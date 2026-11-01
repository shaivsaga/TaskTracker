# Owner decision briefs — F1, F2, F3, Phase 4 S1b, Phase 5 stamp-vs-no-cache

**Worktree:** `TT-ov-briefs` @ `ov/owner-briefs` (origin/main `2222eb4`) · **Date:** 2026-11-01
**Documentation only.** Nothing here is implemented and no approval is assumed. Each section ends
with the exact decision the owner must make.

Evidence sources: repo code at `2222eb4`; SECURITY_AUDIT_REPORT.md, REMEDIATION_PLAN.md,
HARDENING_GATE_REVIEW_2026-10-31.md, `.claude/DELIVERABLES.md`,
`.claude/plans/phase4-owner-decisions.plan.md` (§3 = S1), PROJECT_HANDOFF.md §11. The first five
of those are **not tracked on main** — they exist only in the main checkout's working directory;
their line references below are quotes, so the briefs survive if the files move.

---

## F1 — `publish.php` notesRef invariant

### Current behavior (code path, today)

There is **no `notesRef` anywhere in the repo** (grep across the worktree at `2222eb4`: 0 hits;
independently confirmed in `.claude/DELIVERABLES.md` §I: "no `notesRef` anywhere in the file").
`notes` is a plain string carried inline. The exact publish path:

1. `api/publish.php:15-17` — payload must be JSON with `tasks` an array.
2. `api/publish.php:30-48` — per-task validation: id (non-empty, ≤64 chars), title (string,
   ≤500), `notes` and `subject` (string only — **`notes` has no length cap**; the 4 MB body cap at
   line 13 is the only bound), dueDate/dueTime regexes, files (≤10, id
   `/^[a-f0-9]{32}\.(pdf|pptx|docx|jpg|png)$/D`, name ≤120, size int ≥0).
3. **Unknown keys are not stripped.** `$t` is copied wholesale into `$stamped` (`:81-94`); only
   `changedAt` is unset and server-stamped. `$current['tasks'] = $stamped` (`:95-99`) is written
   verbatim. So any key a client sends on a task — a future `notesRef`, or any junk — is persisted
   into public `current.json` and every snapshot.
4. `logic.js:196-207` `Task.toJSON()` sends `notes` as a string (plus `closedAt`, which is also
   not in publish.php's validated set — an existing example of the same passthrough).

### The S1b data-loss risk (F1 as filed)

Under the S1b design (phase4 plan §3.2), a task with a large body carries `notes: ""` plus
`notesRef: { id: <sha256>, len, excerpt }`, the body lives at `data/bodies/<sha256>.json`, and the
GC rule deletes a body only when no snapshot, not `current.json`, and no live transfer references
it. **Nothing in `publish.php` stops a task arriving with empty `notes` and no ref**:

- A stale client is the live vector. Browsers cache `app.js` with
  `Cache-Control: public, max-age=31536000, immutable` (nginx `map $arg_v $asset_cache`, stamped
  URLs), and the workflow asserts a year on those stamps. A browser holding a year-old `app.js`
  keeps publishing the old shape while the server has externalised other tasks' bodies. A new
  client that fails to fetch a body before publishing (offline draft, 8 s timeout at
  `app.js:337`) can also send empty notes with no ref.
- If such a publish lands, the task's body is no longer referenced by `current.json` (and,
  after enough publishes/prunes, by any snapshot either), GC legitimately reaps it, and the notes
  are **silently and permanently gone** — while `current.json` stays perfectly parseable and
  renderable, so no test of the "board still works" class would ever catch it. This is why F1
  **gates S1b**.

### Recommended invariant

The server must never let a publish drop a body reference it did not explicitly receive as a
deletion. Two shapes:

- **Option A (recommended): explicit-delete contract.** A task whose live predecessor
  (`$liveById[$t['id']]`, `publish.php:77-79`) carries `notesRef`, and whose submitted form has
  empty `notes` **and no `notesRef`**, is rejected **409** with a message directing a reload.
  Deleting notes is expressed only by an explicit marker (e.g. `notesRef: null` present in the
  JSON), so "key absent" (stale/naive client) can never mean "delete".
- **Option B: server-side carry-over.** Same trigger, but the server re-attaches the previous
  ref instead of rejecting — mirroring the existing clear-board precedent of carrying
  announcements over (`publish.php:100,111`). Friendlier to stale clients, but it silently
  "undeletes" notes unless the explicit marker from Option A also exists, so it needs the same
  contract plus a branch; strictly more code for the same safety.

Option A is the smaller, sharper change. Either way the contract must be **defined and tested
before S1b ships** — not after.

### Required tests (php `tests/php/run.php` style)

1. Publish a task with empty `notes`, no ref, while the live task has `notesRef` → **409**; board
   unchanged; body file still present.
2. Publish with the explicit delete marker (`notesRef: null`) → succeeds; body becomes
   GC-eligible; a later GC run removes it (and only it).
3. Publish carrying the correct `notesRef` → succeeds unchanged (happy path).
4. Task with inline notes (below threshold) → unchanged behavior, no ref involved.
5. A `notesRef` present but malformed (fails the F3 hash regex) → **422**, never persisted.
6. Regression guard: unknown-key passthrough — assert the validator now has an explicit allowlist
   for task keys including `notesRef`, or that `notesRef` shape is validated when present.

**DECISION NEEDED FROM OWNER:** Choose Option A (409 on empty-notes-no-ref, explicit delete
marker) or Option B (server carry-over with the same marker), and confirm the contract is
implemented and tested as a precondition of approving S1b — not after it.

---

## F2 — `.publish.lock` migration

### Current locking behavior

- `api/publish.php:65-68` takes `flock` on `data/.publish.lock` (`'c'` mode), bounded 50×100 ms
  non-blocking wait, **fails closed with 503 before anything is written** if the lock cannot be
  taken. Everything — snapshot exclusive-create (`:139-146`), temp-file + atomic `rename()` of
  `current.json` (`:136,148-151`), prune (`:153-158`) — runs under that one lock.
- `api/versions.php:27-34` takes the **same lock** before deletes (by id or `all:true`), same
  bounded wait, same fail-closed 503. Deletes never interleave with a publish.
- Snapshots are written with exclusive-create (`'x'`) + full `fwrite` + `fclose` before the bytes
  count; `current.json` is replaced only via same-directory temp + `rename()`. A crash at any
  point leaves either the old file or a complete new one — never a truncated one.

### What the S1 migration changes and why F2 exists

Both S1a (rewrite base64 out of `current.json` + `data/versions/*.json`) and S1b (externalise
bodies) need a **migration**: a one-off job that reads the live board and historical snapshots and
rewrites them in place. The phase4 plan (§3.2) describes the migration's *what* but never gives it
a locking or atomicity story — which is exactly what the S1 adversarial review filed as F2
(DELIVERABLES §I): the migration as stated takes **no `.publish.lock`** and states **no
temp+rename**, so:

- **Concurrent publish loses data.** Migration reads the board → admin publishes → migration
  writes back its **older** copy → the newer publish is silently overwritten and `publishedAt`
  goes backwards (breaking the "ids only ever increase" ordering that prune and the versions list
  depend on).
- **Crash truncates a historical snapshot.** A migration that `file_put_contents` over
  `data/versions/<id>.json` in place can be killed mid-write, leaving a partial snapshot that
  `versions.php:48` then silently skips — that history is gone.

### Recommended approach

The migration must inherit the exact discipline `publish.php` already uses — no new mechanism:

1. Take `flock` on the same `data/.publish.lock`, same bounded wait, fail closed (abort with a
   report, change nothing) if it cannot be taken.
2. Every file it rewrites — `current.json` **and** each `data/versions/*.json` — goes through
   temp file in the same directory + `rename()`, mode fixed before rename, old file untouched on
   any failure. For snapshots, prefer write-new-then-rename (or exclusive-create like publish)
   so a crash mid-run leaves the original intact.
3. Skip-and-report anything unreadable or non-conforming rather than half-rewriting; make the
   run **idempotent** so a re-run after a crash converges.
4. Run it owner-triggered (CLI/SSH or an admin-only route) at a quiet time — but the lock is not
   optional even then, because a publish is one click away at any moment.

### Required tests

1. **Interleaving:** start a migration, fire a concurrent publish mid-run → exactly one of them
   503s; the board's `publishedAt` is monotonic; no write is interleaved.
2. **Crash window:** kill the migration between temp-write and rename (or simulate a partial
   temp write) → every snapshot still parses; the original content is intact.
3. **Idempotency:** run the migration twice → second run changes nothing, reports success.
4. **Skip path:** a corrupt/unreadable snapshot is reported, not modified or deleted.

**DECISION NEEDED FROM OWNER:** Approve the migration contract — same `.publish.lock`, temp+rename
for every rewritten file, skip-and-report, idempotent — as a mandatory acceptance condition for
whichever S1 migration (S1a's or S1b's) gets implemented.

---

## F3 — hash validation and its relationship to S1b

### Current validation of note body ids/refs

- **Reader (versions):** `api/versions.php:8-11` `canonical_id()` —
  `/^[1-9]\d{0,18}$/D` plus a `(string)(int)$s === $s` round-trip — forecloses path traversal
  through the snapshot id parameter. That is the only "id → file" reader that exists today.
- **Transfer path:** `api/_validate.php:24-75` `clean_payload()` strictly whitelists `progress`
  keys (`/^[\w.\-]{1,100}$/`, `__proto__` rejected) **but passes `draft.tasks` and
  `draft.announcements` through with per-field checks only** — unknown task keys survive the
  payload verbatim. `publish.php` has the same no-whitelist passthrough (F1, §above).
- **Today this is inert:** nothing reads a `notesRef` and there is no body reader endpoint, so no
  unknown key is a file path yet. F3 is a **precondition of S1b, not a live bug** — the same
  conclusion the 2026-10-31 checkpoint reached ("do not implement now"; unknown keys are inert
  until S1b makes them point at files).

### The proposal and why S1b forces it

Under S1b, two new paths make unknown keys dangerous:

1. **A body reader endpoint** (`api/body.php` or equivalent, GET `?id=<body id>`) serving
   `data/bodies/<sha256>.json`. Without strict id validation, `?id=../../api/.htpasswd` is a
   **file read** against a path that, if the config is ever wrong again, is reachable.
   Required: id must match `^[a-f0-9]{64}$` (`/D` anchored) — sha256 hex, no separators, no
   traversal possible — and the endpoint must resolve only inside `data/bodies/`
   (basename/realpath guard as a second layer, matching how `canonical_id()` layers round-trip
   on top of the regex).
2. **Persistence of client-supplied refs.** `clean_payload()`'s passthrough means a crafted
   transfer → import → publish persists an attacker-chosen `notesRef` string into **public**
   `current.json`. Once refs point at files, the value must be validated at both write paths:
   `clean_payload()` (reject the transfer, return null) and `publish.php` (422), using the same
   `^[a-f0-9]{64}$` regex. Better still, since bodies are content-addressed, the server can
   derive the id itself at publish time and ignore client ids entirely — the client-supplied id
   then only ever gets *verified*, not trusted.

### Risks of doing it late or wrong

- Serving externalised bodies as `text/html` would be a stored-XSS surface in the app's own
  origin (phase4 plan §3.5): the reader must return JSON (or `text/plain` + `nosniff`);
  `sanitizeDoc()` still re-validates on every render — externalising does not make content
  trusted.
- Enforcing the hash regex on a task-key whitelist *before* the S1b format is settled risks
  silently dropping fields the client sends today (`closedAt` already escapes the validated set;
  `logic.js:204`). That is why the checkpoint deferred implementation — the whitelist should be
  finalised **with** S1b's format, not guessed before it.

### Required tests

1. Reader endpoint: `?id=../../api/.htpasswd`, `?id=..%2f..%2f`, uppercase hex, short/long hex,
   non-hex → all 400/404; valid 64-hex id → 200 JSON `{id, html}`; response carries
   `Content-Type: application/json` and `nosniff`.
2. `clean_payload()` with a draft task carrying a malformed `notesRef` (bad format, traversal,
   extra keys) → returns null, transfer rejected.
3. `publish.php` with a malformed ref → 422, nothing persisted.
4. Round-trip: published ref id equals sha256 of the stored body bytes.

**DECISION NEEDED FROM OWNER:** Confirm that `^[a-f0-9]{64}$` id validation on the body reader,
plus ref-format validation in both `clean_payload()` and `publish.php`, is adopted as a **blocking
acceptance criterion of S1b** — and whether the server derives (rather than trusts) body ids at
publish time.

---

## Phase 4 S1b — Externalized document bodies

### Current storage format

`data/current.json` (public) and each `data/versions/<unix-timestamp>.json` snapshot store the
full board inline: `{publishedAt, tasks:[…], announcements:[…]}` where every task's `notes` is an
inline HTML/text string, with pasted images embedded **inside those strings as base64 data URIs**
(`insertDocImages` fallback, `app.js:745-767`) or as `uploads/<32hex>` references
(`sanitizeDoc`, `logic.js`, accepts both forms — the existing backward-compatibility hook).
Measured on the live board (2026-10-30, phase4 plan §3.1): 1,702,291 bytes, **97% of it in four
strings** (704 KB + 412 KB base64 + 336 KB + 201 KB doc bodies). Every publish writes a full
snapshot (max 50 kept, `keep_versions`).

### Migration shape (per phase4 plan §3.2–§3.4, condensed)

- Split: **S1a first** (stop producing base64; server-side normalise on publish + one-off
  migration rewriting stored base64 to `uploads/` refs — backward compatible, reader already
  renders both, ≈1.70 MB → ≈1.29 MB), then **S1b** (the format change, ≈ residual 45 KB,
  <20 KB gzipped with `JSON_UNESCAPED_SLASHES`).
- **S1b:** bodies over a threshold (≈8 KB) move to `data/bodies/<sha256-of-sanitised-bytes>.json`
  (content-addressed: free dedup, immutable ids); tasks carry `notes: ""` +
  `notesRef: {id, len, excerpt ≤2 KB}`. Body file is written **before** the board that references
  it (crash leaves an orphan, never a dangling pointer). Read path: new JSON reader endpoint
  (F3), body fetched lazily when a dialog opens. GC: a body is deleted only when no snapshot,
  not `current.json`, and no live transfer references it — conservative, reference-counted,
  applied to both prune and `versions.php all:true`. The inline `excerpt` keeps list previews
  and class search working at reduced fidelity.
- **Rollback (hard requirement from DELIVERABLES §D):** ship S1b with **both** the ref and a
  retained inline copy for one deploy cycle, then drop the inline copy in a follow-up. Once
  inline copies are gone, reverting the code leaves old readers unable to fetch bodies — the
  change is forward-safe, not trivially reversible.

### Owner risk

1. **Persisted-format change.** PROJECT_HANDOFF §11 rule 5: "Never silently change auth,
   permissions, privacy, nginx rules, rate limiting, or persistence. Ask first." This is the
   canonical case — it needs an explicit yes, and F1 (the notesRef invariant) and F3 (hash
   validation) must be settled **before** the format ships, or the format launches with its
   data-loss and traversal doors open.
2. **Reduced search fidelity.** Load-time class search matches `title + subject + notes`
   (`app.js:1414-1416` region); an externalised body is searchable only through its ≤2 KB
   excerpt. Full-body search would mean fetching every body — rejected for load cost. The owner
   must either accept this or set a larger inline threshold.
3. **Host unknowns.** Whether `data/` survives redeploys and whether it is backed up are marked
   **[unknown]** (phase4 plan §3.9, PROJECT_HANDOFF §10). `data/bodies/` is irrecoverable without
   that answer.
4. **Sizing.** `keep_versions => 50` means the body store must hold up to ~50 snapshots' worth of
   referenced bodies; a GC bug's blast radius is bounded only by conservatism ("when in doubt,
   keep").
5. **Dependency order.** L5 (opaque version ids) before S1b, so the id scheme is chosen once;
   C5 (branch protection) before any S1 push to main, because only the deploy path can corrupt
   production data with this.

### Required tests

Condensed from phase4 plan §3.6: logic tests for the ref/inline threshold decision and
`Task.fromJSON` accepting `notesRef`; PHP checks for data-URI extraction round-trip, fail-closed
on non-image blobs, and the GC reference rule; a manual run of the migration against a copy of
the live payload confirming every task still renders (dialog, search, transfer, history); post-
deploy proof that the payload is <20 KB gzipped and that a pre-migration snapshot still renders.

**DECISION NEEDED FROM OWNER:** Do you approve changing the persisted board format (S1b:
externalised bodies under `data/bodies/` with `notesRef` in `current.json`), with the dual-write
rollback cycle, the ≤2 KB excerpt search fidelity, and F1/F3 implemented and tested first — and
do you confirm the host `data/` location, redeploy survival and backup status that this depends
on?

---

## Phase 5 — stamp versus no-cache for `data/current.json`

### Current behavior (the client defeats the server's work)

- **Server (already merged):** `deploy/nginx-default.conf:116-118` serves `current.json` with
  `Cache-Control: no-cache` (S2) so the browser should revalidate against nginx's ETag
  (mtime+size) and get a 0-byte 304 on unchanged loads.
- **Client (defeats it):** `app.js:337` —
  `fetch(\`${API.current}?t=${Date.now()}\`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })`.
  The timestamp query makes a fresh URL every load, and `no-store` forbids the browser from even
  keeping a revalidatable copy. Result: every load is a **full refetch of ~1.7 MB** (measured
  2026-10-30; gzip reaches only 1.25 MB because of the base64). DELIVERABLES §C records this as
  "S2 is half delivered".
- **Assets, for contrast:** `index.html` carries five `?v=` stamps (styles.css, qr-draw.js,
  attachments.js, logic.js, app.js) rewritten by CI to the commit SHA; the nginx `map $arg_v
  $asset_cache` gives stamped assets `public, max-age=31536000, immutable` and everything else
  `no-cache`. That machinery is correct; the current.json fetch is the one place the cache-buster
  pattern was copied where it hurts.

### Options

1. **Drop the cache-buster (recommended).** Change `app.js:337` to
   `fetch(API.current, { cache: 'no-cache', signal: AbortSignal.timeout(8000) })` — or even just
   remove the two defeating parts and keep the URL plain. `no-cache` makes the browser revalidate
   on every load with `If-None-Match`; unchanged board → 304, 0 bytes; a publish rewrites the
   file (new mtime + size → new ETag) → 200 with the new board. Freshness guarantee is identical
   to today (every load is verified), only the unchanged case stops paying 1.7 MB. One-line
   change, no protocol or format involvement, independent of S1 (though S1 makes the un-cached
   case cheap too, and S1's own acceptance requires this client half for its 304 target).
2. **Stamp `?v=<publishedAt>`.** Append the board's `publishedAt` (known from the localStorage
   cache) instead of a timestamp. Gives immutable caching + zero revalidation requests, but needs
   a two-phase fetch (guess stamp → fall back on mismatch), fails on first visit without a cached
   board, and saves only the 304 request (~a few hundred bytes) that option 1 already reduces to
   nothing. Strictly more code for negligible gain.
3. **Do nothing.** Leaves the ~1.7 MB per load and the memory-noted double cost (uncacheable,
   uncompressed-at-the-edge) in place.

### Recommended path

Option 1, as a standalone one-line PR (it is "S2 client half", already listed as an independent
win in DELIVERABLES §F track 2). Keep `cache: 'no-store'` on the admin-only `api/versions.php`
fetches (`app.js:24,2692`) — tiny responses, and admin lists genuinely should never come from
cache.

### Required tests

- `node --test tests/*.test.js` stays green (the JS suite has no DOM harness, so this fetch is
  not unit-covered today — a gap to note, not fix here).
- Manual QA: second load of the board shows `data/current.json` → **304** in DevTools; publish a
  change → next load is 200 with the new content (revalidation catches the change); the
  empty-board 404 path (`app.js:339`) still resolves; offline fallback to the localStorage cache
  (`KEYS.cache`) still works.
- The POST_DEPLOY_VERIFICATION acceptance line "current.json a 304 on a second load" becomes
  checkable only after this change lands.

**DECISION NEEDED FROM OWNER:** Approve removing the `?t=${Date.now()}` cache-buster and
`cache: 'no-store'` from the `loadPublished()` fetch in `app.js` (replaced by `cache: 'no-cache'`
revalidation against nginx's ETag), or choose the stamped-`publishedAt` variant instead.

---

## Evidence gaps

- The three context documents named in the task (SECURITY_AUDIT_REPORT.md, REMEDIATION_PLAN.md,
  HARDENING_GATE_REVIEW_2026-10-31.md) are **not tracked on main** and do not exist in this
  worktree; they were read from the main checkout's working directory. Same for
  `.claude/DELIVERABLES.md`, `.claude/plans/phase4-owner-decisions.plan.md` and
  PROJECT_HANDOFF.md. Their conclusions are quoted, so the briefs stand alone, but the files
  themselves are one careless `git clean` away from gone (HARDENING_GATE_REVIEW §G already flags
  committing them as an owner decision).
- The ~1.7 MB payload figure is from the 2026-10-30 measurement; HARDENING_GATE_REVIEW §F notes
  it was not re-verified later and should be treated as unconfirmed.
- Whether `www.dsct.dev` or any subdomain exists in DNS is unknowable from the repo (see
  p4-hsts-analysis.md §5).
