# Past archive

The `#page-past` section (route `/index.html#past`) lists closed tasks and tasks more than one week past due with calm short due dates (or `No due date`), no status checkboxes, and zero overflow down to `320px`.

## Sub-features

- `desktop-past-labels-and-structure` verifies every `#past-list .past-row` has four child elements, zero `.status-check` controls, and calm short date labels (or `No due date`) in `.task-row-due`.
- `phone-320-no-overflow` verifies `scrollWidth <= innerWidth` when `#page-past` is viewed at `320x568`.

## How to get to it (user POV)

- Click the `Past` tab in the navigation bar or open `/index.html#past`.
- Resize to a `320px` phone width and scroll the archived list.

## Driving it with verify.mjs

Preconditions:

- Ephemeral fixture includes both closed tasks (`closedAt > 0`) and expired tasks (`> 7` days past due).

- **Desktop structure and labels.** Open `/index.html#past` at `1280x800` and wait for `#past-list .past-row`. Assert every row has 4 direct children, zero `.status-check` elements, and `.task-row-due` text showing a short date (such as `Nov 14`) or `No due date` rather than `Closed` or `Expired`. Capture `past-desktop.png`.
- **Phone 320px layout.** Resize viewport to `320x568`. Assert `document.documentElement.scrollWidth <= window.innerWidth`. Capture `past-phone-320.png`.

## Gotchas

- Firefox desktop clamps classic `window/rect` to `500px` minimum width, so `verify.mjs` sets `320x568` through WebDriver BiDi `browsingContext.setViewport`.
- `.done-row.past-row` omits the status checkbox track at `>=1100px` (4-column grid), switches to 3 columns at `720px–1099px`, and stacks on a 2-column grid below `720px`.
