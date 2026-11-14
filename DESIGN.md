---
name: TaskTracker
description: A calm, pixel-flavored school-portal board: warm paper or deep navy, hard 2px edges, stamped buttons.
colors:
  paper: "#F4EFE2"
  card: "#FFFBF0"
  card-sunk: "#EBE4D0"
  rule: "#CFC4A6"
  ink: "#1A1D3D"
  ink-soft: "#585C84"
  royal: "#2E4FB3"
  royal-deep: "#1F3A8A"
  royal-wash: "#DDE5FF"
  go: "#1F7A49"
  caution: "#8A5A00"
  alert: "#B3261E"
  night: "#0F1226"
  night-card: "#181C3A"
  night-sunk: "#20254A"
  night-rule: "#434C8F"
  night-ink: "#EEF0FF"
  night-ink-soft: "#A3ABDF"
  periwinkle: "#7C9BFF"
  periwinkle-deep: "#4F6FD6"
  night-wash: "#262F66"
  night-go: "#5BD08A"
  night-caution: "#F7CD54"
  night-alert: "#FF8F85"
typography:
  body:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  title:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "24px"
  label:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
  display-pixel:
    fontFamily: "'Press Start 2P', monospace"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
    letterSpacing: "0.02em"
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  page: "40px"
components:
  button-primary:
    backgroundColor: "{colors.royal}"
    textColor: "#FFFFFF"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.royal-deep}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "0 16px"
  task-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px"
  text-input:
    backgroundColor: "#FFFFFF"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "0 12px"
  nav-tile-active:
    backgroundColor: "{colors.royal-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "48px"
---

# Design System: TaskTracker

## Overview

**Creative North Star: "The Pixel Study Hall"** *(named from the implemented look; confirm or rename.)*

A school-portal dashboard drawn with a pixel hand: cream paper in light, deep indigo in dark, both fully designed and following the device setting. Surfaces are flat blocks with hard 2px edges and a short offset "ledge" underneath, so cards and buttons feel set down on a desk rather than floating. Pixel sprites and a pixel typeface appear only as small accents; everything a classmate has to read quickly is plain, tabular Plus Jakarta Sans.

Density is phone-first and calm. One royal-blue voice marks selection, focus and "in progress"; green means done; amber and red appear only for urgency, and never as a verdict on the person. The system must stay legible at 320 px and meet WCAG AA in both themes.

**Key Characteristics:**
- Square corners everywhere (0 radius), 2px borders, no blur.
- Depth is a hard offset ledge, never a soft shadow.
- Pixel typeface for labels and numerals only, never for sentences or dates.
- One tab bar for navigation, no sidebar: a sticky top bar from 720px up, a fixed bottom tab bar on phones (thumb zone), with Settings pinned top right.
- Short, continuous, sub-second motion using opacity and transform only (never box-shadow); reduced motion is honored with no movement.

## Colors

Warm paper and ink in light, indigo night in dark, with a single saturated blue. Tokens keep the same role names in both themes.

### Primary
- **Royal Blue** (#2E4FB3; dark: Periwinkle #7C9BFF): selection, focus rings, in-progress status, links, the primary button, today in the calendar.
- **Deep Royal** (#1F3A8A; dark: #4F6FD6): hover and the pressed underside of primary controls.
- **Royal Wash** (#DDE5FF; dark: #262F66): active nav tile and selected calendar day.

### Neutral
- **Paper** (#F4EFE2; dark: #0F1226): page background.
- **Card Cream** (#FFFBF0; dark: #181C3A): cards, dialogs, top bar.
- **Sunk Parchment** (#EBE4D0; dark: #20254A): board column headers, hover and pressed fills, alternate calendar rows, banners.
- **Rule Tan** (`--ln`, #CFC4A6; dark: #434C8F): dividers, calendar grid rules, the ledge shadow (`--sh`), **and every card, column and phone row border**. Against Card Cream that edge is 1.68:1 in light and 2.11:1 in night — that is the shipped look, matched to production, not an oversight: the card is identified by its ledge and its content, not by edge contrast. Every interactive control and form field keeps Soft Slate (`--mu`) for its border (3:1+).
- **Ink Navy** (#1A1D3D; dark: #EEF0FF): body text.
- **Soft Slate** (#585C84; dark: #A3ABDF): secondary text and unchecked checkbox borders.

### Status
- **Done Green** (#1F7A49; dark: #5BD08A): done checkbox and completed states.
- **Caution Amber** (#8A5A00; dark: #F7CD54): due soon, on a 12% amber wash.
- **Alert Red** (#B3261E; dark: #FF8F85): overdue, on a 10% red wash.

### Subject Palette
Ten subject tags follow the class schedule colors, always with dark ink (#14183A) text: CP104 sky #58AFFC, PKLP orange #FF9F6B, GENSCI cyan #70D1FE, EFFCOM green #8FE3A8, MABKOM sand #D8C7A0, THEOLOGY stone #C3C7D6, FINMATH101 mauve #C9A6E0, PE yellow #F7CD54, GENMATH pink #FBA6F7, PERDEV teal #7FF0E0.

### Named Rules
**The One Voice Rule.** Royal blue is the only accent. Green, amber and red are status, never decoration.
**The Calm Urgency Rule.** Overdue is red text on a faint wash, labeled in plain words ("2 days overdue", "Expired", "Closed"); no alarm fills, no shaming language.
**The Twenty Names Rule.** The token vocabulary is the twenty names in `:root` (bg, sf, sf2, ln, tx, mu, ac, acd, acs, onac, ok, wn, er, sh, oa and their washes). Add no app-only token. A name that nothing reads is deleted, not kept for a rainy day — `--ed` was retired this way.

**The Derived Veil Rule.** The overlay veil is the ink, not a colour of its own: `color-mix(in srgb, var(--tx) 48%, transparent)` on paper and 14% at night. A named scrim token is forbidden by the rule above and by the lockstep lint, and the mockup's `rgba(20,24,58,.5)` is a paper-only value - on the night page it moves the pixels by 2/255 and the modal stops reading as a layer. In night a darkening scrim cannot work at all: pure black over `--bg` tops out at 1.13:1, so the veil lightens instead.

## Typography

**Body Font:** Plus Jakarta Sans (variable, self-hosted, with system-ui fallback)
**Pixel Font:** Press Start 2P (with monospace fallback), self-hosted

**Character:** A friendly, readable workhorse paired with a tiny pixel accent. Numbers are tabular everywhere.

### Hierarchy
- **Pixel Display** (400, 24px from 720px, line-height 32px, uppercase): page title. **The phone has no pixel page title**: below 720px the title is visually hidden (still in the DOM for assistive tech) because the fixed tab bar already names the page with its active label, and the row it used to occupy was keeping the first task card under the bar. The calendar month, date-picker month and step counters use the 12px micro size (calendar month 16px from 720px).
- **Title** (600, 16px, 24px): task card titles, clamped to two lines.
- **Body** (400, 14px, 20px): notes, descriptions, list rows.
- **Label** (600, 12px, 16px): due badges, field labels, phone tab labels. Subject tags and chips are 700 with 0.04em tracking.
- **Pixel Micro** (400, 12px floor, uppercase): nav badges, step counters, keyboard hints. **Calendar day numbers are 12px/16 in a 20px box**, matching production: the 16px crispness variant was tried and reverted because the owner prefers the shipped look, so this is the one place the pixel face is knowingly softer than its 8px grid at 1.5x. On phones the numeral gets no gutter (`min-width: 0`, no padding) because a 320px grid gives a 34px day cell and anything wider overflows it.
- **Personal strip** (`.mine`): the count is Pixel Display at 32px/32px against a 16px/24px bold label on a shared baseline, 10px apart; the next-deadline line is 14px/20px and **wraps** rather than ellipsising, because clipping it was hiding the time. On phones the whole strip steps down to 24px/24px count, 14px/20px label and 12px/16px next line (70px tall instead of 112px at 320). The count covers every task that is not done and not closed, minus anything more than a week past due, which the strip names separately ("N older in Past") — it is the same set the Tasks list shows, so the two numbers agree.

### Named Rules
**The Pixel Is a Garnish Rule.** The pixel face never sets a sentence, a date or a time. If a classmate must read it to act, it is Plus Jakarta Sans.

## Layout

From 720px up, a single sticky top bar (64px, inset 40px to match the page column, and to the column's own edge from 1100px) carries the brand, icon tabs and theme toggle; the admin tab is raised 4px as the one distinct tab. On phones (below 720px) the same tabs move to a fixed bottom bar, reachable with one thumb. A 52px sticky brand strip stays above scrolling cards, with a 44px Settings button fixed at the top right; the theme toggle is in Settings. One centered content column has a max width of 1120px (1200px from 1280px), padding 24px 16px on phones and 32px 40px from 720px, with 16px (24px on desktop) between blocks. List view, Done and Past narrow to an 880px reading column, with the page title aligned to that column.

The board is three columns (To Do, In Progress, Done) on desktop. Below 720px both Tasks and Admin are list-only: their Board/List switches and boards are hidden without overwriting the saved desktop view. Resizing back restores that preference. Tasks rows are 12px-padded cards with 8px between them. Breakpoints: 374, 720 (labels appear next to tab icons; 720 to 819 uses tighter padding), 1100 (brand wordmark appears). Spacing runs on a 4px base (4, 8, 12, 16, 24). Shared action controls (icon buttons, tabs, chips, property fields) are at least 44px at every width, and phone touch targets are 44px. The calendar's phone month shows subject-colored boxes and lists the picked day's tasks underneath. The sheet's floor is 320px, taken as `min(320px, 100%)` on `html`, so a viewport narrower than 320 (a 320px Windows window loses 15px to its scrollbar) reflows instead of growing a horizontal scrollbar.

**The Phone Fold Rule.** On a phone the first task card must clear the fixed tab bar without a scroll. Measured at 320×568: brand strip 0–52, mine strip 64–134 (70px), page heading 134–250, pinned announcement 266–363, first row 379 (108px tall) against a tab bar at 504 — 125px of clearance, one whole row. That budget is why the phone drops the pixel page title (≈36px), runs the strip at 24/14/12 instead of 32/16/14 (≈42px) and clamps the collapsed announcement to one line below 375 (20px). Any change to the header, the strip or the announcement must be re-measured against those offsets; the arithmetic is in `C:\xampp\tt-overnight\reports\ui-local-critique\scan7-*.json`.

## Elevation & Depth

Flat, with a hard offset ledge instead of blur: cards, the toast and secondary buttons sit on `0 2px 0` in Rule Tan (`--sh`); desktop board columns are the same Card Cream (`--sf`) blocks as the cards, with the same 2px Rule Tan border and the same ledge — the board reads as three paper panels with cards resting on them, which is the shipped look and the one place a card sits inside a framed container on purpose. Dialogs, the quick-add panel, the due picker and the status menu use `0 4px 0`; the primary button adds an inset bottom bar in Deep Royal plus the 2px ledge, so it reads as pressable. Pressing removes the ledge. Selected controls (view tabs, toolbar toggles, chips) swap the ledge for an inset 3px Royal bar along the bottom. The active nav tab takes a 2px Royal underline; the active Admin tab adds a 2px page-colored gap and a 4px Ink ring. There are no soft or blurred shadows.

### Named Rules
**The Ledge Rule.** Depth is a solid offset in the rule color. Never blur, never spread.

## Shapes

Square. Every corner is 0px; borders are 2px (Rule Tan `--ln` on cards, board columns, phone rows and phone day cells, and on dividers and secondary containers; Soft Slate `--mu` on controls) and turn Royal Blue on hover or focus. The checkbox is a 22px square with a 44px invisible touch area: empty (not started), a minus on blue (in progress), a check on green (done). **It opens a menu, it does not toggle**: the button carries `aria-haspopup="listbox"`, the menu is 224×144 with three 44px rows (Not started, In progress, Done), and the same menu sits behind the dialog's Status button. The square shows state; the label announces "…: Not started. Change status" — this is the shipped interaction, and it is why a single tap does not tick the task. Subject tags are 24px-high blocks with a 2px darker underside.

## Components

### Buttons
- **Primary:** Royal Blue fill, white text, 44px high, 16px side padding, Deep Royal underside bar and 2px ledge; hover deepens to Deep Royal.
- **Secondary:** Card Cream fill, Ink text, 2px Soft Slate border, 2px ledge in Rule Tan; hover fills Sunk Parchment.
- **Text button:** royal blue, 600 weight, underlined (3px offset).
- **Danger:** red outline; solid red only once the typed confirmation is correct.
- **Icon button:** 44x44 square, 2px Soft Slate border, border turns blue on hover.

### Task Card
Card Cream block, 12px padding, 2px Rule Tan (`--ln`) border, ledge. Header holds the checkbox and a two-line title; footer holds the subject tag and due badge. Hover borders blue; done cards strike through the title in Soft Slate. A 6px blue square marks unpublished changes in admin. A done tap plays a four-step pixel "stamp" (scale 1.6 to 1 in 400ms), only with motion allowed. The title is the card's own button - the card stays click-anywhere, and the button is what the keyboard and a screen reader reach; it is also the element the two-line clamp is applied to.

### Archive Rows (Done, Past)
From 1100px, each archive item uses five tracks: 24px status, a title with a 200px floor, 104px subject, 112px status/date and content-sized actions. Between 720px and 1099px, the title spans a card's first row and metadata shares the second row with actions. Below 720px, every card has three rows: title, metadata, then right-aligned wrapping actions, including single-action rows. Actions keep 44px targets. The title remains a button inside a list item. Delete arms to "Confirm?" for 4s before removal; the toast offers Undo.

### Pinned Announcements
Every pinned announcement shows in full on desktop. The collapse is a phone affordance only: below 720px the block shows the newest item clamped to two lines with a "Show all N" toggle, and below 375 it clamps to one line so the first task row still clears the tab bar. A resize across 720px re-applies the right state without a reload. When empty, the entire public announcements area is hidden at every width. The admin announcement composer remains available.

### Due Badge
12px label with a calendar or alarm icon; due soon (within 3 days) uses amber on an amber wash, overdue uses red on a red wash, otherwise Soft Slate.

Tasks due today or tomorrow precede the overdue backlog in the shared list. Compact due text includes the date and optional time; long date descriptions remain available in the task dialog.

### Inputs / Fields
44px high, 2px Soft Slate (`--mu`) border for 3:1 contrast, white (dark: night) fill, square. Focus swaps the border to Royal Blue plus a 2px outline with 2px offset. The due picker is one combined date-and-time field with a "time is optional" hint. In the task dialog, the Status, Subject and Due buttons name themselves from the visible field label plus their own value (`aria-labelledby`), so a screen reader announces "Subject, Add subject" rather than an unlabelled button.

### Navigation
Icon tabs (top bar on desktop, bottom bar on phones): 48px high, 2px transparent border, Soft Slate icons slightly desaturated (saturate .7). Active tab: Royal Wash fill, Royal border and a 2px blue underline. Admin is a solid Royal tab in the same row as the others — it is **not** raised, so the bar reads as one even line. Badges are 20px Royal squares (red for overdue counts) seated inside the tab's top-right corner, never floating outside it. Labels sit beside the icons from 720px (720 to 819px uses tighter padding and a 16px bar inset); on phones the bar shows labels under the icons. Phone order: Tasks, Calendar, Admin (centre, president only), Done, Past. Settings is **not a tab**: it is a 44px icon-only button sitting immediately left of the theme toggle on desktop, and a fixed top-right 44px button on phones, where the theme toggle is hidden (Settings > Appearance: System, Light, Dark).

### Admin Bar
Save (secondary) and Publish (primary) close the row; Preview as student, History and Discard changes sit directly beside them as text buttons, one press away. The bar is a grid: on phones the status line takes its own row and the actions stack beneath it (measured 140px at 375, 192px at 320 — one 44px row per group plus the status line), while from 720px the status keeps the left edge and all three groups sit right-aligned on one 64px line. The bar holds all five in three divider-separated groups so weight descends left to right: **tools** (Preview as student, History) as quiet unbordered `--mu` links, then **draft** (Discard changes as a framed text button, Save as the secondary button), then **release** (Publish alone, filled Royal). On phones the groups drop their dividers, so no wrapped line opens with a stray rule. "Publish" is the single verb for releasing to the class. The public list on Tasks is headed "Pinned"; the admin composer is headed "Announcements".

### Admin Subjects and Presets
Subjects and the recycle bin sit in collapsible panels below the task-editing area. New subjects use an inline form with an editable code before creation; the code becomes immutable afterward. Tasks store codes, while subject tags, filters and update notices show configured names. Renaming or retiring a subject never retags existing tasks. Custom colours receive readable foreground text.

Applying a preset previews added, changed, retired and removed subjects in the shared in-app confirmation dialog. Cancel, Escape and backdrop clicks leave the draft unchanged; explicit Apply changes only the draft catalogue. Publish is still required to release it. Confirmation starts on Cancel, traps Tab, restores focus to Apply, and uses the same interruptible motion as task reopening.

### Icons
Two icon languages, on purpose: pixel sprites for navigation and theme controls, and 1.75-stroke square-cap line SVGs inside pages (search, pin, trash, chevrons). The sprite art is a **per-theme pair** — `assets/sprites-light.svg` outlines in ink `#14183A`, `assets/sprites-dark.svg` outlines in white — swapped by `--sheet` in `:root` and `:root[data-theme="dark"]`. That pair exists because a single outline cannot serve both surfaces: ink is 1.08:1 on the night surface and white is 1.15:1 on cream, so each theme needs the outline drawn against its own background. Do not collapse it into one sheet. In forced-colors mode every tab shows its label and the active tab takes a Highlight outline.

### Loading and Feedback
Buttons in flight show a 14px square-edged spinner (700ms) after the label. Data areas use Sunk Parchment skeleton blocks pulsing between 100% and 50% opacity over 1.2s. The toast is an Ink-filled block with a 2px ledge, lifted to 92px above the phone tab bar.

Toasts size to their content within the viewport. Long messages wrap without shrinking the Undo action; that action has a 44px target.

### Dialogs and Quick Add
Card Cream panel, 2px border, 4px ledge, max 640px, header separated by a 2px rule. Quick add parses "GENMATH worksheet ip 10/5" live into Task, Subject, Status and Due preview rows, but only **Subject and Due** carry chips: status is personal progress, set on your own list rather than declared at post time, and typing "ip"/"done" still parses. The Subject row is one chip, never ten: the parser's guess plus "Change subject", or a single "Add subject" when the input names nothing yet. The full list appears only after that chip is pressed, and stays revealed until the overlay closes so the row cannot re-collapse under a finger mid-choice. A fresh quick add therefore opens with five chips (Add subject, Today, Tomorrow, Date & time, and Clear once a date is set). Chips are 44px tall and the change chip is underlined so it reads as an action among values.

### Calendar
Month and week grids with 1px-rule cells, alternate rows in Sunk Parchment, today shown as a blue square behind the pixel day number, chips with a status-colored left edge.
Phone task markers use a 4px gap so their 1px outlines remain visibly separate; markers wrap inside narrow day cells. Only the three most urgent dots fit, so a day with more shows a `+N` remainder on the dot row; the cell's own accessible label always carries the true task count.

## Do's and Don'ts

### Do:
- **Do** keep every corner square and every border 2px.
- **Do** build depth only with the solid ledge in Rule Tan (`0 2px 0` or `0 4px 0`).
- **Do** use Royal Blue for selection, focus and in-progress only.
- **Do** keep the pixel font to titles, micro-labels and numerals; keep dates and times in tabular Plus Jakarta Sans.
- **Do** keep shared action controls at least 44px, phone text entry at 16px and 44px phone touch targets, and test both themes at 320px. The one documented exception is the due picker's 7-column day grid: 7 × 44 + 6 × 2px gaps needs 320px and the picker's own 320px floor leaves 288, so the day cells are 36px (40px from 720) by geometry, not by choice. Any reskin that widens the picker must raise them.
- **Do** re-measure the phone fold before changing the header, the mine strip or the pinned announcement; the budget is written down in Layout (The Phone Fold Rule).
- **Do** use calm status words: Expired, Closed, Done.
- **Do** theme the surfaces the browser brings: `scrollbar-color: var(--ln) transparent` and `caret-color: var(--ac)`, alongside the existing `::selection` and `accent-color`.
- **Do** honor `prefers-reduced-motion` and `prefers-contrast: more` (the latter promotes the remaining Rule Tan borders to Soft Slate); motion is short and continuous: interruptible 180ms opacity overlays, one local 140ms opacity-only page/view fade (no global View Transitions or per-child stagger), and 60-80ms press feedback; box-shadow never animates, and reduced mode does not move.

### Don't:
- **Don't** use rounded corners, blurred shadows, gradients or glassmorphism.
- **Don't** add a second accent color or a new token outside the twenty.
- **Don't** show "Missed", "Failed", scores, streaks, leaderboards or any comparison between students.
- **Don't** set sentences, dates or times in Press Start 2P.
- **Don't** bring back the left sidebar; navigation lives in the top bar on desktop and the bottom bar on phones.
- **Don't** use color alone to signal status; pair it with the checkbox glyph or a text label.
