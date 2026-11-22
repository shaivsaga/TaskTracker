# Multi-section plan

**Status.** Design settled in [ADR 0008](adr/0008-multi-section.md) and [GLOSSARY.md](../GLOSSARY.md). Nothing here is built yet.

## Goal

Keep Section A untouched at the root URL (`dsct.dev`, `data/`, existing `localStorage` keys, 14 goldens). Give Section B (and future operator-provisioned Sections) its own unlisted **Section Link** `/s/<id>/<token>/`, its own **Board**, **Uploads**, **History**, **Recycle Bin**, **Transfers**, and **Officer** login—with the smallest possible change across nginx, PHP, and JS.

## Settled architecture (at a glance)

| Concern | Section A (root) | Non-root Section (e.g. `b`) |
| --- | --- | --- |
| URL | `/` | `/s/b/<32-hex-token>/` |
| Data directory | `data/` (untouched) | `data/sections/b/` |
| Admin auth | `/home/site/secure/htpasswd` (Owner) | `/home/site/secure/htpasswd_b` (Owner + B's Officer) |
| Login throttle | `zone=login:10m rate=5r/m` | `zone=login_b:10m rate=5r/m` |
| PHP section signal | `fastcgi_param TT_SECTION "";` | `fastcgi_param TT_SECTION "b";` |
| Session cookie path | `/api/` (auto from `SCRIPT_NAME`) | `/s/b/<token>/api/` (auto from `SCRIPT_NAME`) |
| `localStorage` keys | Frozen `class_tasks_*` | Prefixed `b_class_tasks_*` (theme & view stay device-wide) |
| UI badge | None (unchanged) | Derived from Section ID (`SECTION B`) in header + beside Publish |
| Initial subjects | Existing catalogue | One-time copy of A's subjects at provisioning, then independent |
| Concurrent publish | Existing `baseRevision` + `operationId` in `api/publish.php` | Same, automatically per Section |

## File-by-file implementation scope

### 1. PHP — section-scoped data directory
- **`api/_board.php`**: add `tt_section_id()` reading `$_SERVER['TT_SECTION'] ?? ''` (validated against `/^[a-z0-9][a-z0-9_-]{0,31}$/`; empty or `'a'` → root). Update `tt_data_dir()` to return `dirname(__DIR__) . '/data'` for root or `dirname(__DIR__) . '/data/sections/' . $id` for non-root. Reject an invalid non-empty `TT_SECTION` with 400 (fail closed).
- **`api/_session.php`**, **`api/publish.php`**, **`api/versions.php`**, **`api/upload.php`**, **`transfer.php`**: replace hardcoded `dirname(__DIR__) . '/data'` with `tt_data_dir()` so sessions, boards, snapshots, recycle bin, uploads, and transfers all follow `TT_SECTION` automatically.
- **Tests (`tests/php/`)**: verify A's paths are unchanged, `TT_SECTION=b` isolates board/versions/sessions/uploads/transfers under `data/sections/b/`, and invalid `TT_SECTION` values fail closed.

### 2. Nginx & deploy scripts — wildcard includes, provisioning, rotation, backups
- **`deploy/nginx-default.conf`**:
  - Top-level (`http {}`): add `include /home/site/secure/sections-http-*.conf;`
  - Inside `server {}`: add `include /home/site/secure/sections-server-*.conf;`
  - On A's five `/api/*.php` locations (and generic PHP handler): explicitly set `fastcgi_param TT_SECTION "";`.
  - Because both includes use `*`, missing section files pass `nginx -t` cleanly in CI and on hosts with only Section A.
- **`deploy/section.sh`** (small operator helper):
  - `provision <id>`: creates `data/sections/<id>/`, seeds `current.json` with a one-time copy of A's `subjects` (empty tasks/announcements), generates a 128-bit hex token, writes `/home/site/secure/sections-http-<id>.conf` (`limit_req_zone ... zone=login_<id>:10m rate=5r/m;`) and `/home/site/secure/sections-server-<id>.conf` (exact routes for `/s/<id>/<token>/`, `data/current.json`, `uploads/*`, `api/{login,logout,versions,publish,upload}.php`, `transfer.php`, case-insensitive `^/s/<id>/<token>/api/` 404 gate, and full security header set), prints the Section Link, and reminds the operator to create `/home/site/secure/htpasswd_<id>` and run `nginx -t && nginx -s reload`.
  - `rotate <id>`: generates a new 128-bit token, rewrites `sections-server-<id>.conf`, runs `nginx -t && nginx -s reload`, and prints the new Section Link. Old links (page, board, API, uploads) immediately return 404.
- **`deploy/backup.sh`**: add `sections` to the `for name in current.json versions uploads admin sections;` list so one backup covers all Sections.
- **Tests**: extend `tests/nginx-conf.test.js` and `deploy/check-nginx.sh` (test with a generated dummy section include) plus `deploy/verify-hardening.mjs` (optional `--section-url` flag to probe B's login gate, API gate, `data/` denial, and stale-token 404).

### 3. Client JS — Section ID, prefixed keys, transfers, reset, badge
- **`js/util.js`**:
  - `currentSection()`: parses `location.pathname` for `/^\/s\/([a-z0-9][a-z0-9_-]{0,31})\/[a-f0-9]{32}(?:\/|$)/i`; returns `''` for root (Section A) or the lowercase **Section ID** (`'b'`).
  - `KEYS`: unchanged for root (`class_tasks_*`); prefixed with `${id}_` (`b_class_tasks_*`) for non-root. Legacy `class_tasks_mvp` migration runs for root only.
  - `API` (`api/publish.php`, `api/versions.php`, `data/current.json`), `TRANSFER_API` (`transfer.php`), and `attachments.js` (`uploads/<id>`) stay relative—zero path rewrites.
- **`js/settings.js`**:
  - Scope **Reset my progress** to the current Section's keys only (never wipe another Section's `localStorage` keys on the same device). Keep `class_tasks_theme` and view preferences device-wide.
  - Scope `ADMIN_KEY` / `SIGNED_OUT_KEY` per Section so signing in or out on B doesn't flip A's admin UI state.
- **`js/transfer.js`**:
  - Tag exported payloads and QR transfers with `section: currentSection() || 'a'`.
  - Reject imports whose `section` does not match the active Section (legacy exports without `section` import into A only).
- **Section badge (`index.html` / `js/` / `styles.css`)**:
  - Hidden when `currentSection() === ''` (Section A stays visually and DOM-wise identical; all 14 goldens untouched).
  - Shown on non-root Sections with label derived from Section ID (`b` → `SECTION B`) in the header and beside the Publish button.
  - B's Officer signs in via `/s/b/<token>/?admin` → Settings (existing `adminHint()` flow).

## Acceptance criteria

- Section A: all existing unit, PHP, nginx, hardening, and 14 E2E golden checks pass unchanged.
- Section B: board, drafts, progress, uploads, recycle bin, version history, and transfers are completely isolated from A; cross-section transfer imports are rejected.
- Security: `TT_SECTION` cannot be spoofed from client requests; B's Officer cannot log into A; a rotated/stale token returns 404 for the page, `data/current.json`, `uploads/*`, and all `/api/*` casing variants.
- Rotation: changing B's token via `deploy/section.sh rotate b` takes <1 minute and leaves B's students' `b_*` browser progress intact when they open the new link.

## Non-goals

No student accounts, no server-side student progress, no in-app section switcher or overview dashboard, no self-service section creation UI, no live cross-section task/subject sharing, no A data migration, and no changes to ADRs 0001–0004, `index.html`'s CSP-pinned inline scripts, or the five `?v=` asset stamps.
