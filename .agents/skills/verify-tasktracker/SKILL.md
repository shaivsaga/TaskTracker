---
name: verify-tasktracker
description: Drive TaskTracker in real headless Mozilla Firefox via geckodriver against an isolated server, run Node and PHP suites, and capture visual and DOM proof across all student workflows. Use when verifying TaskTracker UI behavior, layout, theme, or regressions after changes.
---

# Verify TaskTracker

TaskTracker is a vanilla HTML, CSS, ES module JavaScript, and PHP 8.1+ class task board with no framework or build step. The primary user surface is the browser web app across desktop (`1280x800`) and phone (`390x844`, `320x568`) viewports in light and dark themes.

## Launch

Verification starts an ephemeral local Node server via `scripts/verify.mjs` reusing `createAuditServer` from `tests/e2e/audit.mjs`. It allocates OS-assigned free loopback ports for HTTP, WebDriver, and WebDriver BiDi (`--websocket-port`), generates a date-shifted copy of `tests/e2e/fixture-board.json` in `os.tmpdir()`, uses BiDi `browsingContext.setViewport` for exact `390x844` and `320x568` viewports, and runs all features sequentially across one shared `geckodriver` daemon. Pass `--geckodriver-url <url>` to attach to an existing idle daemon.

Never write to or modify `/opt/lampp/htdocs/tasktracker/data/` during verification. When driving an already running Apache instance instead of the ephemeral server, pass `--url http://localhost/tasktracker` after seeding `data/current.json` separately.

```bash
node .agents/skills/verify-tasktracker/scripts/verify.mjs drive all
```

Ready state is confirmed when the HTTP server answers `200` on `/index.html` and `/data/current.json` and WebDriver `GET /status` returns ready.

## Doctor

Run the read-only health check first whenever an environment issue is suspected.

```bash
node .agents/skills/verify-tasktracker/scripts/verify.mjs doctor
```

Doctor checks required repository files, `node`, `firefox`, `geckodriver`, `php`, and an ephemeral server round trip verifying `GET /index.html` (`200`), `GET /data/current.json` (`200` JSON), and `GET /data/secret.json` (`404`). Exit code `0` means the host can run browser verification.

## Drive

Read [features/README.md](features/README.md) and the matching feature file before running a targeted proof. Drive one feature or all six mapped features through real WebDriver clicks, selections, and keyboard events.

```bash
node .agents/skills/verify-tasktracker/scripts/verify.mjs drive <feature|all>
```

Available feature names are `class-board`, `status-and-done`, `calendar`, `past-archive`, `task-dialog-and-theme`, and `multi-section`. Prefer stable handles (`#id`, `data-task-id`, `data-view`, `href`, `option[value]`) and real `Enter`, `Escape`, and `/` key actions.

Run the non-browser unit and PHP validator suites alongside browser verification when code changed.

```bash
npm test && /opt/lampp/bin/php tests/php/run.php
```

## Evidence

Every `drive` run writes proof artifacts to `/tmp/verify-tasktracker-<timestamp>-<pid>/` unless `--out <dir>` is passed. Each run produces `report.json` with pass/fail checks, before/after observations, captured `console.error` / `window.onerror` entries, and PNG screenshots at desktop, 90% zoom, and phone widths.

Proof rules for TaskTracker:

- Exercise real click and keyboard flows, never internal JS setters.
- Verify both visible DOM updates and persisted `localStorage` side effects (`class_tasks_progress`, `class_tasks_theme`, `class_tasks_tour_seen`) across reloads where applicable.
- Confirm zero uncaught page or console errors.

## Cleanup

`verify.mjs` owns cleanup inside `finally` blocks on both success and failure.

- Closes every Firefox browser session via `DELETE /session/<id>`.
- Stops a spawned `geckodriver` daemon via `SIGTERM` on its child PID. Under an AppArmor-confined host where snap `geckodriver` refuses cross-profile `SIGTERM` with `EACCES`, writes the idle daemon URL atomically to `/tmp/verify-tasktracker-geckodriver.json` so subsequent runs reuse it instead of leaking processes. Never kill processes by name.
- Closes the ephemeral Node HTTP server and unlinks the temporary fixture JSON in `os.tmpdir()`.
- Preserves the entire `--out` evidence directory and `report.json` after teardown.

## Helpers

- `node .agents/skills/verify-tasktracker/scripts/verify.mjs doctor` checks host prerequisites and ephemeral server isolation.
- `node .agents/skills/verify-tasktracker/scripts/verify.mjs drive all` runs all 6 feature journeys over one shared `geckodriver` instance and writes screenshots plus `report.json` to `/tmp/verify-tasktracker-<timestamp>-<pid>/`.
- `node .agents/skills/verify-tasktracker/scripts/verify.mjs drive calendar --out /tmp/cal-proof --geckodriver-url http://127.0.0.1:4444` drives one feature against a chosen output directory and existing `geckodriver` daemon.
- [features/README.md](features/README.md) indexes the mapped user journeys.
