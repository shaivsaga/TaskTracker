<?php
declare(strict_types=1);

const TTL          = 600;      // seconds a link lives  
const MAX_BODY     = 1048576;  // 1 MB
const MAX_CREATES  = 30;       // creates + cancels per window per IP
const MAX_READS    = 300;      // reads per window per IP
const RATE_WINDOW  = 600;     

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $code, $body = null) {
    http_response_code($code);
    if ($body !== null) echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

const NOT_FOUND = ['error' => 'This transfer link is not valid or has expired.'];

// Sliding-window rate limit per IP, one small file per IP, guarded by flock.
function rate_ok(string $dir, string $kind, int $limit): bool {
    $ip   = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $file = $dir . '/rl_' . sha1($ip) . '.json';
    $fh   = @fopen($file, 'c+');
    if (!$fh) respond(500, ['error' => 'Transfer storage is not available.']);
    flock($fh, LOCK_EX);
    $data = json_decode((string)stream_get_contents($fh), true);
    if (!is_array($data)) $data = [];
    $now = time();
    foreach (['create', 'read'] as $k) {
        $list = isset($data[$k]) && is_array($data[$k]) ? $data[$k] : [];
        $data[$k] = array_values(array_filter($list, function ($t) use ($now) {
            return is_int($t) && $t > $now - RATE_WINDOW;
        }));
    }
    $ok = count($data[$kind]) < $limit;
    if ($ok) $data[$kind][] = $now;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($data));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $ok;
}

// Rebuilds the payload from a strict whitelist. Returns null if anything is off.
function clean_payload($p) {
    if (!is_array($p) || ($p['v'] ?? null) !== 1) return null;
    $pr = $p['progress'] ?? null;
    if (!is_array($pr) || count($pr) > 5000) return null;
    $progress = [];
    foreach ($pr as $id => $e) {
        $id = (string)$id;
        if ($id === '__proto__' || !preg_match('/^[\w.\-]{1,100}$/', $id)) return null;
        if (!is_array($e)) return null;
        $st = $e['status'] ?? null;
        $mv = $e['movedAt'] ?? null;
        if (!in_array($st, ['not_started', 'in_progress', 'done'], true)) return null;
        if ((!is_int($mv) && !is_float($mv)) || $mv < 0 || $mv > 4102444800000) return null;
        $progress[$id] = ['status' => $st, 'movedAt' => (int)round($mv)];
    }
    $clean = ['v' => 1, 'progress' => (object)$progress];
    if (array_key_exists('draft', $p) && $p['draft'] !== null) {
        $d = $p['draft'];
        if (!is_array($d)) return null;
        $tasks = $d['tasks'] ?? null;
        $ann   = $d['announcements'] ?? [];
        if (!is_array($tasks) || !is_array($ann) || count($tasks) > 2000 || count($ann) > 200) return null;
        foreach ($tasks as $t) if (!is_array($t)) return null;
        foreach ($ann as $a)   if (!is_array($a)) return null;
        $clean['draft'] = ['tasks' => array_values($tasks), 'announcements' => array_values($ann)];
    }
    return $clean;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'POST') {
    header('Allow: GET, POST');
    respond(405, ['error' => 'Method not allowed.']);
}

// Storage: data/transfers/ with its own deny-all .htaccess
$dir = __DIR__ . '/data/transfers';
if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) respond(500, ['error' => 'Transfer storage is not available.']);
if (!is_writable($dir)) respond(500, ['error' => 'Transfer storage is not available.']);
$ht = $dir . '/.htaccess';
if (!is_file($ht)) {
    @file_put_contents($ht,
        "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n" .
        "<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
}

// Delete expired links and stale rate files on every request
$now = time();
foreach (glob($dir . '/*.json') ?: [] as $f) {
    $b = basename($f);
    $mt = @filemtime($f);
    if ($mt === false) continue;
    if (preg_match('/^[a-f0-9]{32}\.json$/', $b) && $mt + TTL < $now) @unlink($f);
    elseif (strncmp($b, 'rl_', 3) === 0 && $mt + RATE_WINDOW < $now) @unlink($f);
}
foreach (glob($dir . '/*.tmp') ?: [] as $f) {
    if (@filemtime($f) !== false && filemtime($f) + 60 < $now) @unlink($f);
}

if ($method === 'GET') {
    if (!rate_ok($dir, 'read', MAX_READS)) respond(429, ['error' => 'Too many attempts. Try again in a few minutes.']);
    $t = $_GET['t'] ?? '';
    if (!is_string($t) || !preg_match('/^[a-f0-9]{32}$/', $t)) respond(404, NOT_FOUND);
    $raw = @file_get_contents($dir . '/' . $t . '.json');
    $rec = $raw === false ? null : json_decode($raw, true);
    if (!is_array($rec) || !isset($rec['expiresAt'], $rec['payload']) || $rec['expiresAt'] < $now * 1000) respond(404, NOT_FOUND);
    respond(200, ['payload' => $rec['payload'], 'expiresAt' => $rec['expiresAt']]);
}

// POST: create or cancel. Both count toward the create limit.
if (!rate_ok($dir, 'create', MAX_CREATES)) respond(429, ['error' => 'Too many attempts. Try again in a few minutes.']);
$ct = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
if (strpos($ct, 'application/json') !== 0) respond(415, ['error' => 'Unsupported content type.']);
$raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ($raw === false || $raw === '') respond(400, ['error' => 'Invalid request.']);
if (strlen($raw) > MAX_BODY) respond(413, ['error' => 'Your data is too large to transfer. Remove large images from notes and try again.']);
$in = json_decode($raw, true, 32);
if (!is_array($in)) respond(400, ['error' => 'Invalid request.']);

if (array_key_exists('cancel', $in)) {
    $c = $in['cancel'];
    if (is_string($c) && preg_match('/^[a-f0-9]{32}$/', $c)) @unlink($dir . '/' . $c . '.json');
    respond(204); // same answer whether or not the token existed
}

$clean = clean_payload($in['payload'] ?? null);
if ($clean === null) respond(400, ['error' => 'The data could not be read.']);

$token = bin2hex(random_bytes(16));
$exp   = ($now + TTL) * 1000;
$json  = json_encode(['expiresAt' => $exp, 'payload' => $clean], JSON_UNESCAPED_SLASHES);
$path  = $dir . '/' . $token . '.json';
$tmp   = $path . '.tmp';
if ($json === false || @file_put_contents($tmp, $json, LOCK_EX) === false || !@rename($tmp, $path)) {
    @unlink($tmp);
    respond(500, ['error' => 'Could not save the transfer.']);
}
respond(200, ['token' => $token, 'expiresAt' => $exp, 'expiresIn' => TTL]);