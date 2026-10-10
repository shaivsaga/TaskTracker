<?php
header('Content-Type: application/json');
$config = require __DIR__ . '/config.php';
function fail($code, $msg) { http_response_code($code); echo json_encode(['error' => $msg]); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST only');
$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in) || !isset($in['tasks']) || !is_array($in['tasks'])) fail(400, 'Invalid payload');

$now = time();
$current = [
  'publishedAt'   => $now,
  'tasks'         => array_values($in['tasks']),
  'announcements' => array_values($in['announcements'] ?? []),
];
$dataDir = dirname(__DIR__) . '/data';
$verDir  = $dataDir . '/versions';
if (!is_dir($verDir)) {
  if (!mkdir($verDir, 0775, true)) fail(500, 'Cannot create data directory');
  file_put_contents($verDir . '/.htaccess', "Require all denied\n");
}
$version = $current + ['note' => mb_substr(trim((string)($in['note'] ?? '')), 0, 80)];
$flags = JSON_UNESCAPED_UNICODE;
if (file_put_contents($dataDir . '/current.json', json_encode($current, $flags), LOCK_EX) === false
 || file_put_contents("$verDir/$now.json", json_encode($version, $flags), LOCK_EX) === false) fail(500, 'Write failed');

$files = glob("$verDir/*.json") ?: [];
sort($files);
foreach (array_slice($files, 0, max(0, count($files) - (int)$config['keep_versions'])) as $f) unlink($f);
echo json_encode(['current' => $current]);