# Independent UX Audit — dsct.dev (TaskTracker)

**Auditor:** independent review requested by the site's author (a high school class president who built and runs the site for classmates)
**Date of testing:** 2026-10-28 · **Live site:** https://dsct.dev
**Method summary:** source read of the app (local repo verified byte-identical to live for `app.js`, `logic.js`, `styles.css`), then live interactive testing with Playwright on desktop (~1280×800 / 1528×686, mouse + keyboard) and mobile layout at 390×844 (viewport emulation — see Limitations).

## 0. Update — P5 continuation (2026-11-01)

The original findings below are preserved unchanged. This section records what has since been fixed on `main` (verified in source at `origin/main` `2222eb4`, which carries merged PRs #23–#29) and what remains. Severity labels below use the P0–P3 scale (P0 = core action broken for real users, P3 = polish); the body's High/Medium/Low map to P0/P1/P2–P3 respectively.

**Verification method and its limit:** all statuses below come from reading the merged code, not from running the app (static-analysis-only continuation). "Fixed (code)" means the fix is present and tested in the repo; it still deserves one live re-check after the next deploy. Screenshots `12-…` and `20-…` document the pre-fix behaviour — they were taken 2026-10-28, before the fixes landed.

**Citation re-check (2026-11-01, resumed run):** every `file:line` citation in this section and in the finding bodies was re-read against the `2222eb4` worktree. Three were tightened — C3 `1599–1607` → `1597–1603`, C9 `1602–1606` → `1600–1603`, and C1's branch identifier (`calPhone.matches` → `phoneMonth`, attributes at `1356–1359`). No finding was added, removed, or re-graded by this pass.

**Harness evidence (same baseline):** `node --test tests/*.test.js` in this worktree → **52 tests, 50 pass, 1 fail, 1 skip**. The single failure is `tests/ci-workflows.test.js:40` ("post-deploy-hardening.yml lost its workflow_run trigger"), which is the known Windows-CRLF `workflow_run` regex miss already fixed on `ov/fix-crlf-guard` (PR #30) — a checkout line-endings artefact, not an app defect. CI on Linux is green.

### Fixed since the audit

| Finding | Status | Verified where |
|---|---|---|
| A1 popover off-screen (P0) | **Fixed (code)** — popover position now goes through `clampPopoverPosition()` (logic.js:324), a pure, unit-tested helper; `openStatusPopover` applies it (app.js:~1650) | PRs #23–#25; range review `.claude/reviews/pr-22-to-25-range-review.md` |
| A2 deep links (P1) | **Fixed (code)** — `pageFromHash` on init (app.js:3407) and a `hashchange` listener (app.js:2456); history navigation included | PR #24 (70e3067) |
| B1 silent reopen (P1) | **Fixed (code)** — popover reopen toasts the *actual* target status with Undo (`statusChangeMessage`, logic.js); the kanban drag path got the same toast+Undo, and Undo now refreshes an open task dialog | PR #25 (8107799) + PR #26 (9eaed6b), which also fixed the wrong-toast-copy defect the range review found in #25 |
| C5 dialog Escape drops focus (P2) | **Fixed (code)** — `closeTaskDialog` restores focus to the opener via `dialogReturn` (app.js:440, 482–488); Escape routes through the same close path (app.js:677) | present at `2222eb4` |
| E3 psychological tail of silent reopen | **Fixed** by B1 | — |

### Still open (re-verified in current code)

| Finding | Status | Evidence |
|---|---|---|
| C1 desktop calendar cells not keyboard-accessible (P1) | **Open** — `role="button"`, `tabindex` and aria-labels are applied only inside the `phoneMonth` branch (`calPhone.matches && calMode === 'month'`, app.js:1337) at app.js:1356–1359; desktop cells remain bare divs | app.js:1340–1372 |
| C3 popover ARIA gaps (P2) | **Partially fixed** — the real popover now has `role="listbox"` and `role="option"` (app.js:1597–1603). Still missing: no `aria-label` on the listbox, no `aria-selected` on any option (the current status is unmarked for screen readers), and the real status-check triggers have only `aria-label="Change status"` (app.js:1659) without `aria-haspopup`/`aria-expanded` — while the tutorial's sample popover *has* all of them (app.js:2926–2927, 2939) | app.js:1593–1660, 2926–2939 |
| C2 `aria-current` on today (P3) | **Partially fixed, with a new defect** — see new finding C8 below | app.js:1294, 1358 |
| C4 search results not announced (P2) | **Open** — `.column-empty` and the list empty state still have no live region (index.html:178–258; nothing in app.js announces result counts) | — |
| C6 no skip link (P3) | **Open** — no skip link in index.html | — |
| B2 two confirm patterns (P3) | **Open** — modal `confirmReopen` (popover/drag/dialog paths) coexists with the inline 2-tap "Confirm?" (app.js:1147–1148) | — |
| B3 admin vs class search (P3) | **Open** — admin matcher is still title+subject only (app.js:1398–1403); class matcher includes notes (app.js:1442) | — |
| B4 inline "Confirm?" subtle on mobile (P3) | **Open** | app.js:1147 |
| D1 two calendar implementations (P3) | **Open** (same root as C1) | — |
| D2 tutorial popover vs product popover (P3) | **Partially open** — listbox roles now match; ARIA-state attributes still don't (see C3) | — |
| E1 overdue emphasis, E2 device-bound progress framing (P2, hypotheses) | **Open** — wording-level hypotheses, unchanged; still need real student feedback, not more audit | — |

### New findings from this pass

**C8 · `aria-current` is set to `"true"` instead of `"date"`, and only on phone/month cells — P3 · Both**
- **Observation:** where the calendar does set the attribute, it uses `aria-current="true"` (app.js:1294 on the selected day via `calSelect`, app.js:1358 on the picked phone-month cell). The ARIA spec for a today/date marker expects `aria-current="date"`; `"true"` is a legal but semantically weaker value. The desktop month/week cells set no `aria-current` at all — today is only `.is-today` styling there.
- **Repro:** inspect `#cal-grid .cal-day` in the DOM on desktop vs 390px phone width.
- **Recommendation:** use `aria-current="date"` and set it on today's cell in every view, not the selected cell. One-line each. **Complexity: S.**
- **Acceptance:** today's cell exposes `aria-current="date"` in desktop month, desktop week, and phone month.

**C9 · Popover options are interactive `<button role="option">` elements — P3 · Both (informational)**
- **Observation:** `ensureStatusPopover` renders options as `<button type="button" role="option">` (app.js:1600–1603). `role="option"` overrides the button's native role; screen readers may then drop button semantics/activation hints. This is a pragmatic pattern that works in practice, but the cleaner fix is a plain listbox with `aria-activedescendant`, or dropping the role attribute and letting the buttons be a menu.
- **Recommendation:** low priority; decide once when doing C3. **Complexity: S.**

### Re-verification acceptance tests (post-deploy, for the fixed items)

1. **A1:** at 390×844, tap the status checkbox on the bottom card of a ≥6-row list → all three options visible and tappable; desktop ~700px viewport height, bottom row, mouse click on "Done" works. (Screenshots `12-`, `20-` must no longer be reproducible.)
2. **A2:** paste `dsct.dev/#calendar` into a fresh tab → Calendar opens; `#done`, `#past` likewise; sidebar navigation still pushes history entries.
3. **B1:** reopen a Done task via the popover to "In progress" → toast reads "Marked in progress" (not "not done") with a working Undo; drag a done card out of Done → same toast+Undo.
4. **C5:** open a task dialog from a card, press Escape → focus returns to the card.

---

## 1. Executive summary

dsct.dev is a genuinely well-built tool for its job. The core loop — see assignments, mark your own progress, check the calendar — works on desktop and mobile, the accessibility foundations are far better than typical for a one-person student project (visible focus, focus traps, screen-reader announcements, Undo toasts, reduced-motion support), and contrast passes WCAG AA in both themes. The psychology is mostly on the right side: private per-device statuses, no public shaming, neutral-to-reassuring wording, forgiving confirmations.

The audit found **one confirmed functional defect that matters**, and it is at the heart of the product: **the status popover is positioned below the trigger without checking the viewport, so on a phone, tapping the status checkbox on a card near the bottom of the screen makes the menu open entirely off-screen — the student sees nothing happen.** On desktop the same bug hides the "Done" option for bottom rows. This is the single most important thing to fix, and the fix is small (clamp the popover inside the viewport).

Second tier: reopening a Done task from the popover is completely silent (no toast, no Undo — while every other status change confirms itself), deep links like `dsct.dev/#calendar` don't work, and the desktop calendar is not keyboard-accessible (the mobile one is — the fix is to bring desktop up to parity).

Nothing found requires a redesign. Every P0/P1 recommendation below is a small, targeted change.

---

## 2. Scope and method

**What was reviewed:** the live student-facing site end to end — Class tasks (list + board), search, status changes (popover, drag-and-drop, task dialog), Completed page, Past page, Calendar (month + week), Settings (tutorial, transfer, theme), plus navigation, keyboard access, touch-target geometry, and contrast in both themes.

**Evidence types used:**
- Live interaction (Playwright, desktop Edge): every result marked Pass below was actually performed.
- Rect measurements from the live DOM (touch targets, popover geometry, dialog fit).
- Computed-style contrast sampling in dark and light themes.
- Source inspection of `app.js` / `logic.js` / `styles.css` (byte-identical to live) to confirm root causes and check what couldn't be triggered live.
- Screenshots (files `01-…`–`21-…` in the repo folder, untracked).

**What was intentionally not done:** no admin sign-in (out of scope), no real accounts created, no class data altered. All status changes made during testing were recorded and restored; final state disclosed in §13.

---

## 3. What works well (verified, not flattery)

These were tested, not assumed:

- **The core loop works everywhere.** Marking done, reopening, board drag-and-drop, search, calendar, Completed/Past pages all function on desktop and mobile layout.
- **Undo where it counts.** Mark-done, deletes, imports, and transfers all get an 8-second Undo toast; destructive admin actions (publish/clear/reset) require typed confirmation. This is a forgiving system.
- **Screen-reader feedback.** `#action-feedback` live region announces "Marked done. Undo available." etc.; toasts are announced.
- **Accessibility foundations:** global visible focus outline (`:focus-visible`, 2px accent), focus traps in all overlays, logical tab order, `prefers-reduced-motion` fully honored, `prefers-contrast: more` supported, labeled controls throughout.
- **Contrast passes AA everywhere sampled, both themes** (worst combo 5.8:1, body text 6.2–7.8:1). Dark and light are both real, consistent themes.
- **Mobile adaptations are thoughtful:** drawer nav, single-column board, vertical week view, month view as tap-to-select day + agenda list — and the mobile calendar cells are *more* accessible than desktop's (proper buttons with "1 task, 1 overdue" labels).
- **Touch-target engineering:** the 16px status checkbox grows to a ~42px hit area via a `::after`; header buttons are 44×44.
- **Language is kind:** "Nothing is lost, and you can still mark things done." (Past page), "Someday" for undated tasks, helpful empty states instead of blank guilt.
- **Privacy by design:** statuses live per-device in localStorage, never published; no feeds of who-hasn't-done-what. For a class of teenagers this is the correct default.
- **Offline handling:** cached board + "Offline. Showing the last synced version." banner.
- **Trust plumbing:** QR/link transfer with 10-minute expiry and explicit cancel; typed "RESET" to wipe.

---

## 4. Workflow results table

*(Rows below reflect the 2026-10-28 live tests. For what changed since, see §0 — notably row 6/7 (A1, fixed), 10 (B1, fixed), 13 (A2, fixed).)*

| # | Workflow | Device | Result | Notes |
|---|----------|--------|--------|-------|
| 1 | First-visit tutorial (6 steps, skip, replay) | Desktop | **Pass** | Restarts at step 1 from Settings |
| 2 | Class tasks — list view render + overdue/due labels | Desktop, Mobile | **Pass** | |
| 3 | Class tasks — board render, column counts | Desktop, Mobile | **Pass** | Single-column stack on mobile |
| 4 | Drag & drop between columns | Desktop | **Pass** | Restored afterward |
| 5 | Status change via popover — visible rows | Desktop | **Pass** (mouse) / **Pass** (keyboard) | |
| 6 | Status change via popover — bottom rows | Desktop | **Partial** | "Done" option off-screen, mouse-blocked (A1) |
| 7 | Status change via popover — bottom cards | Mobile | **Fail** | Entire menu off-screen, nothing visible (A1) |
| 8 | Mark done → toast + Undo + announcement | Desktop, Mobile | **Pass** | |
| 9 | Task dialog open/edit/status | Desktop, Mobile | **Pass** | Focus-loss-on-Escape issue (C5) |
| 10 | Reopen Done → confirm modal (popover path) | Desktop | **Pass** | But silent afterward (B1) |
| 11 | Reopen via Completed page inline confirm | Desktop, Mobile | **Pass** | Two taps, 4 s window |
| 12 | Search (filter, clear, empty states, notes matching) | Desktop, Mobile | **Pass** | Results not announced to SRs (C4) |
| 13 | Deep links (`#calendar`, `#done`, …) | Desktop | **Fail** | Loads Class tasks, URL misleading (A2) |
| 14 | Completed page + timestamps | Desktop, Mobile | **Pass** | |
| 15 | Past page (closed tasks, mark done) | Desktop, Mobile | **Pass** | "Expired" label **Not Verified** (no >7-day task in live data) |
| 16 | Calendar month view + chips → dialog | Desktop, Mobile | **Pass** | Desktop cells not keyboard-reachable (C1) |
| 17 | Calendar week view | Desktop, Mobile | **Pass** | Vertical list on mobile |
| 18 | Calendar "+N more" overflow | — | **Not Verified** | No day has 3+ tasks in live data |
| 19 | Settings: theme toggle + persistence | Desktop, Mobile | **Pass** | |
| 20 | Settings: QR/link transfer + cancel | Desktop | **Pass** | Link revoked after test |
| 21 | Admin (draft, publish, history, admin search) | — | **Not Verified** | Sign-in out of scope; admin search source-reviewed only (B3) |
| 22 | Drag while search-filtered | — | **Not Verified** | Would mutate live board data; HTML5 DnD + Playwright unreliable |
| 23 | Real touch input (finger, on-screen keyboard) | — | **Not Verified** | Mobile pass used viewport emulation |

---

## 5. Findings

Severity: **High** = blocks or silently breaks a core task for real users · **Medium** = significant friction or exclusion · **Low** = polish. "Device" is where observed; several apply to both.

### A — Confirmed functional defects

**A1 · Status popover opens off-screen near the viewport bottom — High · Mobile (+ Desktop)**
- **Observation:** the popover is `position: fixed`, placed at `trigger.bottom + 4px` with no viewport clamping ([app.js:1628](app.js:1628)). Measured live at 390×844: a card's checkbox at y≈826 produces a popover at y 846–962 — **entirely below the fold; nothing is visible** (screenshot `20-mobile-popover-offscreen.png`). A tap appears to do nothing. Mid-screen (y=549) is fine (565–681); y≈728 clips the "Done" option by ~17px. On desktop (686px viewport) the "Done" option for bottom rows is fully off-screen and mouse-unreachable (keyboard still works).
- **Why it matters:** changing status is the product's core action. On phones — where this site will mostly be used — the bottom ~140px of every screen silently kills it.
- **Recommendation:** after positioning, measure the popover and clamp/flip it inside the viewport (you already do this for the subject dropdown — reuse that logic). **Complexity: S.** Essential.

**A2 · Deep links don't work — Medium · Both**
- **Observation:** loading `dsct.dev/#calendar` (or any hash) renders Class tasks; navigation only happens on sidebar clicks (no `hashchange` handling). The URL says `#calendar` while the screen shows Class tasks.
- **Why it matters:** bookmarks, browser reloads, and any link shared in a class group chat land somewhere else than promised — on a site whose URL is shared via chat, this is a real trust-eroder.
- **Recommendation:** on load (and on `hashchange`), read the hash and call the existing `setPage()`. **Complexity: S.** Essential.

### B — Confirmed usability problems

**B1 · Reopening a Done task from the popover is silent — Medium · Both**
- **Observation:** the popover's reopen path ([app.js:1586-1591](app.js:1586)) only sets status + re-renders: no toast, no live-region announcement, no Undo. The Completed-page reopen toasts "Marked not done" with Undo ([app.js:1122](app.js:1122)); mark-done gets toast + Undo + haptic ([app.js:79-81](app.js:79)).
- **Why it matters:** un-submitting work is the *anxiety-relevant* direction — it's the one action where a student most wants confirmation that it worked, and it's the only one that gives none.
- **Recommendation:** show the same "Marked not done" + Undo toast from the popover path. One line of reuse. **Complexity: S.** Essential.

**B2 · Two different confirm patterns for the same action — Low · Both**
- **Observation:** reopening Done asks via a modal dialog on the popover path, but via an inline two-tap "Confirm?" (4-second window) on the Completed/Past pages. Both work; they're just different.
- **Recommendation:** acceptable to keep both, but if you touch this code, prefer one (the inline pattern is lighter). The inline confirm's label could say what's confirmed ("Confirm reopen?"). **Complexity: S.** Optional.

**B3 · Admin and class search behave differently — Low · Desktop (admin)**
- **Observation:** class search matches title + subject + note text ([app.js:1414-1416](app.js:1414)); the admin `#task-search` matches title + subject only ([app.js:1371-1377](app.js:1371)). Same-looking inputs, same user (the admin is also a classmate), different behavior.
- **Recommendation:** include note text in the admin matcher too. **Complexity: S.** Optional.

**B4 · Inline "Confirm?" is subtle on mobile — Low · Mobile**
- **Observation:** the confirm button renders ~59×21px visual (hit expansion unverified), with a 4-second window and a bare "Confirm?" label.
- **Recommendation:** rely on the existing `::after` hit-area trick here too, if not already. **Complexity: S.** Optional.

### C — Accessibility

**C1 · Desktop calendar day cells are not keyboard-accessible — Medium · Desktop**
- **Observation:** desktop cells are bare `<div>`s — no `tabindex`, no role, no labels; only chips are Tab-reachable. The **mobile** implementation is correct: `role="button"` divs with full aria-labels ("Friday, October 23, 1 task, 1 overdue"), roving tabindex, arrow-key support.
- **Recommendation:** bring desktop up to the mobile implementation (you already wrote it). **Complexity: M.** Essential.

**C2 · `aria-current="date"` missing on today — Low · Both.** Today is styled (`.is-today`) but not announced. One attribute. **Complexity: S.**

**C3 · Status popover ARIA gaps — Low · Both.** The listbox has no label, options lack `aria-selected` (current status unmarked), and the 19 trigger buttons lack `aria-expanded`/`aria-haspopup`. Notably the tutorial's sample popover *has* them — the product should match its own demo. **Complexity: S.**

**C4 · Search results not announced — Low · Both.** Filtering to 2 or 0 results changes the DOM silently for screen readers (no live region on the empty/column messages). **Complexity: S.**

**C5 · Task dialog Escape loses focus — Low-Medium · Desktop.** Escape closes the dialog but focus drops to `<body>` (verified twice); Settings and the reopen modal restore focus to their openers. Keyboard users restart from the top of the page. **Complexity: S.**

**C6 · No skip link — Low.** Seven tab stops before content on every page. A visually-hidden "Skip to tasks" link is a small win. **Complexity: S.**

**C7 · Drag-and-drop is mouse-only — note, not a defect.** On touch there is no drag at all, and the popover is the only alternative. That's a viable single path (it works, with Undo), so this is acceptable as-is — but it's the reason A1 hurts so much on mobile: the popover is *the* path, and it's the broken one.

### D — Visual inconsistencies

**D1 · Desktop vs mobile calendar are different implementations — Low.** Structure, semantics, and accessibility differ (see C1). Users won't see both side-by-side, but consistency would halve future maintenance.
**D2 · Tutorial sample popover vs real popover — Low.** The demo has correct ARIA; the product doesn't (see C3).
Overall visual consistency is otherwise strong: one spacing scale, one radius, coherent dark/light themes, consistent chip/tag language.

### E — Psychological risks (hypotheses — need real student feedback, not certainties)

**E1 · "N days overdue" is the loudest text on the page — Medium (hypothesis).** Red, repeated, sorted to the top. It's honest and conventional, and the private data model means no one else sees it. But for students already avoiding a task, the page's most prominent element is an accusation. Consider whether a 5-day-overdue item and a 5-minutes-overdue item deserve the same volume, and whether the board's first section should sometimes be "Due soon" rather than the overdue pile. Label: hypothesis.
**E2 · Per-device progress can feel like data loss — Medium (hypothesis).** A student who marks everything done on a school computer sees it all "undone" at home. Transfer exists, but nothing tells a first-time user their progress is device-bound until they've already lost the feeling. The list page's "Your progress is saved on this device only" line is good — it appears *after* they've started. Consider surfacing it in the tutorial (one step) and in the empty Completed state. Label: hypothesis.
**E3 · The silent reopen (B1) has a psychological tail.** Un-submitting without feedback can read as "did it even register?" — for anxious students this invites re-checking loops. Same fix as B1.
**What's already right:** "Someday" instead of "No date", the reassuring Past-page copy, private statuses, no streaks/points/leaderboards, neutral empty states. The defaults here are kind; keep them.

### F — Speculative ideas (validate with classmates before building)

- **Search by date words** ("november", "fri") — students think in deadlines; today "november" returns 0 despite two November tasks. *(Small.)*
- **Subject filter chips** alongside search — faster than typing "GENSCI". *(Small.)*
- **A "due within 48h" cue** in the list (e.g., the existing "In 6 days · 11:59 PM" could escalate visually in the last two days). *(Small.)*
- **Keyboard shortcuts for students** — `n` and `/` exist but are admin-only; `/` focusing search costs one line. *(Tiny.)*
Nothing here should ship before a couple of classmates say they want it — the site's discipline (no feature creep) is one of its strengths.

---

## 6. Top 10 findings (ranked)

| # | Finding | Cat | Severity | Fix size |
|---|---------|-----|----------|----------|
| 1 | Popover opens off-screen for bottom cards (mobile: whole menu invisible) | A1 | High | S |
| 2 | Reopen via popover: no toast, no Undo, no announcement | B1 | Medium | S |
| 3 | Deep links (`#calendar` etc.) land on the wrong page | A2 | Medium | S |
| 4 | Desktop calendar cells not keyboard-accessible (mobile impl. is correct) | C1 | Medium | M |
| 5 | Task dialog Escape drops focus to `<body>` | C5 | Low-Med | S |
| 6 | Popover listbox/trigger ARIA gaps (no `aria-selected`, `aria-expanded`, label) | C3 | Low | S |
| 7 | Search result changes not announced to screen readers | C4 | Low | S |
| 8 | Two confirm patterns for the same action | B2 | Low | S |
| 9 | Admin vs class search inconsistency (notes searchable only for students) | B3 | Low | S |
| 10 | Overdue framing + device-bound progress not surfaced early (psychology hypotheses) | E1/E2 | Medium (hypothesis) | S |

---

## 7. Prioritized recommendations

*(Status as of 2026-11-01: items 1–3 are done on `main` — see §0. The next actionable pass is item 4 (C1 desktop calendar parity), then 5–7 (C3 remainder, C4), then the P2 batch.)*

**P0 — fix before classmates rely on the site (all small):**
1. **Clamp the status popover inside the viewport** (A1). Reuse the subject-dropdown clamping. Also benefits the due-picker and any fixed menu.
2. **Toast + Undo + live announcement on popover reopen** (B1). Reuse the Completed-page toast.
3. **Honor the URL hash on load and `hashchange`** (A2).

**P1 — next pass:**
4. Desktop calendar parity with mobile cells + `aria-current="date"` (C1, C2).
5. Popover ARIA: label, `aria-selected`, `aria-expanded`/`aria-haspopup` (C3).
6. Restore focus to opener when the task dialog closes (C5).
7. `aria-live` on search result/empty messages (C4).

**P2 — polish and ideas:**
8. Unify confirm pattern (or at least clarify the inline label) (B2, B4).
9. Match admin search to class search (B3).
10. Skip link (C6).
11. F-ideas only after asking classmates (dates in search, subject chips, due-soon cue, `/` shortcut).

---

## 8. Suggested implementation sequence

1. A1 popover clamp (small, highest payoff — test in both view sizes and both list/board views).
2. B1 reopen toast (a few lines, same file area as A1).
3. A2 hash routing (small, self-contained; test bookmarks + reload on each page).
4. C5 focus restore (one `focusRestoreTarget` like the confirm modal already has).
5. C3 popover ARIA (touches the same popover code as 1–2 — natural to do together).
6. C1/C2 calendar desktop parity (bigger of the small jobs; mobile code is the reference implementation).
7. C4, C6, B3, B2/B4 — batch the leftovers.

---

## 9. Acceptance tests for the P0s

**A1 — popover clamp:**
1. At 390×844, open a task list with ≥6 rows; tap the status checkbox on the last visible card → the menu must be fully visible (all three options tappable), above or below the trigger.
2. Scroll that card to the very bottom of the screen, tap → same result.
3. Desktop at ~700px viewport height, bottom list row, mouse: click "Done" → task moves to Submitted/Done.
4. Verify the subject dropdown and due picker still position correctly (no regression).

**B1 — reopen feedback:**
1. Mark a task done; via popover, choose "Not started" → confirm modal appears; accept → a "Marked not done" toast with a working Undo appears, and `#action-feedback` announces it.
2. Press Undo within 8 s → task returns to Done.

**A2 — deep links:**
1. Paste `dsct.dev/#calendar` into a fresh tab → Calendar opens.
2. Repeat for `#done`, `#past`, `#class-tasks`.
3. From Calendar, click sidebar "Class tasks" → navigates; press Back → returns to Calendar.

---

## 10. Design & visual identity (brief)

The visual system is coherent and confident: single accent blue, one spacing scale, 4px radii, quiet surfaces with strong hierarchy, subject tags as a stable color language, red reserved (mostly) for overdue. Dark default with a real light theme. No decorative noise. If anything, the overdue red is the only "loud" element — see E1. Verdict: keep the identity; nothing here needs design work beyond the fixes above.

## 11. Psychology review (brief, for a high-school audience)

The product's psychological defaults are unusually considerate: private statuses, no comparison surfaces, forgiving copy, Undo everywhere, neutral "Someday", reassuring Past page. The residual risks are the overdue emphasis (E1), the invisibility of the device-bound data model (E2), and the silent reopen (B1/E3). All are wording/visibility-level fixes, not redesigns. The most valuable next input is not more audit — it's asking 3–5 classmates what they think happens to their data and what the red labels make them feel.

## 12. Accessibility summary

Strong foundations (focus visibility, traps, live regions, reduced motion, contrast AA both themes, mobile calendar). Gaps are narrow and all small: desktop calendar keyboard access (C1), popover ARIA (C3), Escape focus loss (C5), result announcements (C4), skip link (C6), `aria-current` (C2). None require architectural change.

## 13. Testing state disclosure

All statuses changed during testing were restored: final progress state = all five entries `not_started` (original `movedAt` timestamps differ — cosmetic only). Theme key is explicitly `"dark"` (previously unset default; identical rendering). One transfer link was created and then cancelled (10-minute expiry, so it was dead regardless). No server-side or class-visible data was created or modified at any point. No admin sign-in was performed.

## 14. Limitations and questions for real student feedback

**Limitations of this audit:**
- Mobile pass = desktop-browser viewport emulation (390×844): layout, media queries, and tap geometry are real; real-finger input, on-screen keyboards, iOS/Android-specific behaviors were not tested.
- Admin features untested live (no sign-in, per scope). Admin search findings are source-verified only.
- Not verifiable with current live data: "Expired" label (>7 days overdue), "+N more" calendar overflow, drag-while-filtered behavior.
- Firefox/Safari not tested (Escape-clears-search is Chromium-native behavior; other browsers may differ).
- Live `index.html` differs from the local branch under review; all interactive findings were re-verified against the live site, so no finding depends on local markup.

**Questions worth asking classmates (cheap, high-signal):**
1. Did you ever tap something and "nothing happened"? (Would surface A1 in the wild.)
2. What do you think happens to your checkmarks when you open the site on another device? (Tests E2.)
3. How do the red "N days overdue" labels make you feel — helpful or stressful? (E1.)
4. Have you ever un-marked a task as done? Did you trust that it worked? (B1.)
5. Do you use the calendar, or just the list? (Informs where polish matters most.)

---

*End of report. Working notes and per-phase evidence: `AUDIT_HANDOFF.md`.*
