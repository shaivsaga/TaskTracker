// js/calendar.js - the calendar page (app.js split, slice 2.3).
//
// Moved verbatim out of app.js: renderCalendar and renderCalAgenda, their private helpers, the
// month/week navigation, the day-cell and agenda handlers and the calendar's own listeners.
//
// D6: this module never imports logic.js and never reads a bare global. The date helpers, the task
// source and the task dialog arrive through init(deps); renderCalendar is exported because
// renderAllTasks() in app.js still repaints the page. `subjects` is a thunk, not the map itself:
// init() has to run where the moved listener block used to sit, which is before app.js initialises
// its SUBJECTS const, so the map is read at call time instead of captured at init time.
//
// calMode/calAnchor/calSelected/calByDay/calAgendaSig stay in js/state.js (slice 2.1) and are read
// and written through `state` here.
//
// Importing this module touches nothing: no DOM read, no listener, no state read and no timer at
// evaluation time, so
//   node --input-type=module -e "await import('./js/calendar.js')"
// is clean under plain Node (docs/p6-architecture-findings.md 4, DECISIONS.md D6).

import { state } from './state.js';
import { plural } from './util.js';
import { subjectFor } from './subjects.js';

let recordSource = null;    // () => the task list the renderers read (state.isAdmin is read inside it)
let openTaskDialog = null;  // opens the task dialog when a chip is clicked
let todayDate = null;       // logic.js helpers, kept in app.js's one ./logic.js?v=5 import
let toInputValue = null;
let dayDiff = null;
let subjects = null;        // () => app.js's SUBJECTS map, read at call time (see the header)
let calPhone = null;        // window.matchMedia('(max-width: 719px)'), created in init()

// --- Calendar ---
const calSort = (a, b) => (a.dueTime || '').localeCompare(b.dueTime || '');
const calLongDate = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const calSameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

// Phone month view: the day picked in the grid, defaulting to today (or the 1st) of the shown month.
function calPickDay() {
  if (state.calSelected && calSameMonth(state.calSelected, state.calAnchor)) return state.calSelected;
  const t = todayDate();
  return calSameMonth(t, state.calAnchor) ? t : new Date(state.calAnchor.getFullYear(), state.calAnchor.getMonth(), 1);
}

function calRange() {
  const a = state.calAnchor;
  if (state.calMode === 'week') return { start: new Date(a.getFullYear(), a.getMonth(), a.getDate() - a.getDay()), days: 7 };
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  return { start: new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay()), days: Math.ceil((first.getDay() + last.getDate()) / 7) * 7 };
}

// A custom hex colour has no shipped class, so the dot carries the definition's colour itself.
function subjectDot(code) {
  const dot = document.createElement('span');
  const cls = code && subjects()[code] ? subjects()[code] : '';
  dot.className = 'cal-dot' + (cls ? ` ${cls}` : '');
  if (code && !cls) {
    const def = subjectFor(state.catalog, code);
    if (def) dot.style.setProperty('--tag', def.color);
  }
  return dot;
}
function createCalChip(task) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'cal-chip' + (task.status !== 'done' && task.isOverdue() ? ' is-overdue' : '');
  chip.dataset.status = task.status;
  chip.title = (task.subject ? `${task.subject} · ` : '') + task.title;
  if (task.subject) chip.appendChild(subjectDot(task.subject));
  if (task.dueTime) { const t = document.createElement('span'); t.className = 'cal-time'; t.textContent = task.getTimeLabel(); chip.appendChild(t); }
  const title = document.createElement('span');
  title.className = 'cal-chip-title';
  title.textContent = task.title;
  chip.appendChild(title);
  chip.addEventListener('click', () => openTaskDialog(task));
  return chip;
}

// Same rule as the list rows and the board badge: open, not overdue, due within 3 days.
const isDueSoon = (t) => t.status !== 'done' && !!t.dueDate && !t.isOverdue() && dayDiff(t.dueDate) <= 3;
const urgencyRank = (t) => (t.status === 'done' ? 3 : t.isOverdue() ? 0 : isDueSoon(t) ? 1 : 2);

function createCalDots(list) {
  const wrap = document.createElement('span');
  wrap.className = 'cal-dots';
  wrap.setAttribute('aria-hidden', 'true');
  // Completion never reserves a marker slot; rank the remaining tasks before limiting them.
  const open = list.filter((t) => t.status !== 'done');
  open.sort((a, b) => urgencyRank(a) - urgencyRank(b)).slice(0, 3).forEach((t) => {
    wrap.appendChild(subjectDot(t.subject));
  });
  // The cell's aria-label carries the true count; this is the visible remainder for the rest.
  if (open.length > 3) {
    const more = document.createElement('span');
    more.className = 'cal-plus';
    more.textContent = `+${open.length - 3}`;
    wrap.appendChild(more);
  }
  return wrap;
}

function renderCalAgenda() {
  const box = document.querySelector('#cal-agenda');
  if (!box) return;
  const on = calPhone.matches && state.calMode === 'month';
  box.hidden = !on;
  if (!on) { state.calAgendaSig = ''; return; }
  const d = calPickDay();
  const tasks = (state.calByDay.get(toInputValue(d)) || []).slice().sort(calSort);
  // The page re-renders every minute; only touch the live region when the day's content really changed.
  const sig = `${toInputValue(d)}|${tasks.map((t) => `${t.id}:${t.status}:${t.title}:${t.dueTime || ''}:${t.isOverdue() ? 1 : 0}`).join(',')}`;
  if (sig === state.calAgendaSig) return;
  state.calAgendaSig = sig;
  document.querySelector('#cal-agenda-title').textContent = calLongDate(d);
  const out = document.querySelector('#cal-agenda-list');
  out.replaceChildren();
  if (!tasks.length) {
    const p = document.createElement('p');
    p.className = 'cal-agenda-empty';
    p.textContent = 'Nothing due this day.';
    out.appendChild(p);
    return;
  }
  tasks.forEach((t) => out.appendChild(createCalChip(t)));
}

const calFocus = (key) => document.querySelector(`#cal-grid [data-date="${key}"]`)?.focus({ preventScroll: true });

function calSelect(d, focus) {
  state.calSelected = d;
  const key = toInputValue(d);
  if (!calSameMonth(d, state.calAnchor)) {
    state.calAnchor = new Date(d.getFullYear(), d.getMonth(), 1);
    renderCalendar();
  } else {
    document.querySelectorAll('#cal-grid .cal-day.is-tappable').forEach((c) => {
      const on = c.dataset.date === key;
      c.classList.toggle('is-selected', on);
      c.tabIndex = on ? 0 : -1;
      if (on) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
    });
    renderCalAgenda();
  }
  if (focus) calFocus(key);
}

// Arrow keys move the selection by a day or a week; Enter/Space picks the focused day.
function calKey(e, d) {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (step) { e.preventDefault(); calSelect(new Date(d.getFullYear(), d.getMonth(), d.getDate() + step), true); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); calSelect(d, true); }
}

function syncCalTabs() {
  document.querySelectorAll('[data-cal-mode]').forEach((b) => {
    const on = b.dataset.calMode === state.calMode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// The day cell's two ARIA contracts sit here side by side instead of being duplicated per branch:
// the phone month cell is a picker (role=button, roving tabindex, aria-current="true" on the picked
// day), every other cell is a labelled group that holds that day's chips and marks today
// aria-current="date".
function calLabelCell(cell, num, { d, key, list, picker, current }) {
  const overdue = list.filter((t) => t.status !== 'done' && t.isOverdue()).length;
  const soon = list.filter(isDueSoon).length;
  const completed = list.filter((t) => t.status === 'done').length;
  const completion = completed ? `, ${plural(list.length - completed, 'unfinished task')}, ${plural(completed, 'completed task')}` : '';
  cell.dataset.date = key;
  cell.setAttribute('aria-label', `${calLongDate(d)}, ${list.length ? plural(list.length, 'task') : 'no tasks'}${completion}${overdue ? `, ${overdue} overdue` : ''}${soon ? `, ${soon} due soon` : ''}`);
  num.setAttribute('aria-hidden', 'true');
  if (picker) {
    cell.setAttribute('role', 'button');
    if (current) cell.setAttribute('aria-current', 'true');
  } else {
    cell.setAttribute('role', 'group');
    if (dayDiff(d) === 0) cell.setAttribute('aria-current', 'date');
  }
}

// Every calendar day a task covers, capped at 60 so a mistyped end date cannot paint a year of dots.
function calDayKeys(t) {
  const keys = [toInputValue(t.dueDate)];
  if (t.endDate) {
    for (let i = 1; i < 60 && keys.length < 60; i++) {
      const d = new Date(t.dueDate.getFullYear(), t.dueDate.getMonth(), t.dueDate.getDate() + i);
      if (toInputValue(d) > toInputValue(t.endDate)) break;
      keys.push(toInputValue(d));
    }
  }
  return keys;
}

export function renderCalendar() {
  const grid = document.querySelector('#cal-grid');
  if (!grid) return;
  const { start, days } = calRange();
  const dated = recordSource().filter((t) => t.dueDate);
  const byDay = new Map();
  dated.forEach((t) => calDayKeys(t).forEach((k) => {
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(t);
  }));
  const short = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  document.querySelector('#cal-title').textContent = state.calMode === 'week'
    ? `${short(start)} – ${short(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))}`
    : state.calAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  // The arrows move a month or a week; say which, instead of a bare "Previous"/"Next".
  const period = state.calMode === 'week' ? 'week' : 'month';
  document.querySelector('#cal-prev').setAttribute('aria-label', `Previous ${period}`);
  document.querySelector('#cal-next').setAttribute('aria-label', `Next ${period}`);
  grid.dataset.mode = state.calMode;
  grid.setAttribute('role', 'region');
  grid.setAttribute('aria-labelledby', 'cal-title');
  const focusedDay = grid.contains(document.activeElement) ? document.activeElement.dataset.date : '';
  grid.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const h = document.createElement('div');
    h.className = 'cal-dow';
    h.setAttribute('aria-hidden', 'true');
    h.textContent = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).toLocaleDateString(undefined, { weekday: 'short' });
    grid.appendChild(h);
  }
  const max = state.calMode === 'week' ? 12 : 3;
  const phoneMonth = calPhone.matches && state.calMode === 'month';
  const picked = phoneMonth ? toInputValue(calPickDay()) : '';
  state.calByDay = byDay;
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = toInputValue(d);
    const list = (byDay.get(key) || []).slice().sort(calSort);
    const cell = document.createElement('div');
    cell.className = 'cal-day' + (state.calMode === 'month' && d.getMonth() !== state.calAnchor.getMonth() ? ' is-outside' : '') + (dayDiff(d) === 0 ? ' is-today' : '');
    if (state.calMode === 'week') cell.dataset.dow = d.toLocaleDateString(undefined, { weekday: 'short' });
    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = d.getDate();
    cell.appendChild(num);
    calLabelCell(cell, num, { d, key, list, picker: phoneMonth, current: key === picked });
    if (phoneMonth) {
      cell.classList.add('is-tappable');
      if (key === picked) cell.classList.add('is-selected');
      cell.tabIndex = key === picked ? 0 : -1;
      if (list.length) cell.appendChild(createCalDots(list));
      cell.addEventListener('click', () => calSelect(d));
      cell.addEventListener('keydown', (e) => calKey(e, d));
      grid.appendChild(cell);
      continue;
    }
    list.slice(0, max).forEach((t) => cell.appendChild(createCalChip(t)));
    if (list.length > max) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'cal-more';
      more.textContent = `+${list.length - max} more`;
      more.addEventListener('click', () => { state.calAnchor = d; state.calMode = 'week'; syncCalTabs(); renderCalendar(); });
      cell.appendChild(more);
    }
    grid.appendChild(cell);
  }
  document.querySelector('#cal-empty').hidden = dated.length > 0;
  if (focusedDay) calFocus(focusedDay);
  renderCalAgenda();
}

function calStep(dir) {
  state.calAnchor = state.calMode === 'week'
    ? new Date(state.calAnchor.getFullYear(), state.calAnchor.getMonth(), state.calAnchor.getDate() + dir * 7)
    : new Date(state.calAnchor.getFullYear(), state.calAnchor.getMonth() + dir, 1);
  renderCalendar();
}

// Called once by app.js, at the spot the listeners below used to occupy, after cacheDom() and
// before the first render. The module keeps every dep in a module-local binding.
export function init(deps) {
  recordSource = deps.recordSource;
  openTaskDialog = deps.openTaskDialog;
  todayDate = deps.todayDate;
  toInputValue = deps.toInputValue;
  dayDiff = deps.dayDiff;
  subjects = deps.subjects;
  calPhone = window.matchMedia('(max-width: 719px)');
  document.querySelector('#cal-prev').addEventListener('click', () => calStep(-1));
  document.querySelector('#cal-next').addEventListener('click', () => calStep(1));
  document.querySelector('#cal-today').addEventListener('click', () => { state.calAnchor = todayDate(); state.calSelected = state.calAnchor; renderCalendar(); });
  calPhone.addEventListener('change', renderCalendar);
  document.querySelectorAll('[data-cal-mode]').forEach((b) => b.addEventListener('click', () => { state.calMode = b.dataset.calMode; syncCalTabs(); renderCalendar(); }));
}
