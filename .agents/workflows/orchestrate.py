"""
Non-ACP / interactive-IDE Antigravity `run_workflow` script for TaskTracker STANDARD and DEEP modes.

IMPORTANT (V1 Benchmark Finding — 2026-11-25):
  Under T3 Code ACP headless mode, `run_workflow` child agents stall on unprompted tool
  approvals. Inside T3 Code ACP, follow `.agents/skills/tt-orchestrator/SKILL.md` Section 4
  (read-only Workspace="inherit" Planner, shell-free Workspace="share" or inline Engineers,
  parent-controlled sequential `verify-matrix.mjs`, and Codex `delegate_task` review).

Hard model policy enforced in code:
  NEVER uses claude-opus-5-5*, claude-sonnet-5-5*, or (unless explicitly prompted)
  gpt-6.2-sol, gpt-6.1-terra, or other non-default Codex models (active Codex review default: gpt-6.2-astra).
  Antigravity `run_workflow` agent() uses model tiers: "inherit" (Gemini 4 Neon), "pro", "flash", "flash_lite".
"""
import json
from pathlib import Path

ROOT = Path.cwd()
AGENTS_DIR = ROOT / ".agents" / "agents"

BANNED_MODEL_PATTERNS = (
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "gpt-6.2-sol",
    "gpt-6.1-terra",
)


def assert_model_allowed(model_tier):
    if not model_tier:
        return "inherit"
    lowered = str(model_tier).lower()
    for bad in BANNED_MODEL_PATTERNS:
        if bad in lowered:
            raise ValueError(f"Policy violation: model '{model_tier}' is banned by TaskTracker hard model policy.")
    if model_tier not in ("inherit", "pro", "flash", "flash_lite"):
        raise ValueError(f"Unsupported run_workflow model tier: '{model_tier}'")
    return model_tier


def load_role(name):
    p = AGENTS_DIR / f"{name}.md"
    return p.read_text(encoding="utf-8") if p.exists() else f"Role: {name}"


task = args.get("task", "").strip()
if not task:
    raise ValueError("Missing required workflow arg: 'task'")

mode = str(args.get("mode", "standard")).lower()
if mode not in ("standard", "deep"):
    raise ValueError(f"orchestrate.py handles 'standard' or 'deep' (got '{mode}'). Run FAST inline.")

base_ref = args.get("base_ref", "main")
tier_budget_cap = 3 if mode == "deep" else 2
raw_cycles = int(args.get("max_fix_cycles", tier_budget_cap))
if raw_cycles < 1 or raw_cycles > tier_budget_cap:
    raise ValueError(
        f"max_fix_cycles={raw_cycles} exceeds allowed {mode.upper()} budget (1..{tier_budget_cap})."
    )
max_fix_cycles = raw_cycles
skip_internal_review = bool(args.get("skip_internal_review", False))
approved_plan = args.get("approved_plan")

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "files_to_modify": {"type": "array", "items": {"type": "string"}},
        "invariants_checked": {"type": "array", "items": {"type": "string"}},
        "acceptance_criteria": {"type": "array", "items": {"type": "string"}},
        "work_packages": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "enum": ["frontend", "backend"]},
                    "files": {"type": "array", "items": {"type": "string"}},
                    "instructions": {"type": "string"},
                },
                "required": ["owner", "files", "instructions"],
            },
        },
        "parallelizable": {"type": "boolean"},
        "open_questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "summary",
        "files_to_modify",
        "invariants_checked",
        "acceptance_criteria",
        "work_packages",
        "parallelizable",
        "open_questions",
    ],
}

IMPL_SCHEMA = {
    "type": "object",
    "properties": {
        "owner": {"type": "string"},
        "modified_files": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
        "local_checks": {"type": "string"},
        "escalations": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["owner", "modified_files", "summary", "local_checks", "escalations"],
}

REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["APPROVE", "REQUEST_CHANGES"]},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "severity": {"type": "string", "enum": ["P0", "P1", "P2", "NIT"]},
                    "owner": {"type": "string", "enum": ["frontend", "backend"]},
                    "file": {"type": "string"},
                    "line": {"type": "integer"},
                    "issue": {"type": "string"},
                    "concrete_fix": {"type": "string"},
                },
                "required": ["severity", "owner", "file", "issue", "concrete_fix"],
            },
        },
        "checked_assumptions": {"type": "array", "items": {"type": "string"}},
        "unnecessary_complexity": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "findings", "checked_assumptions"],
}

VERIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "overall": {"type": "string", "enum": ["PASS", "FAIL", "PASS_WITH_UNVERIFIED"]},
        "ledger_markdown": {"type": "string"},
        "failing_checks": {"type": "array", "items": {"type": "string"}},
        "remaining_uncertainty": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["overall", "ledger_markdown", "failing_checks", "remaining_uncertainty"],
}

# --- Phase 1: Plan ---
if approved_plan:
    plan = approved_plan
    log("Using owner-approved plan.")
else:
    phase("Architect & Plan")
    planner_prompt = f"""{load_role('architect-planner')}

Repository root (read ONLY files under this directory): {ROOT}
Task ({mode.upper()} mode):
{task}

Base git ref: {base_ref}
Read only the relevant files under {ROOT} using quick_outline / ranged read_file. Return the smallest sufficient plan matching the JSON schema. Do NOT edit any files."""
    plan = await agent(
        planner_prompt,
        schema=PLAN_SCHEMA,
        role="Architect & Planner",
        model=assert_model_allowed("inherit"),
    )
    log("Plan summary:", plan["summary"])

    # In DEEP mode, return the plan immediately so the human can approve before any code edits.
    if mode == "deep":
        log("DEEP mode requires explicit human approval of the plan before implementation.")
        print(json.dumps({"stage": "AWAITING_DEEP_PLAN_APPROVAL", "plan": plan}, indent=2))
        raise SystemExit(0)

    if plan.get("open_questions"):
        log("Open product/architectural questions require Markus's decision before editing.")
        print(json.dumps({"stage": "AWAITING_HUMAN_DECISION", "plan": plan}, indent=2))
        raise SystemExit(0)

# --- Phase 2: Implement ---
phase("Implement")
work_packages = plan.get("work_packages", [])
all_pkg_files = [set(wp["files"]) for wp in work_packages]
files_disjoint = len(work_packages) > 1 and all(
    all_pkg_files[i].isdisjoint(all_pkg_files[j])
    for i in range(len(all_pkg_files))
    for j in range(i + 1, len(all_pkg_files))
)


def make_engineer_agent(wp, feedback=None):
    role_name = "backend-engineer" if wp["owner"] == "backend" else "frontend-engineer"
    prompt = f"""{load_role(role_name)}

Repository root (edit and run commands ONLY inside this directory): {ROOT}
Task ({mode.upper()} mode): {task}
Assigned files (relative to {ROOT}; edit ONLY these): {wp['files']}
Acceptance criteria: {json.dumps(plan['acceptance_criteria'])}
Invariants to preserve: {json.dumps(plan['invariants_checked'])}
Instructions:
{wp['instructions']}
"""
    if feedback:
        prompt += f"\nTargeted fixes required from review/verification:\n{feedback}\n"
    return agent(
        prompt,
        schema=IMPL_SCHEMA,
        role=f"{wp['owner'].title()} Engineer",
        model=assert_model_allowed("inherit"),
    )


if plan.get("parallelizable") and files_disjoint:
    log("Running Frontend & Backend Engineers in parallel on disjoint files.")
    impl_results = await parallel(work_packages, lambda wp: make_engineer_agent(wp))
else:
    log("Running Engineers sequentially (single package or overlapping files).")
    impl_results = await pipeline(work_packages, lambda wp: make_engineer_agent(wp))

# --- Phase 3: Review, Verify & Bounded Correction Loop ---
cycle = 0
last_review = None
last_verify = None

while True:
    phase(f"Review & Verify (Cycle {cycle + 1})")
    verify_prompt = f"""{load_role('verification-engineer')}

Repository root: {ROOT}
Run `cd {ROOT} && node .agents/workflows/verify-matrix.mjs --base {base_ref} --mode {mode}` and verify acceptance criteria:
{json.dumps(plan['acceptance_criteria'])}
Never edit product files. Never fabricate results. Return the exact Evidence Ledger."""

    verify_task = agent(
        verify_prompt,
        schema=VERIFY_SCHEMA,
        role="Verification Engineer",
        model=assert_model_allowed("flash"),
    )

    if skip_internal_review:
        last_verify = await verify_task
        last_review = {
            "verdict": "DEFERRED_TO_EXTERNAL_CODEX_REVIEW",
            "findings": [],
            "checked_assumptions": [],
        }
    else:
        review_prompt = f"""{load_role('independent-reviewer')}

Repository root: {ROOT}
Mode: {mode.upper()}
Acceptance criteria: {json.dumps(plan['acceptance_criteria'])}
Run `cd {ROOT} && git diff {base_ref}` plus `git ls-files --others --exclude-standard` (excluding `.cursor/`) and inspect connected callers under {ROOT}. Do NOT edit files."""
        review_task = agent(
            review_prompt,
            schema=REVIEW_SCHEMA,
            role="Independent Reviewer (Fresh Context)",
            model=assert_model_allowed("inherit"),
        )
        last_review, last_verify = await parallel([review_task, verify_task], lambda a: a)

    blockers = [
        f for f in last_review.get("findings", []) if f.get("severity") in ("P0", "P1")
    ]
    review_deferred = last_review.get("verdict") == "DEFERRED_TO_EXTERNAL_CODEX_REVIEW"
    review_approved = last_review.get("verdict") == "APPROVE" and not blockers
    verify_passed = last_verify.get("overall") == "PASS"

    if verify_passed and (review_approved or review_deferred):
        log("Verification passed." + (" Awaiting external Codex review." if review_deferred else " Quality gates satisfied."))
        break

    cycle += 1
    if cycle >= max_fix_cycles:
        log(f"Stopping: reached max_fix_cycles={max_fix_cycles} with unresolved issues.")
        break

    phase(f"Targeted Fix (Attempt {cycle})")
    feedback_text = json.dumps(
        {"p0_p1_findings": blockers, "failing_checks": last_verify.get("failing_checks", [])},
        indent=2,
    )
    target_owners = {f["owner"] for f in blockers}
    pkgs_to_fix = [wp for wp in work_packages if not target_owners or wp["owner"] in target_owners]
    await pipeline(pkgs_to_fix, lambda wp: make_engineer_agent(wp, feedback=feedback_text))

# --- Phase 4: Technical Walkthrough ---
phase("Technical Walkthrough")
mentor_prompt = f"""{load_role('technical-mentor')}

Repository root: {ROOT}
Mode: {mode.upper()}
Task: {task}
Inspect `cd {ROOT} && git diff {base_ref}` (and any untracked files) and produce the proportional Technical Walkthrough (include 1-2 comprehension questions ONLY if mode == 'deep'). Read-only."""
walkthrough = await agent(
    mentor_prompt,
    schema={"type": "string"},
    role="Technical Mentor",
    model=assert_model_allowed("inherit"),
)

unresolved_blockers = [
    f for f in last_review.get("findings", []) if f.get("severity") in ("P0", "P1")
]
review_deferred = last_review.get("verdict") == "DEFERRED_TO_EXTERNAL_CODEX_REVIEW"
review_approved = last_review.get("verdict") == "APPROVE" and not unresolved_blockers
verify_passed = last_verify.get("overall") == "PASS"
approval_blocked = not (review_approved and verify_passed)

if review_deferred and verify_passed:
    stage = "AWAITING_EXTERNAL_REVIEW"
elif approval_blocked:
    stage = "BLOCKED"
else:
    stage = "COMPLETE"

result = {
    "stage": stage,
    "approval_blocked": approval_blocked,
    "mode": mode,
    "fix_cycles_used": cycle,
    "max_fix_cycles": max_fix_cycles,
    "plan": plan,
    "implementation": impl_results,
    "review": last_review,
    "verification": last_verify,
    "walkthrough": walkthrough,
}
print(json.dumps(result, indent=2))
