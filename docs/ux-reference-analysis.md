# UX reference analysis: the four owner-supplied design references

Reference record, written 2026-11-01 against `main` @ `5d7da89` and the `feat/ux-redesign` worktree @ `6aee63f`.

The agent brief says, in as many words, *do not write another audit or report document*. This is not an audit and
not a findings report: it is the record of the four files the owner supplied - what they are, what they require,
where they disagree with each other, and how the current build differs. Nothing in it is implemented and no
approval is assumed. Every measurement below was taken with the tools named next to it.

---

## 1. The four references

| | File | Full path | Bytes | Modified |
|---|---|---|---|---|
| A | `TaskTracker UI redesign agent brief.pdf` | `%USERPROFILE%\Downloads\` | 89,521 | 2026-10-30 17:48:09 |
| B | `TaskTracker redesign full conversation handoff.pdf` | `%USERPROFILE%\Downloads\` | 141,199 | 2026-10-30 17:07:52 |
| C | `TaskTracker-redesign-mockup(3).html` | `%USERPROFILE%\Downloads\` | 119,323 | 2026-10-31 17:00:36 |
| D | `TaskTracker redesign v2.html` | `%USERPROFILE%\Downloads\` | 818,632 | 2026-10-31 17:02:43 |

Originals untouched. The v2 gallery was opened, its two packed pages were unpacked to
`_agent-scratch/v2/` for reading, and both PDFs were text-extracted to `_agent-scratch/pdf/`. Both PDFs report
no embedded images, so there are no screenshots or diagrams inside them to inspect - the handoff's screenshots
are referenced in prose, not embedded.

Also present in Downloads and **superseded**: `TaskTracker-redesign-mockup.html`, `(1).html`, `(2).html` -
118,207 bytes each, identical SHA256 (`52eeb9a363704e98...`), modified 15:46:02, 15:46:53 and 16:05:25. They are
three copies of one earlier revision and are not references.

---

## 2. How each was inspected

- **A and B (PDFs)** - `pypdf` text extraction; page count, per-page character count, image count and producer
  metadata read directly. Read end to end, not skimmed.
- **C (mockup(3))** - raw HTML/CSS/JS read: 516 lines, one file, custom properties, media queries, and the
  interaction script.
- **D (v2)** - it is a `__bundler` gallery, so it was unpacked rather than read: a gzipped, base64 manifest
  (793,401 chars) plus a 1,183-char template naming two pages in order, `34093058-...` then `eb14bc6c-...`. Each
  page expanded to roughly 415 KB of self-contained HTML with its fonts inlined as data URIs. Extracted to
  `_agent-scratch/v2/page1_34093058.html` and `page2_eb14bc6c.html`; the two component sheets were split out to
  `phone.html` and `desktop.html` for line-by-line reading.
- **D, rendered** - opened in headless Chromium through `playwright-core` (installed in a temp directory, not in
  project dependencies) at window 1400x1780 to clear the taller of the two frames. Screenshot at
  `_agent-scratch/shots/ref-v2-gallery.png`.

---

## 3. What the references require

### 3.1 Scope and process (reference A)

UI and UX only. Preserve all existing functionality. Do not bundle this with the `app.js` modularization or with
security work. Do not assume any pull request is merged or deployed - base decisions on the actual repository
state. Ask the owner only when a decision would change behaviour or remove a feature. Verify at roughly 390px
phone and at desktop, in both light and dark. Report in about ten lines.

Direction: this is an *operate* surface, so scanability beats expression. Pixel-flavoured identity with a readable
interface. BedaLink is a visual reference only - do not import its structure.

### 3.2 The ten design rules (reference A, binding)

1. **Mobile first.** On phones the board becomes a status switcher (To do / In progress / Done) with one list per
   status; a four-item bottom tab bar (Tasks, Calendar, Done, Past); Admin and Settings behind a menu; the pinned
   announcement collapses to one line that expands on tap.
2. **One layout frame.** One content width and one page header shared by every page on desktop.
3. **Urgency tiers.** 2 days or less hot, 3 to 7 warm, later quiet. Hot means a coloured due pill. Done items are
   collapsed by default on the board. An overdue task that is not yet Past uses the hot tier with calm wording
   (*Past due*), never red alarm language. Past tasks keep neutral wording (Closed or Expired).
4. **Subject colours** come from the class schedule, amplified at most slightly. Separate the warm trio (PKLP,
   PE, PERDEV) so they are distinguishable. Every subject gets a colour - no grey tags. Always show the subject
   code. Never rely on colour alone.
5. **Pixel font only** for the wordmark, headings and big decorative numbers. Task titles, notes and instructions
   in a clean readable font. Dates, times and countdowns in a clean font with tabular figures. No dim microtext.
   AA contrast in both themes.
6. **Themes follow the device setting.** Light and dark are both fully designed, from shared tokens.
7. **Progress and reward.** Marking done plays a pixel check-stamp animation under one second, every time. In
   board view the card then slides into Done - on phones toward the Done tab, whose count ticks up. In list view
   only the stamp plays. Unchecking is silent. Marking done shows a brief Undo. Clearing everything due soon
   produces a larger *Done for today* moment. No sound by default. Light vibration on phones where supported.
   Respect reduced motion. No streaks.
8. **No comparison between students.** No leaderboards, rankings or points. Progress is personal and stays on the
   device.
9. **Calendar** keeps the existing month grid; each day shows its number plus small subject-coloured boxes
   without names, and `+N` when there are too many; tapping a day shows task names and details below the grid.
10. **Admin and controls.** Quick-add is touch-friendly; keyboard-shortcut hints are hidden on touch screens; real
    buttons with one clear primary action; Delete must look different from Restore; long links become a short
    *Open link* action.

### 3.3 Glossary (reference A - these words are load-bearing)

*Done* is the single word for completed work: the status, the column and the page. Never *Completed*, never
*Submitted*. A *Past task* is closed or seven days overdue and is always neutral. *Urgency tier* is hot, warm or
quiet. *Pinned announcement* is the one-line bar. *Draft and Apply changes* describes the admin flow.

### 3.4 ADRs the brief asks to be recorded

1. No comparison between students, ever.
2. Pixel is identity only, never the typeface for text people must read in order to act.
3. Light and dark are both first-class, following the device setting.

### 3.5 Reference B: owner context and working style

The owner wants concise replies, agents making routine decisions, short reports, and *no endless audits*. The
handoff records that the agent that produced it **could not inspect the repository or run design-skill scripts**, so
its picture of the app comes from 20 desktop and 2 phone screenshots rather than from code. It ran three rounds
of design questioning. Its suggested prompt for a stronger model was: read the handoff and the brief, refine the
direction without changing the settled decisions in section 6, start with open items 1 to 4, propose specific
tokens and type choices, keep it concise, and flag anything in the research table that cannot be verified.

### 3.6 Reference B: findings about the app as it was

These are the observations that motivated the redesign. They describe the app *before* this work, so they are
useful as a checklist of what the redesign must have fixed:

- **Inconsistent page widths** - board about 1270px, list and Done about 815px, Past tasks nearly full width,
  stretching a single row across 1,000px.
- **Everything the same visual weight**, so nothing guides the eye.
- **Done items took a third of the board.**
- **No progress feedback** beyond a checkbox.
- **Subject colour underused**, with several subjects rendered grey.
- **The white admin badge was the highest-contrast element on the page.**
- Mono, uppercase and hairline borders read as a developer tool rather than a student's planner.
- **Underlined links acting as buttons.**
- **Delete styled identically to the Restore next to it.**
- The admin bar had five mixed-style actions, and a *disabled* Apply still looked primary.
- The calendar opened on a month where everything was already done.

### 3.7 Reference B: the look the owner likes

BedaLink (the retro pixel version specifically) preferred; also Codedex and NovusGFX, and
`https://novusgfx.github.io/retro-design-system/docs/` is named in reference A as the retro reference.

### 3.8 Reference B: the research table

One row is cited in full: Sailer and Homner 2020, *Educational Psychology Review* 32(1), 77-112 - gamification
produces small positive effects on cognitive outcomes (g = 0.49) and motivation (g = 0.36), with behaviour change
less stable. The leaderboards and badges row was partially pruned from the handoff. Rule 8 settles the product
question regardless: no comparison between students.

---

## 4. The design system, extracted exactly

From the v2 component sheet (`_agent-scratch/v2/phone.html`), which repeats the identical token block in its
desktop sibling. Reference C carries the same palette with different variable names.

```css
/* light */
--bg:#F8F4EA  --sf:#FFFFFF  --ink:#1B1A17  --mu:#55514A  --ln:#1B1A17
--ac:#2257D9  --onac:#FFFFFF  --hot:#B3361D  --onhot:#FFFFFF
--wb:#FFF0C7  --wt:#5E3B00  --ok:#1E7B3A  --sh:#1B1A17
/* dark */
--bg:#14131A  --sf:#1E1D27  --ink:#F2EFE8  --mu:#B4B0C2  --ln:#6A6785
--ac:#7FA8FF  --onac:#0F1020  --hot:#F4896C  --onhot:#2A0D06
--wb:#3A2E10  --wt:#F2C45A  --ok:#5CCB86  --sh:#000
```

Reference C adds `--surface2:#F1EBDC`, `--soft:#CFC7B4`, `--danger:#A82A16`, `--accentsoft:#E3EBFB`, a sun ramp
`--sun1..--sun4` (`#FFE3A8 #FFC27A #F59A5A #E26B4B`), and a spacing scale `--s1:4px` through `--s16:64px`.

**Geometry**: `--r:4px`, `--bw:2px`, `--lift:4px`, `--frame:1120px`, `--rail:336px`, `--gutter:16px` (32px at
840px and up), `--ease:cubic-bezier(.2,.7,.2,1)`.

**Type**: `--ui: Inter` for everything readable; `--px: 'Press Start 2P'` for the wordmark, headings and big
numbers only. The root carries `font-variant-numeric: tabular-nums`, so dates and counts line up.

**Components, verbatim:**

```css
.card{display:flex;gap:4px;background:var(--sf);border:2px solid var(--ln);
      border-left:4px solid <subject>;border-radius:4px;padding:8px 12px 12px 4px;
      box-shadow:0 4px 0 var(--sh)}          /* hard lift, no blur */
.cb{44x44}  .box{24x24;border:2px solid var(--ink);border-radius:4px}
.tag{12px/16px 700;border:2px solid var(--ln);border-radius:4px;padding:2px 8px}
.pill{12px/16px 700;padding:4px 8px;border-radius:4px}
.pill.hot{background:var(--hot);color:var(--onhot)}
.pill.warm{background:var(--wb);color:var(--wt);border:2px solid var(--wt)}
.pill.quiet{color:var(--mu);padding-right:0}   /* quiet has no background at all */
.ttl{16px/24px 600}   .meta{14px/20px;color:var(--mu)}
.btn{min-height:44px;min-width:44px;border:2px solid var(--ln);border-radius:4px;padding:0 16px}
.btn.pri{background:var(--ac);color:var(--onac)}
.meter{display:flex;gap:4px}  .meter span{flex:1;height:12px;border:2px solid var(--ln)}
.meter span.on{background:var(--ok)}  .lbl{12px/16px 700;color:var(--mu)}
.seg{grid;repeat(3,1fr);border:2px solid var(--ln)}   /* phone status switcher */
.seg button{min-height:44px}  .seg button.on{background:var(--ac);color:var(--onac)}
.tabs{grid;repeat(4,1fr);border-top:2px solid var(--ln)}   /* phone bottom bar */
.tabs a{min-height:64px;color:var(--mu);12px 700}
.tabs a.on{color:var(--ac);box-shadow:inset 0 3px 0 var(--ac)}
.nav a{min-height:44px;padding:0 12px;color:var(--mu);600 14px}
.nav a.on{color:var(--ink);box-shadow:inset 0 -3px 0 var(--ac)}   /* desktop nav */
.pin{min-height:44px;border:2px solid var(--ln);border-radius:4px}
```

**Structure.** Desktop: header with a 2px bottom border, inner `max-width:1120px`, padding `12px 32px`, gap 24px -
wordmark TASKTRACKER in Press Start 2P at 16px/24px, then nav (Tasks, Calendar, Done 3, Past), then a primary
*Quick add* and a *Menu*. Main is `max-width:1120px`, padding 32px, gap 24px; `h1` in the pixel face at 24px/32px;
a sub-line *Section A - Sat, Oct 31 - Progress stays on this device*; a 280px meter labelled *1 of 4 due soon are
Done*; a one-line pinned bar; then a three-column board, `repeat(3,1fr)` gap 24px, headers 20px/28px with counts.

Phone: 16x16 accent square plus the wordmark at 12px, primary *Quick add* and *Menu*; the `h1`; the meta line; the
meter and label; the one-line pinned bar; a three-way status switcher with counts; one list of cards; the four-tab
bottom bar.

**Urgency wording**: *Past due*, *Due tomorrow*, *In 2 days* (hot), *In 5 days* (warm), *In 12 days* (quiet).

**Subject triples** `--s-<CODE>` / `--sc-<CODE>` / `--st-<CODE>`:

| Subject | Solid | Soft | Tint |
|---|---|---|---|
| CP104 | `#5188F6` | `#EEF3FE` | `#CBDBFC` |
| GENSCI | `#58ECFD` | `#EEFDFF` | `#CDF9FE` |
| GENMATH | `#D55DC1` | `#FBEFF9` | `#F2CEEC` |
| FINMATH | `#97ABFF` | `#F5F7FF` | `#E0E6FF` |
| EFFCOM | `#4FD8A6` | `#EDFBF6` | `#CAF3E4` |
| MABKOM | `#CBAF6E` | `#FAF7F0` | `#EFE7D4` |
| PKLP | `#E66F2D` | `#FCF1EA` | `#F8D4C0` |
| PE | `#F7CD54` | `#FEFAEE` | `#FDF0CC` |
| PERDEV | `#F7CD54` | `#FEFAEE` | `#FDF0CC` |
| THEOLOGY | `#A3B0BD` | `#F6F7F8` | `#E3E7EB` |

---

## 5. Relationship between the four files

```
2026-10-30 17:07:52  B  full conversation handoff   (6 pp)  -> requirements, owner context, findings
2026-10-30 17:48:09  A  agent brief                 (3 pp)  -> the binding rules, glossary, ADRs
2026-10-31 15:46-16:05   mockup.html / (1) / (2)          -> one earlier revision, three copies, superseded
2026-10-31 17:00:36  C  mockup(3).html            (516 ln)  -> interactive behaviour prototype
2026-10-31 17:02:43  D  redesign v2.html         (2 pages)  -> the rendered visual specification
```

- **A and B are the requirements.** They are a day older than the mockups and were written before any HTML
  existed. Where a mockup and a rule disagree, the rule wins, because the rules are what the owner signed off.
- **D is the visual specification.** It is the newest file and the only one that states a rendering at both target
  viewports. It shows the phone in dark and the desktop board in light, which is deliberate: it demonstrates that
  both themes are first-class rather than showing one theme twice.
- **C is the behaviour specification.** It is two minutes older than D and carries the same palette, but it is
  interactive: settings, quick add, delete confirmation, the subjects panel, the check stamp, Undo, *Done for
  today*, and a mock date control.
- **Superseded**: `mockup.html`, `(1)`, `(2)` - identical bytes, one earlier revision, no THEOLOGY in the subject
  set and a different subject ordering.

---

## 6. Differences between the two packed v2 mockups

| | Phone page (`34093058`) | Desktop page (`eb14bc6c`) |
|---|---|---|
| Title | Tasks (phone) | Tasks (desktop) |
| Frame | 390x844 | 1280x820 |
| Theme shown | dark | light |
| Component CSS | identical, repeated verbatim | identical, repeated verbatim |
| Shell | accent square + wordmark + quick add, `h1`, meta, meter, pinned bar, `.seg` switcher, card list, `.tabs` | wordmark + `.nav` + quick add, `h1` + meta + meter, pinned bar, 3-column board |
| THEOLOGY colour | `#A3B0BD` | `#8FA6C4` |

So the two pages are the same system rendered twice for two contexts. The one substantive disagreement between
them is a single subject colour, and the phone value agrees with reference C while the desktop value does not.

---

## 7. Current implementation state and gaps (measured)

Taken 2026-11-01 with the headless harness at `_agent-scratch/pw/verify.mjs`, light and dark at 1280x820 and
390x844, against the restored worktree at `http://localhost/TT-wt-ux/`.

**Healthy.** The app loads as five scripts (`qrcode.js`, `qr-draw.js?v=10`, `attachments.js?v=1`,
`logic.js?v=6`, `app.js?v=4`) with zero page errors, zero console errors and zero failed requests. Page-level
horizontal overflow is 0 at both widths. Contrast passes AA everywhere measured: task card 14.51, due badge 8.12,
subject tag 8.00, column header 16.07, brand 16.07. The shared frame is already the reference value:
`--content-w: 1120px`. Typography roles are already split correctly - brand and headings render `Press Start 2P`,
task titles and column headers render `Inter`.

**Gaps, each with the evidence:**

| # | Gap | Evidence | Severity |
|---|---|---|---|
| G1 | The new markup does not exist, so three `app.js` code paths are inert | `.tabbar`, `.status-switch` and `.column-toggle` occur **0** times in `index.html`, while `app.js:2578`, `app.js:2588` and `app.js:2591` query them | high - rules 1 and 3 unimplemented on phones |
| G2 | The theme does not follow the device | `data-theme` is `dark` in **all four** contexts, including `colorScheme: light`. The boot script does `localStorage.getItem('class_tasks_theme') || 'dark'` | high - rule 6 |
| G3 | Touch targets below 44px | `.status-check` 24x24 (and overflows itself: scrollWidth 30 vs clientWidth 20), `.view-tab` 69x40 and 56x40, `.sidebar-toggle` 32x32, one input 40 tall | high - rules 1 and 10 |
| G4 | Transition timing differs from the reference | `--ease` is `cubic-bezier(0.32, 0.72, 0, 1)` at `styles.css:58`; the reference is `cubic-bezier(.2,.7,.2,1)` | low |
| G5 | Per-subject triples are absent | The app has no `--s-<CODE>` / `--sc-<CODE>` / `--st-<CODE>` set; it carries one `--tag` and one `--st` | medium - rule 4 |
| G6 | Due badges and subject tags render in IBM Plex Mono | computed `font-family` is `"IBM Plex Mono", ui-monospace, ...` for both; the reference uses the UI font at 12px/16px 700 with tabular figures | medium - rule 5 |
| G7 | Rule 7 feedback is absent | No check-stamp, no card slide, no Undo on done, no *Done for today* | medium |
| G8 | Rule 9 calendar day boxes | Not verified in this pass | unknown |

Token reconciliation between `styles.css` and reference C: **33 identical, 2 differing, 44 app-only, 41
reference-only**. The app already carries the reference palette (`--bg:#F8F4EA`, `--accent:#2257D9`,
`--hotbg:#B3361D`, `--warmbg:#FFF0C7`, `--done:#1E7B3A`, the sun ramp, `--r:4px`, `--lift:4px`,
`--shadow:#1B1A17`). The reference-only set is mostly the per-subject triples, `--frame`, `--rail`, `--ui`, `--px`
and the `--s10/--s12/--s16` steps.

---

## 8. Unresolved contradictions and owner decisions

1. **PE and PERDEV are given the identical colour `#F7CD54` in reference C and in both v2 pages**, which
   contradicts rule 4's requirement to separate the warm trio. The contradiction is inside the owner's own
   references, so it cannot be resolved by inspecting them. Recommendation: separate them minimally inside the
   warm family, keep AA in both themes, and confirm with the owner.
2. **THEOLOGY is `#A3B0BD` in the phone page and in reference C, but `#8FA6C4` in the desktop page.** The phone
   value has two votes to the desktop's one, so `#A3B0BD` is the better default, but this needs one word from the
   owner.
3. **Dark-mode subject tints are unspecified.** The references define the light `--sc-` and `--st-` values and a
   dark block for surfaces, ink, accent and pills - but no dark subject tints. The app has invented its own
   (`CP104 #2B395D`, `GENSCI #2D535F`, `GENMATH #4E2E4F`, `FINMATH #3D425F`, `EFFCOM #2B4E48`, `MABKOM #4B4339`,
   `PKLP #523229`, `PE #564B33`, `PERDEV #564B33`, `THEOLOGY #41434E`). These are app-authored, not owner-supplied,
   and inherit the PE/PERDEV collision.
4. **`--rail:336px`** appears in reference C but not in v2's two pages. Whether the subject rail ships on desktop
   is undecided by the references.
5. **The brief says not to write another report.** This document exists because the session asked for it. It is
   scoped as a reference record, not an audit, and it should not grow into one.
6. **`app.js:337`'s 8-second budget** is the board fetch, not a body fetch. No body fetch exists yet. Any S1b
   design that cites 8 seconds as an existing body-fetch budget is citing the wrong thing.

---

## 9. Prioritized implementation plan

1. **Close G1** - add the missing markup `app.js` already queries: the four-item bottom tab bar, the status
   switcher with `[data-status-filter]`, and a `.column-toggle` per board column. This is the difference between a
   redesign and a reskin, and it is pure addition to `index.html`.
2. **Close G2** - default the theme to the device and honour `prefers-color-scheme`, keeping a stored override.
3. **Close G3** - raise every measured touch target to 44px.
4. **Close G5 and G2's palette half** - the ten per-subject triples, with an explicit answer to contradiction 1.
5. **Close G6 and G4** - move due badges and subject tags to the UI font with tabular figures; align `--ease`.
6. **Close G7** - the check stamp, the slide into Done, Undo, and the *Done for today* moment, all gated on
   reduced motion.
7. **Then** rule 9's calendar day boxes, and re-measure rules 3 and 10 across both viewports.

---

## 10. What could not be verified here

- **The orchestrating model cannot read images.** `read_image` fails with *does not declare image input*, so the
  v2 gallery screenshot and every app screenshot are evidence by measurement, not by looking. Visual judgements in
  this document come from computed styles, geometry, contrast ratios and overflow counts. No claim here rests on
  having seen a picture.
- **No rendering comparison has been produced yet** between the reference pages and the running app at matching
  viewports. The harness measures the app; it does not yet diff it against the reference.
- **nginx behaviour was not executed** - there is no nginx binary, no WSL and no running Docker daemon on this
  machine. Any nginx statement anywhere in this repository is static inspection unless it is marked otherwise.
- **Reference B's research table** was not independently checked against the journal; one row is quoted above as
  the handoff states it, and the handoff says the leaderboards row was partially pruned.