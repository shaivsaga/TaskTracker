<?php
declare(strict_types=1);
require __DIR__ . '/../../api/_validate.php';
require __DIR__ . '/../../api/_session.php';  // tt_https() / tt_guard_dir(); nothing here calls out to the network

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

exit($fails ? 1 : 0);