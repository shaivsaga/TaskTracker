import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('Done rows unify reopen to one control and .mine respects previewing + range deadlines', () => {
  const doneBody = TASKS.slice(TASKS.indexOf('export function renderDonePage()'), TASKS.indexOf('function subjectCodesMatching'));
  assert.doesNotMatch(doneBody, /createStatusCheck\(task\)/, 'Done rows must not render a second interactive status-check reopen trigger');
  assert.match(doneBody, /status-check is-done is-static/, 'Done rows keep a static green check icon beside Mark not done');
  assert.match(APP, /const all = \(state\.previewing \? myTasks : state\.publishedTasks\)/, 'renderMine must reflect previewed draft tasks');
  assert.match(APP, /typeof t\.getDeadline === 'function' \? t\.getDeadline\(\) : t\.dueDate/, 'mineDue must read range end dates via getDeadline()');
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
