# Second section (B) — plan

**Status.** Plan only. Nothing here is built and no production behaviour changes.
The decision to defer this work is in [`adr/0005-multi-section-deferred.md`](adr/0005-multi-section-deferred.md);
this document is the design work that decision postponed.

## Goal

Section A keeps the short address, its board and its classmates' saved progress. A second section B
gets its own board, its own admin login and its own unlisted address, and can be rotated if the
address leaks. The owner's login works in both sections, with a read-only overview.

## What exists today (the facts this plan is built on)

| Thing | Where | Consequence for B |
| --- | --- | --- |
| Client paths | `js/util.js:43` — `API = { publish: 'api/publish.php', versions: 'api/versions.php', current: 'data/current.json' }`, all relative | A section served from a sub-path needs **no** client path changes |
| Server data folder | `api/_board.php:209` — `tt_data_dir() = dirname(__DIR__) . '/data'` | A section with its own folder gets its own `data/` for free |
| Session cookie | `api/_session.php:54` — path derived from `SCRIPT_NAME`, cookie named `tt_admin` | One cookie per section path; both sections can be signed in in one browser |
| Admin sign-in | `deploy/nginx-default.conf` — `location = /api/login.php` with `auth_basic_user_file /home/site/secure/htpasswd` | Absolute path: B needs its own login location and its own password file |
| API gate | `location ~* ^/api/ { return 404; }` plus the casing variants the verifier probes | Absolute too: must be replicated for B's prefix |
| Deploy artifact | `data/` is gitignored, so the board is never in the artifact | Per-section data folders survive deploys exactly as A's does today |
| Rate limits | nginx `limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m`; PHP `client_ip()` at `transfer.php:27-40` reads the **last** `X-Forwarded-For` entry | One shared zone means one address's failed logins spend both sections' budget |

## The address problem (decide this first)

B's address is about 128 bits, unlisted, and rotatable. Two shapes:

**Option 1 — a copy of the app per section on the host.** `/b/<token>/` is a folder on the server that
is not in git. Serving from it makes `tt_data_dir()` and the cookie path follow automatically.
Cost: the code exists in git once but on the host twice, so every deploy has to copy the new files into
B's folder; when that copy is missed, the two sections silently run different versions. Rotation is a
folder rename plus a new nginx location.

**Option 2 — one codebase, section id in the path (recommended).** B is served from the same document
root, with the section resolved on the server:

- nginx: one `location ^~ /b/<token>/` block replicating today's five exact API routes and the
  `^/api/` 404 gate against `/b/<token>/api/...`, then `alias`/`rewrite` to the same `index.html`.
- PHP: one `section_id()` helper that maps the request's first path segment to
  `data/sections/<id>/`, where that section's board, snapshots, sessions, uploads and transfer files
  live. A becomes `data/sections/a/` — a one-off move of `data/` using the lock discipline in
  `docs/owner-briefs.md` §F2, after which A's short address keeps working unchanged.
- Client: `API` stays relative; only the storage keys get a section prefix (below).

Cost: one helper, one nginx block per section, one data-folder move. Rotation is a token change in the
nginx block plus a folder rename, with no file copying.

Either option must keep the token out of git, because the repository is public. That rules out
committing `/b/<token>/` as a folder of copied files, which is a second reason to prefer Option 2.

## Storage keys

`js/util.js:38-41` defines `KEYS`: `class_tasks_draft`, `class_tasks_progress`,
`class_tasks_checkpoints`, `class_tasks_published_cache` (`legacy` is a read-only migration source).
A keeps all of them byte-identical — they are a frozen invariant. B uses `<section>_<existing name>`,
for example `b7f3_class_tasks_progress`, produced by one `keysFor(section)` function; the `legacy`
migration runs for A only. Theme and view settings are per device today and stay per device; they are
not section-scoped unless testing shows they should be.

## The rate-limit / client-IP question (the one ADR 0005 blocks on)

nginx keys login throttling on `$binary_remote_addr`; PHP keys transfer throttling on the last
`X-Forwarded-For` entry, because Azure appends the real client there and the last entry is the one
Azure added and a visitor cannot fake.

With two sections sharing one `limit_req_zone`, one address's attempts in A spend B's budget. Log-in
is admin-only, so the volume is small — but one school NAT means every classmate and both admins share
a single public address and therefore a single 5 requests/minute budget.

**Decision needed:** per-section zones (`limit_req_zone ... zone=login_b`) at the same 5 r/m, or one
shared zone. Recommendation: per-section zones — two lines of nginx, no PHP change. Transfer limits
become per-section for free once the transfer folder is per-section, so nothing to decide there.

## Order of work

1. `adr/0008-multi-section-shape.md`: choose Option 1 or 2, and record the token rule.
2. `section_id()` plus the `data/sections/<id>/` move, behind a switch so A's behaviour is unchanged.
   Tests: A's paths resolve as before; the move is idempotent, lock-protected and skip-and-report on
   an unreadable snapshot.
3. nginx: one block per section, login throttle zone per section. Extend `deploy/check-nginx.sh` and
   `tests/nginx-conf.test.js` so a missing per-section login gate fails CI.
4. Client: `keysFor()` and the section-aware API base. Goldens cover A unchanged plus one B fixture.
5. Admin: B's own password file outside the web root and its own login; the owner's login keeps the
   read-only overview of last published time and task count across sections.
6. Rotation: a documented one-minute procedure, plus a test that an old token serves nothing — page and
   every API route, in the same casing variants the hardening verifier already probes.

## Acceptance

- A's behaviour goldens (`tests/e2e/`) unchanged, the same storage keys, the same short address.
- B's board is unreadable from A's URL and the reverse: one section's page never loads another's board.
- A stale token answers 404 for the page and for every API route.
- `deploy/verify-hardening.mjs` extended to probe B: its login gate, its `data/` denial and its API gate,
  alongside the 15 checks it runs today.

## Risks

- **Accepted gap carried over from ADR 0005:** while A is at the short address, B's classmates can read
  A's board by typing it. This plan does not change that.
- **The data move is the dangerous step:** it touches the live board and every snapshot. It follows the
  same lock, temp+rename, skip-and-report and idempotency rules as `docs/owner-briefs.md` §F2, and it
  does not ship before a verified backup of `data/` exists.
- **Token leakage** through a screenshot, a forwarded chat message or a Host header log. Rotation has to
  be a routine one-minute procedure, not an incident.

## Non-goals

No accounts, no server-side student progress, no cross-section task sharing, no per-section themes, and
no change to the frozen invariants: ADRs 0001-0004, A's storage keys, the `current.json` shape, or the
five `?v=` stamps.
