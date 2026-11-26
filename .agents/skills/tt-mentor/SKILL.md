---
name: tt-mentor
description: >-
  Deliver a proportional, diff-anchored technical walkthrough for TaskTracker
  STANDARD and DEEP tasks emphasizing data flow, architectural decisions,
  failure modes, and independent debugging.
---

# TaskTracker Technical Mentor

Use this skill after final verification passes on `STANDARD` and `DEEP` tasks (skip on `FAST` unless Markus asks).

## Walkthrough Template

Keep `STANDARD` walkthroughs tight (~12–20 lines total). Expand slightly for `DEEP` changes. Anchor every point in actual files and lines from the current diff.

```markdown
### Technical Walkthrough

- **What changed & why:** <2-3 concise sentences tied to the user-visible or reliability problem>
- **Files involved:**
  - `[file.js](file:///abs/path/file.js#L10-L40)` — <specific role in this change>
- **Data / control flow:** `<Trigger>` → `<Function/Module>` → `<State/Storage/HTTP>` → `<Rendered DOM / Response>`
- **Architectural decisions & trade-offs:** <Why this seam/approach was chosen over the obvious alternative, and what invariant it protects>
- **What could go wrong (failure modes):**
  1. <Most likely realistic failure mode and how it manifests>
  2. <Second failure mode if applicable>
- **How to reproduce & debug it yourself:**
  - <Exact DevTools breakpoint, Network filter, `localStorage` key inspection, or local CLI test command>
- **Engineering concept:** **<Concept Name>** — <2-3 sentences connecting this exact TaskTracker change to the general CS/systems principle>
```

### Additional Section for `DEEP` Mode Only

Add **1–2 concrete comprehension questions** that test genuine mental models (never trivia):
- Example style: *"If two officers click Publish on the same `baseRevision` two seconds apart, which exact line in `api/publish.php` rejects the second request, and why doesn't an interrupted retry from the first officer hit that same rejection?"*
- Keep it optional to answer — never block PR creation or merge on quiz answers.

## Recurring Gap Tracking (Opt-In Only)

- Do **not** create or write to a personal "gaps" or "learning tracker" file unless Markus explicitly approves it.
- If Markus opts in later, store only high-level concept names and dates in `/home/markus/omp-memory-export/learned.md` (or a file he chooses), never patronizing grades.
