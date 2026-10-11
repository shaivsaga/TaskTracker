<?php
header('Content-Type: application/json');
$dir = dirname(__DIR__) . '/data/versions';

// Canonical snapshot id: a plain positive integer, no leading zeros, fits PHP_INT_MAX. Returns the id as a string, or null. The (int) round-trip rejects "000123" and digit strings that overflow; digits-only means no path characters.
function canonical_id($v) {
  if (is_int($v)) $s = (string)$v; elseif (is_string($v)) $s = $v; else return null;
  return (preg_match('/^[1-9]\d{0,18}$/D', $s) && (string)(int)$s === $s) ? $s : null;
}
// true = the file is gone (deleted now, or already absent, e.g. removed by something else after glob()); false = it is still there.
function remove_snapshot($f) {
  if (@unlink($f)) return true;
  clearstatcache(true, $f);
  return !file_exists($f);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $ct = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '')[0]));
  if ($ct !== 'application/json') { http_response_code(415); echo json_encode(['error' => 'Content-Type must be application/json']); exit; }
  $in = json_decode(file_get_contents('php://input'), true);
  $all = is_array($in) && ($in['all'] ?? null) === true;  // strict: only the JSON boolean true deletes everything
  $id = (!$all && is_array($in)) ? canonical_id($in['id'] ?? null) : null;  // validated before the lock is taken or anything is touched
  if (!$all && $id === null) { http_response_code(400); echo json_encode(['error' => 'Bad request']); exit; }

  // Same lock as publish.php, so deletes never interleave with a publish. Bounded wait; fails closed (503) before anything is deleted. If data/ does not exist there is nothing to race with.
  $lock = false;
  if (is_dir(dirname($dir))) {
    $lock = @fopen(dirname($dir) . '/.publish.lock', 'c');
    $locked = false;
    for ($i = 0; $lock && $i < 50 && !$locked; $i++) { $locked = flock($lock, LOCK_EX | LOCK_NB); if (!$locked) usleep(100000); }
    if (!$locked) { if ($lock) fclose($lock); http_response_code(503); echo json_encode(['error' => 'A publish is in progress or locking is unavailable. Try again.']); exit; }
  }
  $failed = [];
  if ($all) {
    foreach (glob("$dir/*.json") ?: [] as $f) { if (!remove_snapshot($f)) $failed[] = basename($f, '.json'); }
  } else {
    if (!remove_snapshot("$dir/$id.json")) $failed[] = $id;
  }
  if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
  if ($failed) { http_response_code(500); echo json_encode(['ok' => false, 'error' => 'Could not delete ' . count($failed) . ' version file(s).', 'failed' => $failed]); exit; }
  echo json_encode(['ok' => true]); exit;
}

$out = [];
foreach (array_reverse(glob("$dir/*.json") ?: []) as $f) {
  $v = json_decode((string)@file_get_contents($f), true);  // a snapshot can vanish (prune/delete) or be mid-write between glob() and read; unreadable/partial = skipped, and no warning text may leak into the JSON
  if (is_array($v)) $out[] = ['id' => basename($f, '.json')] + $v;
}
echo json_encode(['versions' => $out], JSON_UNESCAPED_UNICODE);