<?php
declare(strict_types=1);
// Test-only support for tests/php/run.php.
//
// api/publish.php and api/versions.php are scripts, not functions: they exit, read php://input and
// require an admin session, so run.php cannot exercise them in-process. This helper boots a
// throwaway copy of the real api/*.php files under the PHP built-in server, with its own data/
// directory, and talks to it over loopback HTTP. Nothing here touches the repository's own data/.
//
// Every entry point returns null / an empty list when the sandbox cannot be built (no proc_open, no
// allow_url_fopen, no listening socket). Callers then print a "skip:" line instead of failing, so an
// environment without loopback HTTP is not turned into a red build.

function tt_e2e_rmdir(string $dir): void {
    if (!is_dir($dir)) return;
    foreach (glob($dir . '/*') ?: [] as $f) { is_dir($f) ? tt_e2e_rmdir($f) : @unlink($f); }
    foreach (glob($dir . '/.*') ?: [] as $f) {              // dotfiles: .htaccess, .publish.lock
        $b = basename($f);
        if ($b === '.' || $b === '..') continue;
        is_dir($f) ? tt_e2e_rmdir($f) : @unlink($f);
    }
    @rmdir($dir);
}

// Copy the real api/ files into a temp docroot, add an admin session record whose token this test
// owns, and start the built-in server on it. Returns null when the environment cannot host it.
function tt_e2e_start(): ?array {
    if (!function_exists('proc_open') || !function_exists('proc_terminate') || !ini_get('allow_url_fopen')) return null;
    $src  = dirname(__DIR__, 2) . '/api';
    $root = rtrim(sys_get_temp_dir(), '/\\') . '/tt-e2e-' . bin2hex(random_bytes(4));
    if (!@mkdir($root . '/api', 0777, true)) return null;
    foreach (glob($src . '/*.php') ?: [] as $f) {
        if (!@copy($f, $root . '/api/' . basename($f))) { tt_e2e_rmdir($root); return null; }
    }
    if (!is_file($root . '/api/publish.php') || !is_file($root . '/api/versions.php')) { tt_e2e_rmdir($root); return null; }

    $token = bin2hex(random_bytes(32));
    $now   = time();
    if (!@mkdir($root . '/data/sessions', 0777, true)) { tt_e2e_rmdir($root); return null; }
    $rec = json_encode(['created' => $now, 'lastSeen' => $now, 'expires' => $now + 3600]);
    if (@file_put_contents($root . '/data/sessions/' . hash('sha256', $token) . '.json', $rec) !== strlen($rec)) {
        tt_e2e_rmdir($root);
        return null;
    }

    $log = $root . '/server.log';
    for ($try = 0; $try < 5; $try++) {
        $port = random_int(20000, 60000);
        $proc = @proc_open(
            [PHP_BINARY, '-S', '127.0.0.1:' . $port, '-t', $root],
            [0 => ['file', $log, 'a'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']],
            $pipes
        );
        if (!is_resource($proc)) continue;
        for ($i = 0; $i < 100; $i++) {                       // up to ~10 s for the first bind
            $fp = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.2);
            if ($fp) { fclose($fp); return ['root' => $root, 'port' => $port, 'token' => $token, 'proc' => $proc, 'log' => $log]; }
            usleep(100000);
        }
        @proc_terminate($proc);
        @proc_close($proc);
    }
    tt_e2e_rmdir($root);
    return null;
}

function tt_e2e_stop(?array $sb): void {
    if (!$sb) return;
    if (isset($sb['proc']) && is_resource($sb['proc'])) { @proc_terminate($sb['proc']); @proc_close($sb['proc']); }
    tt_e2e_rmdir($sb['root']);
}

// One admin-authenticated request. Returns ['status' => int, 'body' => string, 'json' => array|null],
// or null when the request itself could not be made (server died, bad port).
function tt_e2e_req(array $sb, string $method, string $path, ?string $body = null, array $headers = []): ?array {
    $cookie = defined('TT_COOKIE') ? TT_COOKIE : 'tt_admin';   // api/_session.php defines it; run.php requires that file
    $hs = array_merge(['Cookie: ' . $cookie . '=' . $sb['token'], 'Connection: close'], $headers);
    if ($body !== null && !preg_grep('/^content-type:/i', $hs)) $hs[] = 'Content-Type: application/json';
    $ctx = stream_context_create(['http' => [
        'method' => $method, 'header' => implode("\r\n", $hs), 'content' => $body ?? '',
        'ignore_errors' => true, 'timeout' => 20, 'protocol_version' => 1.1,
    ]]);
    $raw = @file_get_contents('http://127.0.0.1:' . $sb['port'] . $path, false, $ctx);
    $status = 0;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) { $status = (int)$m[1]; break; }
    }
    if ($status === 0) return null;
    return ['status' => $status, 'body' => (string)$raw, 'json' => json_decode((string)$raw, true)];
}

function tt_e2e_publish(array $sb, array $payload): ?array {
    $json = json_encode($payload);
    return $json === false ? null : tt_e2e_req($sb, 'POST', '/api/publish.php', $json);
}

function tt_e2e_get(array $sb, string $path): ?array {
    return tt_e2e_req($sb, 'GET', $path);
}

// Read one JSON file out of the sandbox (the board, a snapshot, ...). Null when missing/unreadable.
function tt_e2e_json_file(array $sb, string $rel): ?array {
    $v = json_decode((string)@file_get_contents($sb['root'] . '/' . $rel), true);
    return is_array($v) ? $v : null;
}

function tt_e2e_task(?array $board, string $id): ?array {
    foreach (is_array($board['tasks'] ?? null) ? $board['tasks'] : [] as $t) {
        if (is_array($t) && ($t['id'] ?? null) === $id) return $t;
    }
    return null;
}

// Every body reference a stored task carries, in the shape the S1b design proposes
// (notesRef: {id, len, excerpt}) or any other key whose value carries a 64-hex id.
// Deliberately shape-tolerant: it must recognise a reference in whatever form the owner approves.
function tt_e2e_refs(array $task): array {
    $out = [];
    foreach ($task as $k => $v) {
        if (is_string($v) && preg_match('/^[a-f0-9]{64}$/D', $v)) $out[] = ['key' => (string)$k, 'id' => $v];
        if (is_array($v) && is_string($v['id'] ?? null) && preg_match('/^[a-f0-9]{64}$/D', $v['id'])) {
            $out[] = ['key' => (string)$k, 'id' => $v['id'], 'len' => $v['len'] ?? null];
        }
    }
    return $out;
}

function tt_e2e_count(array $sb, string $pattern): int {
    return count(glob($sb['root'] . '/' . $pattern) ?: []);
}
