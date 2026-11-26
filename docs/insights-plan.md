# Local Insights & Reminders Plan (V1) and S1b Deferral

**Status.** Approved architecture plan (2026-11-26) implementing [ADR 0009](adr/0009-local-insights-and-s1b-deferral.md). Plan only — PR 1 documents the design; PRs 2–3 implement V1 incrementally; PR 4 requires separate approval.

## Scope Boundaries

| Track | Scope | Features |
| --- | --- | --- |
| **Essential V1** | PRs 1–3 | Deterministic workload clustering, overdue/due-soon reminders, subject breakdown; **Variant A** UI (`#mine` Insights button → `#insights-overlay`); max 1 non-duplicate calm cue per open task row/card; three separate privacy controls (`Show Insights`, `Local activity history` opt-in, `Clear activity history`); section-scoped opt-in activity key surfacing a factual history summary only; S1b reassessment triggers recorded in docs. |
| **Separately Approved Candidate** | PR 4 (gated) | Experimental `hybrid_burst_downweight` predictor, opt-in shadow evaluation, adaptive beta toggle, and any validated gating rules. **No automatic model promotion is approved.** Requires separate owner review and approval before starting. |
| **Future Enhancements** | V2+ (deferred) | Static RFC 5545 `.ics` subscription feed; adaptive nudge-timing bandit (requires empirical proof over fixed `24h`); optional V2 diagnostic JSON export; S1b `data/bodies/` migration (subject to reassessment trigger and separate owner approval); browser LLMs / external AI APIs (out of scope per ADR 0004). |

## Evidence Classification

- **Measured results:** Live `https://dsct.dev/data/current.json` (`8,839` bytes raw, `3,373` bytes gzip-6, `27` tasks, `10` subjects, max note `796` bytes, `0` base64 URIs); `300 × 10 KB` S1b payload with `2,048 B` excerpts reaching `684.91 KB` (`701,348` bytes > `700,000` byte transfer cap); `8/8` storage fault-probe assertions against real `js/util.js`, `js/recovery.js`, `js/transfer.js`, and `js/settings.js`; `320x568` prototype Variant A first task row at `288–367px` above `502px` bottom bar (`44px` minimum tap targets, zero horizontal overflow).
- **Projected implementation budgets:** V1 plain-JS footprint `< 3 KB` source; `1`-year activity store (`150` tasks) `17,444` bytes raw (`3,382` bytes gzip-6); `2`-year combined `progress` + `activity` (`300` tasks) `50,145` bytes (`0.956%` of `5 MB` `localStorage` quota).
- **Synthetic evidence (preliminary only):** `40`-seed × `6`-archetype held-out simulation (`120` tasks/seed, `0` leakage violations) establishing that catch-up burst filtering + `0.35` down-weighting repairs `weekly_batch_cleaner` (`0.3495` → `0.1329` Brier), while deterministic `heuristic` (`0.2389`) still outperforms all learned variants on `sparse_noisy_logger` (`0.2479`/`0.2487`) and shadow gating at `nClean >= 15, t >= 0.5` falsely promotes on `97.5%` of `sparse_noisy_logger` runs. Not proof of real-student efficacy.
- **Unverified assumptions:** Actual student tapping frequency on `dsct.dev`, whether stricter candidate gates (`nClean >= 30`, `missingInProgressOverdueRate <= 0.25`, `tStat >= 1.65`) eliminate false promotions in practice, and future term task growth.

## Dependency-Ordered Slice Plan & Stacked PR Structure

1. **PR 1 (`docs/insights-adr-and-s1b-deferral` → `main`):**
   - `docs/adr/0009-local-insights-and-s1b-deferral.md`, `docs/insights-plan.md`, `docs/adr/README.md`, `docs/owner-briefs.md`, `README.md`.
   - Docs only; zero JS/HTML/CSS/PHP changes.
2. **PR 2 (`feat/insights-core-and-storage` → PR 1):**
   - `js/insights.js` (new pure module, respecting `d6-module-boundary` — no top-level DOM access or `?v=` imports):
     - `analyzeWorkload(tasks, progress, nowMs)` → clusters (`>= 2` open tasks within `48h`), due-soon count, overdue count, subject load breakdown.
     - `explainTaskIndicator(task, workload, existingPillText)` → returns **at most one** calm cue (`2 due Dec 2` or `Due soon`) and suppresses any cue that duplicates existing deadline pill wording (e.g. does not repeat `Due soon` or `Today` when the pill already says `Today` / `Tomorrow`).
     - `summarizeActivityHistory(activity, nowSec)` → factual counts (`trackedTasks`, `completedCount`, `inProgressCount`, `reopenCount`, `lastCheckInSec`) for opted-in students; zero predictive scoring.
   - `js/util.js`: add `insightsPrefs` (`sectionKey('class_tasks_insights_prefs', sec)`) and `activity` (`sectionKey('class_tasks_activity', sec)`) to `keysForSection()`.
   - `js/recovery.js` + `js/store.js`: add `filterDeletedActivity(activity, deletedIds)` and invoke it inside `applyDeletionAuthority()`.
   - `js/settings.js`: add `insightsPrefs` to `resetSectionStorage()`'s preserved `keep` set (so `Reset my progress` clears `progress` and `activity` while keeping the student's opt-in/opt-out and visibility choices); add safe read/write/prune helpers and `clearActivityHistory()` / immediate purge on opt-out.
   - `tests/insights.test.js`, `tests/multi-section.test.js`, `tests/recovery.test.js`.
   - Zero `index.html`, `styles.css`, `api/*`, `transfer.php`, or golden changes.
3. **PR 3 (`feat/insights-ui-and-settings` → PR 2):**
   - `index.html`, `styles.css`, `js/dom.js`, `js/tasks.js`, `js/settings.js`, `app.js`:
     - Add Variant A entry button (`#mine-insights-btn`, `44px`) inside `#mine` and `#insights-overlay` modal sheet (focus trap, Escape/backdrop close, `motion.js` lifecycle).
     - Render at most one subtle, non-duplicate cue chip on qualifying open `.task-row` / `.task-card` elements (hidden when `showInsights === false`).
     - Add three separate controls in `#settings-overlay`:
       1. `Show Insights` toggle (`showInsights`, preserves stored history).
       2. `Record local activity history` opt-in toggle (`activityOptIn`, defaults `false`; turning off **immediately deletes** `class_tasks_activity`).
       3. `Clear activity history` action button (with inline confirmation; removes `class_tasks_activity` without altering `showInsights`).
     - Hook `js/tasks.js:setStatus()` to call `recordActivityTransition()` **only** when `prefs.activityOptIn === true`.
     - Regenerate goldens cleanly (`node tests/e2e/capture.mjs --update`, checking `git diff --numstat`) and extend `tests/e2e/ui-behaviors.mjs` with Variant A fold, three-control privacy lifecycle, zero-network-leakage, and disabled-storage fallback checks.
4. **PR 4 (`feat/insights-hybrid-candidate`, separately gated future work):**
   - Not started without explicit owner approval after V1 review.
   - Would add `hybrid_burst_downweight`, opt-in shadow evaluation, and adaptive beta toggle strictly behind validated safety gates (no automatic model promotion).

## Acceptance Criteria and Verification Requirements

| PR | Acceptance criteria | Verification commands |
| --- | --- | --- |
| **PR 1** | ADR 0009 + plan match owner amendments; zero code/runtime changes. | `npm run lint` · `npm test` |
| **PR 2** | Pure functions pass deterministic and edge-case tests; `activityOptIn === false` writes `0` bytes; toggling opt-out deletes `activity`; `resetSectionStorage()` clears `activity` and keeps `insightsPrefs`; `filterDeletedActivity()` removes deleted IDs; `SecurityError`/`QuotaExceededError`/corrupt JSON/bad schema never throw; `transfer.php` payload excludes `activity` and `insightsPrefs`; `d6-module-boundary` lint clean. | `npm run lint` · `npm test` · `/opt/lampp/bin/php tests/php/run.php` |
| **PR 3** | Variant A keeps `320x568` first `.task-row` at `<= 504px` fold (`0` horizontal overflow across `320/375/640/720/768/1280`); all interactive controls `>= 44px`; light/dark 20-token contrast passes; max 1 cue per open task without duplicating deadline pills; all 3 privacy controls behave independently; `0` student activity/pref bytes transmitted on network; updated goldens match `check.mjs`. | `npm run lint` · `npm test` · `npm run audit` · `node tests/e2e/label-in-name.mjs` · `node tests/e2e/design-lint.mjs` · `node tests/e2e/check.mjs` (harness host) · `/opt/lampp/bin/php tests/php/run.php` |

## Privacy and Data Lifecycle Specification

- **Keys (section-scoped via `sectionKey()`):**
  - `class_tasks_insights_prefs` (`b_class_tasks_insights_prefs` in Section B): `{ v: 1, showInsights: true, activityOptIn: false }`. Never cleared by `Reset my progress`. Never transferred.
  - `class_tasks_activity` (`b_class_tasks_activity`): `{ v: 1, tasks: { [id]: { s, d, r, e: [[code, tsSec], ...], lastSec } } }`, capped at `8` transitions/task and `400` tasks (pruning oldest `lastSec` first). Created **only** when `activityOptIn === true`. Cleared immediately on opt-out, via `Clear activity history`, and via `Reset my progress`. Deleted task IDs removed by `filterDeletedActivity()`. Excluded from `transfer.php` in V1.
- **Degradation rules:**
  - `SecurityError` (private browsing / blocked storage): deterministic V1 runs in memory from `current.json` + `state.progress`; Settings opt-in control disables cleanly with storage-unavailable message.
  - `QuotaExceededError`: prune oldest `50%` of `activity.tasks` and retry once without touching `KEYS.progress`; if still full, suspend activity writes cleanly.
  - Corrupt JSON or unsupported `v`: reset to safe default (`activityOptIn: false`), never breaking app boot.

## Mobile-First UI Specification (Variant A)

- **Closed state (`320x568`):** `#mine` places a `44px` `Insights` button on the right edge (`min-width: 44px`, `2px solid var(--ln)`). Zero rows added above `#class-task-list`, preserving `288px` first-row top clearance above the `502px` bottom navigation bar. Hidden completely when `showInsights === false`.
- **Open state (`#insights-overlay`):** Reuses `.task-dialog-overlay` (`motion.js` open/close, Escape/backdrop dismiss, focus restoration). Contains:
  1. **Workload notices** (deterministic V1): clustered deadline alerts and upcoming unstarted reminder counts in plain language.
  2. **Your activity summary** (when `activityOptIn === true`): factual counts from `class_tasks_activity` (tracked check-ins, completed count, last check-in time), or a single quiet Settings link when opted out.
  3. **Footer:** `"Saved on this device only"` + `44px` `Settings` shortcut button.
- **Task row/card indicator rules:** Max `1` chip on open (`status !== 'done'`, not past) rows/cards inside `.task-meta`. Suppressed whenever `showInsights === false` or when the deadline pill already conveys the same urgency (e.g., `Today` tasks do not add `Due soon`; clustered tasks show `2 due Dec 2`).

## Rollout and Rollback Strategy

- **V1 Rollout:** Ship PR 1 (docs) → PR 2 (core + storage) → PR 3 (UI + settings) behind code review and full CI/browser gates. Activity history starts opted out for all users.
- **No automatic promotion:** PR 4 remains separate future work; even if PR 4 is later approved, no silent or automatic promotion of adaptive predictions is authorized without fresh evidence and explicit owner sign-off.
- **Rollback:** Disabling `showInsights` defaults or reverting PR 3 removes all UI elements on reload (`Cache-Control: no-cache` on `js/*.js`) with zero impact on `KEYS.progress` or `data/current.json`.

## Future PR 4 Technical Context (Not in V1)

If PR 4 is later authorized:
- **Model candidate:** `hybrid_burst_downweight` blends the deterministic heuristic baseline (`8 / (n + 8)`) into Beta-Binomial Empirical Bayes shrinkage (global prior `(2, 6)`, subject and concurrency-tier shrinkage `m = 4`) plus `3` L2-regularized recency-decayed logistic weights (`concurrent72h`, `hasTime`, `leadDays`).
- **Imperfect proxy handling:** Recorded `doneAt` timestamps are treated as proxies for true completion. Overdue Done taps occurring within `120s` of another overdue Done tap (`isBurst`) are excluded from training updates; overdue taps without prior `in_progress` are down-weighted (`0.35`).
- **Unvalidated hypotheses requiring real validation before any PR 4 ship:** Whether `nClean >= 30`, `burstRate <= 0.30`, `missingInProgressOverdueRate <= 0.25`, and one-sided paired `tStat >= 1.65` protect sparse/inconsistent tappers (`sparse_noisy_logger`) without relying on noisy self-evaluation.

## S1b Board Storage Reassessment Protocol

S1b (`data/bodies/<sha256>.json`) stays deferred while `current.json` remains small (`8,839` bytes raw / `3,373` bytes gzip-6 live). Trigger **architectural reassessment** (requiring separate owner approval before any migration) if any threshold is met:
- Live `current.json >= 150 KB` raw or `>= 40 KB` gzip level `6`, or
- Any admin draft `>= 350 KB` (`50%` of `MAX_DRAFT_TRANSFER_BYTES`), or
- Any single active task note `> 8 KB`.

Any future S1b design must satisfy preconditions F1 (tombstone explicit delete marker), F2 (`.publish.lock` atomic migration), and F3 (`^[a-f0-9]{64}$` validation) in [owner-briefs.md](owner-briefs.md), and cap inline excerpts at **`512 B`** rather than `2,048 B` so `300`-task drafts remain safely under `transfer.php`'s `700,000 B` cap.
