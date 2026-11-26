# TaskTracker Agent Guide

TaskTracker (`https://dsct.dev`) is a zero-build, no-framework vanilla HTML/CSS/ES-module JS + PHP 8.1+ class task board with flat JSON persistence (`data/current.json`) and multi-section isolation.

## 1. Authority Hierarchy & Evidence Rules

When sources disagree, follow this order:
1. **Explicit recent owner decisions** (`[user]`)
2. **Current verified repo code & executed tests** (`[code]`, `[html]`, `[live-test]`, `[agent-test]`, `[ci]`)
3. **In-repo architecture docs**: [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md), [GLOSSARY.md](GLOSSARY.md), [docs/adr/README.md](docs/adr/README.md)
4. **Indexed OKF bundle** (`/home/markus/knowledge/bundles/tasktracker/`) and rolling `/home/markus/omp-memory-export/CURRENT_STATE.md`
5. **Graphify AST graph** (`/home/markus/tasktracker-graph/graphify-out/`) — optional structural lookup only

Never upgrade `[agent-test]` to `[live-test]`. Never fabricate test output. Always sync before planning or reviewing: `git fetch origin --prune`.

## 2. Hard Safety & Frozen Invariants

- **Git & deploy:** Never push to `main`, never merge, never force-push (merging to `main` auto-deploys production). Use descriptive branches (`feat/*`, `fix/*`, `docs/*`, `chore/*`) — never `overnight/*`. Stage named files only (`git add <file>`).
- **Secrets:** Never open, print, or commit `.env`, `api/.htpasswd`, student data, or private production sessions.
- **Protected runtime paths:** Do not touch `data/`, `deploy/`, `api/*.php`, `transfer.php`, `tests/startup.test.js`, `tests/php/*`, `tests/module-state.test.js`, or `tests/e2e/golden/*` unless the task explicitly requires it and passes `DEEP` approval/verification gates.
- **Stack & contracts:** Zero frameworks, bundlers, or npm dependencies (`package.json` has none). `index.html`'s inline bootstrap script stays byte-identical (CSP sha256 pinned in `deploy/nginx-default.conf`). Five assets are stamped `?v=<sha7>` by CI (`styles.css`, `qr-draw.js`, `attachments.js`, `logic.js`, `app.js`); `js/*.js` imports carry no `?v=`. `data/current.json` and `localStorage` keys/shapes are backward-compatible.
- **Deploy hygiene:** `.github/workflows/main_tasktracker.yml` uploads `.` to Azure (nginx denies dotfiles `location ~ /\.(?!well-known)`). Keep orchestration files and benchmark archives inside `.agents/` or outside the repo.

## 3. Hard Model Policy (No Exceptions)

- **NEVER use `claude-opus-5-5*` or `claude-sonnet-5-5*`** under any circumstance.
- **Codex reviewer model (configurable via `TT_REVIEWER_MODEL` or `--reviewer-model`):**
  - **Active default:** `gpt-6.2-astra` (per owner directive 2026-11-26; supersedes `gpt-6.1-terra` used during V1 benchmarks).
  - **Do NOT use `gpt-6.1-terra`, `gpt-6.1-sol`, `gpt-6.2-sol`, or any other Codex model unless explicitly prompted by Markus.**
- **Approved Antigravity defaults:** `gemini-4-neon` (Orchestrator, Planner, Backend/DEEP, fallback review), `gemini-4-carbon` / `gemini-4-hydrogen` (Frontend/walkthroughs), `gemini-3.8-flash` (FAST scans, verification aggregation).

## 4. Orchestration, Quality Gates & Benchmarks

- **Primary orchestrator:** [.agents/skills/tt-orchestrator/SKILL.md](.agents/skills/tt-orchestrator/SKILL.md)
- **Role prompts:** `.agents/agents/{orchestrator,architect-planner,frontend-engineer,backend-engineer,independent-reviewer,verification-engineer,technical-mentor}.md`
- **Executable scripts:**
  - `node .agents/workflows/classify-task.mjs --task "<summary>" [--files a,b | --git-diff] [--reviewer-model <id>]`
  - `node .agents/workflows/verify-matrix.mjs [--base main] [--mode fast|standard|deep]`
  - Non-ACP/IDE-only workflow: `.agents/workflows/orchestrate.py`
  - Weekly telemetry: `node .agents/workflows/weekly-review-collect.mjs`
- **Mandatory quality gates:**
  - Complete tier-appropriate verification (`verify-matrix.mjs --mode <tier>`) MUST run **after the final code modification** before approval.
  - Exhausting the review-cycle budget (FAST: 1, STANDARD: 2, DEEP: 3) with any unresolved `P0` or `P1` finding **blocks approval** (`BLOCKED / ESCALATED`).
- **Verification skills:**
  - UI/E2E (Firefox): [.agents/skills/verify-tasktracker/SKILL.md](.agents/skills/verify-tasktracker/SKILL.md)
  - Formal sync protocol (TLC + PHP/JS replay): [.agents/skills/verify-board-sync/SKILL.md](.agents/skills/verify-board-sync/SKILL.md)
- **Mentoring, review & V1 evidence:**
  - [.agents/skills/tt-mentor/SKILL.md](.agents/skills/tt-mentor/SKILL.md)
  - [.agents/skills/tt-weekly-review/SKILL.md](.agents/skills/tt-weekly-review/SKILL.md)
  - [.agents/benchmarks/v1-2026-11-25/REPORT.md](.agents/benchmarks/v1-2026-11-25/REPORT.md)

## 5. Human Authority & Consent

- **Mode-level consent:** Approving `STANDARD` or `DEEP` mode authorizes spawning that mode's defined agents within its fixed iteration budget. `FAST` mode stays single-agent (no subagents).
- **Explicit approval always required before:** merging to `main`, deploying, touching production data or credentials, adding dependencies/paid services, destructive operations, creating recurring schedules, or changing orchestration rules.
