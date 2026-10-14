<?php
header('Content-Type: application/json');
$config = require __DIR__ . '/config.php';
function fail($code, $msg) { http_response_code($code); echo json_encode(['error' => $msg]); exit; }
// Announcement formatting: only <b> <i> <ul> <li> <br>, no attributes, balanced, text escaped as &amp; &lt; &gt; only. Anything else is rejected, never rewritten.
function announce_html_ok($h) {
  if (!is_string($h) || strlen($h) > 8000 || !mb_check_encoding($h, 'UTF-8')) return false;
  $stack = [];
  foreach (preg_split('/(<[^<>]*>)/', $h, -1, PREG_SPLIT_DELIM_CAPTURE) as $p) {
    if ($p === '') continue;
    if ($p[0] === '<') {
      if ($p === '<br>') continue;
      if (!preg_match('/^<(\/?)(b|i|ul|li)>$/D', $p, $m)) return false;
      if ($m[1] === '') { $stack[] = $m[2]; if (count($stack) > 20) return false; }
      elseif (array_pop($stack) !== $m[2]) return false;
    } elseif (strpbrk($p, '<>') !== false || preg_match('/&(?!(?:amp|lt|gt);)/', $p)) {
      return false;
    }
  }
  return !$stack;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST only');
$ct = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '')[0]));
if ($ct !== 'application/json') fail(415, 'Content-Type must be application/json');
$raw = file_get_contents('php://input');
if (strlen($raw) > 4 * 1024 * 1024) fail(413, 'Board is too large (max 4 MB). Remove or shrink images in notes.');
$in = json_decode($raw, true);
if (!is_array($in) || !isset($in['tasks']) || !is_array($in['tasks'])
    || (isset($in['announcements']) && !is_array($in['announcements']))
    || (isset($in['note']) && !is_scalar($in['note']))) fail(400, 'Invalid payload');  // wrong types would otherwise be a TypeError / warning after the lock is taken
// Explicit clear-board intent. Absent = ordinary publish (unchanged). Present = it must be exactly {confirm:"CLEAR BOARD", expectedCount:<int >= 0>} AND tasks must be a literal empty JSON array (not {}). Anything else is rejected here, before the lock is taken or anything is written.
$clear = null;
if (array_key_exists('clearBoard', $in)) {
  $cb = $in['clearBoard'];
  if (!is_array($cb) || count($cb) !== 2 || ($cb['confirm'] ?? null) !== 'CLEAR BOARD' || !is_int($cb['expectedCount'] ?? null) || $cb['expectedCount'] < 0) fail(400, 'Invalid clearBoard intent');
  $obj = json_decode($raw);  // objects stay stdClass here, so a JSON [] can be told apart from {} (both decode to an empty array above)
  if (!is_object($obj) || !isset($obj->tasks) || !is_array($obj->tasks) || $obj->tasks) fail(400, 'clearBoard requires tasks to be an empty JSON array');
  $clear = $cb;
}
// Shape and size limits. Deliberately generous; they exist to stop malformed data, not to police normal use.
if (count($in['tasks']) > 300) fail(422, 'Too many tasks (max 300).');
$n = 0;
foreach ($in['tasks'] as $t) {
  $n++;
  if (!is_array($t) || array_is_list($t) && $t) fail(422, "Task $n is not an object.");
  if (!is_string($t['id'] ?? null) || $t['id'] === '' || strlen($t['id']) > 64) fail(422, "Task $n needs an id (text, up to 64 characters).");
  if (isset($t['title']) && (!is_string($t['title']) || mb_strlen($t['title']) > 500)) fail(422, "Task $n: title must be text up to 500 characters.");
  foreach (['notes', 'subject'] as $k) {
    if (isset($t[$k]) && !is_string($t[$k])) fail(422, "Task $n: $k must be text.");
  }
  if (isset($t['subject']) && strlen($t['subject']) > 32) fail(422, "Task $n: subject is too long.");
  if (isset($t['dueDate']) && (!is_string($t['dueDate']) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $t['dueDate']))) fail(422, "Task $n: dueDate must look like 2026-10-26.");
  if (isset($t['dueTime']) && (!is_string($t['dueTime']) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D', $t['dueTime']))) fail(422, "Task $n: dueTime must look like 15:30.");
}
$anns = $in['announcements'] ?? [];
if (count($anns) > 100) fail(422, 'Too many announcements (max 100).');
foreach ($anns as $a) {
  if (!is_array($a) || !is_string($a['text'] ?? null) || mb_strlen($a['text']) > 500 || !is_numeric($a['createdAt'] ?? null)) fail(422, 'An announcement is malformed or longer than 500 characters.');
  if (isset($a['html']) && !announce_html_ok($a['html'])) fail(422, 'An announcement has formatting that is not allowed.');
}
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
if ($clear !== null) $current['announcements'] = [];  // clear-board never takes announcements from the request; they are carried over from the live board below
if ($clear !== null && !file_exists($dataDir . '/current.json')) { flock($lock, LOCK_UN); fail(409, 'Cannot verify the published board (no current.json); refusing to clear it.'); }  // a missing file is not proof of an empty board
if (!$current['tasks'] && file_exists($dataDir . '/current.json')) {
  // An empty publish is allowed only when the live board is provably empty: current.json must decode to an object whose tasks is an array with zero entries. A valid clearBoard intent is the only other way through, and it must also match the live count.
  $live = json_decode((string)@file_get_contents($dataDir . '/current.json'), true);
  if (!is_array($live) || !isset($live['tasks']) || !is_array($live['tasks'])) { flock($lock, LOCK_UN); fail(409, 'Cannot verify the published board; refusing to publish an empty one.'); }
  $liveCount = count($live['tasks']);
  if ($clear === null) {
    if ($liveCount > 0) { flock($lock, LOCK_UN); fail(409, 'Refusing to publish an empty board: it would remove every published assignment.'); }
  } else {
    if ($liveCount !== $clear['expectedCount']) { flock($lock, LOCK_UN); fail(409, "The live board has changed (it now has $liveCount assignment(s)). Reload and confirm again."); }
    $current['announcements'] = is_array($live['announcements'] ?? null) ? array_values($live['announcements']) : [];  // assignments only
    if ($liveCount > 0) {
      // Recovery guarantee: the live board must already be in the newest snapshot (it normally is). If not, e.g. after "Clear all history", save a backup snapshot first. If that fails, nothing is changed.
      $newest = null;
      foreach (glob("$verDir/*.json") ?: [] as $f) { $n = basename($f, '.json'); if (preg_match('/^\d+$/', $n) && ($newest === null || (int)$n > $newest)) $newest = (int)$n; }
      $last = $newest === null ? null : json_decode((string)@file_get_contents("$verDir/$newest.json"), true);
      if (!is_array($last) || ($last['tasks'] ?? null) !== $live['tasks']) {
        $bid = max($now, ($newest ?? 0) + 1);
        for ($i = 0, $bh = false; $i < 50 && !$bh; $i++) { $bh = @fopen("$verDir/$bid.json", 'x'); if (!$bh) $bid++; }
        $bJson = json_encode(['publishedAt' => (int)($live['publishedAt'] ?? $now), 'tasks' => $live['tasks'], 'announcements' => is_array($live['announcements'] ?? null) ? array_values($live['announcements']) : [], 'note' => 'Backup before clearing board'], JSON_UNESCAPED_UNICODE);
        $bOk = $bh && $bJson !== false && fwrite($bh, $bJson) === strlen($bJson);
        if ($bh) $bOk = fclose($bh) && $bOk;
        if (!$bOk) { if ($bh) @unlink("$verDir/$bid.json"); flock($lock, LOCK_UN); fail(500, 'Cannot save a backup of the live board; nothing was changed.'); }
      }
    }
  }
}
$note = mb_substr(trim((string)($in['note'] ?? '')), 0, 80);
if ($clear !== null && $note === '') $note = 'Board cleared';  // makes the clear easy to spot in History
$version = $current + ['note' => $note];
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