<?php
require __DIR__ . '/_session.php';
require_once __DIR__ . '/_board.php';
tt_require_admin();
header('Content-Type: application/json');
$dataDir = dirname(__DIR__) . '/data';
$dir = $dataDir . '/versions';

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

function tt_out($body) { echo json_encode($body, JSON_UNESCAPED_UNICODE); exit; }
function tt_err($code, $msg, $extra = []) {
  http_response_code($code);
  echo json_encode(['error' => $msg] + $extra);
  exit;
}

// Read the public board and the private state under the caller's lock, resolving any interrupted
// commit first. Both reads are strict: a damaged file is an error, never an empty default.
function tt_state($dataDir) {
  $rec = tt_recover_pending($dataDir);
  if (isset($rec['error'])) tt_err(500, 'The last operation could not be resolved. Nothing was changed.', ['code' => $rec['error']]);
  [$board, $berr] = tt_read_board($dataDir);
  if ($berr !== null) tt_err(500, 'The published board cannot be read.', ['code' => 'board_unreadable']);
  [$admin, $aerr] = tt_read_admin($dataDir);
  if ($aerr !== null) tt_err(500, 'The private admin state cannot be read.', ['code' => 'admin_unreadable']);
  if ($admin === null) $admin = tt_admin_blank();
  return [$board, $admin];
}

function tt_public_revision($board) { return is_array($board) ? (int)($board['revision'] ?? 0) : 0; }

function tt_marker_ids($board) {
  $out = [];
  foreach (is_array($board) && is_array($board['deletedTasks'] ?? null) ? $board['deletedTasks'] : [] as $m) {
    if (is_array($m) && is_string($m['id'] ?? null)) $out[$m['id']] = true;
  }
  return $out;
}

function tt_live_task($board, $id) {
  foreach (is_array($board) && is_array($board['tasks'] ?? null) ? $board['tasks'] : [] as $t) {
    if (is_array($t) && ($t['id'] ?? null) === $id) return $t;
  }
  return null;
}

// The receipt is bounded to the latest operation: an exact retry replays, a different body conflicts.
function tt_receipt_gate($admin, $operationId, $body) {
  $hash = tt_hash_value($body);
  $r = tt_receipt($admin, $operationId, $hash);
  if ($r === 'conflict') tt_err(409, 'That operation id was already used for a different change.', ['code' => 'operation_conflict']);
  return [$r, $hash];
}

function tt_preset_validate($preset) {
  if (!is_array($preset)) return [null, 'preset must be an object'];
  if (array_key_exists('id', $preset) && $preset['id'] !== null && !tt_bin_id($preset['id'])) return [null, 'preset id must be 32 lowercase hex characters'];
  if (!is_string($preset['name'] ?? null) || !mb_check_encoding($preset['name'], 'UTF-8')) return [null, 'preset needs a name'];
  $name = trim($preset['name']);
  if ($name === '' || mb_strlen($name) > 100) return [null, 'preset name must be 1-100 characters'];
  if (preg_match('/[\x00-\x1f\x7f]/', $name)) return [null, 'preset name has control characters'];
  [$subs, $err] = tt_subject_validate($preset['subjects'] ?? null);
  if ($err !== null) return [null, $err];
  return [['id' => $preset['id'] ?? null, 'name' => $name, 'subjects' => $subs], null];
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $ct = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '')[0]));
  if ($ct !== 'application/json') tt_err(415, 'Content-Type must be application/json');
  $in = json_decode(file_get_contents('php://input'), true);
  $hasAction = is_array($in) && array_key_exists('action', $in);

  // New action forms are dispatched first; mixing them with the legacy history-delete shapes is
  // ambiguous, so it is refused instead of guessed.
  if ($hasAction) {
    if (array_key_exists('id', $in) || array_key_exists('all', $in)) tt_err(400, 'Send either an action or a history deletion, not both.');
    $action = $in['action'];
    $opId = $in['operationId'] ?? null;
    if (!tt_operation_id($opId)) tt_err(400, 'operationId must be 32 lowercase hex characters.');
    if (!is_int($in['baseAdminRevision'] ?? null) || $in['baseAdminRevision'] < 0) {
      tt_err(409, 'This page needs a newer client. Reload and try again.', ['code' => 'refresh_required']);
    }
    if (!in_array($action, ['preset-save', 'preset-delete', 'bin-archive', 'bin-restore', 'bin-permanent-delete'], true)) {
      tt_err(400, 'Unknown action.', ['code' => 'unknown_action']);
    }

    [$lock] = tt_board_lock($dataDir);
    if ($lock === null) tt_err(503, 'Another operation is in progress or locking is unavailable. Try again.');
    try {
      [$board, $admin] = tt_state($dataDir);

      // bin-restore is a read: it validates under the lock, returns the record and changes nothing.
      if ($action === 'bin-restore') {
        $rec = tt_bin_record($admin, $in['binId'] ?? null);
        if ($rec === null) tt_err(404, 'That recycle-bin record does not exist.');
        $id = (string)($rec['task']['id'] ?? '');
        $requiresNewId = isset(tt_marker_ids($board)[$id]) || tt_admin_has_marker($admin, $id);
        tt_out([
          'operationId'   => $opId,
          'adminRevision' => (int)$admin['revision'],
          'task'          => $rec['task'],
          'subjects'      => $rec['subjects'],
          'requiresNewId' => $requiresNewId,
        ]);
      }

      [$receipt, $bodyHash] = tt_receipt_gate($admin, $opId, ['action' => $action] + $in);
      if ($receipt === 'replay') {
        $last = $admin['lastOperation'];
        tt_out(['operationId' => $opId, 'adminRevision' => (int)($last['adminRevision'] ?? $admin['revision'])] + ($last['result'] ?? []) + ['replayed' => true]);
      }
      if ($in['baseAdminRevision'] !== (int)$admin['revision']) {
        tt_err(409, 'The admin state changed since you loaded it. Reload and try again.',
          ['code' => 'stale_admin_base', 'adminRevision' => (int)$admin['revision']]);
      }

      if ($action === 'preset-save') {
        [$preset, $perr] = tt_preset_validate($in['preset'] ?? null);
        if ($perr !== null) tt_err(422, $perr);
        $next = $admin;
        $index = null;
        if ($preset['id'] !== null) {
          foreach ($next['presets'] as $i => $p) if ($p['id'] === $preset['id']) $index = $i;
          if ($index === null) tt_err(404, 'That preset does not exist.');
        }
        $lower = mb_strtolower($preset['name']);
        foreach ($next['presets'] as $i => $p) {
          if ($i !== $index && mb_strtolower(trim((string)$p['name'])) === $lower) tt_err(422, 'Another preset already uses that name.');
        }
        $now = time();
        $stored = ['id' => $preset['id'] ?? bin2hex(random_bytes(16)), 'name' => $preset['name'], 'subjects' => $preset['subjects'], 'updatedAt' => $now];
        if ($index === null) $next['presets'][] = $stored; else $next['presets'][$index] = $stored;
        $next['revision'] = (int)$admin['revision'] + 1;
        $next['lastOperation'] = ['id' => $opId, 'hash' => $bodyHash, 'kind' => $action, 'publicRevision' => tt_public_revision($board), 'adminRevision' => $next['revision'], 'result' => ['preset' => $stored]];
        if (!tt_write_json_atomic($dataDir . '/admin/state.json', $next)) tt_err(500, 'Could not save the preset; nothing changed.');
        tt_out(['operationId' => $opId, 'adminRevision' => $next['revision'], 'preset' => $stored]);
      }

      if ($action === 'preset-delete') {
        $presetId = $in['presetId'] ?? null;
        if (!tt_bin_id($presetId)) tt_err(422, 'presetId must be 32 lowercase hex characters.');
        $next = $admin;
        $kept = [];
        foreach ($next['presets'] as $p) if ($p['id'] !== $presetId) $kept[] = $p;
        if (count($kept) === count($next['presets'])) tt_err(404, 'That preset does not exist.');
        $next['presets'] = array_values($kept);
        $next['revision'] = (int)$admin['revision'] + 1;
        $next['lastOperation'] = ['id' => $opId, 'hash' => $bodyHash, 'kind' => $action, 'publicRevision' => tt_public_revision($board), 'adminRevision' => $next['revision'], 'result' => ['presetId' => $presetId]];
        if (!tt_write_json_atomic($dataDir . '/admin/state.json', $next)) tt_err(500, 'Could not delete the preset; nothing changed.');
        tt_out(['operationId' => $opId, 'adminRevision' => $next['revision'], 'presetId' => $presetId]);
      }

      if ($action === 'bin-archive') {
        $task = $in['task'] ?? null;
        if (!is_array($task) || ($task !== [] && array_is_list($task))) tt_err(422, 'task must be an object.');
        $taskId = $task['id'] ?? null;
        if (!is_string($taskId) || !preg_match(TT_SAFE_ID, $taskId)) tt_err(422, 'task needs a safe id.');
        [$subs, $serr] = tt_subject_validate(is_array($in['subjects'] ?? null) ? $in['subjects'] : []);
        if ($serr !== null) tt_err(422, $serr);
        // Published provenance is proved by the server only: a live definition or an already-proven
        // record for the same identity. A client flag can never create cleanup authority.
        $proven = tt_live_task($board, $taskId) !== null;
        foreach ($admin['bin'] as $r) {
          if (($r['task']['id'] ?? null) === $taskId && ($r['everPublished'] ?? false)) { $proven = true; break; }
        }
        $before = $admin;
        $next = tt_archive_records($admin, [['task' => $task, 'subjects' => $subs]], 'draft-delete', $proven);
        $binId = null;
        $key = tt_archive_key($task, $subs);
        foreach ($next['bin'] as $r) if ($r['archiveKey'] === $key) { $binId = $r['binId']; break; }
        $next['revision'] = (int)$admin['revision'] + 1;
        $next['lastOperation'] = ['id' => $opId, 'hash' => $bodyHash, 'kind' => $action, 'publicRevision' => tt_public_revision($board), 'adminRevision' => $next['revision'], 'result' => ['binId' => $binId]];
        // Archive-only safety writes advance the revision too, so always persist and always bump.
        if (!tt_write_json_atomic($dataDir . '/admin/state.json', $next)) tt_err(500, 'Could not archive the task; the draft was not changed.');
        tt_out(['operationId' => $opId, 'adminRevision' => $next['revision'], 'binId' => $binId]);
      }

      // bin-permanent-delete
      $binId = $in['binId'] ?? null;
      if (!tt_bin_id($binId)) tt_err(422, 'binId must be 32 lowercase hex characters.');
      if (($in['confirm'] ?? null) !== 'DELETE PERMANENTLY') tt_err(400, 'Confirmation is required to delete permanently.', ['code' => 'confirm_required']);
      $rec = tt_bin_record($admin, $binId);
      if ($rec === null) tt_err(404, 'That recycle-bin record does not exist.');
      $id = (string)($rec['task']['id'] ?? '');
      // Absence must be proved at the locked public revision, not inferred from a local draft.
      if (tt_live_task($board, $id) !== null) {
        tt_err(409, 'That task is still published. Publish without it first, then delete permanently.', ['code' => 'still_published', 'latestRevision' => tt_public_revision($board)]);
      }
      if (!is_int($in['baseRevision'] ?? null) || $in['baseRevision'] !== tt_public_revision($board)) {
        tt_err(409, 'The board changed since you loaded it. Reload and try again.',
          ['code' => 'stale_base', 'latestRevision' => tt_public_revision($board)]);
      }

      $withoutRecord = $admin;
      $kept = [];
      foreach ($admin['bin'] as $r) if ($r['binId'] !== $binId) $kept[] = $r;
      $withoutRecord['bin'] = array_values($kept);
      $provenPublished = ($rec['everPublished'] ?? false) === true;

      if (!$provenPublished) {
        // A never-published identity is reserved privately: it authorises no student cleanup.
        $withoutRecord['retiredDraftIds'][] = ['id' => $id, 'deletedAt' => time()];
        $withoutRecord['revision'] = (int)$admin['revision'] + 1;
        $withoutRecord['lastOperation'] = ['id' => $opId, 'hash' => $bodyHash, 'kind' => $action, 'publicRevision' => tt_public_revision($board), 'adminRevision' => $withoutRecord['revision'], 'result' => ['deletedBinId' => $binId]];
        if (!tt_write_json_atomic($dataDir . '/admin/state.json', $withoutRecord)) tt_err(500, 'Could not delete the record; nothing changed.');
        tt_out(['operationId' => $opId, 'adminRevision' => $withoutRecord['revision'], 'deletedBinId' => $binId, 'current' => $board]);
      }

      // A published identity becomes an indefinite public marker. Only the marker changes: tasks,
      // catalog and publishedAt stay exactly as they were.
      $markers = array_values(is_array($board['deletedTasks'] ?? null) ? $board['deletedTasks'] : []);
      $already = false;
      foreach ($markers as $m) if (is_array($m) && ($m['id'] ?? null) === $id) $already = true;
      if (!$already) $markers[] = ['id' => $id, 'deletedAt' => time()];
      $nextRevision = tt_public_revision($board) + 1;
      $nextBoard = $board;
      $nextBoard['schemaVersion'] = 2;
      $nextBoard['revision'] = $nextRevision;
      $nextBoard['operationId'] = $opId;
      $nextBoard['deletedTasks'] = $markers;
      if (!array_key_exists('subjects', $nextBoard)) $nextBoard['subjects'] = [];
      $withoutRecord['revision'] = (int)$admin['revision'] + 1;
      $withoutRecord['lastOperation'] = ['id' => $opId, 'hash' => $bodyHash, 'kind' => $action, 'publicRevision' => $nextRevision, 'adminRevision' => $withoutRecord['revision'], 'result' => ['deletedBinId' => $binId]];
      $commit = tt_commit_board($dataDir, $board, $nextBoard, $admin, $withoutRecord, 'Permanent deletion');
      if (!$commit['ok']) {
        if ($commit['code'] === 'committed_recovery_pending') {
          tt_err(500, 'The deletion marker was written, but the private state is still being finalized.', [
            'code' => 'committed_recovery_pending', 'revision' => $commit['revision'], 'operationId' => $commit['operationId'],
          ]);
        }
        tt_err(($commit['status'] ?? 500), 'The record was not deleted; nothing changed.', ['code' => $commit['code']]);
      }
      tt_out(['operationId' => $opId, 'adminRevision' => $withoutRecord['revision'], 'deletedBinId' => $binId, 'current' => $nextBoard]);
    } finally {
      tt_board_unlock($lock);
    }
  }

  // ---- legacy history deletion: history only, never bin, presets or markers --------------------
  $all = is_array($in) && ($in['all'] ?? null) === true;  // strict: only the JSON boolean true deletes everything
  $id = (!$all && is_array($in)) ? canonical_id($in['id'] ?? null) : null;  // validated before the lock is taken or anything is touched
  if (!$all && $id === null) tt_err(400, 'Bad request');

  // Same lock as publish.php, so deletes never interleave with a publish. Bounded wait; fails closed (503) before anything is deleted. If data/ does not exist there is nothing to race with.
  $lock = false;
  if (is_dir($dataDir)) {
    [$lock] = tt_board_lock($dataDir);
    if ($lock === null) tt_err(503, 'A publish is in progress or locking is unavailable. Try again.');
    $rec = tt_recover_pending($dataDir);
    if (isset($rec['error'])) { tt_board_unlock($lock); tt_err(500, 'The last operation could not be resolved.', ['code' => $rec['error']]); }
  }
  $failed = [];
  if ($all) {
    foreach (glob("$dir/*.json") ?: [] as $f) { if (!remove_snapshot($f)) $failed[] = basename($f, '.json'); }
  } else {
    if (!remove_snapshot("$dir/$id.json")) $failed[] = $id;
  }
  if ($lock) tt_board_unlock($lock);
  if ($failed) tt_err(500, 'Could not delete ' . count($failed) . ' version file(s).', ['ok' => false, 'failed' => $failed]);
  tt_out(['ok' => true]);
}

// ---- reads ------------------------------------------------------------------------------------
$lock = null;
if (is_dir($dataDir)) {
  [$lock] = tt_board_lock($dataDir);
  if ($lock === null) tt_err(503, 'A publish is in progress or locking is unavailable. Try again.');
}
try {
  if ($lock !== null) {
    $rec = tt_recover_pending($dataDir);
    if (isset($rec['error'])) tt_err(500, 'The last operation could not be resolved.', ['code' => $rec['error']]);
  }
  $view = $_GET['view'] ?? null;
  if ($view === 'admin') {
    [$board, $admin] = tt_state($dataDir);
    $summaries = [];
    foreach ($admin['bin'] as $r) {
      $t = is_array($r['task']) ? $r['task'] : [];
      $summaries[] = [
        'binId'         => $r['binId'],
        'taskId'        => (string)($t['id'] ?? ''),
        'title'         => is_string($t['title'] ?? null) ? $t['title'] : '',
        'subject'       => is_string($t['subject'] ?? null) ? $t['subject'] : '',
        'archivedAt'    => (int)$r['archivedAt'],
        'source'        => $r['source'],
        'everPublished' => (bool)$r['everPublished'],
      ];
    }
    tt_out([
      'adminRevision'   => (int)$admin['revision'],
      'presets'         => $admin['presets'],
      'binSummaries'    => $summaries,
      'retiredDraftIds' => $admin['retiredDraftIds'],
      'currentRevision' => tt_public_revision($board),
    ]);
  }
  if ($view === 'bin') {
    [, $admin] = tt_state($dataDir);
    $rec = tt_bin_record($admin, $_GET['id'] ?? null);
    if ($rec === null) tt_err(404, 'That recycle-bin record does not exist.');
    tt_out(['adminRevision' => (int)$admin['revision'], 'record' => $rec]);
  }

  $out = [];
  foreach (array_reverse(glob("$dir/*.json") ?: []) as $f) {
    $v = json_decode((string)@file_get_contents($f), true);  // a snapshot can vanish (prune/delete) or be mid-write between glob() and read; unreadable/partial = skipped, and no warning text may leak into the JSON
    if (is_array($v)) $out[] = ['id' => basename($f, '.json')] + $v;
  }
  tt_out(['versions' => $out]);
} finally {
  tt_board_unlock($lock);
}
