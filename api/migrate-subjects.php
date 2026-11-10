<?php
declare(strict_types=1);
// Operator tool: activate schema 2 once, from an explicit, validated legacy seed.
//
// Command line only. There is no HTTP mode, and no value here is ever taken from a request, so this
// file stays out of the API allowlist and is unreachable from the site.
//
//   php api/migrate-subjects.php --check --seed data/admin/subjects-seed.json --backup-dir data/admin/backups/pre-subjects
//   php api/migrate-subjects.php --apply --seed ... --backup-dir ...
//   php api/migrate-subjects.php --recover
//
// --check validates and prints counts only; it writes nothing.
// --apply revalidates under the lock, backs up the coherent current state, and initializes once.
//         An already initialized installation is reported and never replaced.
// --recover resolves an interrupted commit under the lock; it never restores an old backup.
//
// This script never embeds real configuration: the seed file is provided privately by the operator.

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "migrate-subjects.php runs from the command line only\n");
    exit(2);
}

require __DIR__ . '/_board.php';

const MIGRATE_USAGE = 'usage: php api/migrate-subjects.php --check|--apply --seed <file> --backup-dir <dir> | --recover';

function mig_fail(string $message, int $code = 1): void {
    fwrite(STDERR, "abort: $message\n");
    exit($code);
}

function mig_arg(array $args, string $name): ?string {
    foreach ($args as $i => $a) {
        if ($a === "--$name") return $args[$i + 1] ?? null;
        if (str_starts_with($a, "--$name=")) return substr($a, strlen($name) + 3);
    }
    return null;
}

// The real path of a target that may not exist yet: resolve the nearest existing ancestor and
// append the missing segments, so containment is judged on where the directory will actually be.
function mig_real_target(string $path): ?string {
    $missing = [];
    $cur = $path;
    while (($real = realpath($cur)) === false) {
        $parent = dirname($cur);
        if ($parent === $cur) return null;
        array_unshift($missing, basename($cur));
        $cur = $parent;
    }
    return $missing ? $real . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $missing) : $real;
}

// Inside the protected data tree, or absolute and elsewhere: anywhere else could be served publicly.
function mig_backup_ok(string $dataDir, string $dir): bool {
    $real = mig_real_target($dir);
    if ($real === null) return false;
    $root = realpath($dataDir);
    if ($root === false) return false;
    return str_starts_with(strtolower($real), strtolower($root) . DIRECTORY_SEPARATOR);
}

// A coherent copy of everything the activation could ever need to be undone by hand.
function mig_backup(string $dataDir, string $backupDir): array {
    if (!is_dir($backupDir) && !@mkdir($backupDir, 0770, true) && !is_dir($backupDir)) mig_fail("cannot create $backupDir");
    $copied = [];
    foreach (['current.json', 'admin/state.json', 'admin/pending.json'] as $rel) {
        $src = $dataDir . '/' . $rel;
        if (!is_file($src)) continue;
        $dst = $backupDir . '/' . str_replace('/', '_', $rel);
        if (!@copy($src, $dst)) mig_fail("cannot back up $rel");
        if (json_decode((string)@file_get_contents($dst), true) === null) mig_fail("backup of $rel is not readable JSON");
        $copied[] = ['file' => $rel, 'sha256' => hash_file('sha256', $dst), 'bytes' => filesize($dst)];
    }
    $verDir = $dataDir . '/versions';
    $snaps = 0;
    if (is_dir($verDir)) {
        if (!is_dir($backupDir . '/versions') && !@mkdir($backupDir . '/versions', 0770, true) && !is_dir($backupDir . '/versions')) mig_fail('cannot create the versions backup');
        foreach (glob($verDir . '/*.json') ?: [] as $f) {
            if (!@copy($f, $backupDir . '/versions/' . basename($f))) mig_fail('cannot back up ' . basename($f));
            if (json_decode((string)@file_get_contents($backupDir . '/versions/' . basename($f)), true) === null) mig_fail('backup of ' . basename($f) . ' is not readable JSON');
            $snaps++;
        }
    }
    return ['files' => $copied, 'snapshots' => $snaps];
}

$args = array_slice($argv, 1);
$modes = array_values(array_intersect($args, ['--check', '--apply', '--recover']));
if (count($modes) !== 1) mig_fail(MIGRATE_USAGE, 2);

$dataDir = dirname(__DIR__) . '/data';
[$lock, $lockErr] = tt_board_lock($dataDir);
if ($lock === null) mig_fail('the publish lock is unavailable', 3);

try {
    $recovered = tt_recover_pending($dataDir);
    if (isset($recovered['error'])) mig_fail('an interrupted operation is unresolved: ' . $recovered['error'], 4);

    if ($modes[0] === '--recover') {
        echo 'recover: ' . json_encode($recovered) . "\n";
        exit(0);
    }

    $seedPath = mig_arg($args, 'seed');
    $backupDir = mig_arg($args, 'backup-dir');
    if ($seedPath === null || $backupDir === null) mig_fail(MIGRATE_USAGE, 2);
    if (!mig_backup_ok($dataDir, $backupDir)) mig_fail('--backup-dir must live inside the protected data directory');

    [$board, $boardErr] = tt_read_board($dataDir);
    if ($boardErr !== null) mig_fail('the current board is unreadable; refusing to guess: ' . $boardErr, 5);
    [$admin, $adminErr] = tt_read_admin($dataDir);
    if ($adminErr !== null) mig_fail('the private admin state is unreadable; refusing to overwrite it: ' . $adminErr, 5);

    if (is_array($admin) && ($admin['initialized'] ?? null) === true) {
        echo "already-initialized: private state revision {$admin['revision']}; nothing was changed\n";
        exit(0);
    }

    // The catalog comes from the board when it already carries one, and otherwise from the explicit
    // seed. A schema-2 board's catalog is authoritative and is never replaced by the seed.
    $fromBoard = is_array($board) && ($board['schemaVersion'] ?? null) === 2 && is_array($board['subjects'] ?? null) && $board['subjects'] !== [];
    if ($fromBoard) {
        [$catalog, $catErr] = tt_subject_validate($board['subjects']);
        $source = 'board';
    } else {
        $seedRaw = @file_get_contents($seedPath);
        if ($seedRaw === false) mig_fail("cannot read the seed file $seedPath", 6);
        $seed = json_decode($seedRaw, true);
        if (!is_array($seed) || ($seed['schemaVersion'] ?? null) !== 1) mig_fail('the seed must be JSON {schemaVersion:1, subjects:[...]}', 6);
        [$catalog, $catErr] = tt_subject_validate($seed['subjects'] ?? null);
        $source = 'seed';
    }
    if ($catErr !== null) mig_fail('the catalog is invalid: ' . $catErr, 7);

    $tasks = is_array($board) && is_array($board['tasks'] ?? null) ? $board['tasks'] : [];
    $idErr = tt_taskids_validate($tasks);
    if ($idErr !== null) mig_fail('a stored task id is outside the safe write contract: ' . $idErr, 8);

    // A referenced code that the configuration does not define is reported, never retagged.
    $referenced = [];
    foreach ($tasks as $t) {
        $code = is_array($t) && is_string($t['subject'] ?? null) ? $t['subject'] : '';
        if ($code !== '') $referenced[$code] = true;
    }
    $defined = [];
    foreach ($catalog as $s) $defined[$s['code']] = true;
    $missing = array_values(array_diff(array_keys($referenced), array_keys($defined)));

    $revision = is_array($board) ? (int)($board['revision'] ?? 0) : 0;
    echo 'catalog: ' . count($catalog) . " subject(s) from $source\n";
    echo 'tasks: ' . count($tasks) . ", board revision: $revision\n";
    echo 'retired references to review: ' . count($missing) . ($missing ? ' (' . implode(', ', $missing) . ')' : '') . "\n";

    if ($modes[0] === '--check') {
        echo "check: valid, nothing was written\n";
        exit(0);
    }

    if (count($catalog) > TT_SUBJECT_MAX) mig_fail('the catalog exceeds ' . TT_SUBJECT_MAX . ' entries; it was not discarded, but it must be reduced before activation', 7);

    $backup = mig_backup($dataDir, $backupDir);
    echo 'backup: ' . count($backup['files']) . ' file(s), ' . $backup['snapshots'] . " snapshot(s) in $backupDir\n";

    // Activation keeps every task byte-identical (ids, definitions and stamps) and adds the catalog.
    $activationRevision = $revision >= 1 ? $revision : 1;
    $next = is_array($board) ? $board : [];
    $next['schemaVersion'] = 2;
    $next['revision'] = $activationRevision;
    $next['operationId'] = bin2hex(random_bytes(16));
    $next['publishedAt'] = is_array($board) && is_int($board['publishedAt'] ?? null) ? $board['publishedAt'] : time();
    $next['subjects'] = $catalog;
    $next['deletedTasks'] = is_array($board) && is_array($board['deletedTasks'] ?? null) ? array_values($board['deletedTasks']) : [];

    $initial = tt_admin_blank();
    $initial['presets'] = [[
        'id' => bin2hex(random_bytes(16)),
        'name' => 'Initial configuration',
        'subjects' => $catalog,
        'updatedAt' => time(),
    ]];

    if (!tt_write_json_atomic($dataDir . '/current.json', $next, 0644)) mig_fail('cannot write the migrated board; the backup is intact and the old board is unchanged', 9);
    if (!tt_write_json_atomic($dataDir . '/admin/state.json', $initial)) mig_fail('cannot write the private state; restore the board from ' . $backupDir, 9);

    echo 'apply: initialized at revision ' . $activationRevision . ', ' . count($tasks) . " task(s) preserved\n";
    echo "seed: left in place at $seedPath; it contains real configuration and stays private\n";
} finally {
    tt_board_unlock($lock);
}
