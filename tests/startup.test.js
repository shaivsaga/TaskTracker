/**
 * tests/startup.test.js - harness for deploy/startup.sh.
 *
 * deploy/startup.sh is the Azure App Service (Linux) startup command. Verified behaviour,
 * read from deploy/startup.sh:1-41:
 *   - SRC (deploy/nginx-default.conf) is copied over DST (/etc/nginx/sites-available/default)
 *     after DST is backed up to DST.bak, then `nginx -t` runs. Any failure restores DST.bak,
 *     prints a loud banner, writes MARKER (/home/LogFiles/startup-nginx-error.txt) and exits 1
 *     WITHOUT reloading - so the on-disk config is never one nginx already rejected.
 *   - On success a stale MARKER and the backup are removed.
 *   - deploy/php-uploads.ini is installed into conf.d when both source and target dir exist,
 *     followed by `pkill -USR2 php-fpm`; otherwise it reports and continues.
 *   - Finally nginx is reloaded, fatal on failure. Two shapes exist and the harness accepts
 *     EITHER, so it is green against both: `nginx -t && service nginx reload`, and the newer
 *     `nginx -s reload` (falling back to `service nginx reload`).
 *   - The newer shape then self-checks the APPLIED rules with curl against 127.0.0.1:8080,
 *     writes OK_MARKER (/home/LogFiles/startup-nginx-applied.txt) on success, and treats a deny
 *     rule that fails to answer 403 as fatal. Those tests carry HAS_SELF_CHECK and are skipped
 *     against a script without the self-check.
 * The harness swaps the absolute paths (SRC/DST/MARKER/INI_SRC/INI_DST, plus OK_MARKER when the
 * script has one) for temp-dir paths, stubs nginx/service/pkill/curl on PATH, and asserts the
 * observable contract above.
 *
 * RUN CONTRACT (regression guards - every rule below has a test):
 *   1. No path is ever interpolated into shell source. Paths reach startup.sh only through the
 *      environment (TT_SRC, TT_DST, ...), because a raw Windows path interpolated into shell
 *      text loses its backslashes to bash quote removal and silently becomes a drive-relative
 *      path (C:\a\b -> C:ab) that resolves against the CURRENT DIRECTORY - which is how this
 *      harness used to drop ~20 `CUsersshavionte...logsmarker.txt` files into the repo root.
 *   2. Every temp dir lives under os.tmpdir(), is unique per run, and is removed afterwards;
 *      removal is guarded so it can only ever delete the directory the run itself created.
 *   3. The spawned script's cwd is the run's temp dir, never the repository, so a relative path
 *      produced by a future regression cannot land in the repo.
 *   4. After every run the repository working tree must be unchanged (git status --porcelain
 *      plus a repository-root listing snapshot, compared against a baseline taken at load time).
 *   5. Every stub must win over a same-named real binary. MSYS bash prepends its own /mingw64/bin
 *      and /usr/bin to PATH whatever it is handed, so the patched script puts the run's bin dir
 *      first itself; without that, `curl` silently ran the real one and the self-check under test
 *      was skipped rather than exercised.
 *   6. The script is executed from its LF form whatever the checkout did (core.autocrlf). A CRLF
 *      copy sticks a `\r` to every token, so the run would test a script the host never runs.
 *
 * Runs on Linux/macOS with bash, and on Windows through Git for Windows (MSYS) bash, which
 * `node --test tests/startup.test.js` from the worktree root uses automatically. On a machine
 * with no usable POSIX bash the shell-behaviour tests skip with an explicit reason; set
 * TT_REQUIRE_BASH=1 to turn that skip into a failure. Set TT_BASH=/path/to/bash to pin the shell.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const SCRIPT = path.join(ROOT, 'deploy', 'startup.sh');
const TMP_ROOT = os.tmpdir();
const RUN_PREFIX = 'tasktracker-startup-test-';

// The behavioural self-check arrived with a curl probe. A script without one has nothing to test,
// so those tests skip instead of failing - that is what keeps one harness green on both branches.
const HAS_SELF_CHECK = /command -v curl/.test(fs.readFileSync(SCRIPT, 'utf8'));
const selfCheckSkip = HAS_SELF_CHECK ? false : 'deploy/startup.sh has no curl self-check yet';

/* ------------------------------------------------------------------ *
 * bash discovery
 * ------------------------------------------------------------------ */

const bashNotes = [];

function probeBash(candidate) {
  const res = spawnSync(candidate, ['-c', 'printf %s "$(uname -s)"'], {
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
  });
  if (res.error || res.status !== 0) {
    bashNotes.push(`${candidate}: unusable (${res.error ? res.error.code : 'exit ' + res.status})`);
    return null;
  }
  const kernel = (res.stdout || '').trim();
  // WSL's System32 bash.exe starts no distribution (and reports a Linux kernel when it does);
  // a real WSL shell cannot see C:\... as /c/..., so it is not a valid host for this harness.
  if (!/^(MINGW|MSYS|CYGWIN)/i.test(kernel) && kernel !== 'Linux' && kernel !== 'Darwin') {
    bashNotes.push(`${candidate}: kernel "${kernel}" not usable`);
    return null;
  }
  if (process.platform === 'win32' && !/^(MINGW|MSYS|CYGWIN)/i.test(kernel)) {
    bashNotes.push(`${candidate}: ${kernel} (WSL) cannot address Windows paths as /c/...`);
    return null;
  }
  return { exe: candidate, kernel };
}

function findBash() {
  const candidates = [];
  if (process.env.TT_BASH) candidates.push(process.env.TT_BASH);
  if (process.platform === 'win32') {
    const bases = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
      'C:\\Program Files',
    ].filter(Boolean);
    for (const base of bases) candidates.push(path.join(base, 'Git', 'bin', 'bash.exe'));
    const where = spawnSync('where.exe', ['bash'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    if (where.status === 0) {
      for (const line of where.stdout.split(/\r?\n/)) if (line.trim()) candidates.push(line.trim());
    }
  } else {
    candidates.push('bash', '/bin/bash', '/usr/bin/bash');
  }
  for (const candidate of candidates) {
    const found = probeBash(candidate);
    if (found) return found;
  }
  return null;
}

const BASH = findBash();
const bashSkip = BASH
  ? false
  : `no usable POSIX bash (tried: ${bashNotes.join('; ') || 'nothing'}); needs Linux/macOS CI or Git for Windows`;

/* ------------------------------------------------------------------ *
 * path translation + shell environment
 * ------------------------------------------------------------------ */

// A Windows path must be handed to MSYS bash in POSIX form (/c/Users/...), never as C:\Users\...
function toShellPath(p) {
  const abs = path.resolve(p);
  if (process.platform !== 'win32') return abs;
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(abs);
  if (drive) return '/' + drive[1].toLowerCase() + '/' + drive[2].split('\\').join('/');
  const unc = /^\\\\[^\\/]+[\\/].*$/.test(abs);
  if (unc) return '//' + abs.replace(/^\/+/, '').split('\\').join('/');
  return abs.split('\\').join('/');
}

function shellPathEnv(extraDir) {
  const inherited = String(process.env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
    .map(toShellPath);
  return [toShellPath(extraDir), ...inherited].join(':');
}

/* ------------------------------------------------------------------ *
 * repository cleanliness guard
 * ------------------------------------------------------------------ */

function snapshotRepo() {
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  let entries = [];
  try {
    entries = fs.readdirSync(ROOT).sort();
  } catch {
    entries = ['<unreadable>'];
  }
  return {
    git: status.status === 0 ? status.stdout : `<git status failed: ${status.status}>`,
    entries,
  };
}

const REPO_BASELINE = snapshotRepo();
const repoViolations = [];

function describeRepoDelta(before, after) {
  const added = after.entries.filter((name) => !before.entries.includes(name));
  const removed = before.entries.filter((name) => !after.entries.includes(name));
  const gitAdded = after.git.split(/\r?\n/).filter((l) => l && !before.git.split(/\r?\n/).includes(l));
  const gitGone = before.git.split(/\r?\n/).filter((l) => l && !after.git.split(/\r?\n/).includes(l));
  const parts = [];
  if (added.length) parts.push(`new repo-root entries: ${JSON.stringify(added)}`);
  if (removed.length) parts.push(`vanished repo-root entries: ${JSON.stringify(removed)}`);
  if (gitAdded.length) parts.push(`new git status lines: ${JSON.stringify(gitAdded)}`);
  if (gitGone.length) parts.push(`vanished git status lines: ${JSON.stringify(gitGone)}`);
  return parts.join('; ');
}

function noteRepoCheck(label) {
  const after = snapshotRepo();
  const delta = describeRepoDelta(REPO_BASELINE, after);
  if (delta) {
    repoViolations.push(
      new assert.AssertionError({
        message: `the harness changed the repository working tree ${label}: ${delta}`,
      }),
    );
  }
  return after;
}

/* ------------------------------------------------------------------ *
 * temp dirs: created under os.tmpdir(), removed only if ours
 * ------------------------------------------------------------------ */

const liveRunDirs = new Set();
process.on('exit', () => {
  for (const dir of liveRunDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort on exit */
    }
  }
});

function makeRunDir() {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, RUN_PREFIX));
  assert.ok(isOwnedRunDir(dir), `refusing to use ${dir}: not a ${RUN_PREFIX}* dir under ${TMP_ROOT}`);
  liveRunDirs.add(dir);
  return dir;
}

function isOwnedRunDir(dir) {
  const rel = path.relative(TMP_ROOT, dir);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel) && path.basename(dir).startsWith(RUN_PREFIX);
}

function destroyRunDir(dir) {
  assert.ok(isOwnedRunDir(dir), `refusing to delete ${dir}: it is not a temp dir this test created`);
  fs.rmSync(dir, { recursive: true, force: true });
  liveRunDirs.delete(dir);
}

/* ------------------------------------------------------------------ *
 * the script under test: swap its absolute paths for environment lookups
 * ------------------------------------------------------------------ */

const PATH_KEYS = ['SRC', 'DST', 'MARKER', 'INI_SRC', 'INI_DST'];
// OK_MARKER arrived with the behavioural self-check. It is patched only when the script has it, so
// one harness stays green against both shapes of startup.sh instead of breaking whichever of the
// two open branches merges second.
const OPTIONAL_PATH_KEYS = ['OK_MARKER'];
const ENV_NAME = {
  SRC: 'TT_SRC',
  DST: 'TT_DST',
  MARKER: 'TT_MARKER',
  INI_SRC: 'TT_INI_SRC',
  INI_DST: 'TT_INI_DST',
  OK_MARKER: 'TT_OK_MARKER',
};

function buildPatchedScript(paths) {
  // The checkout may be CRLF when core.autocrlf is on, while the blob CI deploys is LF. Run the
  // LF form: a CRLF copy leaves a `\r` stuck to every token, so `[ -f "$X" ]` becomes `]\r` and
  // every test would be exercising a script that could never run on the host.
  let script = fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n');
  // Git-for-Windows bash prepends /mingw64/bin and /usr/bin to PATH at startup, whatever PATH it
  // was handed, so a stub only wins if the script puts the run's bin dir first itself. Without
  // this, `curl` resolves to the real /mingw64/bin/curl - the stubs for nginx/service/pkill only
  // held because Git ships no binary by those names.
  assert.match(script, /^#!.*\n/, 'deploy/startup.sh lost its shebang line');
  script = script.replace(/^#!.*\n/, (shebang) => shebang + 'export PATH="${TT_BIN:?}:$PATH"\n');
  const assign = (key) => new RegExp('^' + key + '=.*$', 'm');
  for (const key of PATH_KEYS) {
    assert.ok(assign(key).test(script), `deploy/startup.sh no longer assigns ${key}=; harness needs updating`);
    // Replace the literal path with an environment lookup. ${VAR:?} makes bash fail loudly if the
    // value is missing, so a wiring mistake can never silently test a different path.
    script = script.replace(assign(key), () => key + '=${' + ENV_NAME[key] + ':?}');
  }
  for (const key of OPTIONAL_PATH_KEYS) {
    // Present means it MUST be rewritten to the environment: a host path left in place writes
    // outside the run sandbox, where the repo-cleanliness guard cannot see it.
    if (assign(key).test(script)) script = script.replace(assign(key), () => key + '=${' + ENV_NAME[key] + ':?}');
  }
  // Structural guard: no path value (Windows or POSIX form) may appear in the shell source.
  for (const [key, value] of Object.entries(paths)) {
    assert.equal(script.includes(value), false, `${key} literal leaked into shell source (quote-mangling risk)`);
    assert.equal(script.includes(toShellPath(value)), false, `${key} shell path leaked into shell source`);
  }
  return script;
}

function runEnv(dir) {
  const at = (...a) => path.join(dir, ...a);
  return {
    TT_SRC: toShellPath(at('src.conf')),
    TT_DST: toShellPath(at('etc', 'default')),
    TT_MARKER: toShellPath(at('logs', 'marker.txt')),
    TT_INI_SRC: toShellPath(at('missing.ini')),
    TT_INI_DST: toShellPath(at('etc', 'zz.ini')),
    TT_OK_MARKER: toShellPath(at('logs', 'applied.txt')),
    TT_BIN: toShellPath(at('bin')),
    TT_CALLS_LOG: toShellPath(at('calls.log')),
  };
}

/* ------------------------------------------------------------------ *
 * one harness run
 * ------------------------------------------------------------------ */

function execute(
  dir,
  {
    nginxExit = 0,
    nginxReloadExit = 0,
    serviceExit = 0,
    curlMiss = '',
    withSrc = true,
    withDst = true,
    withMarker = false,
  } = {},
) {
  const p = (...a) => path.join(dir, ...a);
  fs.mkdirSync(p('bin'));
  fs.mkdirSync(p('etc'));
  fs.mkdirSync(p('logs'));

  const stub = (name, body) => fs.writeFileSync(p('bin', name), '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
  // Arg-aware: the reload must be fail-able on its own, without also failing the `nginx -t` before it.
  stub(
    'nginx',
    `printf '%s\\n' "nginx $*" >> "$TT_CALLS_LOG"
case "$*" in
  *reload*) exit ${nginxReloadExit} ;;
  *-t*) exit ${nginxExit} ;;
esac
exit 0`,
  );
  stub('service', `printf '%s\\n' "service $*" >> "$TT_CALLS_LOG"; exit ${serviceExit}`);
  stub('pkill', 'exit 0');
  // The self-check probes the applied rules over HTTP. Without this stub the run reaches the real
  // curl, stalls ~21s on 127.0.0.1:8080 and silently skips the very self-check under test.
  // Default answers are the hardened ones; TT_CURL_MISS names one path that answers 200 instead,
  // which is exactly what an unapplied deny rule looks like.
  stub(
    'curl',
    `url=""
for a in "$@"; do case "$a" in http://*) url="$a" ;; esac; done
path="\${url#http://127.0.0.1:8080}"
printf '%s\\n' "curl $path" >> "$TT_CALLS_LOG"
case "$path" in
  /index.html) printf '%s\\n' 200 ;;
  /api/login.php) printf '%s\\n' 401 ;;
  *) if [ "$path" = "\${TT_CURL_MISS:-}" ]; then printf '%s\\n' 200; else printf '%s\\n' 403; fi ;;
esac`,
  );

  if (withDst) fs.writeFileSync(p('etc', 'default'), 'OLD CONFIG\n');
  if (withSrc) fs.writeFileSync(p('src.conf'), 'NEW CONFIG\n');
  if (withMarker) fs.writeFileSync(p('logs', 'marker.txt'), 'stale\n');

  const env = runEnv(dir);
  const paths = {
    SRC: p('src.conf'),
    DST: p('etc', 'default'),
    MARKER: p('logs', 'marker.txt'),
    INI_SRC: p('missing.ini'),
    INI_DST: p('etc', 'zz.ini'),
    OK_MARKER: p('logs', 'applied.txt'),
    TT_BIN: p('bin'),
  };
  fs.writeFileSync(p('startup.sh'), buildPatchedScript(paths));

  const res = spawnSync(BASH.exe, [toShellPath(p('startup.sh'))], {
    encoding: 'utf8',
    cwd: dir, // never ROOT: a future relative-path regression lands in temp, not in the repo
    timeout: 60000,
    windowsHide: true,
    env: { ...process.env, PATH: shellPathEnv(p('bin')), TT_CURL_MISS: curlMiss, ...env },
  });
  assert.equal(res.error, undefined, `bash could not start: ${res.error && res.error.message}`);
  assert.equal(res.signal, null, `bash was killed by ${res.signal}`);

  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    dst: fs.existsSync(p('etc', 'default')) ? fs.readFileSync(p('etc', 'default'), 'utf8') : null,
    bakExists: fs.existsSync(p('etc', 'default.bak')),
    markerExists: fs.existsSync(p('logs', 'marker.txt')),
    okMarkerExists: fs.existsSync(p('logs', 'applied.txt')),
    calls: fs.existsSync(p('calls.log')) ? fs.readFileSync(p('calls.log'), 'utf8') : '',
  };
}

function run(opts) {
  const dir = makeRunDir();
  const violationsBefore = repoViolations.length;
  let result = null;
  let failure = null;
  try {
    result = execute(dir, opts);
  } catch (err) {
    failure = err;
  } finally {
    noteRepoCheck('during a deploy/startup.sh run');
    try {
      destroyRunDir(dir);
    } catch (err) {
      if (!failure) failure = err;
    }
    noteRepoCheck('while cleaning up the run temp dir');
  }
  if (repoViolations.length > violationsBefore) throw repoViolations[violationsBefore];
  if (failure) throw failure;
  assert.equal(fs.existsSync(dir), false, `temp dir survived cleanup: ${dir}`);
  return result;
}

/* ------------------------------------------------------------------ *
 * tests
 * ------------------------------------------------------------------ */

test('startup.sh has LF line endings (CRLF breaks bash)', () => {
  // Check the committed copy, not the working tree: on Windows git checks the blob out as CRLF
  // (core.autocrlf) while the blob itself stays LF, and the blob is what CI deploys to the host.
  const blob = spawnSync('git', ['show', ':deploy/startup.sh'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(blob.status, 0, blob.stderr);
  assert.ok(!blob.stdout.includes('\r'));
});

test('harness routes every path through the environment, never through shell source', () => {
  const dir = makeRunDir();
  try {
    const p = (...a) => path.join(dir, ...a);
    const script = buildPatchedScript({
      SRC: p('src.conf'),
      DST: p('etc', 'default'),
      MARKER: p('logs', 'marker.txt'),
      INI_SRC: p('missing.ini'),
      INI_DST: p('etc', 'zz.ini'),
    });
    for (const key of PATH_KEYS) {
      const assigned = new RegExp('^' + key + '=(.*)$', 'm').exec(script);
      assert.ok(assigned, `patched script lost the ${key}= assignment`);
      assert.equal(assigned[1], '${' + ENV_NAME[key] + ':?}', `${key} must be an environment lookup, got: ${assigned[1]}`);
    }
    assert.doesNotMatch(script, /startup-test-|tasktracker-startup-test-/, 'a temp path is back in the shell source');
    // The substituted values must themselves be absolute, or nothing else here is meaningful.
    for (const [key, value] of Object.entries({ SRC: p('src.conf'), MARKER: p('logs', 'marker.txt') })) {
      assert.ok(path.isAbsolute(value), `${key} test value is not absolute: ${value}`);
    }
  } finally {
    destroyRunDir(dir);
  }
  noteRepoCheck('while checking the shell-source contract');
});

test('the shell receives absolute, unmangled paths (no drive-relative rewrite)', opts(bashSkip), () => {
  const dir = makeRunDir();
  try {
    const env = runEnv(dir);
    const res = spawnSync(BASH.exe, ['-c', 'printf "%s\\n%s\\n" "$TT_SRC" "$TT_MARKER"'], {
      encoding: 'utf8',
      cwd: dir,
      timeout: 30000,
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    assert.equal(res.status, 0, res.stderr);
    const [src, marker] = res.stdout.trim().split('\n');
    assert.equal(src, env.TT_SRC);
    assert.equal(marker, env.TT_MARKER);
    assert.ok(src.startsWith('/'), `shell path is not absolute: ${src}`);
    assert.doesNotMatch(src, /^[A-Za-z]:/, 'path degraded to a drive-relative form');
    assert.doesNotMatch(src, /[A-Za-z]:(?![\\/])/, `path lost its separators: ${src}`);
  } finally {
    destroyRunDir(dir);
  }
  noteRepoCheck('while checking shell path fidelity');
});

test('startup.sh passes bash -n', opts(bashSkip), () => {
  const res = spawnSync(BASH.exe, ['-n', toShellPath(SCRIPT)], { encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('valid config: installs it, clears stale marker, reloads, exits 0', opts(bashSkip), () => {
  const r = run({ withMarker: true });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.dst, 'NEW CONFIG\n');
  assert.strictEqual(r.markerExists, false);
  assert.match(r.calls, /nginx -t/);
  // Either reload mechanism satisfies the contract; the script may prefer `nginx -s reload`.
  assert.match(r.calls, /nginx -s reload|service nginx reload/);
  // A successful run must not leave the backup behind for a later run to restore.
  assert.strictEqual(r.bakExists, false, 'the backup survived a successful install');
});

test('invalid config: banner, marker, exit 1, no reload, and the previous config is restored', opts(bashSkip), () => {
  const r = run({ nginxExit: 1 });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /NGINX CONFIG FAILED/);
  assert.match(r.stderr, /Refusing to start/);
  assert.match(r.stderr, /restored the previous nginx config/);
  assert.strictEqual(r.markerExists, true);
  assert.doesNotMatch(r.calls, /service nginx reload/);
  // 1faf82b left the rejected config on disk here, where a later nginx start would load it.
  assert.strictEqual(r.dst, 'OLD CONFIG\n', 'the rejected config was left in place');
});

test('rollback with no previous config: says so and stays fatal', opts(bashSkip), () => {
  const r = run({ nginxExit: 1, withDst: false });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /no previous config to restore/);
  assert.strictEqual(r.markerExists, true);
  assert.doesNotMatch(r.calls, /service nginx reload/);
});

test('missing source config: fails explicitly, nginx never runs', opts(bashSkip), () => {
  const r = run({ withSrc: false });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not found/);
  assert.strictEqual(r.markerExists, true);
  assert.strictEqual(r.calls, '');
  assert.strictEqual(r.dst, 'OLD CONFIG\n');
});

test('reload failure: surfaced with exit 1 and marker', opts(bashSkip), () => {
  // Both reload mechanisms must fail, or the script legitimately satisfies the reload through the
  // other one and exits 0 - which is what made this assertion stale rather than the script wrong.
  const r = run({ nginxReloadExit: 1, serviceExit: 1 });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /final nginx test or reload failed/);
  assert.strictEqual(r.markerExists, true);
});

test('self-check passes: applied rules answer as expected and the OK marker lands', opts(bashSkip || selfCheckSkip), () => {
  const r = run();
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /not answering/);
  for (const probed of ['/Data/current.json', '/package.json', '/Tests/php/run.php']) {
    assert.ok(r.calls.includes('curl ' + probed), `${probed} was never probed`);
  }
  assert.strictEqual(r.okMarkerExists, true);
});

test('self-check catches a deny rule that did not apply: exit 1, error marker, no OK marker', opts(bashSkip || selfCheckSkip), () => {
  const r = run({ curlMiss: '/package.json' });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /NGINX CONFIG FAILED/);
  assert.match(r.stderr, /self-check: \/package\.json returned 200, expected 403/);
  assert.strictEqual(r.markerExists, true);
  assert.strictEqual(r.okMarkerExists, false);
});

test('no run left a file in the repository and no temp dir behind', () => {
  const failure = repoViolations[0];
  const detail = failure ? failure.message : '';
  assert.deepEqual(repoViolations.length, 0, 'repository cleanliness guard: ' + detail);
  assert.deepEqual([...liveRunDirs], [], 'temp run dirs were not all removed');
});

test(
  'bash availability is explicit, never assumed',
  opts(BASH ? 'bash found; nothing to enforce' : process.env.TT_REQUIRE_BASH ? false : 'set TT_REQUIRE_BASH=1 to make a missing bash fatal'),
  () => {
    assert.fail(
      'TT_REQUIRE_BASH is set but no usable POSIX bash was found: ' +
        (bashNotes.join('; ') || 'no candidates tried'),
    );
  },
);

function opts(skip) {
  return typeof skip === 'string' ? { skip } : {};
}
