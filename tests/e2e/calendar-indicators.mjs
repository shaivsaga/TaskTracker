// Run with node tests/e2e/calendar-indicators.mjs; jsdom lives in the existing external harness.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { state } from '../../js/state.js';
import { init, renderCalendar } from '../../js/calendar.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(process.env.TT_HARNESS || path.resolve(root, '../../harness'), 'load.mjs'));
const { JSDOM } = require('jsdom');
const dom = new JSDOM(`<div id="cal-title"></div><div id="cal-grid"></div><div id="cal-empty"></div>
  <div id="cal-agenda"><div id="cal-agenda-title"></div><div id="cal-agenda-list"></div></div>
  <button id="cal-prev"></button><button id="cal-next"></button><button id="cal-today"></button>`);
globalThis.document = dom.window.document;
globalThis.window = dom.window;
window.matchMedia = () => ({ matches: true, addEventListener() {} });

const dueDate = new Date(2026, 10, 3);
const subjects = { GENSCI: 'bg-cyan', MABKOM: 'bg-sand', PE: 'bg-yellow', PKLP: 'bg-sunglow' };
let tasks = ['GENSCI', 'MABKOM', 'PE'].map((subject, n) => ({
  id: String(n), title: subject, subject, dueDate, status: 'not_started',
  isOverdue: () => false,
}));
state.calMode = 'month';
state.calAnchor = dueDate;
state.calSelected = dueDate;
state.calAgendaSig = '';
const toInputValue = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
init({ recordSource: () => tasks, openTaskDialog() {}, todayDate: () => dueDate,
  toInputValue, dayDiff: () => 5, subjects: () => subjects });
const markers = () => {
  const cell = document.querySelector('#cal-grid .cal-day[data-date="2026-11-03"]');
  assert.ok(cell);
  return { colors: [...cell.querySelectorAll('.cal-dots .cal-dot')].map((dot) => dot.className),
    more: cell.querySelector('.cal-dots .cal-plus')?.textContent ?? null,
    label: cell.getAttribute('aria-label') };
};

try {
  renderCalendar();
  assert.equal(markers().colors.length, 3);
  assert.equal(markers().more, null);

  tasks = [...tasks, { id: '3', title: 'Extra', subject: 'PKLP', dueDate, status: 'not_started', isOverdue: () => false }];
  renderCalendar();
  assert.equal(markers().colors.length, 3);
  assert.equal(markers().more, '+');
  assert.match(markers().label, /4 tasks/);

  tasks = tasks.map((task, index) => index === 0 ? { ...task, status: 'done' } : task);
  renderCalendar();
  assert.deepEqual(markers().colors.map((name) => name.split(' ').at(-1)), ['bg-sand', 'bg-yellow', 'bg-sunglow']);
  assert.equal(markers().more, null);
  assert.match(markers().label, /4 tasks/);
  assert.match(markers().label, /3 unfinished tasks, 1 completed task/);

  tasks = tasks.map((task, index) => index === 1 ? { ...task, status: 'done' } : task);
  renderCalendar();
  assert.deepEqual(markers().colors.map((name) => name.split(' ').at(-1)), ['bg-yellow', 'bg-sunglow']);
  assert.equal(markers().more, null);
  assert.match(markers().label, /2 unfinished tasks, 2 completed tasks/);
  tasks = tasks.map((task) => ({ ...task, status: 'done' }));
  renderCalendar();
  assert.deepEqual(markers().colors, []);
  assert.equal(markers().more, null);
  assert.match(markers().label, /0 unfinished tasks, 4 completed tasks/);
  console.log('calendar indicators: add, completion, overflow and packed squares OK');
} finally {
  dom.window.close();
  delete globalThis.document;
  delete globalThis.window;
}
