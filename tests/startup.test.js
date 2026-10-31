/**
 * tests/startup.test.js - harness for deploy/startup.sh.
 *
 * deploy/startup.sh is the Azure App Service (Linux) startup command. Verified behaviour:
 *   - SRC (deploy/nginx-default.conf) is copied over DST (/etc/nginx/sites-available/default)
 *     after DST is backed up to DST.bak, then `nginx -t` runs. A rejection here restores DST.bak,
 *     prints a loud banner, writes MARKER (/home/LogFiles/startup-nginx-error.txt) and exits 1
 *     WITHOUT reloading: nginx never loaded the new file, so putting the old one back is what makes
 *     disk and memory agree again.
 *   - A backup that fails is fatal on the spot, before SRC overwrites DST - without a copy of the
 *     config in place there is nothing to roll back to, and the later "no previous config to
 *     restore" would report a failed backup as a destination that never held one.
 *   - A restore that does not complete is reported as such, with cp's own message and the failure
 *     that made it necessary, never as a successful rollback.
 *   - DST.bak outlives every check that can still reject the new config: the first `nginx -t`, the
 *     reload, and the behavioural self-check. It is dropped only once all three have passed.
 *   - nginx is reloaded by signalling the master (`nginx -s reload`) and falling back to
 *     `service nginx reload`; both failing is fatal and rolls back, because there nginx is still on
 *     the previous config and nothing has diverged.
 *   - The applied rules are then self-checked with curl against 127.0.0.1:8080. A deny rule that
 *     fails to answer 403 goes to contain_and_fail, NOT restore_and_fail: the reload already
 *     succeeded, so nginx IS serving the rejected config, and restoring DST.bak would leave disk
 *     and memory silently disagreeing - while DST.bak may itself be Azure's unprotected default.
 *     Containment stops nginx (fail closed), leaves both files on disk, and exits 1. Exiting
 *     non-zero is not containment by itself: on 2026-10-31 the host's startup command ran
 *     startup.sh with `;`, the script exited 1, and the site kept serving. A stop command's exit
 *     status is not containment either, so containment is reported only after the nginx process is
 *     observed to be gone (bounded pgrep check), and otherwise reports INCOMPLETE (still running) or
 *     UNVERIFIED (no pgrep to check with).
 *   - The login challenge is host state rather than config, so a non-401 only warns. A skipped
 *     self-check (curl missing, or nginx not answering) warns too, and exits 0.
 *   - MARKER is cleared on a fresh install and rewritten on failure. OK_MARKER
 *     (/home/LogFiles/startup-nginx-applied.txt) is deleted at the very start of every boot and
 *     recreated only by an install that passed the self-check, so it is a claim about THIS boot: no
 *     boot that skipped verification or failed can leave the previous boot's claim standing.
 *     OK_MARKER records the installed config's sha256. Those tests carry HAS_SELF_CHECK and are
 *     skipped against a script without the self-check.
 *   - deploy/php-uploads.ini is installed into conf.d when both source and target dir exist,
 *     followed by `pkill -USR2 php-fpm`; otherwise it reports and continues.
 * The harness swaps the absolute paths (SRC/DST/MARKER/INI_SRC/INI_DST, plus OK_MARKER when the
 * script has one) for temp-dir paths, stubs nginx/service/pkill/curl/cp on PATH, and asserts the
 * observable contract above. The nginx and service stubs are a small state machine: a successful
 * reload makes nginx serve what is on disk (SERVING), a stop leaves it serving nothing. That is how
 * the tests tell "config on disk" apart from "config nginx has loaded" and from "nginx is down",
 * instead of inferring all three from one exit code. nginx's liveness is a second file
 * (TT_NGINX_RUNNING, see RUN CONTRACT 8) so a stop that fails to take the process down is a state
 * the assertions can see, not a claim they have to take on trust.
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
 *   7. The `command -v curl` availability check is pointed at a command name the test controls
 *      (TT_CURL_PROBE). Git for Windows always exposes a real curl, so without that the "curl is
 *      not installed" branch is untestable and would silently stop being covered. Unset, the
 *      script still looks for `curl` itself.
 *   8. The `pgrep` that verifies containment is pointed at a name the test controls
 *      (TT_PGREP_PROBE) for the same reason as item 7. nginx's liveness is modelled as a file
 *      (TT_NGINX_RUNNING) that a successful stop removes, so a stop returning 0 while the master
 *      kept serving is distinguishable from one that worked - which is the whole point of the
 *      check.
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
import { createHash } from 'node:crypto';
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
  // The availability check is a command lookup, not a path, so it is substituted rather than
  // rewritten: Git for Windows puts a real curl on PATH whatever we hand it, which makes the
  // "curl is not installed" branch unreachable from a test unless the name it looks for is ours.
  // The script keeps looking for `curl` when TT_CURL_PROBE is unset.
  const availabilityCheck = /command -v curl (>\/dev\/null 2>&1)/;
  assert.match(script, availabilityCheck, 'deploy/startup.sh no longer probes for curl; harness needs updating');
  script = script.replace(availabilityCheck, (_, rest) => 'command -v "${TT_CURL_PROBE:-curl}" ' + rest);
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
    // What nginx has loaded, as opposed to what is on disk. Empty means nginx is not serving.
    TT_SERVING: toShellPath(at('serving.conf')),
    // Whether the nginx process is alive, as pgrep sees it. A successful stop removes it.
    TT_NGINX_RUNNING: toShellPath(at('nginx.running')),
    // How many copies have targeted the destination a test asked to fail.
    TT_CP_LOG: toShellPath(at('cp.log')),
  };
}

/* ------------------------------------------------------------------ *
 * one harness run
 * ------------------------------------------------------------------ */

function execute(
  dir,
  {
    nginxExit = 0,
    nginxTestFailFrom = 0,
    nginxReloadExit = 0,
    nginxStopExit = 0,
    serviceExit = 0,
    serviceStopExit = 0,
    curlMiss = '',
    curlLogin = '',
    curlDown = false,
    noCurl = false,
    noPgrep = false,
    cpFailDest = '',
    cpFailAt = 1,
    withSrc = true,
    withDst = true,
    withMarker = false,
    withOkMarker = false,
  } = {},
) {
  const p = (...a) => path.join(dir, ...a);
  fs.mkdirSync(p('bin'));
  fs.mkdirSync(p('etc'));
  fs.mkdirSync(p('logs'));

  // Tests name the file ('DST' / 'BAK') rather than a path, because the run dir only exists here.
  const failDest = { DST: p('etc', 'default'), BAK: p('etc', 'default.bak') }[cpFailDest] || '';

  const stub = (name, body) => fs.writeFileSync(p('bin', name), '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
  // nginx is modelled as a state machine rather than an exit code: `-t` only parses, a successful
  // reload makes it serve whatever is on disk, and a stop leaves it serving nothing. TT_SERVING is
  // what the assertions read, so "which config nginx has loaded" is a transition rather than a guess.
  // TT_NGINX_T_FAIL_FROM fails the Nth (1-based) `nginx -t`, which separates a config rejected by
  // the install check from one rejected by the check that runs immediately before the reload.
  stub(
    'nginx',
    `printf '%s\\n' "nginx $*" >> "$TT_CALLS_LOG"
case "$*" in
  *reload*)
    if [ ${nginxReloadExit} -ne 0 ]; then exit ${nginxReloadExit}; fi
    cp "$TT_DST" "$TT_SERVING"; exit 0 ;;
  *stop*)
    if [ ${nginxStopExit} -ne 0 ]; then exit ${nginxStopExit}; fi
    rm -f "$TT_SERVING" "$TT_NGINX_RUNNING"; exit 0 ;;
  *-t*)
    if [ -n "\${TT_NGINX_T_FAIL_FROM:-}" ] && [ "$(grep -c '^nginx -t$' "$TT_CALLS_LOG")" -ge "$TT_NGINX_T_FAIL_FROM" ]; then exit 1; fi
    exit ${nginxExit} ;;
esac
exit 0`,
  );
  stub(
    'service',
    `printf '%s\\n' "service $*" >> "$TT_CALLS_LOG"
case "$*" in
  *reload*)
    if [ ${serviceExit} -ne 0 ]; then exit ${serviceExit}; fi
    cp "$TT_DST" "$TT_SERVING"; exit 0 ;;
  *stop*)
    if [ ${serviceStopExit} -ne 0 ]; then exit ${serviceStopExit}; fi
    rm -f "$TT_SERVING" "$TT_NGINX_RUNNING"; exit 0 ;;
esac
exit 0`,
  );
  // Containment verifies the stop instead of trusting its exit status, which means asking whether
  // the nginx process is still there. Liveness is a file so a stop that reported success while the
  // master kept serving is representable: the stop stubs above delete it only when they really took
  // nginx down, and this reads it back.
  stub(
    'pgrep',
    `printf '%s\\n' "pgrep $*" >> "$TT_CALLS_LOG"
[ -f "$TT_NGINX_RUNNING" ] && exit 0
exit 1`,
  );
  stub('pkill', 'exit 0');
  // cp is stubbed only so a failing copy can be simulated without touching real files; everything
  // else it does is the real cp. TT_CP_FAIL_DEST names the one destination that must fail and
  // TT_CP_FAIL_AT which of its calls fails, so the backup, the install and the restore (the last two
  // both target DST) stay separately testable.
  stub(
    'cp',
    `printf '%s\\n' "cp $*" >> "$TT_CALLS_LOG"
last=""
for a in "$@"; do last="$a"; done
if [ -n "\${TT_CP_FAIL_DEST:-}" ] && [ "$last" = "$TT_CP_FAIL_DEST" ]; then
  n=0
  [ -f "$TT_CP_LOG" ] && n=$(cat "$TT_CP_LOG")
  n=$((n + 1))
  printf '%s' "$n" > "$TT_CP_LOG"
  if [ "$n" = "\${TT_CP_FAIL_AT:-1}" ]; then
    echo "cp: simulated failure writing $last" >&2
    exit 1
  fi
fi
exec /bin/cp "$@"`,
  );
  // The self-check probes the applied rules over HTTP. Without this stub the run reaches the real
  // curl, stalls ~21s on 127.0.0.1:8080 and silently skips the very self-check under test.
  // Default answers are the hardened ones; TT_CURL_MISS names one path that answers 200 instead,
  // which is exactly what an unapplied deny rule looks like, and TT_CURL_LOGIN changes the login
  // challenge - host state the script must not fail closed on. TT_CURL_DOWN makes nginx look
  // unreachable, which is how the readiness timeout is exercised.
  stub(
    'curl',
    `url=""
for a in "$@"; do case "$a" in http://*) url="$a" ;; esac; done
path="\${url#http://127.0.0.1:8080}"
printf '%s\\n' "curl $path" >> "$TT_CALLS_LOG"
case "$path" in
  /index.html) if [ -n "\${TT_CURL_DOWN:-}" ]; then printf '%s\\n' 000; else printf '%s\\n' 200; fi ;;
  /api/login.php) printf '%s\\n' "\${TT_CURL_LOGIN:-401}" ;;
  *) if [ "$path" = "\${TT_CURL_MISS:-}" ]; then printf '%s\\n' 200; else printf '%s\\n' 403; fi ;;
esac`,
  );

  if (withDst) fs.writeFileSync(p('etc', 'default'), 'OLD CONFIG\n');
  // nginx is already serving what was in place before startup.sh ran. That is the starting point the
  // rollback paths are supposed to return to, and the divergence bug is what happens when it does not.
  if (withDst) fs.copyFileSync(p('etc', 'default'), p('serving.conf'));
  if (withSrc) fs.writeFileSync(p('src.conf'), 'NEW CONFIG\n');
  // nginx is up before startup.sh runs, whatever config it happens to be holding.
  fs.writeFileSync(p('nginx.running'), '');
  if (withMarker) fs.writeFileSync(p('logs', 'marker.txt'), 'stale\n');
  if (withOkMarker) fs.writeFileSync(p('logs', 'applied.txt'), 'stale applied\n');

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
    env: {
      ...process.env,
      PATH: shellPathEnv(p('bin')),
      TT_CURL_MISS: curlMiss,
      TT_CURL_LOGIN: curlLogin,
      TT_CURL_DOWN: curlDown ? '1' : '',
      // Points the availability check at a name nothing provides, so `command -v` fails and the
      // skip branch runs. Left unset elsewhere, where the check looks for curl itself.
      TT_CURL_PROBE: noCurl ? 'tasktracker-absent-curl' : '',
      TT_PGREP_PROBE: noPgrep ? 'tasktracker-absent-pgrep' : '',
      TT_CP_FAIL_DEST: failDest ? toShellPath(failDest) : '',
      TT_CP_FAIL_AT: String(cpFailAt),
      TT_NGINX_T_FAIL_FROM: nginxTestFailFrom ? String(nginxTestFailFrom) : '',
      ...env,
    },
  });
  assert.equal(res.error, undefined, `bash could not start: ${res.error && res.error.message}`);
  assert.equal(res.signal, null, `bash was killed by ${res.signal}`);

  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    dst: fs.existsSync(p('etc', 'default')) ? fs.readFileSync(p('etc', 'default'), 'utf8') : null,
    serving: fs.existsSync(p('serving.conf')) ? fs.readFileSync(p('serving.conf'), 'utf8') : null,
    running: fs.existsSync(p('nginx.running')),
    bakExists: fs.existsSync(p('etc', 'default.bak')),
    markerExists: fs.existsSync(p('logs', 'marker.txt')),
    okMarkerExists: fs.existsSync(p('logs', 'applied.txt')),
    markerContent: fs.existsSync(p('logs', 'marker.txt')) ? fs.readFileSync(p('logs', 'marker.txt'), 'utf8') : null,
    okMarkerContent: fs.existsSync(p('logs', 'applied.txt')) ? fs.readFileSync(p('logs', 'applied.txt'), 'utf8') : null,
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
  // Disk and what nginx loaded must end up the same file, or the install only looks applied.
  assert.strictEqual(r.serving, 'NEW CONFIG\n');
  assert.strictEqual(r.markerExists, false);
  assert.match(r.calls, /nginx -t/);
  // App Service containers do not always have a service manager, so the master signal is the
  // primary path: reaching for `service` first would be the failure mode the fallback exists for.
  assert.match(r.calls, /nginx -s reload/);
  assert.doesNotMatch(r.calls, /service nginx reload/);
  // A successful run must not leave the backup behind for a later run to restore.
  assert.strictEqual(r.bakExists, false, 'the backup survived a successful install');
});

test('reload falls back to `service nginx reload` when the master signal fails', opts(bashSkip), () => {
  // The fallback has to be a real second attempt: written as `nginx -s reload && service nginx
  // reload` it would be dead code, and the site would stay on the old config with a green start.
  const r = run({ nginxReloadExit: 1, serviceExit: 0 });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(
    r.calls.indexOf('nginx -s reload') < r.calls.indexOf('service nginx reload'),
    'the service reload was tried before the master signal',
  );
  assert.strictEqual(r.dst, 'NEW CONFIG\n');
  assert.strictEqual(r.bakExists, false);
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
  // nginx never reloaded, so it is still on the config the restore put back: no divergence.
  assert.strictEqual(r.serving, 'OLD CONFIG\n');
  // The marker carries the reason and an ISO-8601 UTC stamp, which is all an operator has when
  // the container dies before they can read the log stream.
  assert.match(r.markerContent, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z new config invalid$/m);
});

test('a config rejected by the last check before the reload rolls back like the first one', opts(bashSkip), () => {
  // The install check passes and the `nginx -t` inside the reload step rejects. nginx has still never
  // loaded the new file, so this is a rollback case: restoring the old config makes disk and memory
  // agree. Treating it as containment instead would stop a site that never went wrong.
  const r = run({ nginxTestFailFrom: 2 });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /final nginx test or reload failed/);
  assert.match(r.stderr, /restored the previous nginx config/);
  assert.strictEqual(r.dst, 'OLD CONFIG\n');
  assert.strictEqual(r.serving, 'OLD CONFIG\n');
  assert.strictEqual(r.bakExists, true, 'the rollback copy is dropped before anything was verified');
  assert.doesNotMatch(r.calls, /nginx -s reload/);
  assert.doesNotMatch(r.calls, /nginx -s stop/);
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

test('reload failure: rolls the config back before exiting 1 with the marker', opts(bashSkip), () => {
  // Both reload mechanisms must fail, or the script legitimately satisfies the reload through the
  // other one and exits 0 - which is what made this assertion stale rather than the script wrong.
  const r = run({ nginxReloadExit: 1, serviceExit: 1 });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /final nginx test or reload failed/);
  assert.strictEqual(r.markerExists, true);
  // The regression this covers: DST.bak used to be deleted the moment `nginx -t` succeeded, so
  // the reload - the check most likely to reject the new config - had nothing left to restore.
  assert.match(r.stderr, /restored the previous nginx config/);
  assert.strictEqual(r.dst, 'OLD CONFIG\n', 'a failed reload left the new config on disk');
  // Nothing was reloaded, so nginx is still on the old config and the rollback keeps it that way.
  assert.strictEqual(r.serving, 'OLD CONFIG\n');
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

test('the OK marker records the digest of the config that was applied', opts(bashSkip || selfCheckSkip), () => {
  // Started with the previous boot's marker in place: a verified boot must replace it with its own
  // claim, not leave a stale one standing next to a fresh one.
  const r = run({ withOkMarker: true });
  assert.doesNotMatch(r.okMarkerContent, /stale applied/, "the previous boot's applied marker was not replaced");
  assert.match(
    r.okMarkerContent,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z nginx config applied and self-checked$/m,
    'the OK marker is not the stamped success line',
  );
  // The stamp is what lets the host's live config be matched against the deploy that claimed it.
  const digest = createHash('sha256').update(r.dst, 'utf8').digest('hex');
  assert.match(r.okMarkerContent, new RegExp(`^sha256 ${digest}$`, 'm'), 'the OK marker does not stamp the applied config');
});

test('a failed run stamps the reason and clears the applied marker', opts(bashSkip), () => {
  // OK_MARKER is a claim about the LAST startup. Left standing next to a fresh error marker it
  // reads as "applied and verified" while this boot applied nothing it could verify.
  const r = run({ nginxExit: 1, withOkMarker: true });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.markerContent, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z new config invalid$/m);
  assert.strictEqual(r.okMarkerExists, false, "the previous boot's applied marker survived a failed startup");
});

test('self-check catches a deny rule that did not apply: nginx is stopped and the rejected config stays', opts(bashSkip || selfCheckSkip), () => {
  const r = run({ curlMiss: '/package.json' });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /NGINX CONFIG FAILED/);
  assert.match(r.stderr, /self-check: \/package\.json returned 200, expected 403/);
  assert.strictEqual(r.markerExists, true);
  // The marker has to name the real reason, or the operator debugs the wrong thing.
  assert.match(r.markerContent, /self-check: \/package\.json returned 200, expected 403/);
  assert.strictEqual(r.okMarkerExists, false);
  // A config that parses, reloads, and still serves /package.json is exactly the 2026-10-31 incident.
  // The reload already put it in front of users, so there is no rollback that makes disk and memory
  // agree - and DST.bak is whatever was in place before, which may be Azure's unprotected default.
  // Containment is to stop nginx, which is the part of "unavailable" this script can actually cause:
  // on the host, startup.sh exited 1 and the site kept serving.
  assert.match(r.calls, /nginx -s stop/, 'nginx was left serving the config that failed its probes');
  assert.strictEqual(r.serving, null, 'something is still being served after a fatal probe');
  // Serving nothing and being gone are different claims, and only the second one is containment.
  assert.strictEqual(r.running, false, 'nginx was reported as stopped but the process is still there');
  assert.match(r.stderr, /nginx stopped; it is no longer serving the rejected config/);
  assert.match(r.stderr, /FAIL-CLOSED/);
  assert.match(r.stderr, /the rejected config remains on disk/);
  assert.strictEqual(r.dst, 'NEW CONFIG\n', 'the rejected config must stay on disk for the operator');
  assert.strictEqual(r.bakExists, true, 'the previous config was dropped without anything being verified');
  // Restoring here would be the divergence bug: disk rewritten, nginx still on the rejected config.
  assert.doesNotMatch(r.stderr, /restored the previous nginx config/);
});

test('containment falls back to `service nginx stop` when the master signal fails', opts(bashSkip || selfCheckSkip), () => {
  // Both stop mechanisms failing would be a worse outcome than a wrong message, so the fallback has
  // to be a real second attempt rather than dead code behind a successful first one.
  const r = run({ curlMiss: '/package.json', nginxStopExit: 1, serviceStopExit: 0 });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.ok(
    r.calls.indexOf('nginx -s stop') < r.calls.indexOf('service nginx stop'),
    'the service stop was tried before the master signal',
  );
  assert.strictEqual(r.serving, null, 'the service fallback never ran: nginx is still serving');
  assert.strictEqual(r.running, false, 'the process survived a stop that reported success');
});

test('both stop mechanisms failing: containment is reported as incomplete, not achieved', opts(bashSkip || selfCheckSkip), () => {
  // The stubs return 0 and take nginx down; here they return 1 and nginx keeps running, which is what
  // a stop that cannot reach the master looks like. Both mechanisms were tried, neither worked, and
  // nginx is still serving the config that failed its probes - the script must say that rather than
  // report the containment it did not achieve. This is the case the exit status of a stop command
  // cannot distinguish, and the reason containment is verified instead of inferred.
  const r = run({ curlMiss: '/package.json', nginxStopExit: 1, serviceStopExit: 1 });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.calls, /nginx -s stop/, 'the master signal was never attempted');
  assert.match(r.calls, /service nginx stop/, 'the service fallback was never attempted');
  assert.strictEqual(r.running, true, 'the run was supposed to leave nginx running');
  assert.strictEqual(r.serving, 'NEW CONFIG\n', 'nginx is still serving the rejected config');
  assert.match(r.stderr, /CONTAINMENT INCOMPLETE: nginx is STILL RUNNING/);
  // The one claim it must not make. A stop command returned non-zero and the process is provably
  // there, so reporting containment here is the 2026-10-31 failure all over again.
  assert.doesNotMatch(r.stderr, /nginx stopped; it is no longer serving/);
  assert.strictEqual(r.dst, 'NEW CONFIG\n');
  assert.strictEqual(r.bakExists, true);
  assert.strictEqual(r.markerExists, true);
});

test('no pgrep on the host: containment is reported as unverified, not as achieved', opts(bashSkip || selfCheckSkip), () => {
  // The stops succeed here, but nothing can confirm the process is gone. Claiming containment that
  // was never observed is the same mistake as trusting exit 1, so the honest outcome is to say so.
  const r = run({ curlMiss: '/package.json', noPgrep: true });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.calls, /nginx -s stop/);
  assert.match(r.stderr, /CONTAINMENT UNVERIFIED: no pgrep on this host/);
  assert.doesNotMatch(r.stderr, /nginx stopped; it is no longer serving/);
  assert.doesNotMatch(r.stderr, /CONTAINMENT INCOMPLETE/);
  assert.strictEqual(r.dst, 'NEW CONFIG\n');
  assert.strictEqual(r.bakExists, true);
});

test('the login probe is advisory: a non-401 warns but does not stop the site', opts(bashSkip || selfCheckSkip), () => {
  // The login challenge needs /home/site/secure/htpasswd, which is host state rather than config:
  // failing closed on it would take the site down over a file this repo does not own.
  const r = run({ curlLogin: '200' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING: \/api\/login\.php returned 200, expected 401/);
  assert.strictEqual(r.okMarkerExists, true);
  assert.strictEqual(r.dst, 'NEW CONFIG\n');
});

test('copy failure: reported, previous config restored, and nginx is never asked to reload', opts(bashSkip), () => {
  const r = run({ cpFailDest: 'DST', cpFailAt: 1 });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /could not copy/);
  // cp's own message is the context: without it the operator only knows the copy failed.
  assert.match(r.stderr, /cp: simulated failure/);
  assert.match(r.stderr, /restored the previous nginx config/);
  assert.strictEqual(r.dst, 'OLD CONFIG\n');
  assert.strictEqual(r.serving, 'OLD CONFIG\n');
  assert.strictEqual(r.markerExists, true);
  assert.strictEqual(r.okMarkerExists, false);
  // The install failed before any check ran, so nginx was never even asked whether the file parses.
  assert.doesNotMatch(r.calls, /^nginx /m);
});

test('backup failure is fatal before the destination is overwritten', opts(bashSkip), () => {
  const r = run({ cpFailDest: 'BAK', cpFailAt: 1 });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /could not back up/);
  assert.match(r.stderr, /cp: simulated failure/);
  // The install must not happen: DST still holds the config the failed backup was supposed to copy,
  // and nothing was written over it.
  assert.strictEqual(r.dst, 'OLD CONFIG\n');
  assert.strictEqual(r.bakExists, false);
  assert.strictEqual(r.serving, 'OLD CONFIG\n');
  assert.match(r.markerContent, /could not back up/);
  assert.strictEqual(r.okMarkerExists, false);
  // BUG-4: a failed backup used to be indistinguishable from a destination that never existed.
  assert.doesNotMatch(r.stderr, /no previous config to restore/);
  assert.doesNotMatch(r.calls, /^nginx /m);
});

test('restoration failure is reported as a failure, with the original error and the disk state', opts(bashSkip), () => {
  // The install is the first write to DST and succeeds; the restore is the second and fails. This is
  // the path that used to print nothing at all, leaving a banner that read like a clean rollback.
  const r = run({ nginxExit: 1, cpFailDest: 'DST', cpFailAt: 2 });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /RESTORE FAILED \(original failure: new config invalid\)/);
  assert.match(r.stderr, /cp: simulated failure/);
  assert.match(r.stderr, /was NOT restored/);
  assert.doesNotMatch(r.stderr, /restored the previous nginx config/);
  // The rejected config is what is on disk, and nginx - never reloaded - is still on the old one.
  assert.strictEqual(r.dst, 'NEW CONFIG\n');
  assert.strictEqual(r.serving, 'OLD CONFIG\n');
  assert.strictEqual(r.bakExists, true);
  assert.match(r.markerContent, /new config invalid$/m);
});

test('nginx readiness timeout: the success claim is not recreated and the backup is kept', opts(bashSkip || selfCheckSkip), () => {
  const r = run({ curlDown: true, withOkMarker: true });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /not answering/);
  // The stale OK_MARKER: the previous boot's claim used to survive a boot that verified nothing,
  // because the skip path never cleared it.
  assert.strictEqual(r.okMarkerExists, false, "the previous boot's applied marker survived a skipped self-check");
  assert.strictEqual(r.markerExists, false);
  // Nothing was verified, so the previous config stays as the operator's rollback copy.
  assert.strictEqual(r.bakExists, true);
  assert.strictEqual(r.dst, 'NEW CONFIG\n');
  assert.strictEqual(r.serving, 'NEW CONFIG\n');
});

test('curl unavailable: the self-check is skipped and no success claim is left behind', opts(bashSkip || selfCheckSkip), () => {
  const r = run({ noCurl: true, withOkMarker: true });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /curl unavailable/);
  assert.doesNotMatch(r.calls, /curl /, 'the self-check ran even though curl was "unavailable"');
  assert.strictEqual(r.okMarkerExists, false, "the previous boot's applied marker survived a skipped self-check");
  assert.strictEqual(r.bakExists, true);
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
