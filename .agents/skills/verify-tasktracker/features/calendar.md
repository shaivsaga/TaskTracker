# Calendar grid

The `#calendar` view renders a month grid whose 1px borders hold at 90% browser zoom in both light and dark themes on desktop and whose dotted days update `#cal-agenda` on phones.

## Sub-features

- `desktop-90-light-borders` keeps `gap: 0px` and positive `1px` cell borders across `.cal-day` cells at 90% zoom in light mode.
- `desktop-90-dark-borders` keeps cell borders intact after switching to dark theme via `#theme-toggle`.
- `phone-dot-tap-updates-agenda` renders `.cal-agenda` with matching tasks and zero horizontal overflow when tapping a dotted day at `390x844`.

## How to get to it (user POV)

- Click the `Calendar` tab in the navigation bar or open `/#calendar`.
- Toggle light and dark theme with `#theme-toggle` on desktop.
- On a phone width, tap any day square displaying subject dots to read its tasks underneath.

## Driving it with verify.mjs

Preconditions:

- Firefox starts with `layout.css.devPixelsPerPx=0.9` for desktop zoom checks and `1.0` for phone agenda checks.
- Date-shifted fixture ensures the active month has tasks with `.cal-dot` indicators.

- **Light 90% zoom borders.** Open `/#calendar` at `1280x800` with `class_tasks_theme='light'`. `.cal` computed `gap` equals `'0px'` and `.cal-day` `borderRightWidth` and `borderBottomWidth` are both positive. Capture `calendar-light-90.png`.
- **Dark 90% zoom borders.** Click `#theme-toggle`. `document.documentElement.dataset.theme` becomes `'dark'` and borders remain positive. Capture `calendar-dark-90.png`.
- **Phone day agenda.** Resize to `390x844` at zoom `1.0`, open `/#calendar`, click a `.cal-day.is-tappable` cell containing `.cal-dot`. `#cal-agenda .cal-agenda-title` and `.cal-chip` items appear with no horizontal overflow. Capture `calendar-phone.png`.

## Gotchas

- Firefox requires `layout.css.devPixelsPerPx` in `moz:firefoxOptions.prefs` at session creation; changing zoom after launch is unreliable.
- WebDriver BiDi `browsingContext.setViewport` hangs in Firefox 160 when `layout.css.devPixelsPerPx=0.9`, so `verify.mjs` uses classic `window/rect` for the 90% zoom desktop check and BiDi only for `< 500px` phone checks at `1.0` zoom.
- If the local calendar month has zero tasks in an unshifted fixture, phone dot selection cannot find a `.cal-dot` cell.
