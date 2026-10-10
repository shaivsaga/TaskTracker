<?php
header('Content-Type: application/json');
$dir = dirname(__DIR__) . '/data/versions';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $in = json_decode(file_get_contents('php://input'), true) ?: [];
  if (!empty($in['all'])) {
    foreach (glob("$dir/*.json") ?: [] as $f) unlink($f);
  } elseif (isset($in['id']) && preg_match('/^\d+$/', (string)$in['id'])) {
    $f = "$dir/{$in['id']}.json";
    if (is_file($f)) unlink($f);
  } else {
    http_response_code(400); echo json_encode(['error' => 'Bad request']); exit;
  }
  echo json_encode(['ok' => true]); exit;
}

$out = [];
foreach (array_reverse(glob("$dir/*.json") ?: []) as $f) {
  $v = json_decode(file_get_contents($f), true);
  if (is_array($v)) $out[] = ['id' => basename($f, '.json')] + $v;
}
echo json_encode(['versions' => $out], JSON_UNESCAPED_UNICODE);