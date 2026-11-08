/**
 * tests/a11y-contract.test.js - the task row/card accessibility contract, as source guards.
 *
 * tests/e2e/audit.mjs proves this in a real browser (accessible names, list semantics, Enter on the
 * title control, the phone collapse, the archive Delete). This file is the same contract in
 * `node --test`, so a checkout without a browser still fails when one of these regresses - the
 * failure that started this: every task row and card was a `tabindex="0"` div with no role and no
 * accessible name, so a screen reader reached a nameless stop that only Enter could use.
 *
 * Structural, in the style of tests/index-integrity.test.js: no browser, no network, no build step.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HTML = read('index.html');
const TASKS = read('js/tasks.js');
const ANNOUNCE = read('js/announcements.js');

test('the four task lists are role="list" so their aria-label names a role that accepts one', () => {
  for (const id of ['class-task-list', 'task-list', 'done-list', 'past-list']) {
    const tag = HTML.match(new RegExp('<(?:div|ul)[^>]*id="' + id + '"[^>]*>'));
    assert.ok(tag, 'index.html must still have ##' + id);
    assert.match(tag[0], /role="list"/, '#' + id + ' carries aria-label but no role, so its name is dropped');
  }
});

test('no task row or card is a bare tab stop', () => {
  assert.doesNotMatch(TASKS, /\.tabIndex\s*=/, 'a row/card must not be focusable itself: a focusable div has no role and no name');
});

test('rows are list items and their title is the control that opens the dialog', () => {
  const items = TASKS.match(/setAttribute\('role', 'listitem'\)/g) || [];
  assert.equal(items.length, 3, 'createTaskRow, renderDonePage and renderPastPage must each mark their row a listitem');
  const rowTitles = TASKS.match(/createElement\('button'\);\r?\n\s*title\.type = 'button';\r?\n\s*title\.className = 'task-row-title/g) || [];
  assert.equal(rowTitles.length, 3, 'the class, Done and Past row titles must be buttons, not spans');
  assert.match(TASKS, /className = 'task-title-open'/, 'the board card title must be a button inside its heading');
});

test('the pinned-announcement collapse is a phone affordance only', () => {
  assert.match(ANNOUNCE, /matchMedia\(PHONE_PINNED\)\.matches/, 'the collapse must be gated on the phone breakpoint; collapsing on desktop hides pinned announcements');
  assert.match(ANNOUNCE, /toggle\.hidden = !items\.length \|\| !phone/, 'the toggle must not render off the phone breakpoint');
});

test('archive Delete arms before it deletes', () => {
  assert.match(TASKS, /armInlineConfirm\(b, label, confirmLabel, fn\)/, 'mkBtn must route confirmed actions through the 4s inline arm');
  assert.match(TASKS, /mkBtn\('Delete', \(\) => deleteTask\(task\), 'Confirm deleting this task'\)/, 'the archive Delete must pass a confirm label');
});
