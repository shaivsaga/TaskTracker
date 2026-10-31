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
  const block = /workflow_run:[ \t]*\n[ \t]+workflows:[ \t]*\[([^\]]*)\]/.exec(src);
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
