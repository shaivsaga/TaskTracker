# P3 Startup Phase 6 Audit — deploy/startup.sh and tests/startup.test.js

Worktree: `C:/xampp/htdocs/TT-ov-p3`, branch `ov/p3-startup-audit`, checked out from origin/main `2222eb4` (includes PR #29 / `3308477`, which fixed several Phase 6 defects). Line numbers below are from the current files in this worktree. Harness verified green: `node --test tests/startup.test.js` — 26 tests, 25 pass, 1 benign skip, 0 fail, exit 0 (39.8s).

## Claim 1 — "Restore-after-self-check-miss does not reload nginx"

**Status: FIXED (deliberate, fail-closed).**

The self-check-miss path does not reload nginx and does not restore — it *stops* nginx:

- `deploy/startup.sh:166` — a deny-rule probe miss calls `contain_and_fail`, not `restore_and_fail`.
- `deploy/startup.sh:71-92` — `contain_and_fail` runs `nginx -s stop` with a `service nginx stop` fallback (line 74), then verifies containment with a bounded `pgrep` loop (lines 80-88) and reports one of three honest outcomes: stopped / STILL RUNNING / no pgrep so UNVERIFIED. It never reloads and never restores `DST.bak` (line 90 states so explicitly).
- `deploy/startup.sh:54-70` — the header comment documents why: after a successful reload, nginx is already serving the new config, so restoring `DST.bak` would rewrite disk while memory kept the config that just failed, and `DST.bak` may itself be Azure's unprotected default.

Regression tests already pin this: `tests/startup.test.js:747-772` (probe miss → `nginx -s stop` seen, nothing served, process gone, no restore message), `:774-785` (service-stop fallback), `:787-806` (both stops fail → CONTAINMENT INCOMPLETE, nginx still running — never claimed as contained), `:808-819` (no pgrep → CONTAINMENT UNVERIFIED).

## Claim 2 — "Stale OK-marker survives skipped checks"

**Status: FIXED.**

`OK_MARKER` (`/home/LogFiles/startup-nginx-applied.txt`) is deleted at the top of every boot, before any path can skip or fail the self-check:

- `deploy/startup.sh:10` — `rm -f "$OK_MARKER"` immediately after the variable assignments; only comments precede it, so no exit path reaches line 12+ with the previous boot's claim intact.
- `deploy/startup.sh:27` — belt-and-braces: `nginx_failed` clears it again next to the error marker it writes.
- `deploy/startup.sh:175-179` — the only writer: it sits *inside* the self-check else-branch, after all three deny-rule probes (`/Data/current.json`, `/package.json`, `/Tests/php/run.php`) have individually passed (lines 160-168). The advisory login probe (lines 171-174) follows the fatal loop, so a WARNING there does not gate the marker.

Path-by-path verification (all occur after line 10):

| Path | OK marker left stale? |
|---|---|
| SRC missing → `nginx_failed` (`:112`) | No (`:10`, `:27`) |
| Backup fail → `nginx_failed` (`:104`) | No |
| Install copy fail / `nginx -t` fail / reload fail → `restore_and_fail` → `nginx_failed` (`:106,108,136`) | No |
| curl unavailable → skip, exit 0 (`:143-145`) | No (`:10`) |
| Readiness timeout (not answering) → skip, exit 0 (`:148-157`) | No (`:10`) |
| Deny probe miss → `contain_and_fail` (`:166`) | No (`:10`, `:27`) |
| Self-check passes (`:175`) | Recreated with fresh stamp + sha256 |

Tests pinning this: `tests/startup.test.js:879-891` (readiness timeout — stale OK marker gone, exit 0), `:893-900` (curl unavailable — same), `:738-745` (failed run clears it), `:723-736` (fresh boot replaces a stale marker with its own stamp + digest), `:747-772` (probe miss → `okMarkerExists` false).

Residual note (not a defect): line 10's `rm` and line 179's write are both `2>/dev/null`. If `/home/LogFiles` were unwritable, both fail and a stale marker could persist — but both need the same directory write access, so "rm fails while the later write succeeds" cannot happen, and an unwritable LogFiles also defeats the error marker, which is a host condition outside this script's reach.

## Claim 3 — "Backup and restore failures may be silent"

**Status: FIXED.**

- **Backup creation** — `deploy/startup.sh:103-104`: `cp -p "$DST" "$DST.bak" || nginx_failed "could not back up $DST to $DST.bak; $DST left untouched"`. `nginx_failed` (`:15-29`) prints the four-line banner to stderr and writes MARKER before `exit 1`. The failure also happens before SRC overwrites DST, so nothing is half-installed. Test: `tests/startup.test.js:846-861` (asserts the message, cp's own stderr, DST untouched, marker content).
- **Restore failure** — `deploy/startup.sh:44-47`: a failing `cp -p "$DST.bak" "$DST"` prints `RESTORE FAILED (original failure: …)` plus cp's captured stderr plus `was NOT restored; inspect it before nginx next starts`. No path reports an incomplete restore as a success. Test: `tests/startup.test.js:863-877` (asserts all three messages and the end state DST=NEW / serving=OLD / bak kept).
- **Restore success and no-backup cases** are also reported (`:43`, `:49`), and both feed into the loud `nginx_failed` banner before `exit 1`.

No silent failure path exists in the backup/restore machinery. (Minor out-of-scope observation, not part of the claim: `deploy/startup.sh:119` — the PHP-ini `cp "$INI_SRC" "$INI_DST"` has no error check; a failed install of the upload limits would be silent. Its absence is otherwise reported at `:122`. Owner decision whether to add an `|| echo` there.)

## Claim 4 — "tests/startup.test.js may encode buggy behavior"

**Status: FIXED / no contradiction found.**

Checked every test against the fail-closed contract in the `startup.sh` comments:

- No test asserts restore-after-probe-failure. The opposite is pinned: `tests/startup.test.js:770-771` — after a probe miss, `assert.doesNotMatch(r.stderr, /restored the previous nginx config/)` with the comment "Restoring here would be the divergence bug."
- No test accepts a silent failure. The failure-reporting tests assert the messages exist (`:831-844`, `:846-861`, `:863-877`), and the containment tests assert the script never claims containment it did not observe (`:787-806` asserts `CONTAINMENT INCOMPLETE` and forbids the "nginx stopped" line when the process is provably alive; `:808-819` likewise for UNVERIFIED).
- The skipped-self-check exit-0 contract (`:879-891`, `:893-900`, documented in the header at `:30-31` and `:32-37`) is a deliberate, commented design in both files, not an encoding of the old defects: those tests specifically assert the *stale-OK-marker* defect is fixed.
- The `okMarkerExists` assertions all expect absence after failure/skip and presence only after a passing self-check — consistent with `startup.sh:10/27/175`.

## Harness run

Command (from the worktree): `node --test tests/startup.test.js`

```
ℹ tests 26
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 39846.3958
```

Exit code: 0. The single skip is the harness's own "bash availability is explicit, never assumed" meta-test (`tests/startup.test.js:909-918`) — it self-skips when bash *was* found ("bash found; nothing to enforce"). No Windows-specific failures.

## Recommendation

Nothing to fix now: all four claims are already resolved in current origin/main by PR #29 (`3308477`) and its companions. No regression tests were added (nothing still-present to pin), and `deploy/startup.sh` was not modified. The only open item is the cosmetic/untested PHP-ini `cp` at `deploy/startup.sh:119` — owner decision, not part of any claim.
