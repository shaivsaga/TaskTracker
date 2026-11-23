# Class Timetable / Schedule Plan

**Status.** Approved design (2026-11-23). Plan only — not yet implemented.

## Why

Classmates check two things throughout a school day: **"what subject is it right now?"** and **"what does the whole week look like?"** Putting the class schedule inside TaskTracker's existing **Calendar** page answers both in one tap without adding a fifth navigation tab, a new server endpoint, or student accounts. Each provisioned Section (Section A / DSCT11-A, Section B, and future sections) owns and publishes its own schedule independently.

## Goals, Non-goals, Anti-goals

**Goals**
- Show a live **"Right now / Up next"** strip computed from the device's local clock (current class or break, minutes remaining, next class, or "No more classes today", plus Room / Adviser / Term).
- Show the **full Mon–Fri week grid** on desktop (`>=720px`) with merged multi-period blocks (e.g. 2-hour classes), reusing each Section's Subject Catalogue colors and readable ink, with the active slot highlighted.
- Keep **phones (`<=719px`)** legible at `320px`: `Mon`–`Fri` day pills (defaulting to today, or Monday on weekends) under the "Right now" strip, plus a compact full-week scroll view for checking the whole grid.
- Provide an **in-app Admin collapsible panel** (`Show schedule`, mirroring Subjects and Recycle Bin) so both Section A and Section B officers can edit and publish their term schedule from any device.
- Work offline via `KEYS.cache`, require zero nginx changes, and keep boards without a schedule 100% backward-compatible.

**Non-goals**
- No separate bottom/top navigation tab.
- No student-editable personal timetables, push notifications, or alarms.
- No drag-and-drop visual grid builder or automatic task-to-period linking in v1.
- No Saturday/Sunday columns (weekdays Mon–Fri only).

**Anti-goals**
- Breaking existing `data/current.json` readers or requiring a data migration for sections without a schedule.
- Adding new CSS tokens outside the 20-token palette, touching `index.html`'s CSP-pinned inline script, or changing the 5 `?v=` asset stamps.

## Approaches Considered

| Approach | Summary | Trade-offs | Decision |
|---|---|---|---|
| **1. Calendar `Schedule` mode + Admin collapsible row editor** | 3rd Calendar view (`Month \| Week \| Schedule`), optional `schedule` object in `current.json`, collapsible `Show schedule` panel in Admin with per-day slot rows. | Slightly more Admin UI code than raw JSON, but Section A and B officers can edit from a phone without touching JSON. | **Chosen (owner pick)** |
| **2. Calendar `Schedule` mode + raw JSON paste/import in Admin** | Same student view, but officers paste/upload schedule JSON once per term. | ~70% less Admin UI code, but error-prone for non-technical officers on phones. | Rejected |
| **3. Separate `Schedule` nav tab + `data/schedule.json`** | Top-level navigation tab and dedicated static JSON file. | Crowds the `320px` bottom bar to 5–6 tabs and requires nginx config updates across every section. | Rejected |

## Data Model (additive field in `current.json`)

Because nginx denies everything under `data/` except `current.json` ([ADR 0003](adr/0003-data-in-files.md)), `schedule` lives as an **optional additive field** inside `current.json` (keeping `schemaVersion: 2`). Sections that have not configured a schedule omit `schedule` (or set it to `null`), and the `Schedule` view tab stays hidden for students until a schedule is published (always visible to signed-in admins).

```json
{
  "schedule": {
    "term": "2ND TERM – AY 2026-2027",
    "sectionLabel": "DSCT11-A",
    "adviser": "Mr. Jomari V. Borja",
    "room": "92C ST. SCHO",
    "slots": [
      { "day": 1, "start": "07:30", "end": "08:30", "subject": "CP104", "teacher": "Mr. James Robert A. Salud" },
      { "day": 1, "start": "09:30", "end": "09:50", "kind": "break", "label": "RECESS" },
      { "day": 3, "start": "07:30", "end": "09:30", "subject": "FINMATH101", "teacher": "Ms. Shiela Grospe" },
      { "day": 5, "start": "13:50", "end": "14:50", "kind": "activity", "label": "CLUB" }
    ]
  }
}
```

**Why `start` + `end` times instead of fixed period numbers:**
- Handles variable start/dismissal hours per day (`07:10` on Tue/Wed/Thu vs `07:30` on Mon/Fri; `13:50` dismissal on Wed vs `14:50` other days).
- Handles **merged multi-period blocks automatically**: the desktop CSS Grid derives row tracks from the sorted unique set of all `start`/`end` timestamps in `slots`, and each slot spans `grid-row: startIdx / endIdx`. A 2-hour block (`07:30`–`09:30`) spans two rows with zero manual merge metadata.
- **Validation rules (PHP `api/_board.php` + client `logic.js`):**
  - `term`, `sectionLabel`, `adviser`, `room`: optional plain strings (max 80 chars each).
  - `slots`: list, max 80 entries.
  - `day`: integer `1` (Mon) through `5` (Fri).
  - `start`, `end`: strict `HH:MM` (24-hour, `00:00`–`23:59`) with `start < end`; no overlapping intervals on the same `day`.
  - `kind`: `'subject'` (default when `subject` is present), `'break'` (`RECESS`, `LUNCH`), or `'activity'` (`HOMEROOM`, `ASSEMBLY`, `CLUB`).
  - `subject`: when `kind === 'subject'`, must exist in the Board's `subjects` catalogue (enforced alongside `tt_subjects_cover()`).
  - `label`: required when `kind !== 'subject'` (max 40 chars); `teacher`: optional plain string (max 80 chars).

## Student UI (inside Calendar)

```
┌─ Calendar ───────────────────────────────────────────────────┐
│  CLASS SCHEDULE · DSCT11-A          [ Month | Week | Schedule ]
│  2ND TERM – AY 2026-2027 · Room 92C ST. SCHO · Mr. Jomari V. Borja
├──────────────────────────────────────────────────────────────┤
│  NOW  08:30–09:30  PKLP (Mr. Jay Z. Silvano) · 24 min left   │
│  NEXT 09:30–09:50  RECESS                                    │
├──────────┬──────────┬──────────┬──────────┬──────────┬───────┤
│ TIME     │ MON      │ TUE      │ WED      │ THU      │ FRI   │
│ 7:10-7:30│          │ HOMEROOM │ ASSEMBLY │ HOMEROOM │       │
│ 7:30-8:30│ CP104    │ THEO     │ FINMATH  │ GENMATH  │GENMATH│
│ 8:30-9:30│ [PKLP]*  │ EFFCOM   │   101    │ GENSCI   │GENSCI │
│ 9:30-9:50│ RECESS   │ RECESS   │ RECESS   │ RECESS   │RECESS │
│ ...      │ ...      │ ...      │ ...      │ ...      │ ...   │
└──────────┴──────────┴──────────┴──────────┴──────────┴───────┘
```

- **Header:** When `Schedule` is selected in Calendar's `.view-tabs`, hide `#cal-today` and `.cal-nav` (`< >`) since the timetable is a fixed weekly grid.
- **"Right now" strip:** Uses the browser's local clock (`new Date()`), refreshed every 60 seconds while the Schedule view is visible (timer cleared on page/mode switch).
  - During a slot: shows subject/label, time range, teacher (if set), and minutes remaining, plus the next slot on the same day.
  - Between slots / before first class: shows "Next: … in X min" (or "Starts at 7:10 AM").
  - After last slot / weekends: shows "No more classes today" and next school day's first class.
- **Desktop (`>=720px`):** 6-column CSS Grid (`Time` + `Mon`–`Fri`), `2px solid var(--ln)` outer frame, `1px solid var(--ln)` cell rules, subject cells tinted from the Subject Catalogue with WCAG-AA ink, break/activity cells on `--sf2`, active slot highlighted with a `2px solid var(--ac)` inset border.
- **Phone (`<=719px`):** `Mon`–`Fri` 44px day selector pills (defaulting to today, or Mon on Sat/Sun) listing that day's vertical schedule cards under the "Right now" strip, plus a `Full week` toggle that renders the compact Mon–Fri grid inside an `overflow-x: auto` container (so the page itself never overflows `320px`).

## Admin UI (Approach 1 — Collapsible Panel)

- Add a collapsed `#schedule-panel` section in Admin below `#subject-panel` (`Show schedule`, `aria-expanded="false"`), matching the Subjects and Recycle Bin panels.
- **Header fields:** `Term`, `Section`, `Adviser`, `Room` (44px `.text-input` fields).
- **Day tabs (`Mon`–`Fri`):** Filter the slot editor one day at a time so phone and desktop stay uncluttered.
- **Per-day slot list:** Sorted by `start` time. Each row shows `Start` – `End`, `Type` (`Subject` / `Break` / `Activity`), `Subject` dropdown (from the Section's active catalogue) or `Label` input, optional `Teacher` input, and `Remove` button.
- **Inline add form:** Add a slot to the active day (with instant overlap validation before saving to draft).
- **Draft / Publish lifecycle:**
  - Edits stay in the browser draft (`KEYS.draft`) until **Publish**.
  - `diffDraft()` adds `scheduleChanged` (counted in `diff.total` and summarized as `"schedule changed"` in Publish diff).
  - Schedule-only publishing works without requiring task edits.
  - **Discard changes** and **History restore** restore `schedule` alongside `tasks`, `announcements`, and `subjects`.

## Reference Seed: DSCT11-A (2nd Term AY 2026–2027)

Transcribed from the printed class schedule (Room `92C ST. SCHO`, Adviser `Mr. Jomari V. Borja`):

| Time | Monday | Tuesday | Wednesday | Thursday | Friday |
|---|---|---|---|---|---|
| 7:10–7:30 | — | HOMEROOM | ASSEMBLY | HOMEROOM | — |
| 7:30–8:30 | CP104 (Mr. James Robert A. Salud) | THEO-112N (Mr. Alexis Emmanuel Gelverio) | FINMATH101 (Ms. Shiela Grospe) *(7:30–9:30)* | GENMATH (Ms. Azenith L. Lagunilla) | GENMATH (Ms. Azenith L. Lagunilla) |
| 8:30–9:30 | PKLP (Mr. Jay Z. Silvano) | EFFCOM (Ms. Manasseh R. Uba) | *(cont. FINMATH101)* | GENSCI (Ms. Charizze E. Suarez) | GENSCI (Ms. Charizze E. Suarez) |
| 9:30–9:50 | RECESS | RECESS | RECESS | RECESS | RECESS |
| 9:50–10:50 | GENSCI (Ms. Charizze E. Suarez) | MABKOM (Ms. Joyce April S. Ramirez) | GENSCI (Ms. Charizze E. Suarez) | LCS-PERDEV (Mr. Steven Claude Dayrit) | MABKOM (Ms. Joyce April S. Ramirez) |
| 10:50–11:50 | EFFCOM (Ms. Manasseh R. Uba) | PKLP (Mr. Jay Z. Silvano) | LCS-PE (Mr. Steven Claude Dayrit) | THEO-112N (Mr. Alexis Emmanuel Gelverio) | PKLP (Mr. Jay Z. Silvano) |
| 11:50–12:50 | LUNCH | LUNCH | LUNCH | LUNCH | LUNCH |
| 12:50–1:50 | THEO-112N (Mr. Alexis Emmanuel Gelverio) | LCS-PERDEV (Mr. Steven Claude Dayrit) | PKLP (Mr. Jay Z. Silvano) | CP104 (Mr. James Robert A. Salud) *(12:50–2:50)* | LCS-PE (Mr. Steven Claude Dayrit) |
| 1:50–2:50 | GENMATH (Ms. Azenith L. Lagunilla) | GENMATH (Ms. Azenith L. Lagunilla) | — | *(cont. CP104)* | CLUB |
| **Official** | **7:30–2:50** | **7:10–2:50** | **7:10–1:50** | **7:10–2:50** | **7:30–2:50** |

## File Touch Map (for future implementation)

1. **`logic.js` + `tests/logic.test.js`:** Pure `validateSchedule()`, `resolveCurrentSlot(schedule, now)`, and `buildWeekGrid(schedule)` helpers.
2. **`api/_board.php`, `api/publish.php`, `tests/php/run.php`:** Optional `schedule` validation, overlap checks, subject coverage check, and preservation in `current.json` + snapshots.
3. **`js/state.js`, `js/store.js`, `js/publish.js`:** Carry `draftSchedule` / `liveBoard.schedule` through `normalizeBoard()`, `snapshot()`, `diffDraft()`, `restoreDraft()`, and `publish`.
4. **`js/schedule.js` + `js/calendar.js`:** Render "Right now" strip, desktop Mon–Fri grid, and phone day switcher/full-week scroll when `calMode === 'schedule'`.
5. **`js/schedule-editor.js`:** Collapsible Admin panel (`#schedule-panel`) following `js/subjects-editor.js`.
6. **`index.html`, `styles.css`, `tests/e2e/ui-behaviors.mjs`:** 3rd Calendar `.view-tab`, `#cal-schedule`, `#schedule-panel`, 20-token CSS, and real-browser E2E checks (320px/1280px, live "Right now" with frozen clock, merged 2-hour block spanning, and Admin edit/publish round-trip).

## What is left to the builder

- Exact CSS class names and grid-template math inside `#cal-schedule`.
- Whether `localStorage` remembers the last selected Calendar mode (`month` / `week` / `schedule`) or keeps `month` as default on cold load.
- Exact copy for empty/weekend states in the "Right now" strip.
