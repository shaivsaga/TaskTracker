<?php
// Server-owned board and private admin-state helpers. Loaded by api/publish.php and
// api/versions.php; this file defines helpers only and must never be reachable as an endpoint.
//
// Two stores, two owners:
//   data/current.json        public board; the server owns revision, operationId and deletedTasks
//   data/admin/state.json    private: named presets, the recycle bin, never-published identity
//                            reservations and the last operation receipt
//   data/admin/pending.json  one in-flight public commit, so an interrupted publish is resolved
//                            honestly instead of guessed from timestamps
//
// A single lock (data/.publish.lock) serialises every writer and every admin reader, and each of
// them resolves a pending operation first. Only the rename of the new current.json makes a publish
// visible; the archive is written before it, so live content is never lost.

// ---- fault seam ------------------------------------------------------------------------------
// Production always answers false. The PHP test sandbox rewrites this one body so a scenario can
// stop the commit at a named step; the trigger is a data-directory file, never a request value.
function tt_fault($name) {
    return false;
}

// ---- changedAt stamps ------------------------------------------------------------------------
// Canonical value of an optional text field: absent, null and the empty string are the same value.
function tt_board_optional_text($task, $key) {
    $v = is_array($task) ? ($task[$key] ?? null) : null;
    return is_string($v) ? $v : '';
}

// Notes compare by content. CRLF and lone CR read as LF, so a textarea round-trip is not an edit.
function tt_board_notes($task) {
    $v = is_array($task) ? ($task['notes'] ?? null) : null;
    return is_string($v) ? str_replace(["\r\n", "\r"], "\n", $v) : '';
}

// Attachments compare by id/name/size only, in canonical order. Request object-key order and the
// order of the attachment list are presentation, not edits.
function tt_board_files($task) {
    $files = is_array($task) && is_array($task['files'] ?? null) ? $task['files'] : [];
    $out = [];
    foreach ($files as $f) {
        if (!is_array($f)) continue;
        $out[] = [
            'id'   => is_string($f['id'] ?? null) ? $f['id'] : '',
            'name' => is_string($f['name'] ?? null) ? $f['name'] : '',
            'size' => is_int($f['size'] ?? null) ? $f['size'] : 0,
        ];
    }
    usort($out, function ($a, $b) {
        return strcmp($a['id'] . "\0" . $a['name'] . "\0" . $a['size'], $b['id'] . "\0" . $b['name'] . "\0" . $b['size']);
    });
    return $out;
}

// The fields L1 makes meaningful. Everything else on a task (extra client fields, device status,
// editor metadata and changedAt itself) is ignored for change detection and preserved on the task.
function tt_board_signature($task) {
    return [
        'title'   => tt_board_optional_text($task, 'title'),
        'notes'   => tt_board_notes($task),
        'dueDate' => tt_board_optional_text($task, 'dueDate'),
        'dueTime' => tt_board_optional_text($task, 'dueTime'),
        'subject' => tt_board_optional_text($task, 'subject'),
        'files'   => tt_board_files($task),
    ];
}

// Return the incoming task list with a server-owned changedAt. $live may be the live board (an
// array with a tasks key) or the live task list itself; incoming changedAt is never trusted.
// A new task is stamped now. A meaningful edit advances to max(now, old+1), so two edits in the
// same wall-clock second still strictly advance. An unchanged task keeps its live stamp exactly:
// missing stays missing and zero stays zero (never fall back to publishedAt or the publish time).
function tt_stamp_tasks($incoming, $live, $nowSeconds) {
    $liveTasks = is_array($live) && isset($live['tasks']) && is_array($live['tasks'])
        ? $live['tasks']
        : (is_array($live) ? $live : []);
    $liveById = [];
    foreach ($liveTasks as $lt) {
        if (is_array($lt) && is_string($lt['id'] ?? null)) $liveById[$lt['id']] = $lt;
    }
    $now = (int)$nowSeconds;
    $stamped = [];
    foreach (is_array($incoming) ? $incoming : [] as $t) {
        if (!is_array($t)) { $stamped[] = $t; continue; }
        unset($t['changedAt']);
        $old = isset($t['id']) && is_string($t['id']) ? ($liveById[$t['id']] ?? null) : null;
        if ($old === null) {
            $t['changedAt'] = $now;
        } elseif (tt_board_signature($t) === tt_board_signature($old)) {
            if (array_key_exists('changedAt', $old)) $t['changedAt'] = $old['changedAt'];
        } else {
            $oldStamp = array_key_exists('changedAt', $old) ? (int)$old['changedAt'] : 0;
            $t['changedAt'] = max($now, $oldStamp + 1);
        }
        $stamped[] = $t;
    }
    return $stamped;
}

// ---- subjects --------------------------------------------------------------------------------
const TT_SUBJECT_MAX = 300;
const TT_SUBJECT_CODE = '/^[A-Za-z0-9][A-Za-z0-9_.\-]{0,31}$/D';

// Validate a Subject list. Returns [list, null] or [null, error]. Every entry must carry a stable
// code, an editable name, a six-digit colour and an explicit active flag: a partially valid
// catalog is rejected as a whole, never silently repaired.
function tt_subject_validate($raw) {
    if (!is_array($raw) || ($raw !== [] && array_is_list($raw) === false)) return [null, 'subjects must be a list'];
    if (count($raw) > TT_SUBJECT_MAX) return [null, 'Too many subjects (max ' . TT_SUBJECT_MAX . ').'];
    $out = [];
    $seen = [];
    foreach ($raw as $i => $s) {
        $n = $i + 1;
        if (!is_array($s) || ($s !== [] && array_is_list($s))) return [null, "Subject $n is not an object."];
        $code = $s['code'] ?? null;
        if (!is_string($code) || !preg_match(TT_SUBJECT_CODE, $code)) return [null, "Subject $n needs a code of 1-32 letters, digits, dot, dash or underscore, starting with a letter or digit."];
        if (in_array($code, ['__proto__', 'prototype', 'constructor'], true)) return [null, "Subject $n uses a reserved code."];
        if (isset($seen[$code])) return [null, "Subject code \"$code\" is used twice."];
        $seen[$code] = true;
        $name = $s['name'] ?? null;
        if (!is_string($name) || !mb_check_encoding($name, 'UTF-8')) return [null, "Subject $n needs a name."];
        $name = trim($name);
        if ($name === '' || mb_strlen($name) > 100) return [null, "Subject $n needs a name of 1-100 characters."];
        if (preg_match('/[\x00-\x1f\x7f]/', $name)) return [null, "Subject $n has control characters in its name."];
        $color = $s['color'] ?? null;
        if (!is_string($color) || !preg_match('/^#[0-9a-fA-F]{6}$/D', $color)) return [null, "Subject $n needs a colour like #58affc."];
        if (!array_key_exists('active', $s) || !is_bool($s['active'])) return [null, "Subject $n needs active to be true or false."];
        $out[] = ['code' => $code, 'name' => $name, 'color' => strtolower($color), 'active' => $s['active']];
    }
    return [$out, null];
}

// Every non-blank task subject must resolve in the submitted catalog. Tasks are never retagged.
function tt_subjects_cover($tasks, $subjects) {
    $known = [];
    foreach ($subjects as $s) $known[$s['code']] = true;
    foreach ($tasks as $i => $t) {
        $code = is_array($t) ? ($t['subject'] ?? '') : '';
        if (!is_string($code) || $code === '') continue;
        if (!isset($known[$code])) return 'Task ' . ($i + 1) . " uses subject \"$code\", which is not in the catalog.";
    }
    return null;
}

// The neutral definition shown for a code that is no longer configured. Display only: it never
// re-tags a task and never becomes an assignable choice.
function tt_subject_retired($code) {
    return ['code' => (string)$code, 'name' => (string)$code, 'color' => '#c3c7d6', 'active' => false];
}

// ---- identifiers -----------------------------------------------------------------------------
const TT_SAFE_ID = '/^[\w.\-]{1,64}$/D';

// Task ids written to the public board. Legacy progress-only keys stay readable in the browser,
// but only this safe grammar is publishable.
function tt_taskids_validate($tasks) {
    $seen = [];
    foreach ($tasks as $i => $t) {
        $id = is_array($t) ? ($t['id'] ?? null) : null;
        if (!is_string($id) || !preg_match(TT_SAFE_ID, $id)) return 'Task ' . ($i + 1) . ' needs an id of 1-64 safe characters.';
        if (in_array($id, ['__proto__', 'prototype', 'constructor'], true)) return 'Task ' . ($i + 1) . ' uses a reserved id.';
        if (isset($seen[$id])) return "Task id \"$id\" appears twice.";
        $seen[$id] = true;
    }
    return null;
}

function tt_operation_id($v) {
    return is_string($v) && preg_match('/^[a-f0-9]{32}$/D', $v) === 1;
}

function tt_bin_id($v) {
    return is_string($v) && preg_match('/^[a-f0-9]{32}$/D', $v) === 1;
}

// ---- canonical JSON --------------------------------------------------------------------------
// Key-sorted, so an equal value always hashes equally no matter how the array was built.
function tt_canon($v) {
    if (is_array($v)) {
        if ($v !== [] && array_is_list($v)) return array_map('tt_canon', $v);
        $out = [];
        $keys = array_keys($v);
        sort($keys, SORT_STRING);
        foreach ($keys as $k) $out[$k] = tt_canon($v[$k]);
        return $out;
    }
    return $v;
}

function tt_canon_json($v) {
    $j = json_encode(tt_canon($v), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return $j === false ? null : $j;
}

function tt_hash_value($v) {
    $j = tt_canon_json($v);
    return $j === null ? null : hash('sha256', $j);
}

// The public board's content hash, used only to tell "the commit happened" from "it did not".
function tt_board_hash($board) {
    if (!is_array($board)) return hash('sha256', 'absent');
    $copy = $board;
    unset($copy['revision'], $copy['operationId']);
    return tt_hash_value($copy);
}

// ---- storage ---------------------------------------------------------------------------------
function tt_data_dir() { return dirname(__DIR__) . '/data'; }
function tt_admin_dir() { return tt_data_dir() . '/admin'; }

// Complete-length write to a unique same-directory temp file, flush, close, then rename. A short
// write is a failure, not a partial file, and the destination keeps its old bytes until the rename.
function tt_write_atomic($path, $json, $mode = 0644) {
    if (!is_string($json)) return false;
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) return false;
    $tmp = $dir . '/.' . basename($path) . '.' . bin2hex(random_bytes(6)) . '.tmp';
    $fh = @fopen($tmp, 'wb');
    if (!$fh) return false;
    $ok = fwrite($fh, $json) === strlen($json);
    $ok = fflush($fh) && $ok;
    $ok = fclose($fh) && $ok;
    if (!$ok) { @unlink($tmp); return false; }
    @chmod($tmp, $mode);
    if (!@rename($tmp, $path)) { @unlink($tmp); return false; }
    return true;
}

function tt_write_json_atomic($path, $value, $mode = 0644) {
    $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return $json === false ? false : tt_write_atomic($path, $json, $mode);
}

// Strict reads: an absent file means "nothing stored yet" (null, no error). Anything present but
// unreadable or malformed is an error, never an empty default: an empty board must be provable.
function tt_read_json_strict($path) {
    if (!is_file($path)) return [null, null];
    $raw = @file_get_contents($path);
    if ($raw === false) return [null, 'cannot read ' . basename($path)];
    $v = json_decode($raw, true);
    if (!is_array($v)) return [null, basename($path) . ' is not readable JSON'];
    return [$v, null];
}

function tt_read_board($dataDir) {
    return tt_read_json_strict($dataDir . '/current.json');
}

// ---- private admin state ---------------------------------------------------------------------
function tt_admin_blank() {
    return [
        'schemaVersion'   => 1,
        'revision'        => 1,
        'initialized'     => true,
        'presets'         => [],
        'bin'             => [],
        'retiredDraftIds' => [],
        'lastOperation'   => null,
    ];
}

// Validate a stored private state. A damaged file is an error, never a fresh store: replacing it
// would destroy the only copy of archived tasks.
function tt_admin_validate($a) {
    if (!is_array($a)) return 'admin state is not an object';
    if (($a['schemaVersion'] ?? null) !== 1) return 'admin state schemaVersion is not 1';
    if (!is_int($a['revision'] ?? null) || $a['revision'] < 1) return 'admin state revision is invalid';
    if (($a['initialized'] ?? null) !== true) return 'admin state is not initialized';
    foreach (['presets', 'bin', 'retiredDraftIds'] as $k) {
        if (!is_array($a[$k] ?? null) || !array_is_list($a[$k])) return "admin state $k is not a list";
    }
    foreach ($a['presets'] as $p) {
        if (!is_array($p) || !tt_bin_id($p['id'] ?? null)) return 'a preset has an invalid id';
        if (!is_string($p['name'] ?? null) || trim($p['name']) === '') return 'a preset has no name';
        [$subs, $err] = tt_subject_validate($p['subjects'] ?? null);
        if ($err !== null) return 'preset "' . $p['name'] . '": ' . $err;
    }
    foreach ($a['bin'] as $r) {
        if (!is_array($r) || !tt_bin_id($r['binId'] ?? null)) return 'a bin record has an invalid id';
        if (!is_array($r['task'] ?? null) && ($r['task'] ?? null) !== []) return 'a bin record has an invalid task';
        if (!is_array($r['subjects'] ?? null)) return 'a bin record has invalid subjects';
        if (!is_int($r['archivedAt'] ?? null)) return 'a bin record has an invalid archivedAt';
        if (!in_array($r['source'] ?? null, ['draft-delete', 'publish-removal'], true)) return 'a bin record has an invalid source';
        if (!is_bool($r['everPublished'] ?? null)) return 'a bin record has an invalid everPublished';
        if (!is_string($r['archiveKey'] ?? null)) return 'a bin record has no archiveKey';
    }
    foreach ($a['retiredDraftIds'] as $r) {
        if (!is_array($r) || !is_string($r['id'] ?? null) || !is_int($r['deletedAt'] ?? null)) return 'a retired draft id is invalid';
    }
    if (($a['lastOperation'] ?? null) !== null) {
        $o = $a['lastOperation'];
        if (!is_array($o) || !tt_bin_id($o['id'] ?? null) || !is_string($o['hash'] ?? null) || !is_string($o['kind'] ?? null)) return 'the last operation receipt is invalid';
    }
    return null;
}

function tt_read_admin($dataDir) {
    [$a, $err] = tt_read_json_strict($dataDir . '/admin/state.json');
    if ($err !== null) return [null, $err];
    if ($a === null) return [null, null];
    $bad = tt_admin_validate($a);
    return $bad === null ? [$a, null] : [null, $bad];
}

// ---- recycle bin -----------------------------------------------------------------------------
// The archive compares content, not identity alone: archiving a draft must never overwrite the
// previously published copy of the same id, and retrying one archive must not duplicate it.
function tt_task_definition($task) {
    $copy = $task;
    if (is_array($copy)) unset($copy['changedAt']);
    return $copy;
}

function tt_archive_key($task, $subjects) {
    $sorted = array_map('tt_canon', is_array($subjects) ? $subjects : []);
    usort($sorted, function ($x, $y) { return strcmp(json_encode($x), json_encode($y)); });
    return (string)tt_hash_value([
        'id'       => is_array($task) ? (string)($task['id'] ?? '') : '',
        'task'     => tt_canon(tt_task_definition($task)),
        'subjects' => $sorted,
    ]);
}

// Merge archive records into a private state. Identical content reuses its record; a later
// server-proven publication only upgrades everPublished, never downgrades it.
function tt_archive_records($admin, $records, $source, $everPublished) {
    $next = $admin ?? tt_admin_blank();
    if ($next['bin'] === [] && !is_array($records)) return $next;
    $byKey = [];
    foreach ($next['bin'] as $i => $r) $byKey[$r['archiveKey']] = $i;
    $changed = false;
    $now = time();
    foreach ($records as $rec) {
        $task = $rec['task'];
        $subs = $rec['subjects'] ?? [];
        $key = tt_archive_key($task, $subs);
        if (isset($byKey[$key])) {
            $i = $byKey[$key];
            if ($everPublished && ($next['bin'][$i]['everPublished'] ?? false) !== true) {
                $next['bin'][$i]['everPublished'] = true;
                $changed = true;
            }
            continue;
        }
        $byKey[$key] = count($next['bin']);
        $next['bin'][] = [
            'binId'         => bin2hex(random_bytes(16)),
            'task'          => tt_task_definition($task),
            'subjects'      => array_values(array_map('tt_canon', $subs)),
            'archivedAt'    => $now,
            'source'        => $source,
            'everPublished' => (bool)$everPublished,
            'archiveKey'    => $key,
        ];
        $changed = true;
    }
    if ($changed) $next['revision'] = (int)$admin['revision'] + 1;
    return $next;
}

function tt_admin_has_marker($a, $id) {
    foreach ($a['retiredDraftIds'] as $r) if ($r['id'] === $id) return true;
    return false;
}

function tt_bin_record($a, $binId) {
    foreach ($a['bin'] as $r) if ($r['binId'] === $binId) return $r;
    return null;
}

// ---- shared lock and pending recovery --------------------------------------------------------
// One lock for every writer and every admin reader. Bounded wait, fail closed, never proceed blind.
function tt_board_lock($dataDir) {
    $fh = @fopen($dataDir . '/.publish.lock', 'c');
    if (!$fh) return [null, 'lockfile'];
    $locked = false;
    for ($i = 0; $i < 50 && !$locked; $i++) {
        $locked = flock($fh, LOCK_EX | LOCK_NB);
        if (!$locked) usleep(100000);
    }
    if (!$locked) { fclose($fh); return [null, 'busy']; }
    return [$fh, null];
}

function tt_board_unlock($fh) {
    if ($fh) { flock($fh, LOCK_UN); fclose($fh); }
}

function tt_recover_pending($dataDir) {
    [$pending, $perr] = tt_read_json_strict($dataDir . '/admin/pending.json');
    if ($perr !== null) return ['error' => 'recovery_pending_invalid'];
    if ($pending === null) return ['recovered' => false];
    if (($pending['schemaVersion'] ?? null) !== 1 || !tt_operation_id($pending['operationId'] ?? null)
        || !is_int($pending['oldPublicRevision'] ?? null) || !is_int($pending['targetPublicRevision'] ?? null)) {
        return ['error' => 'recovery_pending_invalid'];
    }
    [$board, $berr] = tt_read_board($dataDir);
    if ($berr !== null) return ['error' => 'recovery_board_unreadable'];
    $rev = is_array($board) ? (int)($board['revision'] ?? 0) : 0;
    $hash = tt_board_hash($board);
    $op = is_array($board) ? ($board['operationId'] ?? null) : null;

    $committed = $rev === $pending['targetPublicRevision'] && $op === $pending['operationId'];
    if ($committed) {
        $final = $pending['finalAdminState'] ?? null;
        if (!is_array($final) || tt_admin_validate($final) !== null) return ['error' => 'recovery_pending_invalid'];
        if (!tt_write_json_atomic($dataDir . '/admin/state.json', $final)) return ['error' => 'recovery_finalize_failed'];
        if (!@unlink($dataDir . '/admin/pending.json')) return ['error' => 'recovery_pending_stuck'];
        return ['recovered' => true, 'committed' => true, 'revision' => $rev];
    }
    $notCommitted = $rev === $pending['oldPublicRevision'] && $hash === ($pending['oldPublicHash'] ?? null);
    if ($notCommitted) {
        $sid = $pending['snapshotId'] ?? null;
        if (is_string($sid) && preg_match('/^[1-9]\d{0,18}$/D', $sid)) @unlink($dataDir . '/versions/' . $sid . '.json');
        if (!@unlink($dataDir . '/admin/pending.json')) return ['error' => 'recovery_pending_stuck'];
        return ['recovered' => true, 'committed' => false, 'revision' => $rev];
    }
    return ['error' => 'recovery_state_conflict'];
}

// ---- ordered commit --------------------------------------------------------------------------
/**
 * The one place a public board changes. Ordering is the guarantee:
 *   archive -> pending -> snapshot -> current.json rename (commit) -> final private state -> pending removed
 * A failure before the rename leaves the old board byte-identical and removes the provisional
 * snapshot. A failure after it reports committed_recovery_pending: the public board is already
 * complete, and the recorded pending state lets the next admin request finish the private half.
 * Returns ['ok'=>bool, ...].
 */
function tt_commit_board($dataDir, $oldBoard, $nextBoard, $archiveAdmin, $finalAdmin, $snapshotNote) {
    $adminFile = $dataDir . '/admin/state.json';
    $pendingFile = $dataDir . '/admin/pending.json';
    $verDir = $dataDir . '/versions';
    if (!is_dir($verDir) && !@mkdir($verDir, 0775, true) && !is_dir($verDir)) return ['ok' => false, 'code' => 'storage', 'status' => 500];
    if (!is_dir($dataDir . '/admin') && !@mkdir($dataDir . '/admin', 0775, true) && !is_dir($dataDir . '/admin')) return ['ok' => false, 'code' => 'storage', 'status' => 500];

    // 1. Archive-only private state. On failure nothing public has changed yet and the caller
    //    still has its draft, which is exactly the safe outcome.
    if (tt_fault('archive-save')) return ['ok' => false, 'code' => 'archive_write', 'status' => 500];
    if (!tt_write_json_atomic($adminFile, $archiveAdmin)) return ['ok' => false, 'code' => 'archive_write', 'status' => 500];

    // 2. The recovery record, before anything else can be half-done.
    if (tt_fault('pending-save')) return ['ok' => false, 'code' => 'pending_write', 'status' => 500];
    $snapshotId = tt_next_snapshot_id($verDir, time());
    $pending = [
        'schemaVersion'       => 1,
        'operationId'         => $nextBoard['operationId'],
        'kind'                => 'publish',
        'oldPublicRevision'   => is_array($oldBoard) ? (int)($oldBoard['revision'] ?? 0) : 0,
        'oldPublicHash'       => tt_board_hash($oldBoard),
        'targetPublicRevision' => (int)$nextBoard['revision'],
        'targetPublicHash'    => tt_board_hash($nextBoard),
        'snapshotId'          => $snapshotId,
        'finalAdminState'     => $finalAdmin,
    ];
    if (!tt_write_json_atomic($pendingFile, $pending)) return ['ok' => false, 'code' => 'pending_write', 'status' => 500];

    // 3. The public snapshot, complete before it appears under its final name.
    if (tt_fault('snapshot-save')) {
        @unlink($pendingFile);
        return ['ok' => false, 'code' => 'snapshot_write', 'status' => 500];
    }
    $snapshot = $nextBoard;
    $snapshot['note'] = (string)$snapshotNote;
    $verFile = $verDir . '/' . $snapshotId . '.json';
    if (!tt_write_json_atomic($verFile, $snapshot)) {
        @unlink($verFile);
        @unlink($pendingFile);
        return ['ok' => false, 'code' => 'snapshot_write', 'status' => 500];
    }

    // 4. The commit point.
    if (tt_fault('pre-current-rename')) {
        @unlink($verFile); @unlink($pendingFile);
        return ['ok' => false, 'code' => 'commit_failed', 'status' => 500];
    }
    if (tt_fault('short-write')) {
        @unlink($verFile); @unlink($pendingFile);
        return ['ok' => false, 'code' => 'commit_failed', 'status' => 500];
    }
    if (!tt_write_json_atomic($dataDir . '/current.json', $nextBoard, 0644)) {
        @unlink($verFile); @unlink($pendingFile);
        return ['ok' => false, 'code' => 'commit_failed', 'status' => 500];
    }

    // 5. Finalize. Past this line the publish IS committed; an error here must say so.
    if (tt_fault('post-current-rename')) {
        return ['ok' => false, 'code' => 'committed_recovery_pending', 'status' => 500,
            'operationId' => $nextBoard['operationId'], 'revision' => (int)$nextBoard['revision']];
    }
    if (!tt_write_json_atomic($adminFile, $finalAdmin) || !@unlink($pendingFile)) {
        return ['ok' => false, 'code' => 'committed_recovery_pending', 'status' => 500,
            'operationId' => $nextBoard['operationId'], 'revision' => (int)$nextBoard['revision']];
    }

    // 6. Best-effort retention: history is a convenience, the bin is the recovery record.
    tt_prune_versions($verDir, $verFile);
    return ['ok' => true, 'revision' => (int)$nextBoard['revision'], 'operationId' => $nextBoard['operationId'], 'snapshotId' => $snapshotId];
}

// Snapshot ids only ever increase, so their sort order is publish order.
function tt_next_snapshot_id($verDir, $now) {
    $id = (int)$now;
    foreach (glob($verDir . '/*.json') ?: [] as $f) {
        $n = basename($f, '.json');
        if (preg_match('/^\d+$/D', $n) && (int)$n >= $id) $id = (int)$n + 1;
    }
    return (string)$id;
}

function tt_prune_versions($verDir, $keepFile) {
    $keep = 20;
    if (is_file(dirname($verDir) . '/config.php')) {
        $config = require dirname($verDir) . '/config.php';
        $v = filter_var(is_array($config) ? ($config['keep_versions'] ?? null) : null, FILTER_VALIDATE_INT);
        if ($v !== false && $v >= 1) $keep = max(3, $v);
    }
    $files = glob($verDir . '/*.json') ?: [];
    sort($files);
    foreach (array_slice($files, 0, max(0, count($files) - $keep)) as $f) {
        if ($f !== $keepFile) @unlink($f);
    }
}

// ---- operation receipts ----------------------------------------------------------------------
// One bounded receipt: an exact replay of the latest intent returns its recorded result, the same
// token with a different body conflicts. There is deliberately no unbounded operation log.
function tt_receipt($admin, $operationId, $hash) {
    $last = $admin['lastOperation'] ?? null;
    if (!is_array($last) || $last['id'] !== $operationId) return 'new';
    return $last['hash'] === $hash ? 'replay' : 'conflict';
}
