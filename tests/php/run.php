<?php
declare(strict_types=1);
require __DIR__ . '/../../api/_validate.php';
require __DIR__ . '/../../api/_session.php';  // tt_https() / tt_guard_dir(); nothing here calls out to the network
require __DIR__ . '/e2e_lib.php';            // throwaway-sandbox boot of the real publish/versions endpoints

$fails = 0;
function check(string $name, bool $ok): void {
    global $fails;
    if (!$ok) { $fails++; echo "FAIL: $name\n"; } else { echo "ok:   $name\n"; }
}

// announce_html_ok
check('plain text', announce_html_ok('hello'));
check('bold', announce_html_ok('<b>hi</b>'));
check('list', announce_html_ok('<ul><li>x</li></ul>'));
check('line break', announce_html_ok('a<br>b'));
check('escaped ampersand', announce_html_ok('a &amp; b'));
check('bare ampersand rejected', !announce_html_ok('a & b'));
check('unclosed tag rejected', !announce_html_ok('<b>hi'));
check('crossed tags rejected', !announce_html_ok('<i><b>x</i></b>'));
check('script rejected', !announce_html_ok('<script>x</script>'));
check('attribute rejected', !announce_html_ok('<b onclick="x">hi</b>'));
check('link rejected', !announce_html_ok('<a href="x">y</a>'));
check('stray angle bracket rejected', !announce_html_ok('1 < 2'));
check('too long rejected', !announce_html_ok(str_repeat('a', 8001)));
check('non-string rejected', !announce_html_ok(123));

// clean_payload
$ok = ['v' => 1, 'progress' => ['t1' => ['status' => 'done', 'movedAt' => 1700000000000]]];
$r = clean_payload($ok);
check('valid payload accepted', $r !== null && $r['progress']->t1['status'] === 'done');
check('empty progress accepted', clean_payload(['v' => 1, 'progress' => []]) !== null);
check('wrong version rejected', clean_payload(['v' => 2, 'progress' => []]) === null);
check('progress not an array rejected', clean_payload(['v' => 1, 'progress' => 'x']) === null);
check('bad status rejected', clean_payload(['v' => 1, 'progress' => ['t1' => ['status' => 'finished', 'movedAt' => 1]]]) === null);
check('bad id rejected', clean_payload(['v' => 1, 'progress' => ['bad id!' => ['status' => 'done', 'movedAt' => 1]]]) === null);
check('negative time rejected', clean_payload(['v' => 1, 'progress' => ['t1' => ['status' => 'done', 'movedAt' => -1]]]) === null);
check('text time rejected', clean_payload(['v' => 1, 'progress' => ['t1' => ['status' => 'done', 'movedAt' => 'x']]]) === null);
check('valid draft kept', ($d = clean_payload($ok + ['draft' => ['tasks' => [['id' => 'a']], 'announcements' => []]])) !== null && count($d['draft']['tasks']) === 1);
check('draft tasks not an array rejected', clean_payload($ok + ['draft' => ['tasks' => 'x']]) === null);
check('draft task not an object rejected', clean_payload($ok + ['draft' => ['tasks' => ['x']]]) === null);

// M4: the draft half of a transfer now gets the same per-field rules as the publish path.
$draft = fn(array $d) => clean_payload(['v' => 1, 'progress' => [], 'draft' => $d]);
check('draft announcement kept', $draft(['tasks' => [], 'announcements' => [['text' => 'hi', 'createdAt' => 1]]]) !== null);
check('draft announcement allowed html kept', $draft(['tasks' => [], 'announcements' => [['text' => 'hi', 'createdAt' => 1, 'html' => '<b>hi</b>']]]) !== null);
check('draft announcement script rejected', $draft(['tasks' => [], 'announcements' => [['text' => 'hi', 'createdAt' => 1, 'html' => '<script>alert(1)</script>']]]) === null);
check('draft announcement attribute rejected', $draft(['tasks' => [], 'announcements' => [['text' => 'hi', 'createdAt' => 1, 'html' => '<b onclick="x">hi</b>']]]) === null);
check('draft announcement non-string html rejected', $draft(['tasks' => [], 'announcements' => [['text' => 'hi', 'createdAt' => 1, 'html' => ['x']]]]) === null);
check('draft announcement without text rejected', $draft(['tasks' => [], 'announcements' => [['createdAt' => 1]]]) === null);
check('draft announcement without createdAt rejected', $draft(['tasks' => [], 'announcements' => [['text' => 'hi']]]) === null);
check('draft announcement text too long rejected', $draft(['tasks' => [], 'announcements' => [['text' => str_repeat('a', 501), 'createdAt' => 1]]]) === null);
check('draft task without id rejected', $draft(['tasks' => [['title' => 'x']], 'announcements' => []]) === null);
check('draft task title too long rejected', $draft(['tasks' => [['id' => 'a', 'title' => str_repeat('a', 501)]], 'announcements' => []]) === null);
check('draft task subject too long rejected', $draft(['tasks' => [['id' => 'a', 'subject' => str_repeat('a', 33)]], 'announcements' => []]) === null);
check('draft task bad dueDate rejected', $draft(['tasks' => [['id' => 'a', 'dueDate' => '26 October']], 'announcements' => []]) === null);
check('draft task bad dueTime rejected', $draft(['tasks' => [['id' => 'a', 'dueTime' => '3pm']], 'announcements' => []]) === null);
check('draft task bad file rejected', $draft(['tasks' => [['id' => 'a', 'files' => [['id' => 'nope', 'name' => 'n', 'size' => 1]]]], 'announcements' => []]) === null);
check('draft task real shape accepted', $draft(['tasks' => [['id' => 'abc123', 'title' => 'Essay', 'dueDate' => '2026-11-02', 'dueTime' => '15:30', 'notes' => 'plain', 'subject' => 'GENSCI', 'files' => [['id' => str_repeat('a', 32) . '.pdf', 'name' => 'a.pdf', 'size' => 12]]]], 'announcements' => []]) !== null);

// M3: Secure is the default; only a positively local host opts out.
function https_with(array $env): bool { $old = $_SERVER; $_SERVER = $env; $r = tt_https(); $_SERVER = $old; return $r; }
check('https: server flag', https_with(['HTTPS' => 'on']));
check('https: forwarded proto', https_with(['HTTP_X_FORWARDED_PROTO' => 'https', 'HTTP_HOST' => 'dsct.dev']));
check('https: missing header on a public host stays Secure', https_with(['HTTP_HOST' => 'dsct.dev']));
check('https: appended header stays Secure', https_with(['HTTP_X_FORWARDED_PROTO' => 'http, https', 'HTTP_HOST' => 'dsct.dev']));
check('https: spoofed http stays Secure', https_with(['HTTP_X_FORWARDED_PROTO' => 'http', 'HTTP_HOST' => 'dsct.dev']));
check('https: no host at all stays Secure', https_with([]));
check('https: localhost over http is not Secure', !https_with(['HTTP_HOST' => 'localhost']));
check('https: 127.0.0.1 with port is not Secure', !https_with(['HTTP_HOST' => '127.0.0.1:8080']));
check('https: [::1] with port is not Secure', !https_with(['HTTP_HOST' => '[::1]:8080']));

// M6: the deny-all written into data/sessions/, against a temp dir so the real one is untouched.
$tmp = sys_get_temp_dir() . '/tt-guard-' . bin2hex(random_bytes(4));
check('guard: temp dir created', mkdir($tmp, 0777, true));
tt_guard_dir($tmp);
check('guard written', is_file($tmp . '/.htaccess') && str_contains((string)file_get_contents($tmp . '/.htaccess'), 'Require all denied'));
file_put_contents($tmp . '/.htaccess', 'mine');
tt_guard_dir($tmp);
check('guard keeps an existing file', file_get_contents($tmp . '/.htaccess') === 'mine');
unlink($tmp . '/.htaccess');
rmdir($tmp);

// ---------------------------------------------------------------------------
// End-to-end: the REAL api/publish.php and api/versions.php, booted from a throwaway copy of api/
// under the PHP built-in server (see tests/php/e2e_lib.php). Each writer is a script that exits,
// reads php://input and needs an admin session, so it cannot be exercised in-process; this runs the
// actual files over loopback and never touches the repository's own data/ directory.
// The two 503 checks wait out publish.php's own bounded lock retry (50 x 100 ms), so this block
// takes roughly ten seconds.
// ---------------------------------------------------------------------------
$sb = tt_e2e_start();
if (!$sb) {
    tt_e2e_skip('publish/versions end-to-end (needs proc_open + allow_url_fopen + a loopback listener)');
} else {
    register_shutdown_function(function () use ($sb) { tt_e2e_stop($sb); });
    $hex  = hash('sha256', 'body-one');
    $live = function () use ($sb) { return tt_e2e_json_file($sb, 'data/current.json'); };
    $refs = function ($t) { return $t === null ? [] : tt_e2e_refs($t); };
    // A reference only endangers data when the body it names is really stored, so "stored" is the
    // discriminator the F1 gate below uses.
    $storedRefs = function ($t) use ($sb) {
        $out = [];
        foreach (tt_e2e_refs($t) as $rr) if (is_file($sb['root'] . '/data/bodies/' . $rr['id'] . '.json')) $out[] = $rr;
        return $out;
    };
    $storedBodyIds = function (?array $board) use ($storedRefs) {
        $out = [];
        foreach (is_array($board['tasks'] ?? null) ? $board['tasks'] : [] as $t) {
            foreach ($storedRefs($t) as $rr) $out[$rr['id']] = $rr['key'];
        }
        return $out;
    };

    // --- A. publish basics, the F1 reference invariant, server-stamped changedAt ---
    $r = tt_e2e_get($sb, '/api/publish.php');
    check('e2e: GET publish.php is 405 (the sandbox admin session authenticates)', $r !== null && $r['status'] === 405);
    file_put_contents($sb['root'] . '/api/.htpasswd', "sentinel\n");
    // t1 seeds the exact keys F1/F3 are about; big carries a body far over any proposed 8 KB
    // threshold, so a server that externalises bodies will have created data/bodies/<id>.json here.
    $p1 = tt_e2e_publish($sb, ['tasks' => [
        ['id' => 't1', 'title' => 'Essay', 'notes' => '<b>big body</b>', 'closedAt' => 123,
         'notesRef' => ['id' => $hex, 'len' => 12, 'excerpt' => 'big body'], 'zzz' => 'junk'],
        ['id' => 'big', 'title' => 'Big', 'notes' => '<p>' . str_repeat('x', 20000) . '</p>'],
    ], 'announcements' => [['text' => 'hi', 'createdAt' => 1]]]);
    check('e2e: publish is 200 and writes current.json + one snapshot',
        $p1 !== null && $p1['status'] === 200 && is_file($sb['root'] . '/data/current.json') && tt_e2e_count($sb, 'data/versions/*.json') === 1);
    $t1 = tt_e2e_task($live(), 't1');
    check('e2e F1: unknown task keys are persisted verbatim today (notesRef, closedAt, junk)',
        ($t1['notesRef']['id'] ?? null) === $hex && ($t1['closedAt'] ?? null) === 123 && ($t1['zzz'] ?? null) === 'junk');
    $bodiesBefore = tt_e2e_count($sb, 'data/bodies/*.json');
    $beforeF1 = $live();
    $storedBefore = $storedBodyIds($beforeF1);
    // The exact F1 scenario: the live board carries body references, the incoming board has empty
    // notes and no reference keys at all. Under S1b this must not end in a successful publish that
    // leaves a stored body unreferenced: the server must refuse it (option A) or carry the reference
    // over (option B). While bodies are still inline there is nothing to orphan, so this is vacuous
    // by design -- and it turns live the day data/bodies/ appears, which is exactly when F1 stops
    // being theoretical. It fails only in the dangerous combination (bodies stored, no guard).
    $p2 = tt_e2e_publish($sb, ['tasks' => [
        ['id' => 't1', 'title' => 'Essay', 'notes' => ''],
        ['id' => 'big', 'title' => 'Big', 'notes' => ''],
    ], 'announcements' => [['text' => 'hi', 'createdAt' => 1]]]);
    $after = $live();
    $refused  = $p2 === null || $p2['status'] !== 200;
    $orphaned = array_diff_key($storedBefore, $storedBodyIds($after));
    check('e2e F1: a successful publish never leaves a stored body unreferenced (refusal or carry-over)',
        $refused || $orphaned === []);
    check('e2e F1: the board still parses and both tasks survive that same publish',
        $p2 !== null && is_array($after) && tt_e2e_task($after, 't1') !== null && tt_e2e_task($after, 'big') !== null);
    $dangling = [];
    foreach (is_array($after['tasks'] ?? null) ? $after['tasks'] : [] as $t) {
        foreach (tt_e2e_refs($t) as $rr) if (!is_file($sb['root'] . '/data/bodies/' . $rr['id'] . '.json')) $dangling[] = $rr['id'];
    }
    check('e2e F1: no persisted body reference is left dangling', $dangling === []);
    echo 'note: F1 scenario today: HTTP ' . ($p2['status'] ?? '?') . ', stored bodies: ' . $bodiesBefore
        . ', references to stored bodies orphaned by it: ' . count($orphaned)
        . ', seeded notesRef kept: ' . ($refs(tt_e2e_task($after, 't1')) === [] ? 'no (dropped, as today)' : 'yes') . "\n";
    // F3's file boundary: a traversal-shaped reference must never become a path outside data/.
    $p3 = tt_e2e_publish($sb, ['tasks' => [['id' => 't1', 'title' => 'Essay', 'notes' => 'x', 'notesRef' => '../../api/.htpasswd']]]);
    check('e2e F3: a traversal-shaped notesRef never reads or writes outside data/ (200 or 422, sentinel intact)',
        $p3 !== null && in_array($p3['status'], [200, 422], true) && file_get_contents($sb['root'] . '/api/.htpasswd') === "sentinel\n");
    $p4 = tt_e2e_publish($sb, ['tasks' => [['id' => 't1', 'title' => 'Essay', 'notes' => 'x', 'changedAt' => 1]]]);
    $stamp = tt_e2e_task($live(), 't1')['changedAt'] ?? null;
    check('e2e: changedAt is re-stamped by the server (a forged value never survives)',
        $p4 !== null && $p4['status'] === 200 && is_int($stamp) && $stamp !== 1);
    $p5 = tt_e2e_publish($sb, ['tasks' => [['id' => 't1', 'title' => 'Essay', 'notes' => 'x']]]);
    check('e2e: republishing identical content keeps changedAt stable',
        $p5 !== null && $p5['status'] === 200 && (tt_e2e_task($live(), 't1')['changedAt'] ?? null) === $stamp);

    // --- B. publish.php's rejection paths (publish.php:9-54) ---
    $bad = [
        'a task without an id' => [422, ['tasks' => [['title' => 'x']]]],
        'an over-long task id' => [422, ['tasks' => [['id' => str_repeat('a', 65)]]]],
        'an over-long title' => [422, ['tasks' => [['id' => 'a', 'title' => str_repeat('a', 501)]]]],
        'non-string notes' => [422, ['tasks' => [['id' => 'a', 'notes' => ['x']]]]],
        'a bad dueDate' => [422, ['tasks' => [['id' => 'a', 'dueDate' => '26 Oct']]]],
        'a bad dueTime' => [422, ['tasks' => [['id' => 'a', 'dueTime' => '3pm']]]],
        'a bad file id' => [422, ['tasks' => [['id' => 'a', 'files' => [['id' => 'nope', 'name' => 'n', 'size' => 1]]]]]],
        'an announcement with disallowed html' => [422, ['tasks' => [['id' => 'a']], 'announcements' => [['text' => 'hi', 'createdAt' => 1, 'html' => '<script>x</script>']]]],
        'an announcement without createdAt' => [422, ['tasks' => [['id' => 'a']], 'announcements' => [['text' => 'hi']]]],
        'a malformed clearBoard intent' => [400, ['tasks' => [], 'clearBoard' => ['confirm' => 'nope', 'expectedCount' => 0]]],
    ];
    foreach ($bad as $label => $case) {
        $rr = tt_e2e_publish($sb, $case[1]);
        check('e2e: rejects ' . $label, $rr !== null && $rr['status'] === $case[0]);
    }
    $rr = tt_e2e_publish($sb, ['tasks' => []]);
    check('e2e: publishing an empty board over a non-empty one is 409', $rr !== null && $rr['status'] === 409);
    $rr = tt_e2e_publish($sb, ['tasks' => [], 'clearBoard' => ['confirm' => 'CLEAR BOARD', 'expectedCount' => 9]]);
    check('e2e: clearBoard with a stale expectedCount is 409', $rr !== null && $rr['status'] === 409);
    $rr = tt_e2e_req($sb, 'POST', '/api/publish.php', '{"tasks":[]}', ['Content-Type: text/plain']);
    check('e2e: publish with a non-JSON content type is 415', $rr !== null && $rr['status'] === 415);
    $rr = tt_e2e_req($sb, 'POST', '/api/publish.php', 'not json');
    check('e2e: publish with an unparseable body is 400', $rr !== null && $rr['status'] === 400);

    // --- C. clear-board carries the live announcements over (publish.php:100-111) ---
    $rr = tt_e2e_publish($sb, ['tasks' => [['id' => 't1', 'title' => 'Essay']], 'announcements' => [['text' => 'kept', 'createdAt' => 7]]]);
    check('e2e: pre-clear publish is 200', $rr !== null && $rr['status'] === 200);
    $rr = tt_e2e_publish($sb, ['tasks' => [], 'clearBoard' => ['confirm' => 'CLEAR BOARD', 'expectedCount' => 1]]);
    $lv = $live();
    check('e2e: clearBoard empties the tasks and carries the announcements over',
        $rr !== null && $rr['status'] === 200 && ($lv['tasks'] ?? null) === [] && ($lv['announcements'][0]['text'] ?? null) === 'kept');

    // --- D. versions.php: the id -> file reader's rejection paths and delete semantics (F3) ---
    $g = tt_e2e_get($sb, '/api/versions.php');
    $ids = array_map(function ($v) { return $v['id'] ?? null; }, is_array($g['json']['versions'] ?? null) ? $g['json']['versions'] : []);
    check('e2e: versions.php lists the snapshots newest first',
        $g !== null && $g['status'] === 200 && count($ids) >= 1 && $ids[0] === (string)max(array_map('intval', $ids)));
    foreach (['../../api/.htpasswd', '..%2f..%2fapi/.htpasswd', 'ABCDEF', '000123', '1e3', '-1', str_repeat('9', 20), '1.0', ''] as $badId) {
        $rr = tt_e2e_req($sb, 'POST', '/api/versions.php', json_encode(['id' => $badId]));
        check('e2e: versions.php rejects id ' . json_encode($badId), $rr !== null && $rr['status'] === 400);
    }
    check('e2e: a rejected version id never touches a file outside data/versions',
        file_get_contents($sb['root'] . '/api/.htpasswd') === "sentinel\n");
    $rr = tt_e2e_req($sb, 'POST', '/api/versions.php', json_encode(['all' => 'true']));
    check('e2e: versions.php needs the JSON boolean true for all (a string is 400)', $rr !== null && $rr['status'] === 400);
    $target = $ids[0];
    $n = tt_e2e_count($sb, 'data/versions/*.json');
    $rr = tt_e2e_req($sb, 'POST', '/api/versions.php', json_encode(['id' => $target]));
    check('e2e: a valid numeric id deletes exactly that snapshot',
        $rr !== null && $rr['status'] === 200 && tt_e2e_count($sb, 'data/versions/*.json') === $n - 1 && !is_file($sb['root'] . '/data/versions/' . $target . '.json'));
    $rr = tt_e2e_req($sb, 'POST', '/api/versions.php', json_encode(['all' => true]));
    check('e2e: all:true deletes every snapshot', $rr !== null && $rr['status'] === 200 && tt_e2e_count($sb, 'data/versions/*.json') === 0);

    // --- E. lock semantics: one lock for both writers, fail closed, released on completion (F2) ---
    $rr = tt_e2e_publish($sb, ['tasks' => [['id' => 't2', 'title' => 'Lock']]]);
    check('e2e: publish is 200 again after the destructive deletes', $rr !== null && $rr['status'] === 200);
    $boardBefore = (string)file_get_contents($sb['root'] . '/data/current.json');
    $snapsBefore = tt_e2e_count($sb, 'data/versions/*.json');
    $lh = fopen($sb['root'] . '/data/.publish.lock', 'c');
    $held = is_resource($lh) && flock($lh, LOCK_EX | LOCK_NB);
    check('e2e: the test process can hold data/.publish.lock', $held);
    $rr = tt_e2e_publish($sb, ['tasks' => [['id' => 't3', 'title' => 'Blocked']]]);
    check('e2e: a held lock makes publish fail closed with 503', $rr !== null && $rr['status'] === 503);
    check('e2e: the 503 publish wrote nothing (board byte-identical, no snapshot)',
        file_get_contents($sb['root'] . '/data/current.json') === $boardBefore && tt_e2e_count($sb, 'data/versions/*.json') === $snapsBefore);
    $rr = tt_e2e_req($sb, 'POST', '/api/versions.php', json_encode(['all' => true]));
    check('e2e: versions.php shares the same lock and fails closed with 503', $rr !== null && $rr['status'] === 503);
    check('e2e: the 503 delete removed no snapshot', tt_e2e_count($sb, 'data/versions/*.json') === $snapsBefore);
    if ($held) flock($lh, LOCK_UN);
    if (is_resource($lh)) fclose($lh);
    $rr = tt_e2e_publish($sb, ['tasks' => [['id' => 't3', 'title' => 'After release']]]);
    check('e2e: publish succeeds after release even though the lock file stays on disk',
        $rr !== null && $rr['status'] === 200 && tt_e2e_task($live(), 't3') !== null && is_file($sb['root'] . '/data/.publish.lock'));
    tt_e2e_stop($sb);
}

// ---------------------------------------------------------------------------
// F. Update-notice changedAt stamps, exercised through the real publish endpoint on a second,
// fresh synthetic sandbox. L1 says title, notes, dueDate, dueTime, subject and attachment
// id/name/size are meaningful; canonical empty optional values, CRLF/LF and attachment list/key
// order are not. Meaningful edits strictly advance even without a sleep; unchanged legacy zero or
// missing stamps stay stable instead of being restamped with the publish time.
// ---------------------------------------------------------------------------
$sbN = tt_e2e_start();
if (!$sbN) {
    echo "skip: notice stamp end-to-end (needs proc_open + allow_url_fopen + a loopback listener)\n";
} else {
    register_shutdown_function(function () use ($sbN) { tt_e2e_stop($sbN); });
    $liveN = function () use ($sbN) { return tt_e2e_json_file($sbN, 'data/current.json'); };
    $taskN = function (string $id) use ($liveN) { return tt_e2e_task($liveN(), $id); };
    $stampN = function (string $id) use ($taskN) {
        $t = $taskN($id);
        return is_array($t) && array_key_exists('changedAt', $t) ? $t['changedAt'] : null;
    };
    $tasksN = function () use ($liveN) {
        $b = $liveN();
        return is_array($b) && is_array($b['tasks'] ?? null) ? array_values($b['tasks']) : [];
    };
    $catalog = [
        ['code' => 'TS1', 'name' => 'Test Subject One', 'color' => '#3366cc', 'active' => true],
        ['code' => 'TS2', 'name' => 'Test Subject Two', 'color' => '#cc3366', 'active' => true],
    ];
    $pubN = function (array $tasks) use ($sbN, $catalog) {
        return tt_e2e_publish($sbN, ['tasks' => array_values($tasks), 'announcements' => [], 'subjects' => $catalog]);
    };
    $okN = function (?array $r) { return $r !== null && $r['status'] === 200; };
    // Seed a known past stamp straight into the sandbox board so a spurious restamp is visible even
    // when the server's wall clock has not moved since the previous publish.
    $seedStamp = function (string $id, int $value) use ($liveN, $sbN): bool {
        $b = $liveN();
        if (!is_array($b)) return false;
        $found = false;
        foreach ($b['tasks'] ?? [] as $i => $t) {
            if (is_array($t) && ($t['id'] ?? null) === $id) { $b['tasks'][$i]['changedAt'] = $value; $found = true; }
        }
        return $found && tt_e2e_write_board($sbN, $b);
    };
    $retain = function (string $label, string $id, callable $mutate) use ($seedStamp, $stampN, $tasksN, $pubN, $okN) {
        $seeded = $seedStamp($id, max(1, time() - 120));
        $before = $stampN($id);
        $tasks = $tasksN();
        foreach ($tasks as $i => $t) if (is_array($t) && ($t['id'] ?? null) === $id) $tasks[$i] = $mutate($t);
        $r = $pubN($tasks);
        $after = $stampN($id);
        check('e2e stamp: ' . $label . ' retains changedAt', $seeded && $okN($r) && is_int($before) && $after === $before);
    };
    $advance = function (string $label, string $id, callable $mutate) use ($seedStamp, $stampN, $tasksN, $pubN, $okN) {
        $seeded = $seedStamp($id, max(1, time() - 120));
        $before = $stampN($id);
        $tasks = $tasksN();
        foreach ($tasks as $i => $t) if (is_array($t) && ($t['id'] ?? null) === $id) $tasks[$i] = $mutate($t);
        $r = $pubN($tasks);
        $after = $stampN($id);
        check('e2e stamp: ' . $label . ' advances changedAt', $seeded && $okN($r) && is_int($before) && is_int($after) && $after > $before);
    };

    $fileA = ['id' => str_repeat('a', 32) . '.pdf', 'name' => 'a.pdf', 'size' => 12];
    $fileB = ['id' => str_repeat('b', 32) . '.png', 'name' => 'b.png', 'size' => 34];
    $fileC = ['id' => str_repeat('c', 32) . '.docx', 'name' => 'c.docx', 'size' => 56];
    $base = [
        'id' => 'stamp1', 'title' => 'Original', 'notes' => "Line one\r\nLine two",
        'dueDate' => '2026-11-02', 'dueTime' => '15:30', 'subject' => 'TS1',
        'files' => [$fileA, $fileB],
    ];
    $empty = ['id' => 'empty1', 'title' => 'Empty'];
    $untitled = ['id' => 'untitled1'];

    $r = $pubN([$base, $empty, $untitled]);
    check('e2e stamp: a fresh synthetic sandbox seeds integer changedAt stamps',
        $okN($r) && is_int($stampN('stamp1')) && is_int($stampN('empty1')) && is_int($stampN('untitled1')));

    // Unchanged content, CRLF/LF and absent/null/empty optional fields must never look like edits.
    $retain('an unchanged republish', 'stamp1', function (array $t) { return $t; });
    $retain('CRLF notes followed by LF notes', 'stamp1', function (array $t) {
        $t['notes'] = "Line one\nLine two";
        return $t;
    });
    $retain('LF notes followed by CRLF notes', 'stamp1', function (array $t) {
        $t['notes'] = "Line one\r\nLine two";
        return $t;
    });
    $retain('null title on a task with no title', 'untitled1', function (array $t) { $t['title'] = null; return $t; });
    $retain('empty-string title on a task with no title', 'untitled1', function (array $t) { $t['title'] = ''; return $t; });
    $retain('absent title after an empty-string title', 'untitled1', function (array $t) { unset($t['title']); return $t; });
    $retain('null notes on a task with no notes', 'empty1', function (array $t) { $t['notes'] = null; return $t; });
    $retain('empty-string notes on a task with no notes', 'empty1', function (array $t) { $t['notes'] = ''; return $t; });
    $retain('absent notes after empty-string notes', 'empty1', function (array $t) { unset($t['notes']); return $t; });
    $retain('null subject on a task with no subject', 'empty1', function (array $t) { $t['subject'] = null; return $t; });
    $retain('empty-string subject on a task with no subject', 'empty1', function (array $t) { $t['subject'] = ''; return $t; });
    $retain('absent subject after empty-string subject', 'empty1', function (array $t) { unset($t['subject']); return $t; });
    $retain('null dueDate on a task with no deadline', 'empty1', function (array $t) { $t['dueDate'] = null; return $t; });
    $retain('absent dueDate after a null dueDate', 'empty1', function (array $t) { unset($t['dueDate']); return $t; });
    $retain('null dueTime on a task with no deadline', 'empty1', function (array $t) { $t['dueTime'] = null; return $t; });
    $retain('absent dueTime after a null dueTime', 'empty1', function (array $t) { unset($t['dueTime']); return $t; });
    $retain('an empty attachment list on a task with no attachments', 'empty1', function (array $t) { $t['files'] = []; return $t; });
    $retain('absent files after an empty attachment list', 'empty1', function (array $t) { unset($t['files']); return $t; });

    // Attachment metadata is canonical: object-key order and list order alone are not edits.
    $retain('attachment object-key order', 'stamp1', function (array $t) use ($fileA, $fileB) {
        $t['files'] = [
            ['size' => $fileA['size'], 'name' => $fileA['name'], 'id' => $fileA['id']],
            ['size' => $fileB['size'], 'name' => $fileB['name'], 'id' => $fileB['id']],
        ];
        return $t;
    });
    $retain('attachment list order', 'stamp1', function (array $t) use ($fileA, $fileB) {
        $t['files'] = [$fileB, $fileA];
        return $t;
    });

    // Every meaningful field change advances the stamp.
    $advance('attachment name change', 'stamp1', function (array $t) use ($fileA) {
        $files = is_array($t['files'] ?? null) ? $t['files'] : [];
        foreach ($files as $i => $f) if (is_array($f) && ($f['id'] ?? null) === $fileA['id']) $files[$i]['name'] = 'renamed.pdf';
        $t['files'] = $files;
        return $t;
    });
    $advance('attachment size change', 'stamp1', function (array $t) use ($fileB) {
        $files = is_array($t['files'] ?? null) ? $t['files'] : [];
        foreach ($files as $i => $f) if (is_array($f) && ($f['id'] ?? null) === $fileB['id']) $files[$i]['size'] = 35;
        $t['files'] = $files;
        return $t;
    });
    // Replacing only the attachment id, with the same count/name/size, is still a meaningful edit.
    $advance('attachment id change', 'stamp1', function (array $t) use ($fileA) {
        $replacement = str_repeat('d', 32) . '.pdf';
        $files = is_array($t['files'] ?? null) ? $t['files'] : [];
        foreach ($files as $i => $f) if (is_array($f) && ($f['id'] ?? null) === $fileA['id']) $files[$i]['id'] = $replacement;
        $t['files'] = $files;
        return $t;
    });
    $advance('attachment addition', 'stamp1', function (array $t) use ($fileC) {
        $t['files'] = array_values(is_array($t['files'] ?? null) ? $t['files'] : []);
        $t['files'][] = $fileC;
        return $t;
    });
    $advance('attachment removal', 'stamp1', function (array $t) use ($fileC) {
        $t['files'] = array_values(array_filter(
            is_array($t['files'] ?? null) ? $t['files'] : [],
            function ($f) use ($fileC) { return !is_array($f) || ($f['id'] ?? null) !== $fileC['id']; }
        ));
        return $t;
    });
    $advance('due date change', 'stamp1', function (array $t) { $t['dueDate'] = '2027-02-03'; return $t; });
    $advance('due time change', 'stamp1', function (array $t) { $t['dueTime'] = '18:15'; return $t; });
    $advance('subject change', 'stamp1', function (array $t) { $t['subject'] = 'TS2'; return $t; });
    $advance('title-only change', 'stamp1', function (array $t) { $t['title'] = 'Renamed'; return $t; });
    $advance('notes-only change', 'stamp1', function (array $t) { $t['notes'] = 'Changed notes'; return $t; });

    // Two edits with no sleep must both exceed a stored stamp far in the future, proving
    // max(now, old + 1) without depending on the wall clock to tick between publishes.
    $seed = time() + 86400;
    $seeded = $seedStamp('stamp1', $seed);
    $first = $tasksN();
    foreach ($first as $i => $t) if (is_array($t) && ($t['id'] ?? null) === 'stamp1') $first[$i]['dueDate'] = '2027-03-04';
    $r1 = $pubN($first);
    $c1 = $stampN('stamp1');
    $second = $tasksN();
    foreach ($second as $i => $t) if (is_array($t) && ($t['id'] ?? null) === 'stamp1') $second[$i]['dueTime'] = '19:30';
    $r2 = $pubN($second);
    $c2 = $stampN('stamp1');
    check('e2e stamp: two consecutive edits without sleep strictly advance changedAt',
        $seeded && $okN($r1) && $okN($r2) && is_int($c1) && is_int($c2) && $c1 > $seed && $c2 > $seed && $c2 > $c1);

    // Editing one task must leave every untouched task's changedAt exactly as it was. Seed the
    // untouched tasks with distinctive stamps so a restamp-everything publish is caught even when
    // it happens to reuse the wall-clock second of their previous stamps.
    $seeded = $seedStamp('stamp1', max(1, time() - 120))
        && $seedStamp('empty1', time() + 20000)
        && $seedStamp('untitled1', time() + 30000);
    $beforeAll = [];
    foreach ($tasksN() as $t) if (is_array($t) && is_string($t['id'] ?? null)) $beforeAll[$t['id']] = $t['changedAt'] ?? null;
    $editedOne = $tasksN();
    foreach ($editedOne as $i => $t) if (is_array($t) && ($t['id'] ?? null) === 'stamp1') $editedOne[$i]['title'] = 'Only stamp1 changed';
    $r = $pubN($editedOne);
    $afterAll = [];
    foreach ($tasksN() as $t) if (is_array($t) && is_string($t['id'] ?? null)) $afterAll[$t['id']] = $t['changedAt'] ?? null;
    $untouchedExact = count($beforeAll) >= 3;
    foreach ($beforeAll as $id => $stamp) {
        if ($id === 'stamp1') continue;
        if (!array_key_exists($id, $afterAll) || $afterAll[$id] !== $stamp) $untouchedExact = false;
    }
    check('e2e stamp: editing one task leaves every untouched task changedAt exact',
        $seeded && $okN($r) && $untouchedExact && is_int($beforeAll['stamp1'] ?? null)
        && is_int($afterAll['stamp1'] ?? null) && $afterAll['stamp1'] > $beforeAll['stamp1']);

    // Legacy unchanged stamps stay exactly as they were; they are not restamped with publish time.
    $seeded = $seedStamp('stamp1', 0);
    $r = $pubN($tasksN());
    $legacyZero = $taskN('stamp1');
    $zeroBoard = $liveN();
    $publishedAt = is_array($zeroBoard) ? ($zeroBoard['publishedAt'] ?? null) : null;
    check('e2e stamp: an unchanged legacy zero stamp is never restamped with publish time',
        $seeded && $okN($r) && is_array($legacyZero) && ($legacyZero['changedAt'] ?? null) === 0
        && ($legacyZero['changedAt'] ?? null) !== $publishedAt);

    $seeded = $seedStamp('stamp1', 0);
    $zeroEdit = $tasksN();
    foreach ($zeroEdit as $i => $t) if (is_array($t) && ($t['id'] ?? null) === 'stamp1') $zeroEdit[$i]['title'] = 'Zero to positive';
    $r = $pubN($zeroEdit);
    $zeroPositive = $stampN('stamp1');
    check('e2e stamp: a meaningful edit advances a legacy zero stamp to a positive value',
        $seeded && $okN($r) && is_int($zeroPositive) && $zeroPositive > 0);

    $b = $liveN();
    $found = false;
    foreach (is_array($b['tasks'] ?? null) ? $b['tasks'] : [] as $i => $t) {
        if (is_array($t) && ($t['id'] ?? null) === 'stamp1') { unset($b['tasks'][$i]['changedAt']); $found = true; }
    }
    $seeded = $found && tt_e2e_write_board($sbN, $b);
    $r = $pubN($tasksN());
    $legacyMissing = $taskN('stamp1');
    $missingBoard = $liveN();
    $publishedAt = is_array($missingBoard) ? ($missingBoard['publishedAt'] ?? null) : null;
    check('e2e stamp: an unchanged legacy missing stamp stays missing, not restamped with publish time',
        $seeded && $okN($r) && is_array($legacyMissing) && !array_key_exists('changedAt', $legacyMissing)
        && $publishedAt !== null);
}

// ---------------------------------------------------------------------------
// G. Schema-2 persistence: revision CAS, replay receipts, ordered commit recovery, private-bin
// authority and privacy. Fresh synthetic sandbox; nothing here reads the repository's data/.
// ---------------------------------------------------------------------------
$sbP = tt_e2e_start();
if (!$sbP) {
    echo "skip: persistence end-to-end (needs proc_open + allow_url_fopen + a loopback listener)\n";
} else {
    register_shutdown_function(function () use ($sbP) { tt_e2e_stop($sbP); });
    $boardP  = function () use ($sbP) { return tt_e2e_json_file($sbP, 'data/current.json'); };
    $adminP  = function () use ($sbP) { return tt_e2e_json_file($sbP, 'data/admin/state.json'); };
    $bytesP  = function () use ($sbP) { return tt_e2e_bytes($sbP, 'data/current.json'); };
    $snapsP  = function () use ($sbP) { return tt_e2e_count($sbP, 'data/versions/*.json'); };
    $okP     = function (?array $r): bool { return $r !== null && $r['status'] === 200; };
    $codeP   = function (?array $r): string { return is_array($r['json'] ?? null) ? (string)($r['json']['code'] ?? '') : ''; };
    $revP    = function () use ($boardP): int { $b = $boardP(); return is_array($b) ? (int)($b['revision'] ?? 0) : 0; };
    $catalog = [
        ['code' => 'AA', 'name' => 'Alpha', 'color' => '#112233', 'active' => true],
        ['code' => 'BB', 'name' => 'Beta', 'color' => '#445566', 'active' => false],
    ];
    $pubP = function (array $tasks, array $extra = []) use ($sbP, $catalog) {
        return tt_e2e_publish($sbP, ['tasks' => array_values($tasks), 'announcements' => [], 'subjects' => $catalog] + $extra);
    };
    $rawP = function (array $payload) use ($sbP) {
        return tt_e2e_req($sbP, 'POST', '/api/publish.php', json_encode($payload));
    };
    $binP = function (string $id) use ($adminP) {
        $a = $adminP();
        foreach (is_array($a['bin'] ?? null) ? $a['bin'] : [] as $r) {
            if (($r['task']['id'] ?? null) === $id) return $r;
        }
        return null;
    };

    // --- schema 2 and the refresh boundary -----------------------------------------------------
    $tA = ['id' => 'p-a', 'title' => 'Alpha task', 'subject' => 'AA'];
    $r = $pubP([$tA]);
    $b = $boardP();
    check('P2: the first publish writes a schema-2 board with a server revision and operation id',
        $okP($r) && is_array($b) && ($b['schemaVersion'] ?? null) === 2 && ($b['revision'] ?? null) === 1
        && preg_match('/^[a-f0-9]{32}$/D', (string)($b['operationId'] ?? '')) === 1
        && ($b['deletedTasks'] ?? null) === [] && ($b['subjects'] ?? null) === $catalog);

    $before = $bytesP();
    $r = $rawP(['tasks' => [$tA], 'announcements' => []]);
    check('P2: a pre-schema publish is refused with refresh_required and changes nothing',
        $r !== null && $r['status'] === 409 && $codeP($r) === 'refresh_required' && $bytesP() === $before);

    $rev = $revP();
    $r = $rawP(['schemaVersion' => 2, 'operationId' => bin2hex(random_bytes(16)), 'baseRevision' => $rev - 1,
                'tasks' => [$tA], 'announcements' => [], 'subjects' => $catalog]);
    check('P2: a stale baseRevision is 409 even when the task count is unchanged, and nothing is written',
        $r !== null && $r['status'] === 409 && $codeP($r) === 'stale_base' && $revP() === $rev && $bytesP() === $before);

    $r = $rawP(['schemaVersion' => 2, 'operationId' => bin2hex(random_bytes(16)), 'baseRevision' => $rev,
                'tasks' => [$tA], 'announcements' => [], 'subjects' => $catalog,
                'deletedTasks' => [['id' => 'victim', 'deletedAt' => 1]]]);
    check('P2: a request can never supply deletion markers', $r !== null && $r['status'] === 400 && $bytesP() === $before);

    $r = $rawP(['schemaVersion' => 2, 'operationId' => bin2hex(random_bytes(16)), 'baseRevision' => $rev,
                'tasks' => [['id' => 'p-z', 'title' => 'Zed', 'subject' => 'NOPE']], 'announcements' => [], 'subjects' => $catalog]);
    check('P2: a subject code outside the catalog is 422, never a silent retag',
        $r !== null && $r['status'] === 422 && $bytesP() === $before);

    // The custom-colour contract is enforced on both sides: the client refuses to send it, and the
    // server refuses the whole catalogue rather than publishing a colour it cannot render.
    $badColors = ['#fff', '#58affcff', '58affc', 'red', '#GGGGGG', ''];
    $badColorOk = true;
    foreach ($badColors as $i => $colour) {
        $rr = $rawP(['schemaVersion' => 2, 'operationId' => bin2hex(random_bytes(16)), 'baseRevision' => $rev,
            'tasks' => [['id' => 'p-a', 'title' => 'Alpha task', 'subject' => 'AA']], 'announcements' => [],
            'subjects' => [['code' => 'AA', 'name' => 'Alpha', 'color' => $colour, 'active' => true]]]);
        if ($rr === null || $rr['status'] !== 422) $badColorOk = false;
    }
    check('P2: a malformed subject colour rejects the whole publish on the server', $badColorOk && $bytesP() === $before);

    // --- exact replay and operation conflicts ---------------------------------------------------
    $op = bin2hex(random_bytes(16));
    $body = ['schemaVersion' => 2, 'operationId' => $op, 'baseRevision' => $rev,
             'tasks' => [$tA, ['id' => 'p-b', 'title' => 'Beta task', 'subject' => 'BB']],
             'announcements' => [], 'subjects' => $catalog];
    $r1 = $rawP($body);
    $revAfter = $revP();
    $snapsAfter = $snapsP();
    $r2 = $rawP($body);
    check('P2: an exact replay of the same operation is idempotent, with no extra revision or snapshot',
        $okP($r1) && $okP($r2) && ($r2['json']['replayed'] ?? false) === true
        && $revP() === $revAfter && $snapsP() === $snapsAfter && $revAfter === $rev + 1);

    $changed = $body;
    $changed['tasks'] = [$tA];
    $r = $rawP($changed);
    check('P2: the same operation id with a different body conflicts',
        $r !== null && $r['status'] === 409 && $codeP($r) === 'operation_conflict' && $revP() === $revAfter);

    // --- archive before the board loses a definition --------------------------------------------
    $r = $pubP([['id' => 'p-a', 'title' => 'Alpha task', 'subject' => 'AA']]);
    $rec = $binP('p-b');
    check('P2: an ordinary omission archives the removed live definition before it disappears',
        $okP($r) && tt_e2e_task($boardP(), 'p-b') === null && is_array($rec)
        && $rec['source'] === 'publish-removal' && $rec['everPublished'] === true
        && ($rec['subjects'][0]['code'] ?? null) === 'BB');

    $rev = $revP();
    $r = $pubP([], ['clearBoard' => ['confirm' => 'CLEAR BOARD', 'expectedCount' => 1]]);
    $recA = $binP('p-a');
    check('P2: a typed clear-board archives every removed definition and keeps the catalog',
        $okP($r) && ($boardP()['tasks'] ?? null) === [] && is_array($recA) && $recA['everPublished'] === true
        && ($boardP()['subjects'] ?? null) === $catalog && $revP() === $rev + 1);

    $r = tt_e2e_req($sbP, 'POST', '/api/versions.php', json_encode(['all' => true]));
    check('P2: deleting all server history leaves the recycle bin and presets intact',
        $okP($r) && tt_e2e_count($sbP, 'data/versions/*.json') === 0 && $binP('p-a') !== null && $binP('p-b') !== null);

    // --- private bin lifecycle -----------------------------------------------------------------
    $draftOnly = ['id' => 'p-draft', 'title' => 'Never published', 'subject' => 'AA'];
    $r = tt_e2e_admin($sbP, 'bin-archive', ['task' => $draftOnly, 'subjects' => $catalog]);
    $draftBinId = is_array($r['json'] ?? null) ? (string)($r['json']['binId'] ?? '') : '';
    $recD = $binP('p-draft');
    check('P2: archiving a draft-only task records it as never published, with a stable record id',
        $okP($r) && $draftBinId !== '' && is_array($recD) && $recD['everPublished'] === false
        && $recD['source'] === 'draft-delete' && $recD['binId'] === $draftBinId);

    $rAgain = tt_e2e_admin($sbP, 'bin-archive', ['task' => $draftOnly, 'subjects' => $catalog]);
    check('P2: retrying the same archive reuses its record instead of duplicating it',
        $okP($rAgain) && ($rAgain['json']['binId'] ?? null) === $draftBinId && count($adminP()['bin']) === 3);

    $r = tt_e2e_admin($sbP, 'bin-restore', ['binId' => $draftBinId]);
    $restored = $r['json']['task'] ?? null;
    check('P2: bin restore returns the same id, does not consume the record, and is draft-only',
        $okP($r) && ($restored['id'] ?? null) === 'p-draft' && ($r['json']['requiresNewId'] ?? null) === false
        && $binP('p-draft') !== null && tt_e2e_task($boardP(), 'p-draft') === null);

    // --- permanent deletion authority -----------------------------------------------------------
    $revBefore = $revP();
    $publishedBinId = (string)($binP('p-a')['binId'] ?? '');
    $r = tt_e2e_admin($sbP, 'bin-permanent-delete', ['binId' => $publishedBinId, 'confirm' => 'DELETE PERMANENTLY', 'baseRevision' => $revBefore]);
    $b = $boardP();
    $markers = array_map(fn($m) => $m['id'] ?? null, is_array($b['deletedTasks'] ?? null) ? $b['deletedTasks'] : []);
    check('P2: permanent deletion of a published id adds one marker, keeps publishedAt, and drops only that record',
        $okP($r) && in_array('p-a', $markers, true) && $revP() === $revBefore + 1
        && $binP('p-a') === null && $binP('p-b') !== null && is_int($b['publishedAt'] ?? null));

    $r = tt_e2e_admin($sbP, 'bin-restore', ['binId' => $publishedBinId]);
    check('P2: the deleted record itself is gone from the bin',
        $r !== null && $r['status'] === 404);

    // The reservation, not the record, is what forbids the old identity: re-archiving the same
    // definition must say "new id only" instead of offering the dead id back.
    $r = tt_e2e_admin($sbP, 'bin-archive', ['task' => ['id' => 'p-a', 'title' => 'Alpha task', 'subject' => 'AA'], 'subjects' => $catalog]);
    $reArchived = (string)($r['json']['binId'] ?? '');
    $r = tt_e2e_admin($sbP, 'bin-restore', ['binId' => $reArchived]);
    check('P2: a permanently deleted identity can only be restored as a new id',
        $okP($r) && ($r['json']['requiresNewId'] ?? null) === true);

    $r = tt_e2e_admin($sbP, 'bin-permanent-delete', ['binId' => $reArchived, 'confirm' => 'DELETE PERMANENTLY', 'baseRevision' => $revP()]);
    check('P2: deleting the re-archived copy of a marked id is allowed and adds no second marker',
        $okP($r) && count(array_filter($markers, fn($m) => $m === 'p-a')) === 1
        && count(array_filter(array_map(fn($m) => $m['id'] ?? null, $boardP()['deletedTasks'] ?? []), fn($m) => $m === 'p-a')) === 1);

    $rev = $revP();
    $r = $pubP([['id' => 'p-a', 'title' => 'Resurrected', 'subject' => 'AA']]);
    check('P2: publishing a marked identity is refused with forbidden_identity',
        $r !== null && $r['status'] === 422 && $codeP($r) === 'forbidden_identity' && $revP() === $rev);

    $rev = $revP();
    $draftBinId = (string)($binP('p-draft')['binId'] ?? '');
    $r = tt_e2e_admin($sbP, 'bin-permanent-delete', ['binId' => $draftBinId, 'confirm' => 'DELETE PERMANENTLY', 'baseRevision' => $rev]);
    $reserved = array_map(fn($m) => $m['id'] ?? null, $adminP()['retiredDraftIds'] ?? []);
    check('P2: a never-published deletion reserves the id privately and creates no public marker',
        $okP($r) && $revP() === $rev && in_array('p-draft', $reserved, true)
        && !in_array('p-draft', array_map(fn($m) => $m['id'] ?? null, $boardP()['deletedTasks'] ?? []), true));

    $r = tt_e2e_admin($sbP, 'bin-permanent-delete', ['binId' => (string)($binP('p-b')['binId'] ?? ''), 'baseRevision' => $revP()]);
    check('P2: permanent deletion without confirmation is refused',
        $r !== null && $r['status'] === 400 && $codeP($r) === 'confirm_required' && $binP('p-b') !== null);

    // --- presets ------------------------------------------------------------------------------
    $r = tt_e2e_admin($sbP, 'preset-save', ['preset' => ['name' => 'Term 2', 'subjects' => $catalog]]);
    $preset = $r['json']['preset'] ?? null;
    check('P2: a named preset is saved privately with a stable id',
        $okP($r) && preg_match('/^[a-f0-9]{32}$/D', (string)($preset['id'] ?? '')) === 1 && ($preset['subjects'] ?? null) === $catalog);

    $r = tt_e2e_admin($sbP, 'preset-save', ['preset' => ['name' => 'term 2', 'subjects' => $catalog]]);
    check('P2: preset names are unique case-insensitively', $r !== null && $r['status'] === 422);

    $renamed = ['id' => $preset['id'], 'name' => 'Term 2 final', 'subjects' => $catalog];
    $r = tt_e2e_admin($sbP, 'preset-save', ['preset' => $renamed]);
    check('P2: renaming a preset keeps its id', $okP($r) && ($r['json']['preset']['id'] ?? null) === $preset['id']);

    $r = tt_e2e_admin($sbP, 'preset-delete', ['presetId' => $preset['id']]);
    check('P2: a preset can be deleted by id', $okP($r) && ($adminP()['presets'] ?? null) === []);

    // --- privacy ------------------------------------------------------------------------------
    $adminBytes = tt_e2e_bytes($sbP, 'data/admin/state.json');
    $unauth = [
        'summary'    => tt_e2e_get($sbP, '/api/versions.php?view=admin', false),
        'record'     => tt_e2e_get($sbP, '/api/versions.php?view=bin&id=' . ($binP('p-b')['binId'] ?? ''), false),
        'archive'    => tt_e2e_req($sbP, 'POST', '/api/versions.php', json_encode(['action' => 'bin-archive', 'operationId' => bin2hex(random_bytes(16)), 'baseAdminRevision' => 1, 'task' => ['id' => 'x'], 'subjects' => []]), [], false),
        'publish'    => tt_e2e_req($sbP, 'POST', '/api/publish.php', json_encode(['schemaVersion' => 2, 'operationId' => bin2hex(random_bytes(16)), 'baseRevision' => $revP(), 'tasks' => [], 'announcements' => [], 'subjects' => $catalog]), [], false),
    ];
    $allUnauthorized = true;
    foreach ($unauth as $rr) if ($rr === null || $rr['status'] !== 401) $allUnauthorized = false;
    check('P2: every private read and action is 401 without a session and mutates nothing',
        $allUnauthorized && tt_e2e_bytes($sbP, 'data/admin/state.json') === $adminBytes);

    $r = tt_e2e_get($sbP, '/api/versions.php?view=admin');
    check('P2: private summary reads are marked no-store',
        $okP($r) && preg_match('/cache-control:\s*no-store/i', implode("\n", $r['headers'] ?? [])) === 1);

    // --- ordered commit recovery ---------------------------------------------------------------
    $seam = (string)tt_e2e_bytes($sbP, 'api/_board.php');
    check('P2: the sandbox fault seam is live, so a fault case cannot pass as a silent no-op',
        strpos($seam, "/data/.fault") !== false);

    $rev = $revP();
    $snaps = $snapsP();
    $before = $bytesP();
    $faults = ['archive-save' => 'archive_write', 'pending-save' => 'pending_write',
               'snapshot-save' => 'snapshot_write', 'pre-current-rename' => 'commit_failed',
               'short-write' => 'commit_failed'];
    $allSafe = true;
    $seenCodes = [];
    foreach ($faults as $name => $expected) {
        tt_e2e_fault($sbP, $name);
        $rr = $pubP([['id' => 'p-fault', 'title' => 'Fault ' . $name, 'subject' => 'AA']]);
        tt_e2e_fault($sbP, null);
        $seenCodes[$name] = [$rr['status'] ?? null, $codeP($rr)];
        if ($rr === null || $rr['status'] !== 500 || $codeP($rr) !== $expected) $allSafe = false;
        if ($bytesP() !== $before || $revP() !== $rev || $snapsP() !== $snaps) $allSafe = false;
        if (tt_e2e_has($sbP, 'data/admin/pending.json')) $allSafe = false;
    }
    check('P2: every pre-commit fault leaves the live board byte-identical, with no snapshot or pending left', $allSafe);

    tt_e2e_fault($sbP, 'post-current-rename');
    $r = $pubP([['id' => 'p-fault', 'title' => 'Fault commit', 'subject' => 'AA']]);
    tt_e2e_fault($sbP, null);
    $committedPending = tt_e2e_has($sbP, 'data/admin/pending.json');
    $liveAfterCommit = tt_e2e_task($boardP(), 'p-fault') !== null;
    check('P2: a post-commit failure reports committed_recovery_pending and leaves the public board complete',
        $r !== null && $r['status'] === 500 && $codeP($r) === 'committed_recovery_pending' && $committedPending && $liveAfterCommit);

    $r = tt_e2e_get($sbP, '/api/versions.php?view=admin');
    $finalized = !tt_e2e_has($sbP, 'data/admin/pending.json');
    check('P2: the next admin read finishes the interrupted private finalization without republishing',
        $okP($r) && $finalized && ($r['json']['binSummaries'] ?? null) !== null);

    // --- two real processes over one data directory --------------------------------------------
    $sb2 = tt_e2e_start_second($sbP);
    if (!$sb2) {
        echo "skip: cross-process revision check (second listener unavailable)\n";
    } else {
        $rev = $revP();
        $one = ['schemaVersion' => 2, 'operationId' => bin2hex(random_bytes(16)), 'baseRevision' => $rev,
                'tasks' => [['id' => 'p-fault', 'title' => 'Winner one', 'subject' => 'AA']],
                'announcements' => [], 'subjects' => $catalog];
        $two = ['operationId' => bin2hex(random_bytes(16))] + $one;
        $two['tasks'] = [['id' => 'p-fault', 'title' => 'Winner two', 'subject' => 'AA']];
        $first = tt_e2e_req($sbP, 'POST', '/api/publish.php', json_encode($one));
        $second = tt_e2e_req($sb2, 'POST', '/api/publish.php', json_encode($two));
        check('P2: two processes sharing one store yield one successful CAS write and one conflict',
            $okP($first) && $second !== null && $second['status'] === 409 && $codeP($second) === 'stale_base'
            && $revP() === $rev + 1);
        tt_e2e_stop($sb2);
        $GLOBALS['TT_E2E_KEEP_ROOT'] = false;
    }
}

// ---------------------------------------------------------------------------
// H. Migration CLI: explicit seed, coherent backup, one-time activation, and no writes on failure.
// Runs against a throwaway copy of api/ so the repository's own data/ is never touched.
// ---------------------------------------------------------------------------
$migRoot = rtrim(sys_get_temp_dir(), '/\\') . '/tt-mig-' . bin2hex(random_bytes(4));
if (!@mkdir($migRoot . '/api', 0777, true)) {
    echo "skip: migration CLI (cannot create a temp directory)\n";
} else {
    foreach (glob(dirname(__DIR__, 2) . '/api/*.php') ?: [] as $f) @copy($f, $migRoot . '/api/' . basename($f));
    @mkdir($migRoot . '/data/versions', 0777, true);
    $legacy = [
        'publishedAt'   => 1700000000,
        'tasks'         => [
            ['id' => 'legacy-1', 'title' => 'Kept', 'subject' => 'OLD1', 'changedAt' => 1600000000],
            ['id' => 'legacy-2', 'title' => 'Untouched'],
        ],
        'announcements' => [['text' => 'hello', 'createdAt' => 1690000000000]],
    ];
    @file_put_contents($migRoot . '/data/current.json', json_encode($legacy));
    @mkdir($migRoot . '/data/admin', 0777, true);
    $seed = ['schemaVersion' => 1, 'subjects' => [
        ['code' => 'OLD1', 'name' => 'Old One', 'color' => '#123456', 'active' => true],
        ['code' => 'UNUSED', 'name' => 'Never used', 'color' => '#654321', 'active' => false],
    ]];
    @file_put_contents($migRoot . '/data/admin/subjects-seed.json', json_encode($seed));
    $mig = fn(array $args): array => (function () use ($migRoot, $args) {
        $cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($migRoot . '/api/migrate-subjects.php');
        foreach ($args as $a) $cmd .= ' ' . escapeshellarg($a);
        $out = [];
        $code = 0;
        exec($cmd . ' 2>&1', $out, $code);
        return ['code' => $code, 'out' => implode("\n", $out)];
    })();
    $boardNow = fn() => json_decode((string)@file_get_contents($migRoot . '/data/current.json'), true);
    $beforeBytes = (string)@file_get_contents($migRoot . '/data/current.json');

    $r = $mig(['--check', '--seed', $migRoot . '/data/admin/subjects-seed.json', '--backup-dir', $migRoot . '/data/admin/backups/pre']);
    check('P2: migration --check validates and writes nothing',
        $r['code'] === 0 && strpos($r['out'], 'nothing was written') !== false
        && (string)@file_get_contents($migRoot . '/data/current.json') === $beforeBytes
        && !is_dir($migRoot . '/data/admin/backups'));

    $r = $mig(['--apply', '--seed', $migRoot . '/data/admin/subjects-seed.json', '--backup-dir', '/tmp/elsewhere']);
    check('P2: a backup directory outside the protected data tree is refused',
        $r['code'] !== 0 && (string)@file_get_contents($migRoot . '/data/current.json') === $beforeBytes);

    @file_put_contents($migRoot . '/data/admin/bad-seed.json', '{"schemaVersion":1,"subjects":[{"code":"x","name":"X","color":"#fff"}]}');
    $r = $mig(['--apply', '--seed', $migRoot . '/data/admin/bad-seed.json', '--backup-dir', $migRoot . '/data/admin/backups/pre']);
    check('P2: an invalid seed aborts without changing the board',
        $r['code'] !== 0 && (string)@file_get_contents($migRoot . '/data/current.json') === $beforeBytes
        && !is_file($migRoot . '/data/admin/state.json'));

    $r = $mig(['--apply', '--seed', $migRoot . '/data/admin/subjects-seed.json', '--backup-dir', $migRoot . '/data/admin/backups/pre']);
    $migrated = $boardNow();
    $state = json_decode((string)@file_get_contents($migRoot . '/data/admin/state.json'), true);
    check('P2: migration activates schema 2 once, keeping every task id, definition and stamp',
        $r['code'] === 0 && ($migrated['schemaVersion'] ?? null) === 2
        && ($migrated['revision'] ?? null) === 1
        && ($migrated['tasks'][0]['id'] ?? null) === 'legacy-1' && ($migrated['tasks'][0]['changedAt'] ?? null) === 1600000000
        && ($migrated['tasks'][1]['title'] ?? null) === 'Untouched'
        && count($migrated['subjects'] ?? []) === 2 && ($migrated['deletedTasks'] ?? null) === []);

    check('P2: migration writes the initial private state and a readable backup',
        is_array($state) && ($state['initialized'] ?? null) === true && count($state['presets'] ?? []) === 1
        && is_file($migRoot . '/data/admin/backups/pre/current.json')
        && json_decode((string)@file_get_contents($migRoot . '/data/admin/backups/pre/current.json'), true) !== null);

    $activated = (string)@file_get_contents($migRoot . '/data/current.json');
    $r = $mig(['--apply', '--seed', $migRoot . '/data/admin/subjects-seed.json', '--backup-dir', $migRoot . '/data/admin/backups/again']);
    check('P2: re-running the migration reports already-initialized and never replaces configured state',
        $r['code'] === 0 && strpos($r['out'], 'already-initialized') !== false
        && (string)@file_get_contents($migRoot . '/data/current.json') === $activated
        && !is_dir($migRoot . '/data/admin/backups/again'));

    $r = $mig(['--recover']);
    check('P2: the CLI recovery mode resolves pending state without touching a configured board',
        $r['code'] === 0 && strpos($r['out'], 'recover:') !== false
        && (string)@file_get_contents($migRoot . '/data/current.json') === $activated);

    tt_e2e_rmdir($migRoot);
}

// A transfer may carry the draft catalogue, but never deletion authority, private state or a
// sender's base revision: those are stripped by the whitelist, not passed through.
$d2 = fn(array $draft) => clean_payload(['v' => 1, 'progress' => [], 'draft' => $draft]);
$withCatalog = $d2(['schemaVersion' => 2, 'tasks' => [], 'announcements' => [],
    'subjects' => [['code' => 'TS1', 'name' => 'Test One', 'color' => '#3366CC', 'active' => true]]]);
check('transfer: a schema-2 draft keeps its validated catalogue',
    $withCatalog !== null && ($withCatalog['draft']['schemaVersion'] ?? null) === 2
    && ($withCatalog['draft']['subjects'][0]['color'] ?? null) === '#3366cc');
check('transfer: an invalid catalogue rejects the whole payload',
    clean_payload(['v' => 1, 'progress' => [], 'draft' => ['tasks' => [], 'announcements' => [],
        'subjects' => [['code' => 'X', 'name' => 'X', 'color' => '#fff', 'active' => true]]]]) === null);
check('transfer: a malformed entry rejects the payload before any field is trusted',
    clean_payload(['v' => 1, 'progress' => [], 'draft' => ['tasks' => [], 'announcements' => [],
        'subjects' => [['code' => 'OK'], ['code' => 'BAD!', 'name' => 'B', 'color' => '#123456', 'active' => true]]]]) === null);
check('transfer: an unsupported draft schema is refused',
    clean_payload(['v' => 1, 'progress' => [], 'draft' => ['schemaVersion' => 3, 'tasks' => [], 'announcements' => []]]) === null);
$stripped = $d2(['schemaVersion' => 2, 'tasks' => [], 'announcements' => [],
    'subjects' => [['code' => 'TS1', 'name' => 'One', 'color' => '#3366cc', 'active' => true]],
    'baseRevision' => 9, 'deletedTasks' => [['id' => 'victim', 'deletedAt' => 1]],
    'presets' => [['name' => 'p']], 'bin' => [['x' => 1]], 'retiredDraftIds' => [['id' => 'r']]]);
check('transfer: imported authority and private state never reach the candidate',
    $stripped !== null && !array_key_exists('baseRevision', $stripped['draft'])
    && !array_key_exists('deletedTasks', $stripped['draft']) && !array_key_exists('presets', $stripped['draft'])
    && !array_key_exists('bin', $stripped['draft']) && !array_key_exists('retiredDraftIds', $stripped['draft']));
check('transfer: a draft without a catalogue is accepted as legacy and stays catalogue-free',
    ($legacyDraft = $d2(['tasks' => [['id' => 'a']], 'announcements' => []])) !== null
    && !array_key_exists('subjects', $legacyDraft['draft']));

// Real transport round trip: create a transfer over HTTP, read it back, and assert the catalogue
// survived while authority and private state did not. No stubs, no validator echo.
$sbT = tt_e2e_start();
if (!$sbT) {
    echo "skip: transfer round trip (needs a loopback listener)\n";
} else {
    // The sandbox copies api/; the transfer endpoint lives at the docroot root.
    @copy(dirname(__DIR__, 2) . '/transfer.php', $sbT['root'] . '/transfer.php');
    @mkdir($sbT['root'] . '/data/transfers', 0777, true);
    $payload = ['v' => 1,
        'progress' => ['t1' => ['status' => 'done', 'movedAt' => 1700000000000]],
        'draft' => ['schemaVersion' => 2, 'tasks' => [['id' => 't1', 'title' => 'Kept', 'subject' => 'TS1']],
            'announcements' => [],
            'subjects' => [['code' => 'TS1', 'name' => 'Test One', 'color' => '#3366cc', 'active' => true]],
            'baseRevision' => 7, 'deletedTasks' => [['id' => 'gone', 'deletedAt' => 1]]]];
    $create = tt_e2e_req($sbT, 'POST', '/transfer.php', json_encode(['payload' => $payload]));
    $token = is_array($create['json'] ?? null) ? (string)($create['json']['token'] ?? '') : '';
    check('transfer: a payload creates a real short-lived token', $create !== null && $create['status'] === 200 && strlen($token) === 32);
    $read = tt_e2e_get($sbT, '/transfer.php?t=' . $token);
    $back = is_array($read['json'] ?? null) ? ($read['json']['payload'] ?? null) : null;
    check('transfer: the round trip keeps the validated catalogue and the task subject',
        $read !== null && $read['status'] === 200 && is_array($back)
        && ($back['draft']['subjects'][0]['color'] ?? null) === '#3366cc'
        && ($back['draft']['tasks'][0]['subject'] ?? null) === 'TS1'
        && ($back['progress']['t1']['status'] ?? null) === 'done');
    check('transfer: the round trip strips base revision and deletion markers',
        is_array($back) && !array_key_exists('baseRevision', $back['draft'])
        && !array_key_exists('deletedTasks', $back['draft']));
    $bad = tt_e2e_req($sbT, 'POST', '/transfer.php', json_encode(['payload' => ['v' => 1, 'progress' => [], 'draft' => ['tasks' => [], 'announcements' => [], 'subjects' => [['code' => 'X', 'name' => 'X', 'color' => '#fff', 'active' => true]]]]]));
    check('transfer: an invalid catalogue is refused before storage', $bad !== null && $bad['status'] === 400);
    check('transfer: an unknown token is a plain 404, never a partial payload',
        ($unknown = tt_e2e_get($sbT, '/transfer.php?t=' . str_repeat('a', 32))) !== null && $unknown['status'] === 404);
    tt_e2e_stop($sbT);
}

exit($fails ? 1 : 0);