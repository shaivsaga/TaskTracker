// Run with node tests/e2e/preset-confirmation.mjs; uses the existing external jsdom harness.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const harness = process.env.TT_HARNESS || path.resolve(root, '../../harness');
const { boot } = await import(pathToFileURL(path.join(harness, 'load.mjs')).href);
const fixture = path.join(root, 'tests/e2e/fixture-board.json');
const board = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const draft = { tasks: board.tasks, announcements: [], subjects: [] };
const app = await boot({ root, fixture, admin: true, storage: { class_tasks_draft: JSON.stringify(draft) } });
try {
  await app.settle(200);
  const fetch = app.window.fetch;
  app.window.fetch = (url, options) => String(url).includes('api/versions.php?view=admin')
    ? Promise.resolve({ ok: true, json: async () => ({ presets: [{ id: 'example', name: 'Example preset', subjects: [{ code: 'SCI', name: 'Science', color: '#58affc', active: true }] }] }) })
    : fetch(url, options);
  app.window.confirm = () => false;
  await app.setHash('#my-tasks');
  await app.settle(100);
  app.click('#subject-toggle');
  const apply = app.document.querySelector('#preset-apply');
  assert.equal(apply.disabled, false);
  const before = app.window.localStorage.getItem('class_tasks_draft');
  const open = async () => {
    apply.focus();
    app.click('#preset-apply');
    await app.settle();
    const overlay = app.document.querySelector('.confirm-overlay');
    assert.ok(overlay && !overlay.hidden, 'Preset application must open the in-app confirmation');
    assert.equal(app.window.localStorage.getItem('class_tasks_draft'), before, 'Preview cannot change the draft');
    assert.equal(app.document.activeElement.dataset.confirm, 'cancel');
    return overlay;
  };
  let overlay = await open();
  app.document.activeElement.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await app.settle(220);
  assert.equal(overlay.hidden, true);
  assert.equal(app.document.activeElement, apply);
  assert.equal(app.window.localStorage.getItem('class_tasks_draft'), before);
  overlay = await open();
  app.click('.confirm-overlay [data-confirm="cancel"]');
  await app.settle(220);
  assert.equal(app.window.localStorage.getItem('class_tasks_draft'), before);
  overlay = await open();
  app.click('.confirm-overlay');
  await app.settle(220);
  assert.equal(overlay.hidden, true);
  assert.equal(app.document.activeElement, apply);
  assert.equal(app.window.localStorage.getItem('class_tasks_draft'), before);
  overlay = await open();
  app.document.activeElement.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(app.document.activeElement.dataset.confirm, 'ok');
  app.click('.confirm-overlay [data-confirm="ok"]');
  await app.settle(220);
  const after = JSON.parse(app.window.localStorage.getItem('class_tasks_draft'));
  assert.equal(after.subjects.find((subject) => subject.code === 'SCI').name, 'Science');
  assert.deepEqual(after.tasks.map((task) => [task.id, task.subject]), draft.tasks.map((task) => [task.id, task.subject]));
  assert.equal(overlay.hidden, true);
  assert.equal(app.document.activeElement, apply);
  assert.deepEqual(app.errors, []);
  console.log('preset confirmation: preview, Escape, cancel, focus, explicit apply and task identity OK');
} finally {
  app.close();
}
