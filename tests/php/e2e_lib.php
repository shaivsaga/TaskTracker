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

// The commit protocol's one test seam. The copied api/_board.php answers false; here that body is
// replaced so a scenario can stop the commit at a named step. The trigger is a file in the sandbox
// data directory, which only this test can write, never a request parameter.
const TT_E2E_FAULT_SOURCE = '/function tt_fault\(\$name\) \{\s*return false;\s*\}/';
const TT_E2E_FAULT_SANDBOX = "function tt_fault(\$name) {\n    \$f = dirname(__DIR__) . '/data/.fault';\n    return is_file(\$f) && trim((string)@file_get_contents(\$f)) === \$name;\n}";

// Copy the real api/ files into a temp docroot, add an admin session record whose token this test
// owns, and start the built-in server on it. Returns null when the environment cannot host it.
// $reuseRoot with $reuseToken starts a second process over an existing sandbox: the token is passed
// in, never guessed, because two sandboxes in one run hold two different sessions.
function tt_e2e_start(?string $reuseRoot = null, ?string $reuseToken = null): ?array {
    if (!function_exists('proc_open') || !function_exists('proc_terminate') || !ini_get('allow_url_fopen')) return null;
    $src  = dirname(__DIR__, 2) . '/api';
    $root = $reuseRoot ?? rtrim(sys_get_temp_dir(), '/\\') . '/tt-e2e-' . bin2hex(random_bytes(4));
    if ($reuseRoot === null) {
        if (!@mkdir($root . '/api', 0777, true)) return null;
        foreach (glob($src . '/*.php') ?: [] as $f) {
            if (!@copy($f, $root . '/api/' . basename($f))) { tt_e2e_rmdir($root); return null; }
        }
        // Only the sandbox copy gets the live fault seam. The source is matched with a tolerant
        // pattern so a CRLF checkout still rewrites; a silent miss would disable every fault case.
        $board = $root . '/api/_board.php';
        $body = (string)@file_get_contents($board);
        if ($body !== '') @file_put_contents($board, (string)preg_replace(TT_E2E_FAULT_SOURCE, TT_E2E_FAULT_SANDBOX, $body, 1));
    }
    if (!is_file($root . '/api/publish.php') || !is_file($root . '/api/versions.php') || !is_file($root . '/api/_board.php')) { tt_e2e_rmdir($root); return null; }

    if ($reuseRoot === null) {
        $token = bin2hex(random_bytes(32));
        $now   = time();
        if (!@mkdir($root . '/data/sessions', 0777, true)) { tt_e2e_rmdir($root); return null; }
        $rec = json_encode(['created' => $now, 'lastSeen' => $now, 'expires' => $now + 3600]);
        if (@file_put_contents($root . '/data/sessions/' . hash('sha256', $token) . '.json', $rec) !== strlen($rec)) {
            tt_e2e_rmdir($root);
            return null;
        }
    } else {
        $token = (string)$reuseToken;
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

// A second real PHP process over the SAME storage, so two writers can interleave on one lock.
function tt_e2e_start_second(array $sb): ?array {
    return tt_e2e_start($sb['root'], $sb['token']);
}

function tt_e2e_stop(?array $sb): void {
    if (!$sb) return;
    if (isset($sb['proc']) && is_resource($sb['proc'])) { @proc_terminate($sb['proc']); @proc_close($sb['proc']); }
    if (($GLOBALS['TT_E2E_KEEP_ROOT'] ?? false) === true) return;
    tt_e2e_rmdir($sb['root']);
}

// One admin-authenticated request. Returns ['status' => int, 'body' => string, 'json' => array|null],
// or null when the request itself could not be made (server died, bad port).
// $auth = false omits the session cookie: the unauthenticated coverage the sandbox needs.
function tt_e2e_req(array $sb, string $method, string $path, ?string $body = null, array $headers = [], bool $auth = true): ?array {
    $cookie = defined('TT_COOKIE') ? TT_COOKIE : 'tt_admin';   // api/_session.php defines it; run.php requires that file
    $hs = $headers;
    if ($auth) array_unshift($hs, 'Cookie: ' . $cookie . '=' . $sb['token']);
    $hs[] = 'Connection: close';
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
    return ['status' => $status, 'body' => (string)$raw, 'json' => json_decode((string)$raw, true), 'headers' => $http_response_header ?? []];
}

// The catalog a normal test publish carries: the live definitions plus a neutral retired
// definition for any code a scenario invents. Explicit subject cases pass their own 'subjects'.
function tt_e2e_catalog(array $tasks, ?array $board): array {
    $out = [];
    $seen = [];
    foreach (is_array($board['subjects'] ?? null) ? $board['subjects'] : [] as $s) {
        if (!is_array($s) || !is_string($s['code'] ?? null)) continue;
        $out[] = $s;
        $seen[$s['code']] = true;
    }
    foreach ($tasks as $t) {
        $code = is_array($t) ? ($t['subject'] ?? '') : '';
        if (!is_string($code) || $code === '' || isset($seen[$code])) continue;
        $out[] = ['code' => $code, 'name' => $code, 'color' => '#c3c7d6', 'active' => false];
        $seen[$code] = true;
    }
    return $out;
}

// A schema-2 publish. A payload without schemaVersion is wrapped with the current revision, a
// fresh operation id and a catalog, so existing per-field assertions still reach their validators.
// A payload that names schemaVersion is posted verbatim: legacy, stale and malformed cases need that.
function tt_e2e_publish(array $sb, array $payload): ?array {
    if (!array_key_exists('schemaVersion', $payload)) {
        $board = tt_e2e_json_file($sb, 'data/current.json');
        $payload = $payload + [];
        if (!array_key_exists('subjects', $payload)) $payload['subjects'] = tt_e2e_catalog($payload['tasks'] ?? [], $board);
        $payload = ['schemaVersion' => 2, 'operationId' => bin2hex(random_bytes(16)),
                    'baseRevision' => is_array($board) ? (int)($board['revision'] ?? 0) : 0] + $payload;
    }
    $json = json_encode($payload);
    return $json === false ? null : tt_e2e_req($sb, 'POST', '/api/publish.php', $json);
}

// A private admin call: action, a fresh operation id and the current admin revision.
function tt_e2e_admin(array $sb, string $action, array $fields = [], ?string $operationId = null, ?int $baseAdminRevision = null): ?array {
    $state = tt_e2e_json_file($sb, 'data/admin/state.json');
    $payload = ['action' => $action, 'operationId' => $operationId ?? bin2hex(random_bytes(16)),
                'baseAdminRevision' => $baseAdminRevision ?? (is_array($state) ? (int)($state['revision'] ?? 1) : 1)] + $fields;
    $json = json_encode($payload);
    return $json === false ? null : tt_e2e_req($sb, 'POST', '/api/versions.php', $json);
}

function tt_e2e_get(array $sb, string $path, bool $auth = true): ?array {
    return tt_e2e_req($sb, 'GET', $path, null, [], $auth);
}

// Read one JSON file out of the sandbox (the board, a snapshot, ...). Null when missing/unreadable.
function tt_e2e_json_file(array $sb, string $rel): ?array {
    $v = json_decode((string)@file_get_contents($sb['root'] . '/' . $rel), true);
    return is_array($v) ? $v : null;
}

function tt_e2e_write_json(array $sb, string $rel, array $value): bool {
    $path = $sb['root'] . '/' . $rel;
    if (!is_dir(dirname($path))) @mkdir(dirname($path), 0777, true);
    return @file_put_contents($path, json_encode($value, JSON_UNESCAPED_UNICODE)) !== false;
}

// Write a board straight into the sandbox, so a scenario can seed a stamp or a legacy shape that
// the publish path would otherwise normalise away.
function tt_e2e_write_board(array $sb, array $board): bool {
    return tt_e2e_write_json($sb, 'data/current.json', $board);
}

function tt_e2e_bytes(array $sb, string $rel): ?string {
    $raw = @file_get_contents($sb['root'] . '/' . $rel);
    return $raw === false ? null : $raw;
}

// File existence with the stat cache cleared: the server deletes files, and a cached is_file()
// in this process would keep reporting the file that is already gone.
function tt_e2e_has(array $sb, string $rel): bool {
    $path = $sb['root'] . '/' . $rel;
    clearstatcache(true, $path);
    return is_file($path);
}

function tt_e2e_fault(array $sb, ?string $name): void {
    $f = $sb['root'] . '/data/.fault';
    if ($name === null) { @unlink($f); return; }
    @file_put_contents($f, $name);
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
