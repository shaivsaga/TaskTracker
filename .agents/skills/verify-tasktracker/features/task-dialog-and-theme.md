# Task dialog and theme

Opening a task displays a student-friendly read-only dialog named from the task title with its empty admin footer hidden, restores focus on `Escape`, and persists light or dark theme toggles across reloads.

## Sub-features

- `readonly-dialog-name-and-footer` verifies `.task-dialog.is-readonly` sets `aria-label` to the task title and computes `display: none` on `.dialog-footer`.
- `escape-restores-focus` closes `#task-dialog-overlay` on `Escape` and moves focus back to a live page control instead of `<body>`.
- `theme-toggle-and-persists` switches theme via `#theme-toggle`, updates body background color, writes `class_tasks_theme`, and retains the theme after reload.

## How to get to it (user POV)

- Focus a task title on `#page-class-tasks` and press `Enter`, or click a task row.
- Press `Escape` to close the task details dialog.
- Click `#theme-toggle` in the desktop top bar and reload the page.

## Driving it with verify.mjs

Preconditions:

- Ephemeral server serves active tasks on `/index.html`.
- `class_tasks_tour_seen` is `'1'`.

- **Open dialog with keyboard.** Focus the first `.task-row .task-row-title` and press `Enter`. `#task-dialog-overlay` opens with `.is-readonly`, `aria-label` matching the row title, and `.dialog-footer` hidden. Capture `task-dialog-readonly.png`.
- **Close with Escape.** Press `Escape`. `#task-dialog-overlay` closes and `document.activeElement.tagName` is not `'BODY'`.
- **Toggle and reload theme.** Record `dataset.theme` and body `backgroundColor`, click `#theme-toggle`, verify both changed and `localStorage.getItem('class_tasks_theme')` matches, then reload `/index.html` and assert `dataset.theme` persists. Capture `theme-switched.png`.

## Gotchas

- On viewports below `720px`, `#theme-toggle` in the top bar is hidden and theme selection moves inside the Settings dialog.
- Initial `dataset.theme` depends on Firefox `prefers-color-scheme`, so checks must assert a change relative to the initial state rather than assuming light mode starts first.
- `class_tasks_theme` stays device-wide across Sections and survives Section-scoped data resets.
