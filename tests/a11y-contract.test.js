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
const BIN = read('js/bin.js');
const SUBJECTS_EDITOR = read('js/subjects-editor.js');
const CSS = read('styles.css');
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

test('admin task board precedes collapsed Recycle bin and Subjects panels', () => {
  const boardIdx = HTML.indexOf('aria-label="Personal task board"');
  const binIdx = HTML.indexOf('id="bin-panel"');
  const subjectIdx = HTML.indexOf('id="subject-panel"');
  assert.ok(boardIdx > 0 && binIdx > boardIdx && subjectIdx > boardIdx,
    'Personal task board must precede #bin-panel and #subject-panel so tasks are immediately reachable');
  assert.match(HTML, /id="bin-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="bin-body"/,
    '#bin-toggle must control #bin-body and start collapsed');
  assert.match(HTML, /<div id="bin-body" hidden>/, '#bin-body must be hidden by default');
  assert.match(HTML, /id="subject-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="subject-body"/,
    '#subject-toggle must control #subject-body and start collapsed');
  assert.match(HTML, /<div id="subject-body" hidden>/, '#subject-body must be hidden by default');
  assert.match(BIN, /dom\.binToggle\.setAttribute\('aria-expanded'/, 'bin.js must update aria-expanded on #bin-toggle');
  assert.match(SUBJECTS_EDITOR, /dom\.subjectToggle\.setAttribute\('aria-expanded'/, 'subjects-editor.js must update aria-expanded on #subject-toggle');
  assert.match(SUBJECTS_EDITOR, /paletteBtn\.dataset\.act = 'palette'/, 'subjects-editor.js must disclose colour swatches per row via a palette button');
  assert.match(SUBJECTS_EDITOR, /swatches\.hidden = !paletteOpen/, 'subject colour swatches must stay hidden until the row palette is opened');
});

test('student class view prioritises due today/tomorrow, preserves scroll on status change, and guards mobile header', () => {
  assert.match(TASKS, /function orderClassTasks\(list\)/, 'tasks.js must define orderClassTasks for the student view');
  assert.match(TASKS, /!task\.isOverdue\(\) && diff >= 0 && diff <= 1/, 'due today and tomorrow must occupy bucket 0 ahead of overdue backlog');
  assert.match(TASKS, /focus\(\{\s*preventScroll:\s*true\s*\}\)/, 'focusStatusTrigger must prevent scroll jumps when a completed row moves to the bottom');
  assert.match(CSS, /\.brand-m\s*\{\s*position:\s*sticky;\s*top:\s*0;\s*z-index:\s*5;/, 'phone header brand strip must stay sticky above cards and below #settings-open');
});

test('task dialog subject dropdown supports keyboard navigation, aria-selected, Tab trap, and Escape dismissal', () => {
  assert.match(TASKS, /export function openSubjectDropdown\(\)/, 'tasks.js must define openSubjectDropdown');
  assert.match(TASKS, /export function closeSubjectDropdown\(refocus = false\)/, 'tasks.js must define closeSubjectDropdown');
  assert.match(TASKS, /opt\.setAttribute\('aria-selected',\s*String\(opt\.dataset\.subject === cur\)\)/,
    'subject options must set aria-selected to reflect the current subject');
  assert.match(TASKS, /e\.key === 'Home'/, 'subject dropdown must support Home key');
  assert.match(TASKS, /e\.key === 'End'/, 'subject dropdown must support End key');
  assert.match(TASKS, /&& dom\.dialogSubjectDropdown\.hidden\) closeTaskDialog\(\)/,
    'Escape must not close the task dialog while #dialog-subject-dropdown is open');
});

test('read-only dialog values look sunk, are named, and stay out of the tab order', () => {
  assert.match(CSS, /\.prop-value:disabled \{ cursor: default; border-color: var\(--ln\); background: var\(--sf2\); \}/,
    'a disabled property value must drop to the sunk surface at every width, not only on phones');
  assert.match(CSS, /\.task-dialog\.is-readonly \.dialog-doc \{[^}]*border-color: var\(--ln\); background: var\(--sf2\);/,
    'the read-only notes box must read as sunk at every width');
  assert.match(TASKS, /setAttribute\('tabindex', ro \? '-1' : '0'\)/,
    'the read-only title must leave the tab order so focus starts on a real control');
  assert.match(TASKS, /else dom\.dialogSubjectBtn\.textContent = isEditable\(task\) \? 'Add subject' : 'None';/,
    'a student sees None, never an admin prompt, on an untagged task');
  assert.match(TASKS, /empty \? \(editable \? 'Add due date' : 'No due date'\)/, 'a student sees No due date on an undated task');
  assert.match(TASKS, /dialogStatusBtn\.setAttribute\('aria-label', `Status: \$\{s\.label\}`\)/, 'the status control must name its field and value');
  assert.match(TASKS, /dialogDateBtn\.setAttribute\('aria-label', empty \? 'Due: no due date' : `Due: \$\{task\.getDueShort\(\)\}`\)/,
    'the due control must name its field and value');
  assert.match(HTML, /<span class="field-label"[^>]*>Status<\/span>/, 'field labels must not be <label> elements with no control');
});

test('AA-safe dark hovers, overdue time contrast, and mobile 44px targets', () => {
  assert.match(CSS, /:root\[data-theme="dark"\] \.primary-button:hover,/, 'dark hover must not put --onac on --acd');
  assert.match(CSS, /:root\[data-theme="dark"\] \.text-button:hover,/, 'dark text-button hover must keep AA contrast');
  assert.match(CSS, /\.cal-chip\.is-overdue \.cal-time \{ color: var\(--er\); font-weight: 600; \}/,
    'the overdue time keeps the red but drops the wash that measured 4.4:1');
  assert.match(CSS, /\.text-button \{ display: inline-flex; align-items: center; min-height: 44px; \}/,
    'phone text buttons must reach the 44px touch floor');
  assert.match(CSS, /\.history-item \.text-button, \.file-item \.text-button \{ height: 44px; \}/, 'phone history and file buttons must reach 44px');
  assert.match(CSS, /\.quick-chip-btn \{ min-height: 44px; \}/, 'phone quick-add chips must reach 44px');
});
