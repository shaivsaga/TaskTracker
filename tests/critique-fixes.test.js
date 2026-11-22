import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Task } from '../logic.js';
import { summarizeMine } from '../js/tasks.js';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const HTML = read('index.html');
const APP = read('app.js');
const CSS = read('styles.css');
const TOUR = read('js/tour.js');
const TASKS = read('js/tasks.js');
const PUBLISH = read('js/publish.js');
const SUBJECTS = read('js/subjects-editor.js');
const ANNOUNCE = read('js/announcements.js');

test('first-visit onboarding is opt-in (no task-click/scroll/25s auto-hijack) and omits desktop-only steps on phones', () => {
  assert.doesNotMatch(APP, /closest\('\.task-row, \.task-card'\)\)\s*start\(\)/, 'app.js must not hijack the first task tap');
  assert.doesNotMatch(APP, /setTimeout\(start,\s*25000\)/, 'app.js must not auto-pop the tour after 25s');
  assert.match(APP, /tour\.showTourCue\(\)/, 'first visit should reveal the quiet opt-in tour cue');
  assert.match(HTML, /id="tour-cue"[^>]*hidden/, 'tour cue must start hidden in index.html');
  assert.match(TOUR, /desktopOnly:\s*true/, 'Board/List tour step must be flagged desktopOnly');
  assert.match(TOUR, /activeSteps\s*=\s*\(\)\s*=>/, 'tour must filter desktop-only steps on phone viewports');
});

test('Board view keeps subject filtering, List view adds bucket headings, and initial HTML view matches JS default', () => {
  assert.match(CSS, /#page-class-tasks\[data-view="board"\] #class-status-filter \{ display: none; \}/,
    'Board view should hide only #class-status-filter, keeping #class-subject-filter visible');
  assert.match(TASKS, /const boardTasks = state\.classSubjectFilter \?/, 'Board cards must respect #class-subject-filter');
  assert.match(TASKS, /h\.className = 'list-bucket'/, 'List view must render calm urgency bucket dividers when multiple buckets exist');
  assert.match(HTML, /data-view="list" aria-pressed="true"/, 'index.html must default the class view tab to List to match VIEW_DEFAULTS.class');
});

test('Done and Past rows use shared bucketing, calm date labels, and no status box on Past', () => {
  const doneBody = TASKS.slice(TASKS.indexOf('function renderDonePage()'), TASKS.indexOf('function subjectCodesMatching'));
  assert.doesNotMatch(doneBody, /createStatusCheck\(task\)/, 'Done rows must not render a second interactive status-check reopen trigger');
  assert.match(doneBody, /status-check is-done is-static/, 'Done rows keep a static green check icon beside Mark not done');
  assert.match(doneBody, /bucketed\(done,/, 'Done page must group rows with bucketed()');
  assert.match(doneBody, /getRangeLabel\(\)/, 'Done rows must use the same compact date format as Past instead of completion timestamp');
  const pastBody = TASKS.slice(TASKS.indexOf('function renderPastPage()'), TASKS.indexOf('function doneMessage()'));
  assert.match(pastBody, /bucketed\(past,/, 'Past page must group rows with bucketed()');
  assert.doesNotMatch(pastBody, /status-check/, 'Past rows must not render a status box');
  assert.match(pastBody, /getRangeLabel\(\)/, 'Past rows must show the task date without Closed/Expired status labels');

  // Behavioral tests for the personal strip summary (replaces brittle regex on app.js).
  const now = new Date(2026, 10, 21, 12, 0, 0).getTime();
  assert.equal(summarizeMine([], now).hidden, true, 'empty board hides the personal strip');

  const closed = new Task({ id: 'c1', title: 'Closed', dueDate: new Date(2026, 10, 22), closedAt: now - 1000 });
  const done = new Task({ id: 'd1', title: 'Done', dueDate: new Date(2026, 10, 22), status: 'done' });
  const expired = new Task({ id: 'e1', title: 'Old', dueDate: new Date(2026, 10, 1) });
  // Range started 10 days ago but ends tomorrow: deadline is endDate, so it is active, not overdue/expired.
  const range = new Task({ id: 'r1', title: 'Range task', dueDate: new Date(2026, 10, 11), endDate: new Date(2026, 10, 22) });
  const summary = summarizeMine([closed, done, expired, range], now);
  assert.equal(summary.hidden, false);
  assert.equal(summary.count, 1, 'closed, done, and 7+ day expired tasks are excluded');
  assert.equal(summary.olderOverdue, 1, '7+ day expired task is counted in Past');
  assert.match(summary.nextText, /Next: Range task · Tomorrow/, 'range task deadline uses endDate');
  assert.doesNotMatch(summary.nextText, /older in Past/, 'personal strip must not nag about older Past tasks');
});

test('keyboard focus outlines, student / shortcut, read-only dialog footer, and admin delete confirmations are guarded', () => {
  assert.match(CSS, /\.text-input:focus-visible,\s*\.announce-editor:focus-visible,\s*\.dp-input:focus-visible,\s*\.search:has\(input:focus-visible\)/,
    'inputs and search box must show a visible focus ring');
  assert.match(CSS, /\.task-dialog\.is-readonly \.dialog-footer \{ display: none; \}/, 'read-only task dialog must hide empty footer');
  assert.match(CSS, /\[hidden\] \*::before \{ content: none; \}/, 'hidden editor placeholders must not leak into the accessibility tree');
  assert.match(APP, /if \(e\.key === '\/'\)/, '/ search shortcut must run before the admin-only gate');
  assert.match(PUBLISH, /armInlineConfirm\(del, 'Delete', 'Confirm deleting this version'/, 'History single-item Delete must arm before deleting');
  assert.match(SUBJECTS, /armInlineConfirm\(dom\.presetDelete, 'Delete', 'Confirm deleting this preset'/, 'Preset Delete must arm before deleting');
  assert.match(SUBJECTS, /el\('p', 'form-error'/, 'Subject editor validation errors must use .form-error');
  assert.match(ANNOUNCE, /matchMedia\('\(hover: none\)'\)/, 'Ctrl+Enter hint must hide on touch devices');
});

test('class page header pairs supporting copy before #mine and centers .mine-n cleanly', () => {
  const classSection = HTML.slice(HTML.indexOf('id="page-class-tasks"'), HTML.indexOf('id="page-my-tasks"'));
  const copyIdx = classSection.indexOf('class="page-supporting-copy"');
  const mineIdx = classSection.indexOf('id="mine"');
  const actionsIdx = classSection.indexOf('class="page-actions"');
  assert.ok(copyIdx > 0 && mineIdx > copyIdx && actionsIdx > mineIdx,
    '#page-class-tasks must order supporting copy -> #mine -> .page-actions so TASKS pairs with its subtitle');
  assert.match(CSS, /\.mine\s*\{[^}]*align-items:\s*center;/, '.mine must vertically center .mine-n beside the two-line summary');
  assert.match(CSS, /\.mine-n\s*\{[^}]*48px\/48px/, 'desktop .mine-n must use 48px/48px to match the two-line stack at 3x pixel grid');
});
