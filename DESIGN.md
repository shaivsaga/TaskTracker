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

<!-- impeccable:design-map -->
Name: TaskTracker
Colors: paper #F4EFE2, card #FFFBF0, card-sunk #EBE4D0, rule #CFC4A6, ink #1A1D3D, ink-soft #585C84, royal #2E4FB3, royal-deep #1F3A8A, royal-wash #DDE5FF, go #1F7A49, caution #8A5A00, alert #B3261E, night #0F1226, night-card #181C3A (+10 more in the frontmatter)
Fonts: Plus Jakarta Sans (body, title, label); Press Start 2P (display-pixel)
Spacing: xs 4px, sm 8px, md 12px, lg 16px, xl 24px, page 40px
Radius: none 0px
North Star: "The Pixel Study Hall"** *(named from the implemented look; confirm or rename.)*
Rules:
- The One Voice Rule. Royal blue is the only accent.
- The Calm Urgency Rule. Overdue is red text on a faint wash, labeled in plain words ("2 days overdue", "Expired", "Closed"); no alarm fills, no shaming language.
- The Twenty Names Rule. The token vocabulary is the twenty names in `:root` (bg, sf, sf2, ln, tx, mu, ac, acd, acs, onac, ok, wn, er, sh, oa and their washes).
- The Derived Veil Rule. The overlay veil is the ink, not a colour of its own: `color-mix(in srgb, var(--tx) 48%, transparent)` on paper and 14% at night.
- The Pixel Is a Garnish Rule. The pixel face never sets a sentence, a date or a time.
- The Phone Fold Rule. On a phone the first task card must clear the fixed tab bar without a scroll.
- The Ledge Rule. Depth is a solid offset in the rule color.
Don't:
- Don't use rounded corners, blurred shadows, gradients or glassmorphism.
- Don't add a second accent color or a new token outside the twenty.
- Don't show "Missed", "Failed", scores, streaks, leaderboards or any comparison between students.
- Don't set sentences, dates or times in Press Start 2P.
- Don't bring back the left sidebar; navigation lives in the top bar on desktop and the bottom bar on phones.
- Don't use color alone to signal status; pair it with the checkbox glyph or a text label.
Do:
- Do keep every corner square and every border 2px.
- Do build depth only with the solid ledge in Rule Tan (`0 2px 0` or `0 4px 0`).
- Do use Royal Blue for selection, focus and in-progress only.
- Do keep the pixel font to titles, micro-labels and numerals; keep dates and times in tabular Plus Jakarta Sans.
- (+5 more)
Map: assets/sprites-light.svg
Map: assets/sprites-dark.svg
Full: .impeccable/design-full.md (read a section when you need its detail)
