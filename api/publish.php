<?php
require __DIR__ . '/_session.php';
require __DIR__ . '/_validate.php';
require_once __DIR__ . '/_board.php';
tt_require_admin();
header('Content-Type: application/json');
$dataDir = dirname(__DIR__) . '/data';
function fail($code, $msg, $extra = []) {
  http_response_code($code);
  echo json_encode(['error' => $msg] + $extra);
  exit;
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
  if (isset($t['files'])) {
    if (!is_array($t['files']) || count($t['files']) > 10) fail(422, "Task $n: files must be a list of up to 10.");
    foreach ($t['files'] as $f) {
      if (!is_array($f) || !is_string($f['id'] ?? null) || !preg_match('/^[a-f0-9]{32}\.(pdf|pptx|docx|jpg|png)$/D', $f['id'])
          || !is_string($f['name'] ?? null) || mb_strlen($f['name']) > 120 || !is_int($f['size'] ?? null) || $f['size'] < 0) fail(422, "Task $n: a file attachment is malformed.");
    }
  }
}
$anns = $in['announcements'] ?? [];
if (count($anns) > 100) fail(422, 'Too many announcements (max 100).');
foreach ($anns as $a) {
  if (!is_array($a) || !is_string($a['text'] ?? null) || mb_strlen($a['text']) > 500 || !is_numeric($a['createdAt'] ?? null)) fail(422, 'An announcement is malformed or longer than 500 characters.');
  if (isset($a['html']) && !announce_html_ok($a['html'])) fail(422, 'An announcement has formatting that is not allowed.');
}

// --- schema 2: the server owns revision, operationId and every deletion marker ------------------
// An old client that posts the pre-schema body is told to refresh rather than silently losing the
// catalog and the markers; the browser keeps its draft either way.
if (($in['schemaVersion'] ?? null) !== 2) fail(409, 'This board needs a newer client. Reload the page and publish again.', ['code' => 'refresh_required']);
if (!tt_operation_id($in['operationId'] ?? null)) fail(400, 'operationId must be 32 lowercase hex characters.');
if (!isset($in['baseRevision']) || !is_int($in['baseRevision']) || $in['baseRevision'] < 0) {
  fail(409, 'This board needs a newer client. Reload the page and publish again.', ['code' => 'refresh_required']);
}
if (!array_key_exists('subjects', $in)) fail(409, 'This board needs a newer client. Reload the page and publish again.', ['code' => 'refresh_required']);
// Authority is server-owned: a request may never supply markers or private state.
foreach (['deletedTasks', 'presets', 'bin', 'retiredDraftIds', 'adminRevision', 'revision'] as $forbidden) {
  if (array_key_exists($forbidden, $in)) fail(400, "The server owns $forbidden; it must not be sent.");
}

[$subjects, $subErr] = tt_subject_validate($in['subjects']);
if ($subErr !== null) fail(422, $subErr);
$idErr = tt_taskids_validate($in['tasks']);
if ($idErr !== null) fail(422, $idErr);
$coverErr = tt_subjects_cover($in['tasks'], $subjects);
if ($coverErr !== null) fail(422, $coverErr);

@ignore_user_abort(true);  // a client disconnect must not stop the script between snapshot and rename

$verDir = $dataDir . '/versions';
if (!is_dir($verDir)) {
  if (!@mkdir($verDir, 0775, true) && !is_dir($verDir)) fail(500, 'Cannot create data directory');
  file_put_contents($verDir . '/.htaccess', "Require all denied\n");
}
if (!is_dir($dataDir . '/admin')) {
  if (!@mkdir($dataDir . '/admin', 0775, true) && !is_dir($dataDir . '/admin')) fail(500, 'Cannot create private data directory');
  file_put_contents($dataDir . '/admin/.htaccess', "Require all denied\n");
}

[$lock, $lockErr] = tt_board_lock($dataDir);
if ($lock === null) fail(503, 'Another publish is in progress or locking is unavailable. Try again.');

$note = mb_substr(trim((string)($in['note'] ?? '')), 0, 80);
if ($clear !== null && $note === '') $note = 'Board cleared';  // makes the clear easy to spot in History
$now = time();  // inside the lock, so publishedAt never goes backwards

try {
  // An interrupted earlier commit is resolved before this one decides anything.
  $rec = tt_recover_pending($dataDir);
  if (isset($rec['error'])) fail(500, 'The last publish could not be resolved. The board is unchanged; retry after the recovery step.', ['code' => $rec['error']]);

  [$liveBoard, $boardErr] = tt_read_board($dataDir);
  if ($boardErr !== null) fail(500, 'The published board cannot be read; refusing to overwrite it.', ['code' => 'board_unreadable', 'detail' => $boardErr]);
  [$admin, $adminErr] = tt_read_admin($dataDir);
  if ($adminErr !== null) fail(500, 'The private admin state cannot be read; refusing to write.', ['code' => 'admin_unreadable']);
  if ($admin === null) $admin = tt_admin_blank();

  $liveRevision = is_array($liveBoard) ? (int)($liveBoard['revision'] ?? 0) : 0;
  $liveTasks = is_array($liveBoard) && is_array($liveBoard['tasks'] ?? null) ? $liveBoard['tasks'] : [];
  $liveSubjects = is_array($liveBoard) && is_array($liveBoard['subjects'] ?? null) ? $liveBoard['subjects'] : [];
  $markers = is_array($liveBoard) && is_array($liveBoard['deletedTasks'] ?? null) ? $liveBoard['deletedTasks'] : [];

  // One canonical body hash: an exact transport retry replays the stored result, a different body
  // with the same token is a conflict. The receipt is bounded to the latest operation.
  $bodyHash = tt_hash_value([
    'baseRevision'  => $in['baseRevision'],
    'tasks'         => $in['tasks'],
    'announcements' => $anns,
    'subjects'      => $subjects,
    'note'          => $note,
    'clearBoard'    => $clear,
  ]);
  $receipt = tt_receipt($admin, $in['operationId'], $bodyHash);
  if ($receipt === 'conflict') fail(409, 'That operation id was already used for a different change. Reload and try again.', ['code' => 'operation_conflict', 'latestRevision' => $liveRevision]);
  if ($receipt === 'replay') {
    $last = $admin['lastOperation'];
    echo json_encode([
      'current'       => $liveBoard,
      'adminRevision' => (int)($last['adminRevision'] ?? $admin['revision']),
      'operationId'   => $in['operationId'],
      'replayed'      => true,
    ]);
    exit;
  }

  // Optimistic concurrency on the public revision, checked under the lock. Counting tasks would
  // miss a catalog-only or marker-only change, so the revision is the only accepted base.
  if ($in['baseRevision'] !== $liveRevision) {
    fail(409, 'The board changed since you loaded it. Review the newer board and publish again.',
      ['code' => 'stale_base', 'latestRevision' => $liveRevision, 'current' => $liveBoard]);
  }

  // A marker is indefinite: no live task may ever reuse a permanently deleted identity.
  $marked = [];
  foreach ($markers as $m) if (is_array($m) && is_string($m['id'] ?? null)) $marked[$m['id']] = true;
  foreach ($in['tasks'] as $t) {
    $id = (string)$t['id'];
    if (isset($marked[$id])) fail(422, "Task \"$id\" was permanently deleted and cannot be published again. Recover it as a new copy instead.", ['code' => 'forbidden_identity']);
  }

  // The empty-board guard keeps its original meaning: an accidental empty publish is refused, and
  // clearing the whole board stays an explicit, counted intent.
  if (!$in['tasks'] && $liveBoard !== null) {
    $liveCount = count($liveTasks);
    if ($clear === null) {
      if ($liveCount > 0) fail(409, 'Refusing to publish an empty board: it would remove every published assignment.');
    } elseif ($liveCount !== $clear['expectedCount']) {
      fail(409, "The live board has changed (it now has $liveCount assignment(s)). Reload and confirm again.");
    }
  } elseif ($clear !== null && $liveBoard === null) {
    fail(409, 'Cannot verify the published board (no current.json); refusing to clear it.');
  }

  // Clear-board removes assignments only; the live announcements and the catalog are carried over.
  $nextAnnouncements = $clear !== null ? array_values(is_array($liveBoard['announcements'] ?? null) ? $liveBoard['announcements'] : []) : array_values($anns);
  if ($clear !== null && !$in['subjects']) $subjects = $liveSubjects;

  // Every live definition this publish removes is archived before the board can lose it - whatever
  // the reason it disappeared (deletion, an old snapshot, an import or a typed clear).
  $submitted = [];
  foreach ($in['tasks'] as $t) $submitted[(string)$t['id']] = true;
  $removed = [];
  $liveSubjectByCode = [];
  foreach ($liveSubjects as $ls) if (is_array($ls) && is_string($ls['code'] ?? null)) $liveSubjectByCode[$ls['code']] = $ls;
  foreach ($liveTasks as $lt) {
    if (!is_array($lt) || !is_string($lt['id'] ?? null) || isset($submitted[$lt['id']])) continue;
    $code = is_string($lt['subject'] ?? null) ? $lt['subject'] : '';
    $subs = $code !== '' ? [isset($liveSubjectByCode[$code]) ? $liveSubjectByCode[$code] : tt_subject_retired($code)] : [];
    $removed[] = ['task' => $lt, 'subjects' => $subs];
  }
  $archiveAdmin = $removed ? tt_archive_records($admin, $removed, 'publish-removal', true) : $admin;

  // Keep the clear-board backup snapshot: it predates this protocol and is cheap insurance.
  if ($clear !== null && count($liveTasks) > 0) {
    $newest = null;
    foreach (glob("$verDir/*.json") ?: [] as $f) { $bn = basename($f, '.json'); if (preg_match('/^\d+$/D', $bn) && ($newest === null || (int)$bn > $newest)) $newest = (int)$bn; }
    $last = $newest === null ? null : json_decode((string)@file_get_contents("$verDir/$newest.json"), true);
    if (!is_array($last) || ($last['tasks'] ?? null) !== $liveTasks) {
      $backup = [
        'publishedAt'   => (int)($liveBoard['publishedAt'] ?? $now),
        'tasks'         => $liveTasks,
        'announcements' => array_values(is_array($liveBoard['announcements'] ?? null) ? $liveBoard['announcements'] : []),
        'subjects'      => $liveSubjects,
        'deletedTasks'  => $markers,
        'note'          => 'Backup before clearing board',
      ];
      if (!tt_write_json_atomic($verDir . '/' . tt_next_snapshot_id($verDir, $now) . '.json', $backup)) {
        fail(500, 'Cannot save a backup of the live board; nothing was changed.');
      }
    }
  }

  // Stamps are server-owned and compare the meaningful fields only.
  $stamped = tt_stamp_tasks($in['tasks'], $liveTasks, $now);

  $nextRevision = $liveRevision + 1;
  if ($nextRevision > 9007199254740991) fail(500, 'The board revision has reached its limit; no further publishes are possible.', ['code' => 'revision_exhausted']);
  $nextBoard = [
    'schemaVersion' => 2,
    'revision'      => $nextRevision,
    'operationId'   => $in['operationId'],
    'publishedAt'   => $now,
    'tasks'         => $stamped,
    'announcements' => $nextAnnouncements,
    'subjects'      => array_values($subjects),
    'deletedTasks'  => array_values($markers),
  ];

  $finalAdmin = $archiveAdmin;
  $finalAdmin['lastOperation'] = [
    'id'             => $in['operationId'],
    'hash'           => $bodyHash,
    'kind'           => 'publish',
    'publicRevision' => $nextRevision,
    'adminRevision'  => (int)$archiveAdmin['revision'],
    'result'         => ['revision' => $nextRevision],
  ];

  $commit = tt_commit_board($dataDir, $liveBoard, $nextBoard, $archiveAdmin, $finalAdmin, $note);
  if (!$commit['ok']) {
    if ($commit['code'] === 'committed_recovery_pending') {
      // Past the commit point the board IS live. Saying "failed" would invite a duplicate retry.
      fail(500, 'The board was published, but the private archive is still being finalized. Reload; no content was lost.', [
        'code'     => 'committed_recovery_pending',
        'revision' => $commit['revision'],
        'operationId' => $commit['operationId'],
      ]);
    }
    fail($commit['status'] ?? 500, 'The board was not published; nothing changed.', ['code' => $commit['code']]);
  }

  echo json_encode([
    'current'       => $nextBoard,
    'adminRevision' => (int)$finalAdmin['revision'],
    'operationId'   => $in['operationId'],
  ]);
} finally {
  tt_board_unlock($lock);
}
