# Multi-section isolation and badge

Non-root Sections served at `/s/<id>/<32-hex-token>/` display a compact `SECTION <ID>` badge, isolate student progress and resets under `<id>_class_tasks_*`, share device-wide theme preferences, and reject cross-section transfers while leaving Section A at root unchanged.

## Sub-features

- `section-a-no-badge` verifies root `/index.html` renders zero `[data-section-badge]` elements and keeps brand `aria-label` as `TaskTracker home`.
- `section-b-badge-desktop-and-phone` verifies `/s/b/<32hex>/index.html` shows `SECTION B` in `.tb .brand` at `1280x800` and in `.brand-m` at `390x844` with zero horizontal overflow, updating brand `aria-label` to `TaskTracker SECTION B home`.
- `section-b-storage-isolation-and-reset` verifies marking a task done on Section B writes only `b_class_tasks_progress`, persists across reload, and resetting via Settings (`RESET`) clears `b_class_tasks_progress` while preserving Section A's `class_tasks_progress` and `class_tasks_theme`.
- `section-b-theme-device-wide` verifies toggling `#theme-toggle` on Section B updates `class_tasks_theme` and applies on Section A.
- `section-b-rejects-cross-section-transfer` verifies opening Section B with a `?transfer=` link carrying a Section A payload shows a mismatch toast naming both Sections and leaves `b_class_tasks_progress` untouched.

## How to get to it (user POV)

- Open `/index.html` (Section A) and confirm no section badge appears.
- Open `/s/b/<32-hex-token>/index.html` on desktop and phone viewports to see the `SECTION B` badge.
- Mark a task done on Section B, reload, then open Settings and run `Reset all data` (`RESET`).
- Open a Section A transfer link on Section B and confirm the mismatch error toast without losing Section B progress.

## Driving it with verify.mjs

Preconditions:

- Ephemeral server in `verify.mjs` strips `/s/b/<32hex>` when forwarding static and board requests to `createAuditServer`, and serves a Section A transfer payload at `/s/b/<32hex>/transfer.php?t=<32hex>`.
- Both `class_tasks_*` and `*_class_tasks_*` keys are cleared before starting.

- **Confirm Section A has no badge.** Open `/index.html` at `1280x800`. Assert `document.querySelectorAll('[data-section-badge]').length === 0` and `.tb .brand` `aria-label === 'TaskTracker home'`.
- **Verify Section B badge on desktop and phone.** Open `/s/b/<32hex>/index.html` at `1280x800`, assert `.tb .brand [data-section-badge="b"]` reads `SECTION B`, capture `section-b-desktop.png`; resize to `390x844`, assert `.brand-m [data-section-badge="b"]` reads `SECTION B` with `scrollWidth <= innerWidth`, capture `section-b-phone.png`.
- **Verify storage isolation and Settings reset.** Seed `class_tasks_progress` (Section A) and `class_tasks_theme: 'dark'`, open Section B, mark the first task Done via `.status-popover`, reload Section B to verify `b_class_tasks_progress` persisted and `class_tasks_progress` was untouched, then open `#settings-open`, click `#settings-reset-start`, type `RESET` into `#settings-reset-input`, click `#settings-reset-submit`, and verify `b_class_tasks_progress` is cleared while `class_tasks_progress` and `class_tasks_theme` survive.
- **Verify device-wide theme.** Toggle `#theme-toggle` on Section B, open `/index.html`, and verify `document.documentElement.dataset.theme` matches the toggled theme.
- **Verify cross-section transfer rejection.** Seed `b_class_tasks_progress`, open `/s/b/<32hex>/index.html?transfer=<32hex>`, wait for `#toast` containing `Section A` and `Section B`, and verify `b_class_tasks_progress` is unchanged.

## Gotchas

- `resetStorage()` must clear `/^(?:[a-z0-9][a-z0-9_-]{0,31}_)?class_tasks_/` so non-root Section keys never leak between runs.
- Live nginx routing (`/s/<id>/<token>/`, auth, and rotation) is verified separately via `deploy/check-nginx.sh` and `deploy/verify-hardening.mjs --section-url`.
