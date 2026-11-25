# Class board

The main `#page-class-tasks` section (hash `#class-tasks`) lets classmates scan upcoming and overdue tasks, read the `.mine` summary, search by keyboard, and filter by subject in both List and Board views without an intrusive onboarding popup.

## Sub-features

- `opt-in-cue` shows `#tour-cue` on first visit without hijacking clicks on tasks.
- `urgency-buckets-and-mine` groups List rows under `.list-bucket` headings and renders `#mine`.
- `dismiss-cue-persists` hides `#tour-cue` and saves `class_tasks_tour_seen` when dismissed.
- `slash-focuses-search` moves focus to `#class-task-search` when pressing `/` outside inputs.
- `subject-filter-persists-on-board` keeps `#class-subject-filter` visible and applied after switching to Board while hiding `#class-status-filter`.

## How to get to it (user POV)

- Open `/index.html` in a clean browser profile.
- Click a task title row to open task details, or click `Dismiss` on `#tour-cue`.
- Press `/` anywhere outside a form field to jump to task search.
- Pick a subject in `#class-subject-filter` and click the `Board` view button.

## Driving it with verify.mjs

Preconditions:

- Ephemeral server serves the date-shifted fixture so tasks populate the active urgency buckets (`Due today & tomorrow`, `Overdue this week`, `Upcoming`; `Done` stays empty until tasks are completed).
- `class_tasks_*` and section-prefixed `*_class_tasks_*` keys are cleared in `localStorage` before reloading `/index.html`.

- **Verify initial cue and buckets.** Open `/index.html` at `1280x800` and wait for `#class-task-list .task-row`. `#tour-cue` is visible, `#tour-overlay` stays hidden, `.list-bucket` count is at least 2, and `#mine-n` is greater than 0.
- **Verify first click opens task dialog.** Click `#class-task-list .task-row .task-row-title`, then press `Escape`. `#task-dialog-overlay` opens while `#tour-overlay` stays hidden.
- **Dismiss tour cue.** Click `#tour-cue-dismiss`. `#tour-cue` hides and `localStorage.getItem('class_tasks_tour_seen')` equals `'1'`. Capture `class-board-list.png`.
- **Keyboard search.** Press `/` via WebDriver key actions. `document.activeElement.id` equals `'class-task-search'`.
- **Cross-view subject filter.** Select `GENSCI` in `#class-subject-filter` and click `#page-class-tasks .view-tab[data-view="board"]`. `#class-status-filter` has computed `display: none`, `#class-subject-filter` stays visible, and `#class-board .task-card` count equals the filtered List row count. Capture `class-board-filtered.png`.

## Gotchas

- `tests/e2e/fixture-board.json` has fixed 2026-11 dates; running without date shifting puts every task in Past instead of active buckets.
- `createAuditServer` returns 404 on bare directory `/`, so `verify.mjs` opens `/index.html`.
- Board view hides `#class-status-filter` intentionally because the three columns already separate statuses.
