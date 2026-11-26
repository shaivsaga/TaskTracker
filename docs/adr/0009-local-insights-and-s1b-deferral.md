# 9. Local insights, reminders, and S1b deferral

**Status.** Accepted (plan only — deterministic Insights V1 and S1b deferral approved 2026-11-26; PR 4 adaptive predictor is separately gated future work and no automatic model promotion is approved).

## Context

Classmates ask for reminders and workload insights, while [ADR 0001](0001-no-accounts-local-status.md) prohibits student accounts and server-stored progress, [ADR 0003](0003-data-in-files.md) freezes `data/current.json` for existing readers, [ADR 0004](0004-plain-javascript.md) prohibits bundlers and external runtime dependencies, and [ADR 0008](0008-multi-section.md) requires section isolation across root Section A and `/s/<id>/<token>/` sections. Meanwhile, live `https://dsct.dev/data/current.json` measured `8,839` bytes raw (`3,373` bytes gzip level `6`) across `27` tasks (`10` subjects, max note `796` bytes, `0` base64 data URIs) on 2026-11-25, removing the `1.70 MB` payload pressure that originally motivated S1b (`data/bodies/<sha256>.json`).

## Decisions

1. **Essential V1 (PRs 1–3) — deterministic insights only:** Compute workload clustering (`>= 2` open tasks within `48h`/`72h`), due-soon/overdue reminders, and subject breakdowns in plain JavaScript from `current.json` and in-memory `state.progress`. Reminders are **in-app only** for V1; no background Web Push or server endpoints are added.
2. **Approved UI placement (Variant A):** Add a `44px` **Insights** button inside `#mine` that opens `#insights-overlay` (reusing the `.task-dialog-overlay` pattern), preserving the exact `288px` first-task vertical position on a `320x568` phone screen. Task cards and rows show **at most one** calm cross-task cluster cue (such as `2 due Dec 2` or `2 due in 48h`, returning `null` for standalone tasks) that stays semantically non-duplicative of existing single-task deadline pills and never exposes raw probabilities, scores, streaks, or judgmental labels.
3. **Optional local activity history (V1, explicit opt-in):** Transition logging into section-scoped `class_tasks_activity` (`${sec}_class_tasks_activity`) stays off (`0` bytes written) until a student explicitly opts in. In V1, activity history powers only a factual personal history summary (tracked transitions, check-in counts, and recency) with **zero** predictive modeling.
4. **Three separate privacy controls:**
   - **Insights visibility (`showInsights`):** Controls whether the Insights entry button and subtle task cues are shown, without deleting stored data.
   - **Activity consent (`activityOptIn`):** Defaults to `false`. Turning `activityOptIn` off **immediately deletes** `class_tasks_activity` and all derived model state.
   - **Data deletion (`Clear activity history`):** Immediately deletes `class_tasks_activity` while preserving `showInsights` and `activityOptIn: true` (leaving visibility and consent choices explicit).
   - **`Reset my progress` (`resetSectionStorage`):** Deletes `progress` and `activity` for the active section while **preserving** `insightsPrefs` so an opt-out preference survives progress resets.
5. **Preserved invariants:** `KEYS.progress` (`{ status, movedAt }`), frozen 5-key `keysForSection()` in `js/util.js`, and `transfer.php` (`api/_validate.php`) stay unchanged and exclude `activity` and `insightsPrefs` in V1 (`insightsKeysFor()` derives section-scoped `prefs` and `activity` keys via `sectionKey()`). `applyDeletionAuthority()` prunes permanently deleted task IDs from `activity` via `filterDeletedActivity()` even when `progress` had zero hits; if both activity writes and deletion fail because browser storage is inaccessible, activity processing suspends, degraded storage is reported without claiming deletion succeeded, and cleanup retries when storage becomes available without ever compromising `KEYS.progress` deletion authority. Multi-section `b_*` prefixing, `index.html`'s CSP-pinned inline bootstrap script, the five `?v=` asset stamps, the 20 CSS tokens in `DESIGN.md`, `44px` touch floors, and graceful degradation (`SecurityError`, `QuotaExceededError`, corrupt JSON, unknown schema version) remain intact.
6. **Future adaptive predictor (separately approved PR 4 — not in V1):** The hybrid Empirical Bayes + online logistic regression candidate (`hybrid_burst_downweight`), opt-in shadow evaluation, statistical gates, and adaptive beta toggle are deferred to a separately approved **PR 4**. **No automatic model promotion is approved.** Preliminary scratch experiments on synthetic cohorts (40 held-out seeds × 6 archetypes, `120` tasks/seed) showed:
   - Unfiltered `hybrid_raw` failed badly on `weekly_batch_cleaner` (`0.3495` Brier, `7.57` false alarms per `10` tasks).
   - Filtering catch-up bursts (`>= 2` overdue Done taps within `120s`) and down-weighting overdue taps lacking prior `in_progress` to `0.35` improved 5 of 6 archetypes (`0.2024` → `0.1722` aggregate Brier; `0.1567` → `0.0785` ECE).
   - However, the deterministic `heuristic` baseline (`0.2389`) still beat every learned variant on `sparse_noisy_logger` (`0.2479` down-weighted, `0.2487` gated), and shadow gating (`nClean >= 15`, `t >= 0.5`) falsely promoted itself on `97.5%` of `sparse_noisy_logger` runs and oscillated (`72.5%`–`75%` kill rates) because shadow scoring graded against noisy recorded taps.
   - Candidate stricter gates (`nClean >= 30`, `burstRate <= 0.30`, `missingInProgressOverdueRate <= 0.25`, `tStat >= 1.65`) remain **unvalidated hypotheses**, not approved behavior.
7. **S1b board storage deferral (triggers for architectural reassessment):** Keep `current.json` inline and defer `data/bodies/<sha256>.json` externalization. Crossing any of these thresholds triggers **architectural reassessment** (any actual migration requires separate owner approval and preconditions F1, F2, and F3 in [owner-briefs.md](../owner-briefs.md)):
   - Live `current.json >= 150 KB` raw or `>= 40 KB` gzip level `6`, or
   - Any admin draft `>= 350 KB` (`50%` of `MAX_DRAFT_TRANSFER_BYTES`), or
   - Any single active task note `> 8 KB`.
   When reassessing S1b, cap inline excerpts at **`512 B`** rather than `2,048 B` (`300` × `10 KB` tasks with `2,048 B` excerpts measured `684.91 KB` raw = `701,348 B`, exceeding `transfer.php`'s `700,000 B` draft cap).
8. **Future enhancements (V2+, deferred):** Static RFC 5545 `.ics` calendar feed, adaptive nudge-timing bandit (only after empirical evidence over fixed `24h`), optional user-exported V2 diagnostic JSON, and browser-based LLMs / external AI APIs (incompatible with ADR 0004 and strict CSP).

## Evidence classification

| Category | Claims in this record |
| --- | --- |
| **Measured results** | Live `current.json` size (`8,839 B` raw / `3,373 B` gzip-6, `27` tasks, `10` subjects, max note `796 B`); `S1b` `300 × 10 KB` with `2 KB` excerpt hitting `684.91 KB` (`701,348 B`); 8-case storage fault matrix against `js/util.js`, `js/recovery.js`, `js/transfer.js`, `js/settings.js`; `320x568` Variant A first-row top `288px` vs. `502px` bottom bar (`44px` min control, `0` horizontal overflow). |
| **Projected implementation budgets** | V1 plain-JS bundle addition (`< 3 KB` unminified); `1`-year local activity log footprint (`17,444 B` raw / `3,382 B` gzip-6 at `150` tasks); `2`-year combined `progress` + `activity` (`50,145 B` = `0.956%` of `5 MB` quota). |
| **Synthetic evidence (preliminary only)** | Held-out `40`-seed × `6`-archetype ablation (`heuristic`, `hybrid_raw`, `hybrid_burst_filter`, `hybrid_burst_downweight`, `hybrid_shadow_gated`). Does not prove effectiveness among real students. |
| **Unverified assumptions** | Real classmate tapping habits on `dsct.dev`, whether `nClean >= 30` / `tStat >= 1.65` stops noise false-promotion, and future board growth rates. |

## Consequences

- Zero server endpoints, zero student PII, and zero bytes of `localStorage` added unless a student explicitly opts in.
- Pure logic and storage slices land independently of `index.html` and golden screenshots.
- S1b migration complexity and risk (F1–F3) remain zero while deferred.
