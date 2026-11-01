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

exit($fails ? 1 : 0);