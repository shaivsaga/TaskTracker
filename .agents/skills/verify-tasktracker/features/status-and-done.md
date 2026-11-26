# Status and done archive

Students change task progress through the 3-state status popover on `.status-check`, see completed tasks persist on `#page-done` (route `/index.html#done`), and reopen tasks through a single armed `"Mark not done"` button.

## Sub-features

- `popover-marks-done` opens `.status-popover`, sets `done` in `localStorage`, and shows `#toast`.
- `done-persists-and-single-reopen` keeps the completed task on `#page-done` across reload with a non-interactive static check icon and one `"Mark not done"` button.
- `reopen-arms-then-restores` arms `"Confirm?"` on first click and restores `not_started` on second click.

## How to get to it (user POV)

- Click the square `.status-check` box on any task row and pick `Done` from the menu.
- Click the `Done` tab in the top or bottom navigation bar.
- Click `"Mark not done"` once to arm `"Confirm?"`, then click `"Confirm?"` to reopen.

## Driving it with verify.mjs

Preconditions:

- Ephemeral server serves active open tasks on `/index.html`.
- `class_tasks_tour_seen` is `'1'` and `class_tasks_progress` is empty.

- **Mark a task done.** Click `.status-check` on the first task row, verify `.status-popover` opens, capture `status-popover.png`, and click the `Done` option. `#toast` becomes visible and `localStorage.getItem('class_tasks_progress')` records `status: 'done'` for that task ID.
- **Verify Done page persistence.** Click `nav a[href="#done"]`, reload `/index.html#done`, and wait for the task row in `#done-list`. The row renders `<span class="status-check is-done is-static">` and one button labeled `"Mark not done"`. Capture `done-reopen.png`.
- **Reopen with inline confirmation.** Click `"Mark not done"` once and assert the button text changes to `"Confirm?"` with `data-armed="1"`. Click it a second time and assert the row leaves `#done-list` with `status: 'not_started'` saved.

## Gotchas

- Clicking `"Mark not done"` once only arms for 4 seconds; waiting too long between clicks resets the button text.
- `.status-check` opens a 3-state menu rather than toggling directly, as specified in `DESIGN.md`.
- On non-root Sections (`/s/<id>/<token>/`), progress is stored under `<id>_class_tasks_progress` rather than `class_tasks_progress`.
