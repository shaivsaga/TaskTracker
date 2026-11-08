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
- Pixel-stepped, sub-second motion; reduced motion is honored.

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

From 720px up, a single sticky top bar (64px, inset 40px to match the page column, and to the column's own edge from 1100px) carries the brand, icon tabs and theme toggle; the admin tab is raised 4px as the one distinct tab. On phones (below 720px) the same tabs move to a fixed bottom bar, reachable with one thumb, and a 44px Settings button sits fixed at the top right; the brand and theme toggle are hidden there. Below the top bar on desktop, or on phones above the bottom bar, one centered column: max 1120px (1200px from 1280 up), padding 24px 16px on phones and 32px 40px from 720px, with 16px (24px on desktop) between blocks. List view and Done narrow to 720px and stay left-aligned with the page title, never centered under it.

The board is three columns (To Do, In Progress, Done) on desktop. On phones the Tasks page is list-only: the Board/List switch and the board are hidden, and rows are 12px-padded cards with 8px between them. Breakpoints: 374, 720 (labels appear next to tab icons; 720 to 819 uses tighter padding), 1100 (brand wordmark appears). Spacing runs on a 4px base (4, 8, 12, 16, 24). Touch targets are 44px on phones. The calendar's phone month shows subject-colored boxes and lists the picked day's tasks underneath.

## Elevation & Depth

Flat, with a hard offset ledge instead of blur: cards, columns, the toast and secondary buttons sit on `0 2px 0` in Rule Tan; dialogs, the quick-add panel, the due picker and the status menu use `0 4px 0`; the primary button adds an inset bottom bar in Deep Royal plus the 2px ledge, so it reads as pressable. Pressing removes the ledge. Selected controls (view tabs, toolbar toggles, chips) swap the ledge for an inset 3px Royal bar along the bottom. The active nav tab takes a 2px Royal underline; the active Admin tab adds a 2px page-colored gap and a 4px Ink ring. There are no soft or blurred shadows.

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
- **Icon button:** 40x44 square, 2px Soft Slate border, border turns blue on hover.

### Task Card
Card Cream block, 12px padding, 2px border, ledge. Header holds the checkbox and a two-line title; footer holds the subject tag and due badge. Hover borders blue; done cards strike through the title in Soft Slate. A 6px blue square marks unpublished changes in admin. A done tap plays a four-step pixel "stamp" (scale 1.6 to 1 in 400ms), only with motion allowed.

### Due Badge
12px label with a calendar or alarm icon; due soon (within 3 days) uses amber on an amber wash, overdue uses red on a red wash, otherwise Soft Slate.

### Inputs / Fields
44px high, 2px Soft Slate (`--mu`) border for 3:1 contrast, white (dark: night) fill, square. Focus swaps the border to Royal Blue plus a 2px outline with 2px offset. The due picker is one combined date-and-time field with a "time is optional" hint.

### Navigation
Icon tabs (top bar on desktop, bottom bar on phones): 48px high, 2px transparent border, Soft Slate icons slightly desaturated (saturate .7). Active tab: Royal Wash fill, Royal border and a 2px blue underline. Admin is a solid blue tab raised 4px on a 4px ledge. Badges are 20px Royal squares in pixel type (red for overdue counts). Labels sit beside the icons from 720px (720 to 819px uses tighter padding and a 16px bar inset); on phones the bar shows labels under the icons. Phone order: Tasks, Calendar, Admin (centre, president only), Done, Past. Settings sits in a fixed top-right 44px button, and the theme toggle is hidden on phones (Settings > Appearance: System, Light, Dark). Admin is not raised on phones.

### Admin Bar
Save (secondary) and Publish (primary) lead; Preview as student, History and Discard changes sit in a native `<details>` "More" menu (2px border, 4px ledge). "Publish" is the single verb for releasing to the class. The public list on Tasks is headed "Pinned"; the admin composer is headed "Announcements".

### Icons
Two icon languages, on purpose: pixel sprites for navigation and theme controls, and 1.75-stroke square-cap line SVGs inside pages (search, pin, trash, chevrons). In forced-colors mode every tab shows its label and the active tab takes a Highlight outline.

### Loading and Feedback
Buttons in flight show a 14px square-edged spinner (700ms) after the label. Data areas use Sunk Parchment skeleton blocks pulsing between 100% and 50% opacity over 1.2s. The toast is an Ink-filled block with a 2px ledge, lifted to 92px above the phone tab bar.

### Dialogs and Quick Add
Card Cream panel, 2px border, 4px ledge, max 640px, header separated by a 2px rule. Quick add parses "GENMATH worksheet ip 10/5" live into Task, Subject, Status and Due fields, with chips for subjects, statuses and dates.

### Calendar
Month and week grids with 1px-rule cells, alternate rows in Sunk Parchment, today shown as a blue square behind the pixel day number, chips with a status-colored left edge.

## Do's and Don'ts

### Do:
- **Do** keep every corner square and every border 2px.
- **Do** build depth only with the solid ledge in Rule Tan (`0 2px 0` or `0 4px 0`).
- **Do** use Royal Blue for selection, focus and in-progress only.
- **Do** keep the pixel font to titles, micro-labels and numerals; keep dates and times in tabular Plus Jakarta Sans.
- **Do** keep 44px touch targets on phones and test both themes at 320px.
- **Do** use calm status words: Expired, Closed, Done.
- **Do** honor `prefers-reduced-motion` and `prefers-contrast: more` (the latter promotes the remaining Rule Tan borders to Soft Slate); motion is short and stepped (dialogs and pages 140ms steps(3), cards 160ms).

### Don't:
- **Don't** use rounded corners, blurred shadows, gradients or glassmorphism.
- **Don't** add a second accent color or a new token outside the twenty.
- **Don't** show "Missed", "Failed", scores, streaks, leaderboards or any comparison between students.
- **Don't** set sentences, dates or times in Press Start 2P.
- **Don't** bring back the left sidebar; navigation lives in the top bar on desktop and the bottom bar on phones.
- **Don't** use color alone to signal status; pair it with the checkbox glyph or a text label.
