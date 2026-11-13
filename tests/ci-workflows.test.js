/**
 * tests/ci-workflows.test.js - guards on the post-deploy wiring and the live-host verifier.
 *
 * Both failures pinned here are silent, which is the incident class this repo keeps re-learning.
 * A `workflow_run` trigger that names a workflow nobody declares never fires and never complains -
 * the deploy goes green and nothing verifies it, exactly the shape of the 2026-10-31 failure. And
 * deploy/verify-hardening.mjs runs against the live host on every deploy, so if it ever stopped
 * being read-only, CI would start writing to production. Neither shows up as a red build.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

function readWorkflow(name) {
  return fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8');
}

function declaredWorkflowNames() {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => /^name:[ \t]*(.+?)[ \t]*$/m.exec(readWorkflow(f))?.[1])
    .filter(Boolean);
}

function workflowRunTriggers(src) {
  // \r?: on Windows checkouts git gives CRLF (no .gitattributes rule covers *.yml),
  // and a \n-only pattern silently matches nothing - the guard fails on the file it exists to guard.
  const block = /workflow_run:[ \t]*\r?\n[ \t]+workflows:[ \t]*\[([^\]]*)\]/.exec(src);
  if (!block) return [];
  return block[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

test('the post-deploy verifier is triggered by a workflow that exists', () => {
  const triggers = workflowRunTriggers(readWorkflow('post-deploy-hardening.yml'));
  assert.ok(triggers.length, 'post-deploy-hardening.yml lost its workflow_run trigger');
  const names = declaredWorkflowNames();
  for (const trigger of triggers) {
    assert.ok(
      names.includes(trigger),
      `workflow_run names "${trigger}", which no workflow declares - the verifier would never run`,
    );
  }
});

test('the production verifier stays read-only', () => {
  const src = fs.readFileSync(path.join(ROOT, 'deploy', 'verify-hardening.mjs'), 'utf8');
  // It hits the live host on every successful deploy; a body-carrying request would make CI a writer.
  assert.doesNotMatch(src, /method:[ \t]*['"](POST|PUT|PATCH|DELETE)['"]/i, 'the verifier sends a mutating request');
  assert.doesNotMatch(src, /\b(spawn|spawnSync|exec|execSync|execFile)\b/, 'the verifier shells out');
});

// --- Phase 1a: the JavaScript suite must run on pull requests, and a pull request must
// never reach the production deploy. Both halves fail silently: without the trigger,
// nothing runs until after the merge; without the gate on `build`, the deploy job that
// needs it would ship a pull request to production.
function jobBlock(src, name) {
  const re = new RegExp('\\r?\\n  ' + name + ':\\r?\\n([\\s\\S]*?)(?=\\r?\\n  [a-zA-Z0-9_-]+:\\r?\\n|$)');
  return re.exec(src)?.[1] ?? '';
}

test('main_tasktracker.yml runs the JavaScript suite on pull requests', () => {
  const src = readWorkflow('main_tasktracker.yml');
  assert.match(src, /\r?\n  pull_request:/, 'main_tasktracker.yml declares no pull_request trigger');
  const job = jobBlock(src, 'js-tests');
  assert.ok(job, 'main_tasktracker.yml declares no js-tests job');
  assert.match(job, /github\.event_name == 'pull_request'/, 'the js-tests job does not restrict itself to pull requests');
  assert.match(job, /node --test tests\/\*\.test\.js/, 'the js-tests job does not run the JavaScript suite');
});

test('a pull request can never reach the production deploy', () => {
  const src = readWorkflow('main_tasktracker.yml');
  const build = jobBlock(src, 'build');
  assert.match(build, /if:\s*github\.event_name != 'pull_request'/, 'build still runs on pull_request, so the deploy job below it would run too');
  const deploy = jobBlock(src, 'deploy');
  assert.match(deploy, /needs:\s*build/, 'deploy no longer depends on build');
});

test('post-deploy hardening verification only runs for pushes on main or manual dispatch', () => {
  const src = readWorkflow('post-deploy-hardening.yml');
  const job = jobBlock(src, 'verify-hardening');
  assert.ok(job, 'post-deploy-hardening.yml declares no verify-hardening job');
  assert.match(
    job,
    /github\.event\.workflow_run\.event\s*==\s*['"]push['"]/,
    'verify-hardening does not restrict workflow_run to push events',
  );
  assert.match(
    job,
    /github\.event\.workflow_run\.head_branch\s*==\s*['"]main['"]/,
    'verify-hardening does not restrict workflow_run to main branch',
  );
});

test('php-tests.yml declares explicit least-privilege permissions', () => {
  const src = readWorkflow('php-tests.yml');
  assert.match(src, /\r?\npermissions:\r?\n\s+contents:\s*read/, 'php-tests.yml lacks permissions: contents: read');
});
