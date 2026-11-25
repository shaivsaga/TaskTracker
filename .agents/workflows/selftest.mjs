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
import { classifyTask } from './classify-task.mjs';
import { buildCheckPlan } from './verify-matrix.mjs';

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
assert.ok(syncIds.includes('board-sync-replay'));

// 3. Python syntax & banned-model guard check for orchestrate.py
const pySrc = fs.readFileSync(path.join(HERE, 'orchestrate.py'), 'utf8');
for (const banned of ['claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-6.2-sol', 'gpt-6.2-astra']) {
  assert.ok(pySrc.includes(banned), `orchestrate.py must enforce ban on ${banned}`);
}
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
