# P6 — App architecture findings (double-fetch, `?v=`/`?t=` caching, module split)

**Date:** 2026-11-01 · **Baseline:** `origin/main` `2222eb4` (PRs #23–#29 merged) · **Method:** static analysis only; line numbers are from this baseline.
**Builds on:** `.claude/plans/app-js-split.plan.md` (v3, Track S/Track A) and `.claude/plans/phase5-appjs-split.plan.md`. Where those plans are already executed by merged PRs, this doc says so.

---

## 1. logic.js double-fetch — root cause, cost, and status (FIXED in PR #27)

**Mechanism.** `index.html:551` loads logic.js once (`<script type="module" src="logic.js?v=5">`) and `app.js:5` imports it a second time (`import { … } from './logic.js?v=5'`). Same file, two URLs in the module graph. The CI stamper (`.github/workflows/main_tasktracker.yml`, "Stamp asset versions" step) originally rewrote **only index.html's tags** with `?v=<deploy-sha>`; the hand-written import inside app.js kept its literal `?v=5`. A deployed build therefore resolved logic.js to two different URLs (`logic.js?v=abc1234` from index.html, `logic.js?v=5` from app.js) and the browser fetched the file **twice** — the second request is only discovered when app.js parses, so it serialized late on the critical path (measured in the plan's waterfall: t≈722–789 ms, pushing the 1.70 MB data fetch to t≈796). Cost: one extra request (~14 KB raw / 5 KB gz) + HTTP/1.1 serialization; and the missed-bump hazard — a returning visitor holds one URL immutable-cached, and if an export surface ever changed between the two, the app renders blank.

**Status: fixed.** PR #27 (commit `26d440d`) extended the stamper:

- `main_tasktracker.yml:50` — `sed` now rewrites `./logic.js?v=…` inside app.js with the same `$V` as index.html, so both resolve to one URL.
- `main_tasktracker.yml:52-57` — a STALE assertion fails the build if **any** `?v=` reference in any served file differs from the stamp, plus count checks (5 in index.html, 1 in app.js).

Dev/local builds are consistent too (index.html:551 `logic.js?v=5` and app.js:5 `./logic.js?v=5` are currently identical by hand). The remaining soft spot is human, not machine: the hand-written version in both places must be kept equal or CI fails — which is now the *intended* guard.

**Residual risk for a future split:** the STALE grep scans only `index.html app.js logic.js attachments.js qr-draw.js qrcode.js`. New `js/*.js` modules (Track A) are neither stamped nor scanned — see §4.

## 2. The `?t=` landmine — why the S2 win is inert until app.js:337 changes

Two different cache-busting systems coexist:

- **`?v=<sha>`** (deploy-time stamps): makes scripts/CSS *immutable and cacheable*; a new deploy produces a new URL. Correct design, now enforced by CI (§1).
- **`?t=<timestamp>`** (runtime): `app.js:337` fetches the board with `` fetch(`${API.current}?t=${Date.now()}`, { cache: 'no-store', … }) ``. A unique URL every millisecond can never match a cached entry, and `cache: 'no-store'` additionally forbids conditional requests. Together they mean **every page load downloads `data/current.json` in full — the 1.70 MB payload that is ~97% embedded document bodies and base64 images (app-js-split.plan.md §1).** The server config alone cannot fix this: the browser never sends a revalidating request.

**PR #27 already did the server half of S2:** `deploy/nginx-default.conf:113–125` now serves `location = /data/current.json` with `Cache-Control: no-cache` (ETag revalidation possible; a publish changes mtime+size so the ETag changes). But the fetch URL/cache mode defeats it: `?t=` produces a URL nginx has never seen, and `no-store` sends no `If-None-Match`. **Net state: the 1.70 MB refetch on every visit still happens, and the shipped `no-cache` header is inert.**

## 3. Recommended first slice — the minimal double-fetch/304 fix (one line, its own PR)

**Change `app.js:337` from:**

```js
const res = await fetch(`${API.current}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
```

**to:**

```js
const res = await fetch(API.current, { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
```

Two edits, one line: drop the `?t=` query (it busts the exact URL the ETag is keyed to) and use `cache: 'no-cache'` (always revalidate, 304 = 0 bytes). `API.current` (`data/current.json`) carries no query; the nginx `no-cache` header (already merged) does the rest.

**Why this slice first:** it is the smallest diff that realizes a measured plan item (S2, "Small, high payoff"), it is independently verifiable before/after with three curls (plan §5):

```bash
curl -so /dev/null -w '%{http_code} %{size_download}\n' https://dsct.dev/data/current.json           # 200, ~1.7 MB
curl -so /dev/null -w '%{http_code} %{size_download}\n' -H 'If-None-Match: <etag>' https://dsct.dev/data/current.json  # 304, 0
```

and in a browser waterfall: second load of `data/current.json` must be a 304. Offline fallback is unaffected (`class_tasks_published_cache` in localStorage, app.js:62) because the fetch behavior on failure is unchanged. Publish freshness is unaffected: nginx derives the ETag from mtime+size, which every publish changes.

**Regression risks for this slice:** (a) if a host or proxy strips ETags, `no-cache` degrades to a full 200 fetch each time — same as today, no worse; (b) `?t=` removal changes the request URL shape — nothing else references it (grep `API.current` returns exactly one site, app.js:337 inside `loadPublished`; the offline path reads the localStorage cache key instead — app.js:62, 344, 348 — and the only other `?t=` in the tree is a transfer *token*, app.js:3315, not a timestamp); (c) tests: `tests/logic.test.js` does not cover the fetch; verify with the curl check above post-deploy. **Not a regression risk:** stale board on 304 — that is exactly the semantics `no-cache` is for.

**Second slice candidate (owner-gated, index.html tag change):** S4 — defer `qrcode.js` (27 KB) + `qr-draw.js` (index.html:548–549 loads both on every visit; only the Transfer panel uses them, and app.js:3136 already guards `typeof window.drawTransferQR === 'function'`). Inject on first Transfer open.

**The big one stays gated (S1):** moving document bodies/base64 images out of the board payload into `uploads/` (infrastructure exists: `api/upload.php` + immutable `^/uploads/` alias) takes the payload from 1.70 MB to <20 KB. It changes the persisted format — PROJECT_HANDOFF §11 owner decision, plus a back-compat read path. Do not bundle with the §3 slice.

## 4. Module boundaries — what app.js and logic.js actually contain

Measured at `2222eb4`: **app.js 3,428 lines (`wc -l` — the file has no trailing newline, so an editor reports 3,429), logic.js 356**.

- **logic.js** — pure domain layer, importable under Node (17 unit tests): `Task` class, `dayDiff`/`todayDate`/date parsing, `sortTasks`, `sanitizeDoc`, NL quick-add parser, plus the audit's newer pure helpers `clampPopoverPosition` (logic.js:324) and `pageFromHash`, `statusChangeMessage` (logic.js, PR #26). Exports via ESM **and** `Object.assign(globalThis, logicAPI)` (logic.js:351) for the classic scripts. One caveat: `sanitizeDoc`/`Task.fromJSON` touch DOM *inside* functions — safe at import.
- **app.js** — everything else in one file: element-ref caches, ~100 top-level `addEventListener` registrations (order-sensitive in places), task CRUD + cards/board/list renderers, task dialog + doc editor + due picker, status popover, HTML5 DnD, calendar (two implementations), quick-add, announcements, admin draft/publish/history, transfer, tour, settings, theme, nav + hash routing, and all data loading (`loadPublished`, app.js:337). Zero automated coverage.
- **attachments.js / qrcode.js / qr-draw.js** — classic-script helpers (upload flow, QR). The QR pair is eager-loaded but transfer-only.

**Coupling that shapes any split** (phase5 plan §3, still accurate at this baseline): the ESM binding problem — `isAdmin`, `progress`, `previewing`, `announcements`, `currentTask`, `changedIds`, `justChangedId`, `staggerNext`, `publishedTasks`, `publishedAnnouncements` are module-level variables **reassigned** from multiple regions; a naive extraction throws `Assignment to constant variable`. The mandated mechanism is a single exported mutable `state` object (`js/state.js`) with every site becoming `state.x = …`, and no `state.*` read at module-eval time (`isAdmin` is `false` until `start()`'s `await checkAdmin()` resolves, app.js:3420). Six parse-time side effects must move into `init()` if relocated (phase5 §3.2), and the due-picker's `Escape` handler uses capture+`stopPropagation` (app.js:2390 — `, true)` at 2396) so cross-module listener re-registration can silently invert overlay layering.

**Realistic incremental split plan** (Track A layering from app-js-split.plan.md §3, with phase5's corrections — `toast` is not a leaf; `admin.js` absorbs the publish↔announcements cycle):

1. **A1** `js/state.js`, `js/dom.js`, `js/util.js` skeleton (one PR; no behavior moves yet).
2. **A2** leaves in waves, one file per PR, each deployable: `js/calendar.js`, `js/quick-add.js`, `js/tour.js`, `js/settings.js`, `js/nav.js`, then `js/announcements.js`+`js/publish.js` (merged as admin), `js/transfer.js`.
3. **A3** `js/tasks.js` last — it holds the hub functions (`showToast`, `renderAllTasks` with 11 call sites, `saveTasks`, `setStatus`) and must come after the leaves it supports.
4. **A4** ADR + docs.

**Required CI change before A1 merges** (phase5 §7 — the sharpest constraint): extend the stamper sed to stamp `./js/*.js` imports, add `js/*.js` to the STALE grep file list, and replace the fixed `test "$(grep -c "?v=$V" app.js)" = "1"` count with "every `?v=` in app.js equals $V". Otherwise a new module's `?v=` survives to production unstamped — the exact double-fetch/stale-module landmine from §1, silently. Alternative (smaller, needs the nginx owner gate): import modules without `?v=` and serve `js/` with `no-cache` + ETag like `current.json`.

## 5. Regression risks for any split (consolidated)

| Risk | Severity | Mitigation |
|---|---|---|
| Zero app.js test coverage; **JS tests only run on push to main, not PRs** (`main_tasktracker.yml:41` build job; PR-triggered workflows run PHP/nginx only) — a failing new test file passes review and fails post-merge, blocking the deploy job | High | Add `node --test tests/*.test.js` to a PR-triggered workflow **before** A1; browser QA checklist per wave |
| ESM reassignment `TypeError`s (§4 list) | High | `state` object from day one; no partial migrations |
| Listener-order inversions (Escape capture chain, document-delegated popover/subject handlers) | Medium | Move registration blocks verbatim, in source order; QA every overlay's Escape |
| Parse-time side effects relocated (6 effects, phase5 §3.2) | Medium | Explicit init() checklist in the A1 PR description |
| `?v=` stamping of new modules (§4) | Medium | CI workflow change in the same PR as the first module |
| `globalThis` name collisions (logicAPI spray) | Low | New modules import, never read bare globals |
| Track A does **not** improve load speed (adds module round trips on HTTP/1.1; app.js is 7% of the cold load) | — | Do not sell the split as a perf fix; perf lives in §3's slice + S1/S3 |

## 6. What was checked and what was not

- Verified in source: stamper sed + STALE assertion (`.github/workflows/main_tasktracker.yml:43-57`), nginx `no-cache` location (`deploy/nginx-default.conf:113-127`), gzip in server context (`deploy/nginx-default.conf:45-56`, post-incident placement per the in-file comment), `?t=`/`no-store` fetch (`app.js:337`), import/stamp parity at rest (`app.js:5` vs `index.html:551`). Every citation above was re-read line-exact on 2026-11-01 against this worktree; the ones that moved are named there (`113–125`, `548–549`, `3136`, `2390`, `3420`).
- Not verifiable from here (static-only): whether the current nginx conf is actually the one running on the host (the 2026-10-31 duplicate-gzip incident showed startup can reject configs), and whether live dsct.dev now 304s. The post-deploy curls in §3 are the check.
- Not re-measured: the waterfall numbers (t≈722 second fetch, 1.70 MB payload) are quoted from the v3 plan's 2026-10-29 measurement; the payload composition has not changed since (no S1 work merged).
