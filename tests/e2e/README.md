# tests/e2e - jsdom capture harness and goldens

What this is: `capture.mjs` boots the real `index.html` + `app.js` in jsdom through the external
harness at `C:\xampp\tt-overnight\harness`, drives the app with scripted clicks, typing and hash
changes, and writes normalised text snapshots into `golden/`. `check.mjs` re-captures them in memory,
diffs against `golden/`, prints a readable diff and exits 1 on any difference. Between them they cover
the rendered board, the calendar, the done list, the settings panel, the admin draft board, the task
dialog, the status popover, search filtering, the quick-add parser, the transfer import overlay, the
progress store shape, every fetch (with its cache mode) and console errors.

## Why these files are not named `*.test.js`
`capture.mjs` and `check.mjs` need `jsdom` and `esbuild`, which are not dependencies of this repo and
are not going to be: `docs/adr/0004-plain-javascript.md` keeps the app dependency-free, so the repo has
no `node_modules` to install them from. `node --test` collects `tests/*.test.js`, so a `.test.js`
name would put this in the CI run and fail on every checkout without the harness. The harness lives
outside the repo and is passed in with `--harness`.

## Run
```
node tests/e2e/capture.mjs --update     # rewrite every golden (deliberate act: read the diff after)
node tests/e2e/check.mjs                # re-capture and diff; exit 1 on any difference
node tests/e2e/capture.mjs              # build the snapshots, print their sizes, write nothing
```
Defaults, all overridable: `--harness C:\xampp\tt-overnight\harness` (the loader plus its jsdom and
esbuild), `--root` = the repo root two levels up from this file, `--fixture
tests/e2e/fixture-board.json`, `--out tests/e2e/golden` (`--golden` is accepted as an alias).

## The snapshots
| golden | how it is driven | what it catches |
|---|---|---|
| 01-board.html | boot, default route | cards, urgency labels, subject classes, sort order |
| 02-board-dark.html | start from the light theme, click #theme-toggle until data-theme=dark | theme wiring: head meta, toggle label |
| 03-calendar.html | setHash('#calendar') | the calendar grid and its chips |
| 04-done.html | seeded progress, setHash('#done') | done rows and their status labels |
| 05-settings.html | click #settings-open | the settings panel rows |
| 06-admin.html | admin boot with the published board seeded as the draft, setHash('#my-tasks') | admin bar, draft/publish state, announcements admin |
| 07-dialog.html | click the first task card | the task dialog and its fields |
| 08-popover.html | click the first card's status control | the status popover |
| 09-search.html | type "statistical" into #class-task-search | filtering (21 cards to 1) |
| 10-quickadd.html | admin boot, type "math homework tomorrow 5pm", submit | the natural-language parser end to end |
| 11-transfer.html | boot with a stub transfer token, click #import-apply | the import overlay and its summary wording |
| 12-progress.json | move the first card to in_progress through the popover | the progress store shape |
| requests.json | the fetch log of every boot above | the Phase 1b cache policy, no extra network calls |
| errors.json | console errors, console warnings, page faults | must stay `[]` |

Routes and selectors here were read out of the app, not guessed. Two routes in the original brief do not
exist: there is no `#archive` (the done/closed list is `#done`, `data-page-view="done"`) and no
`#settings` route (settings is the `#settings-overlay` panel opened by `#settings-open`). The admin
page is `#my-tasks` (`data-page="my-tasks"`), and the admin boot has to seed the draft because
`#my-tasks` falls back to `#class-tasks` for a non-admin. The status popover is selected as
`body > .status-popover:not(.subject-dropdown)`: the dialog's subject dropdown is also a direct child
of `body` and shares the `status-popover` class, so a plain `.status-popover` match finds the hidden
one first.

## Normalisation
Each golden is LF-only, has `data:` URLs shortened to `data:<omitted>` and absolute paths replaced
with `<path>`, so no golden depends on where the repo is checked out. Whitespace in text nodes is
collapsed, and live form state is written as `value=` / `checked=` attributes, because attribute markup
alone does not show what an input contains. Nothing else is normalised: the markup in a golden is what
the app rendered.

## Determinism
The loader freezes the clock at 2026-11-03T12:00:00+08:00 (`boot({ now })` takes epoch ms), pins the
process timezone to `Asia/Singapore`, pins `Date.prototype.toLocale*` to `en-US`, and replaces
`Math.random` with a seeded generator, so the ids the app mints (`Math.random().toString(36)` in the
`Task` constructor in logic.js, and for announcement ids in app.js) are identical every run.
`check.mjs` twice in a row is byte-identical.

Not frozen, on purpose: the real timers behind the overlay close animations (`hideAnimated` hides a
panel after 120-180ms), so each step settles past them, and the app's 60s re-render interval, which is
never reached. If a future snapshot needs a different instant, pass `now` through `boot()` rather than
normalising the strings the app renders.

## Reading a diff
`check.mjs` prints one `-` (golden) / `+` (now) pair per differing line with line numbers on both
sides, plus a few lines of context above the first difference. A diff is either a real regression or a
deliberate UI change. If it is deliberate: run `capture.mjs --update`, then read `git diff
tests/e2e/golden/` before committing. Never update a golden just to make a failing check pass.

## The browser audit gate (`audit.mjs`)
The Phase 3 run kept its real-browser judges outside the repo (`tmp\visual\probe.ps1`, `tmp\oracle\*`)
and drove them by hand. `audit.mjs` is the reproducible part of that battery, in the repository:
Node builtins only, the repo's own fixture served as `data/current.json`, and Microsoft Edge over the
DevTools protocol (Node 22+'s global `WebSocket`), so still no dependency and no build step.

```
node tests/e2e/audit.mjs [--root <dir>] [--fixture <file>] [--edge <exe>] [--port 8110]
```

It boots the real app at 320, 375, 640, 768 and 1280 CSS px (640 is 200% zoom of a 1280 window), in
both themes where the width is a phone, and checks the things a CSS-less judge cannot see:

- **overflow** - no element crosses the viewport edge on any deep-linkable route (Tasks, Done, Past,
  Calendar, My tasks) or with the task dialog and the settings panel open;
- **fold** - the first task row is on the first phone screen, above the tab bar;
- **titles** - no task name is narrower than 120px at 320/375 (the archive once squeezed it to 60px);
- **names** - every focusable element has an accessible name and none is a bare div/span/article;
- **lists** - each task list is `role="list"`, every row `role="listitem"`, every row title a button;
- **keys** - Enter on the title control opens the task dialog and Escape closes it, on board and list;
- **announce** - every pinned announcement shows on desktop; the phone keeps its one-item collapse;
- **delete** - archive Delete arms to "Confirm?" first, then deletes, then Undo restores the row;
- **themes** - light and dark both come from the stored choice, and no console error appears.

No Edge found exits 0 with `SKIP`, the same way the goldens skip without a harness. It is not named
`*.test.js` for the same reason: it needs a browser and must not fail a checkout that has none.

## label-in-name (`label-in-name.mjs`)
Static WCAG 2.5.3 sweep: for every widget carrying `aria-label`, the element's own visible text must be
contained in that label. axe-core does not implement 2.5.3, so this is the committed check for it.
`node tests/e2e/label-in-name.mjs [index.html]`; exit 1 on any violation.
