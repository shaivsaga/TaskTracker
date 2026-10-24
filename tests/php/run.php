<?php
declare(strict_types=1);
require __DIR__ . '/../../api/_validate.php';

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

exit($fails ? 1 : 0);