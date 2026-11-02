# TaskTracker UX Redesign — Implementation Handoff

**Branch:** `feat/ux-redesign` · **Worktree:** `C:\xampp\htdocs\TT-wt-ux` · **Served at:** `http://localhost/TT-wt-ux/`
**State:** implemented, verified, **uncommitted** (4 modified files, +220 / −129). Nothing pushed, merged or deployed.

## 0. Current state (updated 2026-11-01)

- The redesign is **still uncommitted** on `feat/ux-redesign` in `TT-wt-ux` (re-verified: 4 modified files, unchanged since this handoff was written). Treat the worktree contents as the only copy of the redesign work — commit it before doing anything else in that worktree.
- **The branch is close to current `main`.** Its base is `cb16f46` (post-PR #27); `main` has since added only PRs #28/#29, which touch `deploy/`/nginx and startup — no app-code overlap. Rebase or re-merge onto `main` (`2222eb4`) is low-conflict for the four redesign files.
- **`main` has already absorbed the audit's P0 fixes** (popover viewport clamp, deep links, reopen toast + Undo, dialog focus restore — see `UX_AUDIT_REPORT.md` §0). The redesign does not need to carry them, and its verification harness (`matrix.js`/`audit.js`) will now be running against app code that already includes them.
- **New constraint since the redesign was built: a strict CSP** (PR #27). `script-src 'self'` plus two fixed `sha256` hashes; `style-src 'self' 'unsafe-inline'`. Any index.html change that adds an **inline script** will be blocked in production; inline **styles** remain allowed. The redesign's index.html additions (fonts, status switchers, tab bar) are markup only — safe — but re-verify before merging, because the CSP hashes live in `deploy/nginx-default.conf` and are content-pinned: **if index.html's inline script blocks change, the hashes must be regenerated.**
- **Known gap #3 below is superseded:** the CI stamper (extended in PR #27) now stamps `styles.css` at deploy time alongside the other four assets, asserts no stale `?v=` anywhere, and also stamps app.js's internal `./logic.js` import. The unversioned `styles.css` link at index.html:32 is now a dev-only cosmetic inconsistency, not a caching landmine.

### Next actionable design work (small, in order)

1. **Commit the redesign** in `TT-wt-ux` as-is (it is verified; leaving it uncommitted is the single biggest risk to it).
2. **Fold in the remaining audit P1/P2 items on the surfaces the redesign already touches:** C1 (desktop calendar cells keyboard-accessible — the redesign reworked calendar styling, so the parity fix belongs with it), the C3 remainder (popover `aria-selected`/trigger `aria-expanded`), and C4 (live region on search results). None are redesigns; each is small (see `UX_AUDIT_REPORT.md` §0 acceptance criteria).
3. **Re-run the verification matrix** (`tt-redesign/matrix.js` → `audit.js`, §5) after rebase + the C1/C3/C4 fold-ins, before any merge.
4. **Deferred by design (do not build now):** the two items §4 gaps 1–2 (expandable announcement bar, completion choreography) — still backlog, still need the owner's call.

---

## 1. Recovery findings

The redesign had been started in the **main security checkout** (`C:\xampp\htdocs\TaskTracker`, branch
`fix/security-remediation-phase0-3`, PR #27 open) instead of a branch of its own. Work was relocated to the
dedicated worktree `TT-wt-ux` on `feat/ux-redesign`; the security checkout was left untouched.

DeepSeek's original handoff artifacts remain in `%TEMP%\tt-redesign\`
(`AGENT-CONTEXT.md`, `PLAN.md`, `brief.txt`, `handoff.txt`, mockup + token dumps, Playwright harness).
All were preserved; nothing was reset, cleaned or discarded.

---

## 2. What changed

| File | +/− | Summary |
|---|---|---|
| `styles.css` | +212 / −129 | Light-palette fix, one content column, urgency tiers, pixel type, phone shell |
| `index.html` | +56 / −24 | Fonts, status switchers, tab bar, theme-color, "Done" glossary, asset stamps |
| `logic.js` | +30 | `subjectDisplay` / `SUBJECT_ALIASES`, `getUrgencyTier()`, `getDuePill()` |
| `app.js` | +51 / −20 | Tiered badges + rows, canonical subjects, nav matching, status-switch wiring |

### 2.1 The highest-value fix: the light palette was dead code

`styles.css` carried a `:root[data-theme="light"]` block (specificity 0,1,1) that **outranked base `:root`**
(0,1,0). Every light load rendered the *old* cool-grey design; the redesign's warm-cream tokens never applied.
Every token it declared was verified present in base `:root`, then the block and four stale soft-shadow
overrides were deleted. Light now renders `#FBF8F1` warm cream — confirmed in the screenshots.
`grep 'data-theme="light"' styles.css` → no matches (only the `[data-theme="light"]` *selectors* used elsewhere remain).

### 2.2 File line anchors

**`styles.css`**
- `:62` `--content-w: 1080px` — single content column
- `:120` pixel display type (`.brand-name`, `.header-title`, `.column-header h2`, `.column-count`)
- `:153` phone-only chrome base-hide (`.tabbar`, `.status-switch`)
- `:157` `.page-container { width: min(95%, var(--content-w)) }`; the three per-page max-width rules were deleted
- `:293` `.subject-tag` — `text-transform: uppercase`
- `:305` due-badge urgency tiers (`.hot` solid, `.warm` outlined + inset ring, `.quiet` plain)
- `:591` ≤720px block: bottom tab bar, `main-content` bottom padding, toast lift, status switcher, one-column board
- `:652` radius system — soft 6px on controls, sharp 0 on lists/segments/grid

**`index.html`**
- `:15` / `:23` `theme-color` → `#14131A` dark / `#FBF8F1` light
- `:18` fonts: Inter + Press Start 2P (IBM Plex Sans dropped; IBM Plex Mono kept)
- `:172`, `:243` `.status-switch` before each board; boards carry `data-status-filter`
- `:311` toast gained `role="status" aria-live="polite"`
- `:318` `.tabbar` phone nav (Tasks / Done / Past / Calendar)
- `:581-582` `logic.js?v=6`, `app.js?v=4` — **must stay in lockstep with app.js's import specifier**

**`logic.js`**
- `:20-23` `SUBJECT_ALIASES` + `subjectDisplay()` — canonical uppercase; `FINMATH101` → `FINMATH`
- `:200` `getUrgencyTier()` — hot ≤2d, warm 3–7d, quiet >7d; empty for done/past/undated
- `:209` `getDuePill()` — overdue reads "Past due"
- `:374`, `:381` exported via both `logicAPI` and `export {}`

**`app.js`**
- `:5` imports `subjectDisplay`
- `:543` card due badge tiered; `:1529` row due tiered
- `:1587` `createSubjectTag` canonicalises the code
- `:2463` status-switcher wiring (inert on desktop — CSS keeps it hidden)
- `:2478` `NAV_PAGES` de-duplicated so sidebar **and** tab bar both light up

---

## 3. Verification

Harness: `tt-redesign/matrix.js` → `audit.js`, 20 entries (5 views × 2 widths × 2 themes), Playwright chromium,
API-mocked, localStorage-seeded. Fixtures are date-anchored at run time so urgency tiers never expire.

### 3.1 Machine-checked results — before vs. after, identical tooling

```
                                  BEFORE (main)      AFTER (worktree)
390px  class-tasks  small            1                0
       done                          2                0
       past                          2                0
       calendar                      0                0
       my-tasks                      5                0
       TOTAL                        10                0
1280px class-tasks  small           21               21
       done                         11               11
       past                         11               11
       calendar                     15               15
       my-tasks                     20               20
       TOTAL                        78               78
```

`hOverflow`, `clipped`, `offscreen`, `contrast` = **0 on all 20 entries, both runs, both themes.**
`console: []`, `pageErrors: []`, `failedRequests: []` on all 20.

Reports: `shots/wt-before2/report.json`, `shots/wt-after2/report.json`.

### 3.2 Honest reading of those numbers

- **Mobile 44×44 is now fully clean (10 → 0).** The earlier 23 "violations" were a measurement artifact:
  `.status-check` is 16×16 visually but its `::after { inset: -14px }` hit area is 44×44, and
  `getBoundingClientRect()` under-reports it. `audit.js` now reads the pseudo-element and measures the real
  hit box (`hitBox()`). The fix only ever *lowers* a count.
- **Desktop is unchanged by design.** The 44px rules live only inside the ≤720px block. Desktop small targets
  are pre-existing conventional sizes: sidebar toggle 32×32, icon buttons 36×36, search `label` 230×36,
  view tabs 64×34, primary/secondary 36px tall.
- **One genuine pre-existing AA nit:** `.admin-bar .text-button` ("Preview as student", "History",
  "Discard changes") measures **129×21**, under WCAG 2.2 AA SC 2.5.8 (24×24), and its neighbours sit close
  enough that the spacing exception likely fails too. Admin-only, desktop-only, not introduced here.

### 3.3 Visual QA — inspected, not assumed

Screenshots read directly (both themes, 390 and 1280). Confirmed:

- `wt-after/wtafter-class-tasks-1280-light.png` — warm cream canvas; pixel font on wordmark, "Class tasks",
  column heads and `(7)` counts; HOT solid pills ("Due today · 5:00 PM", "Due tomorrow · 11:59 PM",
  "In 2 days", "Past due"); WARM outlined pills ("In 3 days"/"In 4 days"/"In 7 days"); QUIET plain muted;
  UPPERCASE subjects with **FINMATH101 rendering as FINMATH**; nav "Done"/"Past tasks"; column head "Done".
- `wt-after/wtafter-class-tasks-390-light.png` — status switcher (To Do active) with only that column shown;
  bottom tab bar with Tasks active.
- `wt-after/wtafter-calendar-1280-light.png` — pixel weekday heads and day numbers; square grid; sharp
  Month/Week segment; soft "Today" button; chips ellipsised by design.
- `wt-after/wtafter-my-tasks-1280-light.png` — pixel "Admin"; HOT "In 2 days" pill; UPPERCASE EFFCOM/GENMATH;
  Save outline + Apply solid.
- `wt-after/wtafter-done-390-light.png`, `wtafter-past-390-light.png` — pixel H1s, "Expired"/"Closed" neutral
  labels, "Mark done" text buttons, active tab underline.
- `wt-before/wtbefore-class-tasks-1280-light.png` — the old design for contrast: cool grey/blue palette,
  "Completed tasks", "Submitted / Done", lowercase `genmath`/`FINMATH101`, uniform amber pills, sans headings.

### 3.4 Confirmed already implemented (no work needed)

- Pixel check-stamp on completion: `app.js:1663` `is-popping` + `check-pop`/`check-draw` keyframes.
- Calendar `+N` overflow: `.cal-more`, `app.js:1370`.
- Tappable calendar cells on phone (`calPhone`, `app.js:1206`).
- Pinned announcement bar, offline/`data/current.json` loading, reduced-motion handling.

---

## 4. Known gaps

1. **Pinned announcement** is still a full box, not the brief's one-line expandable bar.
2. **Completion-reward choreography** (card sliding toward Done, count ticking, "Done for today") not built.
3. **`styles.css` is linked unversioned** (`index.html:32`) while both JS files carry `?v=`. Adding a stamp
   would change the `?v=` count a CI guard checks — flagged, not changed.
4. `.admin-bar .text-button` 21px tall — see §3.2.
5. `audit.js` applies the AAA 44×44 test on desktop too, where AA 24×24 is the operative bar; desktop counts
   therefore read higher than the standard requires.

## 5. To resume

```bash
cd C:/xampp/htdocs/TT-wt-ux && git status --short
```

```bash
cd "$TEMP/tt-redesign" && TT_APP="http://localhost/TT-wt-ux/" TT_OUT="$TEMP/tt-redesign/shots/wt-after2" TT_TAG="wtafter" node matrix.js
```

**Do not commit, push, merge or deploy from this worktree without the owner's say-so.**