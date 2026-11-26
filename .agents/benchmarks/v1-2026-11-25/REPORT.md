# TaskTracker Orchestration V1 — Empirical Benchmark Report (2026-11-25)

**Status:** Completion gate for Orchestration V1 (calibrated 2026-11-26). Further changes should be driven by real development experience rather than additional synthetic benchmarks.

**Baseline commit tested:** `feat/agent-orchestration` @ `8e26319` (branched off `main` @ `aa7d7bf`). All runs executed in isolated sandbox branches/worktrees; `main`, live `data/`, and production (`https://dsct.dev`) were never touched.

> **Archival patches preserved in this directory (`patches/`):**
> - `patches/fast.patch` — Tier 1 `.dp-grid` ARIA + 44px `.dp-day` diff
> - `patches/std-orch.patch`, `patches/std-orch-schedule.js.txt`, `patches/std-orch-schedule.test.js.txt` — Tier 2 Calendar `Schedule` UI slice (archived only; NOT promoted to runtime)
> - `patches/deep-base.patch` — Tier 3 single-agent baseline diff
> - `patches/deep-orch.patch` — Tier 3 post-correction-loop diff (archived only; NOT promoted to runtime)

---

## 1. Side-by-Side Results (Measured Values Only)

| Dimension | Tier 1: **FAST** (`.dp-grid` ARIA + `44px` `.dp-day`) | Tier 2: **STANDARD** (`docs/timetable-plan.md` Slice 1: Calendar `Schedule` UI) | Tier 3: **DEEP** (`docs/timetable-plan.md` Slice 2: `schedule` PHP validation + publish/diff/sync) |
| :--- | :--- | :--- | :--- |
| **Baseline (Single-Agent)** | **4.78s** verify (`lint` + `177/177` Node); 2 files (`app.js`, `styles.css`); skipped `label-in-name` & browser check. | **~10m 20s** (`std-base` in `Workspace="share"`); touched 6 files (unnecessarily edited `app.js`, `js/state.js`, `js/store.js`); hit shell prompt timeout on self-test; **shipped syntax crash** (`lint` FAIL: `Identifier 'emptyEl' has already been declared` in `js/calendar.js`). | **10m 12s** (`deep-base` in `Workspace="share"`); 6 files; hit shell prompt timeout; external eval passed `lint`, `179/179` Node, PHP suite, `2/2` `REQUIRE_PHP=1` replay, Docker TLC (`155,917` states, 0 errors) — **yet shipped 5 real `P1` sandbox defects** undetected by automated tests. |
| **Orchestrated** | **4.98s** verify (**+0.20s** overhead); `classify-task.mjs` flagged `app.js`+`aria` as `STANDARD` (overridden to `FAST`), 0 subagents; `verify-matrix` ran `lint` + `177/177` Node + `label-in-name` (`3/3` PASS); independent Playwright audit **146/146 PASS**. | Read-only Planner reduced scope to **5 files** (zero edits to `js/store.js`/`js/state.js`/`app.js`), avoiding `emptyEl` & `module-state.test.js` traps; `verify-matrix --mode standard` passed **7/7** (`lint` 0.41s, `180/180` Node 2.89s, `label-in-name` 0.05s, Playwright **146/146** 41.98s, Firefox `class-board` 8.40s + `task-dialog-and-theme` 5.42s + `calendar` 8.08s); cross-provider Codex review (`gpt-6.1-terra`, `medium`) ran in **1m 07s** + **47s** across 2 fix cycles. | Cross-provider Codex review (`gpt-6.1-terra`, `high`) ran in **1m 54s** → Cycle 1 fix (**4m 52s**) + `verify-matrix --mode deep` **6/6 PASS** (17.98s incl. Docker TLC + `REQUIRE_PHP=1` replay) → Cycle 2 re-review (**1m 50s**) → Cycle 2 fix (**2m 36s**) + **6/6 PASS** (17.95s) → Cycle 3 re-review (**56s**) → 2-line Cycle 3 fix + `181/181` Node PASS. |
| **Sandbox Defects Caught** | Flagged `STANDARD` risk on `app.js` + `aria`; auto-ran `label-in-name.mjs`. | **5 `P1`s + 2 `P2`s:** offline cached schedule lost when `liveBoard === null`; 60s timer leaked on page leave; `window` vs non-bubbling `document` `app:page-shown` listener; keyboard focus wiped on re-render; `<44px` phone day pills; month pixel font bleed; `.9` opacity AA contrast risk. | **7 `P1`s across 3 cycles:** (1) pre-feature clients silently deleting live schedule on omitted key, (2) cross-deploy retry `$bodyHash` `409` break, (3) `clearBoard` dangling subject reference, (4) stale `state.liveBoard` after publish, (5) missing `draftSchedule` persistence/restore, (6) legacy draft `null` vs `undefined` erasure, (7) legacy local checkpoint (`at`) vs published history (`publishedAt`) erasure. |
| **Human Interventions** | 0 (override optional). | 1 (mode confirmation). | 2 (mode confirmation + DEEP plan approval gate). |
| **Models Exercised** | Antigravity `gemini-4-neon` (0 subagents). | Antigravity `gemini-4-neon` + Codex `gpt-6.1-terra` (`medium`). *(Zero banned models.)* | Antigravity `gemini-4-neon` + Codex `gpt-6.1-terra` (`high`). *(Zero banned models.)* |

**Note on Reviewer Model Change (2026-11-26):** `gpt-6.1-terra` was the cross-provider Codex reviewer model validated during these 2026-11-25 runs. Per owner directive on 2026-11-26, reviewer selection is configurable (`TT_REVIEWER_MODEL` / `--reviewer-model`), and the active default is set to **`gpt-6.2-astra`** (`gpt-6.1-terra`, `gpt-6.2-sol`, and all other Codex models are disabled unless explicitly prompted; `claude-opus-5-5*` and `claude-sonnet-5-5*` remain permanently banned).

---

## 2. Empirical Runtime Constraints Discovered & Calibrated

1. **Antigravity `run_workflow` (`orchestrate.py`) under T3 Code ACP:** Child agents stalled (>10m) on unprompted tool approvals. **Calibration:** Mark `orchestrate.py` non-ACP/IDE-only; do not invoke it inside T3 Code ACP headless runs.
2. **Background `invoke_subagent` permissions:**
   - Manual `/tmp/` worktrees hit read/write permission timeouts (60s).
   - `Workspace="inherit"` works cleanly for **read-only** planning/research, but times out on file writes.
   - `Workspace="share"` works cleanly for **file read/write** in isolated worktrees, but times out on `run_command`.
   - **Calibration:** Keep Planners read-only (`Workspace="inherit"`), Engineers shell-free (`Workspace="share"` or inline), and run all shell verification from the **parent Orchestrator**.
3. **Parallel browser contention:** Running Playwright `audit.mjs` concurrently with heavy parallel workers/Firefox caused transient CDP `Inspected target navigated or closed` failures; sequential parent-run execution passed **146/146** Chromium and **3/3** Firefox journeys cleanly.
4. **Final-edit verification & hard `P1` gate:** In Cycle 3 of Tier 3 and Cycle 2 of Tier 2, the final 1–2 line fix was checked with `lint` + `npm test` rather than re-running the full tier matrix + a fresh final `APPROVE` re-review. **Calibration:** V1 now explicitly requires **complete tier-appropriate verification after the final code modification**, and **blocks approval** if the review-cycle budget is exhausted with any unresolved `P0` or `P1`.

---

## 3. Explicit Methodological Limitations

- **Unmeasured Costs:** Neither Antigravity nor T3 Code exposed exact per-subagent input/output token counts or billing/quota deltas for these runs. Token efficiency and cost-per-defect are **unmeasured / inconclusive**.
- **Limited Sample Size:** Only 3 tasks (1 per tier) were tested in a single session on one codebase (`TaskTracker`). Results demonstrate concrete runtime behavior and high-signal defect detection on these slices, but do **not** establish statistical guarantees across all future work.
- **Sandbox Defects vs. Production Incidents:** Every defect listed above was a **sandbox defect** caught in isolated throwaway worktrees during experimental implementation of unshipped backlog features (`docs/timetable-plan.md`). **Zero production incidents** occurred; `main`, `https://dsct.dev`, and live student/section data were unaffected.
- **Evidence Tier:** All automated verification entries are `[agent-test]` (never `[live-test]`). Real mobile Safari ergonomics, Azure restart persistence, and uncoached classmate usability remain outside automated coverage.
