import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Task } from '../logic.js';
import { lintRepo } from './lint.mjs';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

function cloneMinimalRepo(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-lint-'));
  for (const rel of ['logic.js', 'app.js', 'index.html', 'styles.css']) {
    fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
  }
  fs.mkdirSync(path.join(dir, 'js'));
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter((x) => x.endsWith('.js'))) {
    fs.copyFileSync(path.join(ROOT, 'js', f), path.join(dir, 'js', f));
  }
  fs.mkdirSync(path.join(dir, 'assets'));
  for (const f of ['sprites-light.svg', 'sprites-dark.svg']) {
    fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(dir, 'assets', f));
  }
  mutate(dir);
  return dir;
}

async function runMutated(mutate, opts) {
  const dir = cloneMinimalRepo(mutate);
  try {
    return await lintRepo(dir, opts);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Task instances are sealed and expose isClosed/isExpired/isPast with explicit clock', () => {
  const now = new Date(2026, 10, 22, 12, 0, 0).getTime();
  const active = new Task({ id: 'a', title: 'Active', dueDate: new Date(2026, 10, 23) });
  const closed = new Task({ id: 'c', title: 'Closed', dueDate: new Date(2026, 10, 23), closedAt: now - 1000 });
  const expired = new Task({ id: 'e', title: 'Expired', dueDate: new Date(2026, 10, 1) });

  assert.equal(active.isClosed(), false);
  assert.equal(active.isPast(now), false);
  assert.equal(closed.isClosed(), true);
  assert.equal(closed.isPast(now), true);
  assert.equal(expired.isExpired(now), true);
  assert.equal(expired.isPast(now), true);
  assert.throws(() => { active.closed = true; }, TypeError);
  assert.throws(() => { active.changedAt = 123; }, TypeError);
});

test('repo lint passes cleanly on the repository', async () => {
  const errors = await lintRepo(ROOT);
  assert.deepEqual(errors, []);
});

test('no-unknown-task-prop catches commit 480065d^ bug (t.closed instead of t.isClosed/t.closedAt)', async () => {
  const errors = await runMutated((dir) => {
    const p = path.join(dir, 'js', 'tasks.js');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('!t.isClosed()', '!t.closed'));
  }, { checkRuntimeImport: false });
  assert.ok(errors.some((e) => e.rule === 'no-unknown-task-prop' && e.message.includes('.closed')));
});

test('no-raw-task-deadline-math catches commit 003e505^ bug (dayDiff(t.dueDate))', async () => {
  const errors = await runMutated((dir) => {
    const p = path.join(dir, 'js', 'tasks.js');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('dayDiff(t.getDeadline())', 'dayDiff(t.dueDate)'));
  }, { checkRuntimeImport: false });
  assert.ok(errors.some((e) => e.rule === 'no-raw-task-deadline-math'));
});

test('no-bare-moved-state catches commit 6ad4400^ bare state reads inside js/*.js modules', async () => {
  const errors = await runMutated((dir) => {
    const p = path.join(dir, 'js', 'tasks.js');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('state.publishedTasks', 'publishedTasks'));
  }, { checkRuntimeImport: false });
  assert.ok(errors.some((e) => e.rule === 'no-bare-moved-state' && e.message.includes('publishedTasks')));
});

test('d6-module-boundary catches logic.js imports, ?v= imports, and top-level DOM access', async () => {
  const errors = await runMutated((dir) => {
    fs.writeFileSync(path.join(dir, 'js', 'bad-d6.js'), "import { Task } from '../logic.js?v=5';\ndocument.querySelector('#x');\n");
  }, { checkRuntimeImport: true });
  const d6 = errors.filter((e) => e.rule === 'd6-module-boundary');
  assert.ok(d6.some((e) => e.message.includes('logic.js')));
  assert.ok(d6.some((e) => e.message.includes('?v=')));
  assert.ok(d6.some((e) => e.message.includes('evaluation time')));
});

test('dual-sprite-sheets catches commit 862f5f1^ / 249195b^ sprite collapse', async () => {
  const errors = await runMutated((dir) => {
    fs.copyFileSync(path.join(dir, 'assets', 'sprites-light.svg'), path.join(dir, 'assets', 'sprites-dark.svg'));
  }, { checkRuntimeImport: false });
  assert.ok(errors.some((e) => e.rule === 'dual-sprite-sheets'));
});

test('single-board-fetch catches PR #39 pre-fix ?t= cache-buster and no-store', async () => {
  const errors = await runMutated((dir) => {
    const p = path.join(dir, 'js', 'store.js');
    fs.writeFileSync(
      p,
      fs.readFileSync(p, 'utf8').replace(
        "fetchFn(api.current, { cache: 'no-cache', signal: AbortSignal.timeout(8000) })",
        "fetchFn(`${api.current}?t=${Date.now()}`, { cache: 'no-store' })",
      ),
    );
  }, { checkRuntimeImport: false });
  const hits = errors.filter((e) => e.rule === 'single-board-fetch');
  assert.ok(hits.some((e) => e.message.includes('?t=')));
  assert.ok(hits.some((e) => e.message.includes('no-cache')));
  assert.ok(hits.some((e) => e.message.includes('AbortSignal')));
});

test('no-contains-on-rerendered-picker catches PR #60 dpEl.contains(e.target)', async () => {
  const errors = await runMutated((dir) => {
    const p = path.join(dir, 'app.js');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('!e.composedPath().includes(dpEl)', '!dpEl.contains(e.target)'));
  }, { checkRuntimeImport: false });
  assert.ok(errors.some((e) => e.rule === 'no-contains-on-rerendered-picker'));
});

test('no-orphan-field-label and cal-plus-anchor catch commit 87a1178^ regressions', async () => {
  const errors = await runMutated((dir) => {
    const hp = path.join(dir, 'index.html');
    fs.writeFileSync(hp, fs.readFileSync(hp, 'utf8').replace('<span class="field-label"', '<label class="field-label"'));
    const cp = path.join(dir, 'styles.css');
    fs.writeFileSync(cp, fs.readFileSync(cp, 'utf8').replace(/(\.cal-day\s*\{[^}]*)position:\s*relative;/s, '$1'));
  }, { checkRuntimeImport: false });
  assert.ok(errors.some((e) => e.rule === 'no-orphan-field-label'));
  assert.ok(errors.some((e) => e.rule === 'cal-plus-anchor'));
});
