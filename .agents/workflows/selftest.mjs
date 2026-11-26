#!/usr/bin/env node
/**
 * Self-test for TaskTracker's .agents/workflows/ orchestration tooling.
 * Runs cleanly without touching product code or repo data/.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTask, resolveReviewerModel } from './classify-task.mjs';
import { buildCheckPlan } from './verify-matrix.mjs';
import { isAllowedPublicPath } from '../skills/verify-tasktracker/scripts/verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// 1. Classifier tier checks
const fast = classifyTask({ task: 'Fix typo in README', files: ['README.md'] });
assert.equal(fast.recommendedMode, 'FAST');
assert.equal(fast.specialists.length, 1);
assert.equal(fast.maxFixCycles, 1);
assert.equal(fast.requiresWalkthrough, false);

const standard = classifyTask({ task: 'Add calendar schedule tab UI', files: ['js/calendar.js', 'styles.css'] });
assert.equal(standard.recommendedMode, 'STANDARD');
assert.equal(standard.maxFixCycles, 2);
assert.equal(standard.requiresPlanApproval, false);
assert.equal(standard.requiresWalkthrough, true);
assert.ok(standard.specialists.includes('independent-reviewer'));
assert.ok(standard.specialists.includes('verification-engineer'));

const deep = classifyTask({
  task: 'Add additive schedule validation on publish',
  files: ['api/_board.php', 'js/publish.js'],
});
assert.equal(deep.recommendedMode, 'DEEP');
assert.equal(deep.maxFixCycles, 3);
assert.equal(deep.requiresPlanApproval, true);
assert.equal(deep.requiresComprehensionQuestions, true);
assert.equal(deep.parallelImplementationPossible, true);
assert.ok(deep.protectedBoundaries.includes('board-sync-formal'));
assert.ok(deep.requiredChecks.some((c) => c.includes('run-tlc.sh')));

const rulesEdit = classifyTask({ task: 'Update orchestration rules', files: ['AGENTS.md'] });
assert.equal(rulesEdit.touchesOrchestrationRules, true);
assert.equal(rulesEdit.requiresFinalEditVerification, true);
assert.equal(rulesEdit.blockApprovalOnUnresolvedP1, true);

// 1a. Every protected runtime path family in AGENTS.md must enforce DEEP even with neutral wording
for (const protectedPath of [
  'data/current.json',
  'deploy/nginx-default.conf',
  'api/publish.php',
  'transfer.php',
  'tests/startup.test.js',
  'tests/php/run.php',
  'tests/module-state.test.js',
  'tests/e2e/golden/01-board.html',
]) {
  const res = classifyTask({ task: 'Adjust formatting', files: [protectedPath] });
  assert.equal(res.recommendedMode, 'DEEP', `Protected path ${protectedPath} must classify as DEEP`);
  assert.equal(res.requiresPlanApproval, true, `Protected path ${protectedPath} must require DEEP plan approval`);
}

// 1b. Configurable reviewer model resolution & hard bans
const defaultRev = resolveReviewerModel();
assert.equal(defaultRev.provider, 'codex');
assert.equal(defaultRev.model, 'gpt-6.2-astra');
assert.equal(defaultRev.requiresExplicitPrompt, false);
assert.throws(() => resolveReviewerModel('claude-opus-5-5-high'), /permanently prohibited/i);
assert.throws(() => resolveReviewerModel('claude-sonnet-5-5-medium'), /permanently prohibited/i);
const terraRev = resolveReviewerModel('gpt-6.1-terra');
assert.equal(terraRev.requiresExplicitPrompt, true);
const solRev = resolveReviewerModel('gpt-6.2-sol');
assert.equal(solRev.requiresExplicitPrompt, true);
const unlistedCodex = resolveReviewerModel('gpt-6.3-example');
assert.equal(unlistedCodex.provider, 'codex');
assert.equal(unlistedCodex.requiresExplicitPrompt, true);

// 2. Verify-matrix check selection checks
const uiPlan = buildCheckPlan({ files: ['js/calendar.js', 'styles.css'], mode: 'standard' });
const uiIds = uiPlan.map((c) => c.id);
assert.ok(uiIds.includes('repo-lint'));
assert.ok(uiIds.includes('node-tests'));
assert.ok(uiIds.includes('label-in-name'));
assert.ok(uiIds.includes('playwright-audit'));
assert.ok(uiIds.includes('firefox-calendar'));

const syncPlan = buildCheckPlan({ files: ['api/_board.php', 'js/store.js'], mode: 'deep', skipBrowser: true });
const syncIds = syncPlan.map((c) => c.id);
assert.ok(syncIds.includes('php-suite'));
assert.ok(syncIds.includes('tlc-board-sync'));
assert.ok(syncIds.includes('tlc-negative-controls'));
assert.ok(syncIds.includes('board-sync-replay'));
// Ensure process.env is never embedded on any check plan entry
for (const c of syncPlan) {
  assert.equal('env' in c, false, `Check ${c.id} must not attach raw env object`);
}

const deployPlan = buildCheckPlan({ files: ['deploy/nginx-default.conf'], mode: 'deep', skipBrowser: true });
const deployIds = deployPlan.map((c) => c.id);
assert.ok(deployIds.includes('deploy-tests'));
assert.ok(deployIds.includes('docker-nginx-hardening'));
const nginxCheck = deployPlan.find((c) => c.id === 'docker-nginx-hardening');
const nginxCmd = nginxCheck.args.join(' ');
assert.equal(nginxCmd.includes('cp -a .'), false, 'docker-nginx-hardening must never copy full local checkout');
assert.equal(nginxCmd.includes('cp -r '), false, 'docker-nginx-hardening must not recursively copy directories');

// Missing git base ref must fail nonzero in both verify-matrix.mjs (with or without --files) and classify-task.mjs
const badBaseVm = spawnSync('node', [path.join(HERE, 'verify-matrix.mjs'), '--base', 'nonexistent-ref-xyz', '--dry-run'], { encoding: 'utf8' });
assert.notEqual(badBaseVm.status, 0, 'verify-matrix.mjs must exit nonzero on invalid --base ref');
const badBaseVmFiles = spawnSync('node', [path.join(HERE, 'verify-matrix.mjs'), '--files', 'styles.css', '--base', 'nonexistent-ref-xyz', '--dry-run'], { encoding: 'utf8' });
assert.notEqual(badBaseVmFiles.status, 0, 'verify-matrix.mjs must exit nonzero on explicit invalid --base even with --files');
const badBaseCl = spawnSync('node', [path.join(HERE, 'classify-task.mjs'), '--task', 'test', '--git-diff', 'nonexistent-ref-xyz'], { encoding: 'utf8' });
assert.notEqual(badBaseCl.status, 0, 'classify-task.mjs must exit nonzero on invalid --git-diff ref');

// Single-file FAST edit to verify.mjs must still trigger orchestration-selftest (never empty plan)
const verifyOnlyFast = buildCheckPlan({ files: ['.agents/skills/verify-tasktracker/scripts/verify.mjs'], mode: 'fast' });
assert.ok(
  verifyOnlyFast.some((c) => c.id === 'orchestration-selftest'),
  'FAST edit to verify.mjs must schedule orchestration-selftest',
);

// Verify Firefox verifier static allowlist blocks internal PHP helpers, root /transfer.php, and dotfiles
assert.equal(isAllowedPublicPath('/index.html'), true);
assert.equal(isAllowedPublicPath('/api/login.php'), true);
assert.equal(isAllowedPublicPath('/api/_board.php'), false, 'internal PHP helper must be denied');
assert.equal(isAllowedPublicPath('/api/_session.php'), false, 'internal session helper must be denied');
assert.equal(isAllowedPublicPath('/transfer.php'), false, 'unhandled /transfer.php must not stream PHP source');
assert.equal(isAllowedPublicPath('/.env'), false, 'dotfiles must be denied');

// Verify frontend helper files match classify-task.mjs UI checks, and --skip-browser marks UNVERIFIED instead of dropping
for (const feFile of ['attachments.js', 'qr-draw.js']) {
  const plan = buildCheckPlan({ files: [feFile], mode: 'standard' });
  const ids = plan.map((c) => c.id);
  assert.ok(ids.includes('label-in-name'), `${feFile} must schedule label-in-name`);
  assert.ok(ids.includes('playwright-audit'), `${feFile} must schedule playwright-audit`);
  assert.ok(ids.some((id) => id.startsWith('firefox-')), `${feFile} must schedule firefox journey`);

  const skipped = buildCheckPlan({ files: [feFile], mode: 'standard', skipBrowser: true });
  const pw = skipped.find((c) => c.id === 'playwright-audit');
  assert.ok(pw && pw.unavailableReason, `${feFile} with --skip-browser must keep playwright-audit as UNVERIFIED`);
}

// 3. Python syntax, blocked-approval gate & banned-model guard check for orchestrate.py
const pySrc = fs.readFileSync(path.join(HERE, 'orchestrate.py'), 'utf8');
for (const banned of ['claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-6.2-sol', 'gpt-6.1-terra']) {
  assert.ok(pySrc.includes(banned), `orchestrate.py must enforce ban on ${banned}`);
}
assert.ok(pySrc.includes('"BLOCKED"'), 'orchestrate.py must block approval on unresolved P0/P1');
assert.ok(pySrc.includes('"AWAITING_EXTERNAL_REVIEW"'), 'orchestrate.py must not emit COMPLETE when external review is deferred');
assert.ok(pySrc.includes('last_verify.get("overall") == "PASS"'), 'orchestrate.py must require overall == PASS (not PASS_WITH_UNVERIFIED)');
assert.ok(pySrc.includes('exceeds allowed'), 'orchestrate.py must enforce tier max_fix_cycles cap');

const vmSrc = fs.readFileSync(path.join(HERE, 'verify-matrix.mjs'), 'utf8');
assert.ok(vmSrc.includes('counts.fail > 0 || counts.unverified > 0'), 'verify-matrix.mjs must exit nonzero on UNVERIFIED mandatory checks');

// 3b. V1 benchmark evidence preserved outside /tmp
assert.ok(
  fs.existsSync(path.join(ROOT, '.agents/benchmarks/v1-2026-11-25/REPORT.md')),
  'V1 benchmark report must be preserved under .agents/benchmarks/v1-2026-11-25/REPORT.md',
);
// Validate syntax by wrapping top-level await in async def
const pyCheck = spawnSync(
  'python3',
  [
    '-c',
    `import ast, pathlib
src = pathlib.Path(${JSON.stringify(path.join(HERE, 'orchestrate.py'))}).read_text()
wrapped = "async def _wf():\\n" + "\\n".join("    " + l for l in src.splitlines())
ast.parse(wrapped)
print("AST OK")`,
  ],
  { encoding: 'utf8' },
);
assert.equal(pyCheck.status, 0, `orchestrate.py syntax error: ${pyCheck.stderr}`);

// 4. All 7 agent role prompts exist with required sections
const requiredRoles = [
  'orchestrator',
  'architect-planner',
  'frontend-engineer',
  'backend-engineer',
  'independent-reviewer',
  'verification-engineer',
  'technical-mentor',
];
const requiredSections = [
  '## JOB',
  '## INPUT',
  '## OUTPUT',
  '## RESPONSIBILITIES',
  '## BOUNDARIES',
  '## AVAILABLE TOOLS',
  '## MODEL SELECTION',
  '## DEFINITION OF DONE',
  '## ESCALATION CONDITIONS',
  '## APPROVAL REQUIREMENTS',
  '## SYSTEM PROMPT',
];
for (const role of requiredRoles) {
  const txt = fs.readFileSync(path.join(ROOT, '.agents/agents', `${role}.md`), 'utf8');
  for (const sec of requiredSections) {
    assert.ok(txt.includes(sec), `${role}.md missing ${sec}`);
  }
}

console.log('orchestration selftest PASS: classifier, verify-matrix, orchestrate.py AST + model bans, and 7 role prompts verified.');
