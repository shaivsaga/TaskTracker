<?php
header('Content-Type: application/json');
$config = require __DIR__ . '/config.php';
function fail($code, $msg) { http_response_code($code); echo json_encode(['error' => $msg]); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST only');
$ct = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '')[0]));
if ($ct !== 'application/json') fail(415, 'Content-Type must be application/json');
$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in) || !isset($in['tasks']) || !is_array($in['tasks'])
    || (isset($in['announcements']) && !is_array($in['announcements']))
    || (isset($in['note']) && !is_scalar($in['note']))) fail(400, 'Invalid payload');  // wrong types would otherwise be a TypeError / warning after the lock is taken
@ignore_user_abort(true);  // a client disconnect must not stop the script between snapshot and rename

$dataDir = dirname(__DIR__) . '/data';
$verDir  = $dataDir . '/versions';
if (!is_dir($verDir)) {
  if (!@mkdir($verDir, 0775, true) && !is_dir($verDir)) fail(500, 'Cannot create data directory');
  file_put_contents($verDir . '/.htaccess', "Require all denied\n");
}

// Serialise publishes. Everything below (id, timestamp, snapshot, replace, prune) runs under one lock, so current.json always equals the newest snapshot. Fails closed (503) if the lock cannot be taken, before anything is written.
$lock = @fopen($dataDir . '/.publish.lock', 'c');
$locked = false;
for ($i = 0; $lock && $i < 50 && !$locked; $i++) { $locked = flock($lock, LOCK_EX | LOCK_NB); if (!$locked) usleep(100000); }
if (!$locked) { if ($lock) fclose($lock); fail(503, 'Another publish is in progress or locking is unavailable. Try again.'); }

$now = time();  // taken inside the lock so publishedAt never goes backwards
$current = [
  'publishedAt'   => $now,
  'tasks'         => array_values($in['tasks']),
  'announcements' => array_values($in['announcements'] ?? []),
];
if (!$current['tasks'] && file_exists($dataDir . '/current.json')) {
  // An empty publish is allowed only when the live board is provably empty: current.json must decode to an object whose tasks is an array with zero entries.
  $live = json_decode((string)@file_get_contents($dataDir . '/current.json'), true);
  if (!is_array($live) || !isset($live['tasks']) || !is_array($live['tasks'])) { flock($lock, LOCK_UN); fail(409, 'Cannot verify the published board; refusing to publish an empty one.'); }
  if (count($live['tasks']) > 0) { flock($lock, LOCK_UN); fail(409, 'Refusing to publish an empty board: it would remove every published assignment.'); }
}
$version = $current + ['note' => mb_substr(trim((string)($in['note'] ?? '')), 0, 80)];
$flags = JSON_UNESCAPED_UNICODE;
$curJson = json_encode($current, $flags);
$verJson = json_encode($version, $flags);
if ($curJson === false || $verJson === false) fail(500, 'Encode failed');
$cur = $dataDir . '/current.json';
$tmp = $dataDir . '/.current.' . bin2hex(random_bytes(6)) . '.tmp';  // before the snapshot, so an exception here leaves nothing to clean up

// 1. Snapshot first. New id = max(now, highest existing id + 1). Exclusive create ('x') never overwrites an existing version; if a concurrent request grabs the id, take the next one.
$id = $now;
foreach (glob("$verDir/*.json") ?: [] as $f) { $n = basename($f, '.json'); if (preg_match('/^\d+$/', $n) && (int)$n >= $id) $id = (int)$n + 1; }  // ids only ever increase, so sort order = publish order
for ($i = 0, $fh = false; $i < 50 && !$fh; $i++) { $fh = @fopen("$verDir/$id.json", 'x'); if (!$fh) $id++; }
if (!$fh) fail(500, 'Cannot create version snapshot');
$verFile = "$verDir/$id.json";
$ok = fwrite($fh, $verJson) === strlen($verJson);
$ok = fclose($fh) && $ok;
if (!$ok) { @unlink($verFile); fail(500, 'Cannot write version snapshot'); }

// 2. Replace current.json via a temp file in the same directory + atomic rename. On any failure the old file is untouched.
if (@file_put_contents($tmp, $curJson, LOCK_EX) !== strlen($curJson)) { @unlink($tmp); @unlink($verFile); fail(500, 'Write failed'); }
@chmod($tmp, 0644);  // fixed mode: current.json is public by design; never inherit a stricter (or 0) mode from the old file
if (!@rename($tmp, $cur)) { @unlink($tmp); @unlink($verFile); fail(500, 'Write failed'); }

// 3. Prune. keep_versions missing/invalid -> 20; never fewer than 3; never remove the snapshot just written.
$keep = filter_var(is_array($config) ? ($config['keep_versions'] ?? null) : null, FILTER_VALIDATE_INT);
$keep = ($keep === false || $keep < 1) ? 20 : max(3, $keep);
$files = glob("$verDir/*.json") ?: [];
sort($files);
foreach (array_slice($files, 0, max(0, count($files) - $keep)) as $f) { if ($f !== $verFile) @unlink($f); }
flock($lock, LOCK_UN);
echo json_encode(['current' => $current]);