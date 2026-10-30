<?php
// Admin sessions. Basic Auth (api/login.php) is only the one-time sign-in.
// After that an HttpOnly cookie carries the session. The server keeps a SHA-256
// hash of the token in data/sessions/, never the token itself.
const TT_COOKIE = 'tt_admin';
const TT_TTL = 60 * 86400;      // expires after 60 days without use
const TT_RENEW_AFTER = 86400;   // slide the expiry at most once a day

header('Cache-Control: no-store');

function tt_json($code, $body) {
  http_response_code($code);
  header('Content-Type: application/json');
  echo json_encode($body);
  exit;
}

function tt_require_json_post() {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') tt_json(405, ['error' => 'POST only']);
  $ct = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '')[0]));
  if ($ct !== 'application/json') tt_json(415, ['error' => 'Content-Type must be application/json']);
}

function tt_dir() { return dirname(__DIR__) . '/data/sessions'; }
function tt_token_ok($t) { return is_string($t) && preg_match('/^[a-f0-9]{64}$/D', $t) === 1; }
function tt_file($token) { return tt_dir() . '/' . hash('sha256', $token) . '.json'; }
function tt_current_token() { $t = $_COOKIE[TT_COOKIE] ?? null; return tt_token_ok($t) ? $t : null; }

// Azure terminates TLS in front of nginx, so the forwarded protocol is the only positive
// signal that the visitor's own connection was HTTPS. A client can send that header itself,
// though, and a proxy is not guaranteed to replace rather than append it, so it is used only
// to ADD confidence. The default is Secure: a missing, stripped or appended header now falls
// through to "assume HTTPS" instead of silently issuing a session cookie that can travel over
// plaintext HTTP. Only an unambiguously local host opts out, because a Secure cookie could
// never be sent back to it. The Host header is client-supplied too, but spoofing it only ever
// gives the spoofer's own browser the weaker cookie -- it cannot loosen anyone else's.
function tt_https() {
  $h = $_SERVER['HTTPS'] ?? '';
  if ($h !== '' && $h !== 'off') return true;  // set by our own web server: authoritative
  if (strtolower(trim((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))) === 'https') return true;
  return !tt_local_host();
}

function tt_local_host() {
  $host = strtolower(trim((string)($_SERVER['HTTP_HOST'] ?? '')));
  if ($host === '') return false;
  if ($host[0] === '[') $host = substr($host, 1, (int)strpos($host, ']') - 1);  // [::1]:8080
  elseif (($c = strpos($host, ':')) !== false) $host = substr($host, 0, $c);    // host:port
  return $host === 'localhost' || $host === '127.0.0.1' || $host === '::1';
}

// The cookie is scoped to the api folder. Derived from the script path, so it also
// works locally in a subfolder (/TaskTracker/api/), not just on the live site (/api/).
function tt_path() { return rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/api/x.php'), '/') . '/'; }

function tt_cookie($token, $expires) {
  setcookie(TT_COOKIE, $token, [
    'expires'  => $expires,
    'path'     => tt_path(),
    'secure'   => tt_https(),
    'httponly' => true,
    'samesite' => 'Lax',
  ]);
}

function tt_write($file, $rec) {
  $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
  $json = json_encode($rec);
  if (@file_put_contents($tmp, $json, LOCK_EX) !== strlen($json) || !@rename($tmp, $file)) { @unlink($tmp); return false; }
  return true;
}

// Same deny-all guard publish.php and transfer.php write into the folders they own. Written
// whenever the file is missing, so a data/sessions/ that already exists picks one up too.
function tt_guard_dir($dir) {
  $ht = $dir . '/.htaccess';
  if (is_file($ht)) return;
  @file_put_contents($ht,
    "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n" .
    "<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
}

function tt_create() {
  $dir = tt_dir();
  if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) tt_json(500, ['error' => 'Cannot create session storage']);
  tt_guard_dir($dir);
  $now = time();
  foreach (glob($dir . '/*.json') ?: [] as $f) {  // drop expired sessions
    $r = json_decode((string)@file_get_contents($f), true);
    if (!is_array($r) || ($r['expires'] ?? 0) < $now) @unlink($f);
  }
  $token = bin2hex(random_bytes(32));
  if (!tt_write(tt_file($token), ['created' => $now, 'lastSeen' => $now, 'expires' => $now + TT_TTL])) tt_json(500, ['error' => 'Cannot save session']);
  tt_cookie($token, $now + TT_TTL);
}

function tt_revoke($token) { if ($token !== null) @unlink(tt_file($token)); }

// Call at the top of every endpoint that needs an admin. Exits with 401 (no WWW-Authenticate, so no browser prompt).
function tt_require_admin() {
  $token = tt_current_token();
  $file = $token !== null ? tt_file($token) : null;
  $rec = $file !== null ? json_decode((string)@file_get_contents($file), true) : null;
  $now = time();
  if (!is_array($rec) || ($rec['expires'] ?? 0) < $now) {
    if ($file !== null) @unlink($file);
    tt_json(401, ['error' => 'Your admin session has ended. Sign in again from Settings.']);
  }
  if ($now - ($rec['lastSeen'] ?? 0) >= TT_RENEW_AFTER) {
    $rec['lastSeen'] = $now;
    $rec['expires'] = $now + TT_TTL;
    if (tt_write($file, $rec)) tt_cookie($token, $rec['expires']);
  }
}
