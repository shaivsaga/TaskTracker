# TaskTracker verification map

This directory is the maintained source for verifying user-facing TaskTracker behavior in real Mozilla Firefox. Read this index first, then read the matching feature file.

## Baseline preconditions

- Launch via `node .agents/skills/verify-tasktracker/scripts/verify.mjs` so each run binds its own loopback HTTP port and drives sequential Firefox sessions through one shared `geckodriver` daemon (or `--geckodriver-url <url>`).
- Use the date-shifted ephemeral fixture derived from `tests/e2e/fixture-board.json` in `/tmp` without creating or altering `data/`.
- Run `node .agents/skills/verify-tasktracker/scripts/verify.mjs doctor` when anything looks off and require exit code `0`.
- Clear `class_tasks_*` and section-prefixed `*_class_tasks_*` `localStorage` keys at the start of each feature so scenarios never leak state.

## Driving conventions

- Start every feature from clean baseline storage unless its preconditions set a flag such as `class_tasks_tour_seen`.
- Drive real UI actions via WebDriver clicks, select option clicks, and keyboard actions (`Enter`, `Escape`, `/`).
- Treat every command in `verify.mjs` as literal.
- Keep `data/`, `deploy/`, `api/*.php`, and `tests/e2e/golden/` untouched.
- Retain all proof artifacts in the `--out` directory after teardown.

## Proof and skip reporting

- Capture both the user action and the resulting state or storage persistence, not just the initial page.
- UI proof includes DOM/computed style assertions in `report.json` and saved PNG screenshots with zero console errors.
- Persistence proof (`status-and-done`, `task-dialog-and-theme`, `opt-in-cue`, `multi-section`) reloads the page or verifies `localStorage` state.
- Report any skipped path or host limitation (for example Chromium CDP audit unavailable on a Firefox-only host) explicitly with the exact unmet precondition.
- Never claim a skipped path passed because another path passed.

## Feature entry contract

Each feature file starts with an H1 title and one summary paragraph. It then uses four H2 sections in order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists user entry points.
3. `Driving it with verify.mjs` starts with `Preconditions:` and lists labeled checks with exact triggers and observable results.
4. `Gotchas` lists known traps for that surface.

## Features

- [Class board](class-board.md) covers opt-in first-visit tour cue, urgency bucket headers, `.mine` progress strip, `/` search shortcut, and subject filtering across List and Board.
- [Status and done archive](status-and-done.md) covers the 3-state status popover, `Done` persistence across reloads, single reopen control, and 2-tap armed confirmation.
- [Calendar grid](calendar.md) covers 90% zoom grid borders in light and dark themes and phone month dot selection updating `#cal-agenda`.
- [Past archive](past-archive.md) covers calm short date labels (or `No due date`), 4-child row layout without status checkboxes, and zero horizontal overflow at `320px`.
- [Task dialog and theme](task-dialog-and-theme.md) covers read-only dialog accessible naming, hidden footer, `Escape` focus return, and persistent theme toggle.
- [Multi-section isolation and badge](multi-section.md) covers Section A unchanged, Section B header badge on desktop and phone, section-prefixed storage and Settings reset isolation, device-wide theme, and cross-section transfer rejection.
