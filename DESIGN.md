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
- **Card Cream** (#FFFBF0; dark: #181C3A): cards, columns, dialogs, top bar.
- **Sunk Parchment** (#EBE4D0; dark: #20254A): hover and pressed fills, alternate calendar rows, banners.
- **Rule Tan** (#CFC4A6; dark: #434C8F): card borders, dividers and the ledge shadow. Every interactive control and form field uses Soft Slate for its border (3:1).
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
**The Twenty Names Rule.** The token vocabulary is the twenty names in `:root` (bg, sf, sf2, ln, tx, mu, ac, acd, acs, onac, ok, wn, er, sh, oa and their washes). Add no app-only token.

**The Derived Veil Rule.** The overlay veil is the ink, not a colour of its own: `color-mix(in srgb, var(--tx) 48%, transparent)` on paper and 14% at night. A named scrim token is forbidden by the rule above and by the lockstep lint, and the mockup's `rgba(20,24,58,.5)` is a paper-only value - on the night page it moves the pixels by 2/255 and the modal stops reading as a layer. In night a darkening scrim cannot work at all: pure black over `--bg` tops out at 1.13:1, so the veil lightens instead.

## Typography

**Body Font:** Plus Jakarta Sans (variable, self-hosted, with system-ui fallback)
**Pixel Font:** Press Start 2P (with monospace fallback), self-hosted

**Character:** A friendly, readable workhorse paired with a tiny pixel accent. Numbers are tabular everywhere.

### Hierarchy
- **Pixel Display** (400, 16px on phones and 24px from 720px, line-height 24/32px, uppercase): page title. The calendar month, date-picker month and step counters use the 12px micro size (calendar month 16px from 720px).
- **Title** (600, 16px, 24px): task card titles, clamped to two lines.
- **Body** (400, 14px, 20px): notes, descriptions, list rows.
- **Label** (600, 12px, 16px): due badges, field labels, phone tab labels. Subject tags and chips are 700 with 0.04em tracking.
- **Pixel Micro** (400, 12px floor, uppercase): nav badges, calendar day numbers, step counters, keyboard hints.

### Named Rules
**The Pixel Is a Garnish Rule.** The pixel face never sets a sentence, a date or a time. If a classmate must read it to act, it is Plus Jakarta Sans.

## Layout

From 720px up, a single sticky top bar (64px, inset 40px to match the page column, and to the column's own edge from 1100px) carries the brand, icon tabs and theme toggle; the admin tab is raised 4px as the one distinct tab. On phones (below 720px) the same tabs move to a fixed bottom bar, reachable with one thumb. A 52px sticky brand strip stays above scrolling cards, with a 44px Settings button fixed at the top right; the theme toggle is in Settings. One centered content column has a max width of 1120px (1200px from 1280px), padding 24px 16px on phones and 32px 40px from 720px, with 16px (24px on desktop) between blocks. List view, Done and Past narrow to an 880px reading column, with the page title aligned to that column.

The board is three columns (To Do, In Progress, Done) on desktop. Below 720px both Tasks and Admin are list-only: their Board/List switches and boards are hidden without overwriting the saved desktop view. Resizing back restores that preference. Tasks rows are 12px-padded cards with 8px between them. Breakpoints: 374, 720 (labels appear next to tab icons; 720 to 819 uses tighter padding), 1100 (brand wordmark appears). Spacing runs on a 4px base (4, 8, 12, 16, 24). Shared action controls (icon buttons, tabs, chips, property fields) are at least 44px at every width, and phone touch targets are 44px. The calendar's phone month shows subject-colored boxes and lists the picked day's tasks underneath. The sheet's floor is 320px, taken as `min(320px, 100%)` on `html`, so a viewport narrower than 320 (a 320px Windows window loses 15px to its scrollbar) reflows instead of growing a horizontal scrollbar.

## Elevation & Depth

Flat, with a hard offset ledge instead of blur: cards, columns, the toast and secondary buttons sit on `0 2px 0` in Rule Tan; dialogs, the quick-add panel, the due picker and the status menu use `0 4px 0`; the primary button adds an inset bottom bar in Deep Royal plus the 2px ledge, so it reads as pressable. Pressing removes the ledge. Selected controls (view tabs, toolbar toggles, chips) swap the ledge for an inset 3px Royal bar along the bottom. The active nav tab takes a 2px Royal underline; the active Admin tab adds a 2px page-colored gap and a 4px Ink ring. On phones the active tab keeps the Royal Wash fill and the 2px underline but drops the box's side and top strokes, and the Admin tab drops its solid fill: in a bar of 72px tiles those 2px vertical edges read as stray lines beside Calendar and Past. There are no soft or blurred shadows.

### Named Rules
**The Ledge Rule.** Depth is a solid offset in the rule color. Never blur, never spread.

## Shapes

Square. Every corner is 0px; borders are 2px (Rule Tan on cards and containers, Soft Slate on controls) and turn Royal Blue on hover or focus. The checkbox is a 22px square with a 44px invisible touch area: empty (not started), a minus on blue (in progress), a check on green (done). Subject tags are 24px-high blocks with a 2px darker underside.

## Components

### Buttons
- **Primary:** Royal Blue fill, white text, 44px high, 16px side padding, Deep Royal underside bar and 2px ledge; hover deepens to Deep Royal.
- **Secondary:** Card Cream fill, Ink text, 2px Soft Slate border, 2px ledge in Rule Tan; hover fills Sunk Parchment.
- **Text button:** royal blue, 600 weight, underlined (3px offset).
- **Danger:** red outline; solid red only once the typed confirmation is correct.
- **Icon button:** 44x44 square, 2px Soft Slate border, border turns blue on hover.

### Task Card
Card Cream block, 12px padding, 2px border, ledge. Header holds the checkbox and a two-line title; footer holds the subject tag and due badge. Hover borders blue; done cards strike through the title in Soft Slate. A 6px blue square marks unpublished changes in admin. A done tap on the list leaves a stamped completion ghost that holds for a beat, then folds into the Done tab; a board card slides across instead. Undo cancels the movement, and reduced motion skips it for a short static Done-tab highlight. The title is the card's own button - the card stays click-anywhere, and the button is what the keyboard and a screen reader reach; it is also the element the two-line clamp is applied to.

### Class List Filters
Two native selects sit beside search: Subject (All plus the subjects on current tasks) and Status (All, To do, In progress, Done). To do maps to `not_started`; the existing task status controls still say Not started. Search keeps matching title, subject and notes. The List combines all three with AND; the desktop Board hides and ignores the two selects but keeps search. Phones always show the List and its filters, including when the saved desktop view is Board.

The two selections are in-memory only: reload starts at All, while switching views retains them. Subject options come from all nonhistorical tasks, independent of active filters; a vanished selected subject resets to All. Tasks without a subject appear under All only. Task order, historical exclusion, cached board data and persisted progress keep their existing behavior.

No matches shows "No tasks match these filters." and Clear filters; clearing resets search and both selects and focuses search. A genuinely empty board keeps "No tasks yet." without Clear. A status change that removes a matching row announces "Hidden by the Status filter" and focuses the Status select. An open task dialog retains focus until closed; Undo restores the task, progress and a live task control.

### Archive Rows (Done, Past)
From 1100px, each archive item uses five tracks: 24px status, a title with a 200px floor, 104px subject, 112px status/date and content-sized actions. Between 720px and 1099px, the title spans a card's first row and metadata shares the second row with actions. Below 720px, every card has three rows: title, metadata, then right-aligned wrapping actions, including single-action rows. Actions keep 44px targets. The title remains a button inside a list item. Delete arms to "Confirm?" for 4s before removal; the toast offers Undo.

### Pinned Announcements
Every pinned announcement shows in full on desktop. The collapse is a phone affordance only: below 720px the block shows the newest item clamped to two lines with a "Show all N" toggle, so the first task row stays on the first screen. A resize across 720px re-applies the right state without a reload. When empty, the entire public announcements area is hidden at every width. The admin announcement composer remains available.

### Due Badge
12px label with a calendar or alarm icon; due soon (within 3 days) uses amber on an amber wash, overdue uses red on a red wash, otherwise Soft Slate.

Tasks due today or tomorrow precede the overdue backlog in the shared list. Compact due text includes the date and optional time; long date descriptions remain available in the task dialog.

### Inputs / Fields
44px high, 2px Soft Slate (`--mu`) border for 3:1 contrast, white (dark: night) fill, square. Focus swaps the border to Royal Blue plus a 2px outline with 2px offset. The due picker is one combined date-and-time field with a "time is optional" hint. On phones every text-entry control is 16px so iOS does not zoom on focus.

The due picker stays within the available viewport with 8px side clearance, including scrollbar space. Below 480px the preset selector takes its own full-width row above Apply and Delete.

### Navigation
Icon tabs (top bar on desktop, bottom bar on phones): 48px high, 2px transparent border, Soft Slate icons slightly desaturated (saturate .7). Active tab: Royal Wash fill, Royal border and a 2px blue underline. Admin is a solid blue tab raised 4px on a 4px ledge. Badges are 20px Royal squares in pixel type (red for overdue counts). Labels sit beside the icons from 720px (720 to 819px uses tighter padding and a 16px bar inset); on phones the bar shows labels under the icons. Phone order: Tasks, Calendar, Admin (centre, president only), Done, Past. Settings sits in a fixed top-right 44px button, and the theme toggle is hidden on phones (Settings > Appearance: System, Light, Dark). Admin is not raised on phones, and the phone bar carries no box strokes: the active tab is a Royal Wash block with the 2px blue underline and no border, and the Admin tab is a plain tab whose shield and count badge mark it.

### Admin Bar
Save (secondary) and Publish (primary) close the row; Preview as student, History and Discard changes sit directly beside them as text buttons, one press away, wrapping inside the 64px bar on phones (44px targets). "Publish" is the single verb for releasing to the class. The public list on Tasks is headed "Pinned"; the admin composer is headed "Announcements".

### Admin Subjects and Presets
Subjects and the recycle bin sit in collapsible panels below the task-editing area. New subjects use an inline form with an editable code before creation; the code becomes immutable afterward. Tasks store codes, while subject tags, filters and update notices show configured names. Renaming or retiring a subject never retags existing tasks. Custom colours receive readable foreground text.

Applying a preset previews added, changed, retired and removed subjects in the shared in-app confirmation dialog. Cancel, Escape and backdrop clicks leave the draft unchanged; explicit Apply changes only the draft catalogue. Publish is still required to release it. Confirmation starts on Cancel, traps Tab, restores focus to Apply, and uses the same interruptible motion as task reopening.

### Icons
Two icon languages, on purpose: pixel sprites for navigation and theme controls, and 1.75-stroke square-cap line SVGs inside pages (search, pin, trash, chevrons). In forced-colors mode every tab shows its label and the active tab takes a Highlight outline.

### Loading and Feedback
Buttons in flight show a 14px square-edged spinner (700ms) after the label. Data areas use Sunk Parchment skeleton blocks pulsing between 100% and 50% opacity over 1.2s. The toast is an Ink-filled block with a 2px ledge, lifted to 92px above the phone tab bar.

Toasts size to their content within the viewport. Long messages wrap without shrinking the Undo action; that action has a 44px target.

### Dialogs and Quick Add
Card Cream panel, 2px border, 4px ledge, max 640px, header separated by a 2px rule. Open and close are one interruptible 180ms opacity fade that starts from the current opacity, so a rapid reopen or close retargets instead of snapping; no CSS modal entrance competes with it. Quick add parses "GENMATH worksheet ip 10/5" live into Task, Subject, Status and Due fields, with chips for subjects, statuses and dates.

Read-only task fields use a sunk surface and quiet border instead of suggesting an editable input. The subject picker supports arrow keys, selection and Escape without also closing the task dialog. Night-mode primary hover keeps the accessible accent fill and adds an inset edge rather than darkening the text background.

### Calendar
Month and week grids with 1px-rule cells, alternate rows in Sunk Parchment, today shown as a blue square behind the pixel day number, chips with a status-colored left edge.
Phone month cells pack up to three unfinished subject-colour squares with a 4px gap; a fourth or later task adds a small `+` at the bottom right. Completing a task repacks the remaining squares without changing the day's task list.
The accessible day label keeps the total task count and, when completed tasks exist, separates unfinished and completed counts so it explains the remaining markers.

## Do's and Don'ts

### Do:
- **Do** keep every corner square and every border 2px.
- **Do** build depth only with the solid ledge in Rule Tan (`0 2px 0` or `0 4px 0`).
- **Do** use Royal Blue for selection, focus and in-progress only.
- **Do** keep the pixel font to titles, micro-labels and numerals; keep dates and times in tabular Plus Jakarta Sans.
- **Do** keep shared action controls at least 44px, phone text entry at 16px and 44px phone touch targets, and test both themes at 320px.
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
