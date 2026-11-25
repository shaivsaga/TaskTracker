---
name: tt-weekly-review
description: >-
  Optional weekly continuous-improvement review of the TaskTracker
  orchestration system. Collects objective evidence from git history, PRs,
  verification logs, and memory/OKF health, and proposes at most 3
  evidence-backed improvements requiring explicit human approval.
---

# TaskTracker Weekly Orchestration Review

Run on demand (or via an approved T3 Code `schedule_task` — never schedule without Markus's explicit approval).

## Step 1: Collect Objective Evidence

Run the read-only telemetry collector:

```bash
node .agents/workflows/weekly-review-collect.mjs --days 7
```

Inspect:
- Commit / PR volume, fixup or revert patterns, and branch naming hygiene (`overnight/*` drift).
- Saved orchestration/verification logs in `/tmp/tt-orch-logs/` (if present): pass/fail rates, fix-cycle counts, slow checks, repeated failure classes.
- Knowledge drift: `CURRENT_STATE.md` line count (target `<80` lines), `okf-sync.mjs --bundle tasktracker --check`, and whether `verify-board-sync` sync commit matches recent sync edits.
- Repeated human interventions or model-policy slips.

## Step 2: Analyze Against 8 Lenses

1. Repeated agent failures
2. Unnecessary coordination / over-orchestrated FAST tasks
3. Missed regressions (caught late by CI or Markus instead of local checks)
4. Excessive context/token consumption
5. Inefficient model selection (within allowed models only — never propose banned models)
6. Repeated human interventions
7. Documentation / memory / OKF drift
8. Opportunities to simplify or delete orchestration rules

## Step 3: Propose Maximum 3 Improvements

Output **at most 3** ranked proposals. If the system ran cleanly with no clear signal, propose **0** changes and say so — never invent busywork.

For every proposal, include all 7 fields:
1. **Observed problem**
2. **Supporting evidence** (exact commit SHAs, PR numbers, log counts, or timings — never invented)
3. **Proposed change** (exact file/script edit)
4. **Expected benefit**
5. **Potential downside**
6. **Validation method** (how to measure whether it helped next week)
7. **Rollback plan** (exact revert step)

## Step 4: Hard Approval Gate

**Stop after presenting the proposals.** Never modify `.agents/`, `AGENTS.md`, or orchestration rules until Markus explicitly approves which proposals (if any) to apply.
