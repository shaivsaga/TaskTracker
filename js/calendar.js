import { state } from './state.js';
import { plural } from './util.js';
import { subjectFor, subjectDisplayName } from './subjects.js';

let recordSource = null;
let openTaskDialog = null;
let todayDate = null;
let toInputValue = null;
let dayDiff = null;
let subjects = null;
let clampPopoverPosition = null;
let scheduleModule = null;
let calPhone = null;
let calMode = 'month';
let calAnchor = null;
let calSelected = null;
let calByDay = new Map();
let calAgendaSig = '';
let calSubjectFilter = '';
let calSubjectSig = '';
let popoverEl = null;
let popoverDateKey = '';
let popoverTriggerEl = null;
let popoverDocBound = false;

export function invalidateAgenda() {
  calAgendaSig = '';
  calSubjectSig = '';
}

const calSort = (a, b) => (a.dueTime || '').localeCompare(b.dueTime || '');
const calLongDate = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const calSameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

function calPickDay() {
  if (calSelected && calSameMonth(calSelected, calAnchor)) return calSelected;
  const t = todayDate();
  return calSameMonth(t, calAnchor) ? t : new Date(calAnchor.getFullYear(), calAnchor.getMonth(), 1);
}

function calRange() {
  const a = calAnchor;
  if (calMode === 'week') return { start: new Date(a.getFullYear(), a.getMonth(), a.getDate() - a.getDay()), days: 7 };
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  return { start: new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay()), days: Math.ceil((first.getDay() + last.getDate()) / 7) * 7 };
}

const calCatalog = () => (state.isAdmin && !state.previewing && Array.isArray(state.publishedCatalog) && state.publishedCatalog.length
  ? state.publishedCatalog
  : state.catalog);

function subjectDot(code) {
  const dot = document.createElement('span');
  const liveCat = calCatalog();
  const def = code ? subjectFor(liveCat, code) : null;
  const cls = !def && code && subjects()[code] ? subjects()[code] : (code && subjects()[code] && liveCat === state.catalog ? subjects()[code] : '');
  dot.className = 'cal-dot' + (cls ? ` ${cls}` : '');
  if (def && !cls) dot.style.setProperty('--tag', def.color);
  return dot;
}
function createCalChip(task) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'cal-chip' + (task.status !== 'done' && task.isOverdue() ? ' is-overdue' : '');
  chip.dataset.status = task.status;
  chip.title = [task.subject, task.dueTime ? task.getTimeLabel() : '', task.title].filter(Boolean).join(' · ');
  if (task.subject) {
    chip.appendChild(subjectDot(task.subject));
    const sub = document.createElement('span');
    sub.className = 'cal-sub';
    sub.textContent = task.subject;
    chip.appendChild(sub);
  }
  if (task.dueTime) { const t = document.createElement('span'); t.className = 'cal-time'; t.textContent = task.getTimeLabel(); chip.appendChild(t); }
  const title = document.createElement('span');
  title.className = 'cal-chip-title';
  title.textContent = task.title;
  chip.appendChild(title);
  chip.addEventListener('click', () => openTaskDialog(task));
  return chip;
}

const isDueSoon = (t) => t.status !== 'done' && !!t.dueDate && !t.isOverdue() && dayDiff(t.getDeadline()) <= 3;
const urgencyRank = (t) => (t.status === 'done' ? 3 : t.isOverdue() ? 0 : isDueSoon(t) ? 1 : 2);

function createCalDots(list) {
  const wrap = document.createElement('span');
  wrap.className = 'cal-dots';
  wrap.setAttribute('aria-hidden', 'true');

  const open = list.filter((t) => t.status !== 'done');
  if (list.length > 0 && open.length === 0) {
    const doneMark = document.createElement('span');
    doneMark.className = 'cal-done-mark';
    doneMark.title = 'All tasks done';
    doneMark.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-check"/></svg>';
    wrap.appendChild(doneMark);
    return wrap;
  }

  open.sort((a, b) => urgencyRank(a) - urgencyRank(b)).slice(0, 3).forEach((t) => {
    wrap.appendChild(subjectDot(t.subject));
  });

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
  const on = calPhone.matches && calMode === 'month';
  box.hidden = !on;
  if (!on) { calAgendaSig = ''; return; }
  const d = calPickDay();
  const tasks = (calByDay.get(toInputValue(d)) || []).slice().sort(calSort);

  const sig = `${toInputValue(d)}|${tasks.map((t) => `${t.id}:${t.status}:${t.title}:${t.dueTime || ''}:${t.isOverdue() ? 1 : 0}`).join(',')}`;
  if (sig === calAgendaSig) return;
  calAgendaSig = sig;
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
  calSelected = d;
  const key = toInputValue(d);
  if (!calSameMonth(d, calAnchor)) {
    calAnchor = new Date(d.getFullYear(), d.getMonth(), 1);
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

function calKey(e, d) {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (step) { e.preventDefault(); calSelect(new Date(d.getFullYear(), d.getMonth(), d.getDate() + step), true); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); calSelect(d, true); }
}

function syncScheduleTabVisibility() {
  const tab = document.querySelector('#cal-schedule-tab');
  const visible = Boolean(scheduleModule && scheduleModule.hasVisibleSchedule());
  if (tab) tab.hidden = !visible;
  if (!visible && calMode === 'schedule') {
    calMode = 'month';
  }
}

function syncCalTabs() {
  syncScheduleTabVisibility();
  document.querySelectorAll('[data-cal-mode]').forEach((b) => {
    const on = b.dataset.calMode === calMode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

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

function closeDayPopover(refocus = false) {
  if (!popoverEl) return;
  const targetKey = popoverDateKey;
  const trigger = popoverTriggerEl;
  popoverEl.hidden = true;
  popoverDateKey = '';
  popoverTriggerEl = null;
  if (refocus) {
    const live = (targetKey && document.querySelector(`#cal-grid [data-date="${targetKey}"] .cal-more`))
      || (trigger && trigger.isConnected ? trigger : null);
    if (live) live.focus();
  }
}

function ensureDayPopover() {
  if (popoverEl) return popoverEl;
  const box = document.createElement('div');
  box.id = 'cal-day-popover';
  box.className = 'cal-day-popover';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'false');
  box.setAttribute('aria-labelledby', 'cal-popover-title');
  box.hidden = true;
  const head = document.createElement('div');
  head.className = 'cal-popover-head';
  const heading = document.createElement('h3');
  heading.className = 'cal-popover-title';
  heading.id = 'cal-popover-title';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'panel-close';
  close.setAttribute('aria-label', 'Close day tasks');
  close.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-x"/></svg>';
  close.addEventListener('click', () => closeDayPopover(true));
  head.append(heading, close);
  const listWrap = document.createElement('div');
  listWrap.className = 'cal-popover-list';
  box.append(head, listWrap);
  document.body.appendChild(box);
  if (!popoverDocBound) {
    popoverDocBound = true;
    document.addEventListener('click', (e) => {
      if (!popoverEl || popoverEl.hidden) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.includes(popoverEl) || (popoverTriggerEl && path.includes(popoverTriggerEl))) return;
      closeDayPopover(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !popoverEl || popoverEl.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      closeDayPopover(true);
    });
  }
  popoverEl = box;
  return box;
}

function openDayPopover(d, key, list, trigger) {
  if (popoverEl && !popoverEl.hidden && popoverDateKey === key) {
    closeDayPopover(true);
    return;
  }
  const box = ensureDayPopover();
  popoverDateKey = key;
  popoverTriggerEl = trigger;
  box.querySelector('#cal-popover-title').textContent = calLongDate(d);
  const wrap = box.querySelector('.cal-popover-list');
  wrap.replaceChildren();
  list.forEach((task) => {
    const chip = createCalChip(task);
    chip.addEventListener('click', () => closeDayPopover(false), true);
    wrap.appendChild(chip);
  });
  box.hidden = false;
  const rect = trigger.getBoundingClientRect();
  if (clampPopoverPosition) {
    const pos = clampPopoverPosition(rect, box.offsetWidth, box.offsetHeight, window.innerWidth, window.innerHeight);
    box.style.top = `${pos.top}px`;
    box.style.left = `${pos.left}px`;
  } else {
    box.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - box.offsetHeight - 8))}px`;
    box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8))}px`;
  }
  const closeBtn = box.querySelector('.panel-close');
  if (closeBtn) closeBtn.focus();
}

function syncCalSubjectFilter(allDated) {
  const select = document.querySelector('#cal-subject-filter');
  const reset = document.querySelector('#cal-filter-reset');
  if (!select) return;
  const cat = calCatalog();
  const codes = [...new Set(allDated.map((t) => t.subject).filter(Boolean))]
    .sort((a, b) => subjectDisplayName(cat, a).localeCompare(subjectDisplayName(cat, b), undefined, { sensitivity: 'base' }));
  if (calSubjectFilter && !codes.includes(calSubjectFilter)) calSubjectFilter = '';
  const sig = codes.map((c) => `${c}:${subjectDisplayName(cat, c)}`).join('|');
  if (sig !== calSubjectSig) {
    calSubjectSig = sig;
    select.replaceChildren();
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All subjects';
    select.appendChild(allOpt);
    codes.forEach((code) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = subjectDisplayName(cat, code);
      select.appendChild(opt);
    });
  }
  select.value = calSubjectFilter;
  if (reset) reset.hidden = !calSubjectFilter;
}

export function renderCalendar() {
  const grid = document.querySelector('#cal-grid');
  if (!grid) return;
  closeDayPopover(false);
  syncCalTabs();
  const isSchedule = calMode === 'schedule';
  const schedEl = document.querySelector('#cal-schedule');
  const todayBtn = document.querySelector('#cal-today');
  const navBox = document.querySelector('#page-calendar .cal-nav');
  const filtersBox = document.querySelector('#page-calendar .cal-filters');
  const archive = document.querySelector('#cal-past-link');
  const agendaEl = document.querySelector('#cal-agenda');
  const emptyEl = document.querySelector('#cal-empty');

  if (todayBtn) todayBtn.hidden = isSchedule;
  if (navBox) navBox.hidden = isSchedule;
  if (filtersBox) filtersBox.hidden = isSchedule;
  grid.hidden = isSchedule;
  grid.dataset.mode = calMode;

  if (isSchedule) {
    if (archive) archive.hidden = true;
    if (agendaEl) agendaEl.hidden = true;
    if (emptyEl) emptyEl.hidden = true;
    const titleEl = document.querySelector('#cal-title');
    if (titleEl) {
      titleEl.textContent = scheduleModule && scheduleModule.getTitleText
        ? scheduleModule.getTitleText()
        : 'Class Schedule';
    }
    if (schedEl) {
      schedEl.hidden = false;
      scheduleModule?.render();
    }
    return;
  }

  if (schedEl) schedEl.hidden = true;
  scheduleModule?.stopTimer();

  const { start, days } = calRange();
  const records = recordSource();
  if (archive) archive.hidden = !records.some((task) => task.isPast());
  const allDated = records.filter((task) => task.dueDate && !task.isPast());
  syncCalSubjectFilter(allDated);
  const dated = calSubjectFilter
    ? allDated.filter((t) => t.subject === calSubjectFilter)
    : allDated;
  const byDay = new Map();
  dated.forEach((t) => calDayKeys(t).forEach((k) => {
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(t);
  }));
  const short = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  document.querySelector('#cal-title').textContent = calMode === 'week'
    ? `${short(start)} – ${short(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))}`
    : calAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const period = calMode === 'week' ? 'week' : 'month';
  document.querySelector('#cal-prev').setAttribute('aria-label', `Previous ${period}`);
  document.querySelector('#cal-next').setAttribute('aria-label', `Next ${period}`);
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
  const max = calMode === 'week' ? 12 : 3;
  const phoneMonth = calPhone.matches && calMode === 'month';
  const picked = phoneMonth ? toInputValue(calPickDay()) : '';
  calByDay = byDay;
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = toInputValue(d);
    const list = (byDay.get(key) || []).slice().sort(calSort);
    const cell = document.createElement('div');
    cell.className = 'cal-day' + (calMode === 'month' && d.getMonth() !== calAnchor.getMonth() ? ' is-outside' : '') + (dayDiff(d) === 0 ? ' is-today' : '');
    if (calMode === 'week') cell.dataset.dow = d.toLocaleDateString(undefined, { weekday: 'short' });
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
      more.setAttribute('aria-haspopup', 'dialog');
      more.setAttribute('aria-label', `${list.length - max} more tasks on ${calLongDate(d)}`);
      more.addEventListener('click', (e) => { e.stopPropagation(); openDayPopover(d, key, list, more); });
      cell.appendChild(more);
    }
    grid.appendChild(cell);
  }
  emptyEl.hidden = dated.length > 0;
  if (!emptyEl.hidden) {
    emptyEl.textContent = calSubjectFilter && allDated.length > 0
      ? `No dated tasks for ${subjectDisplayName(calCatalog(), calSubjectFilter)}.`
      : (state.isAdmin && !state.previewing
        ? 'No live dated tasks have been posted yet.'
        : 'No dated tasks have been posted yet.');
  }
  if (focusedDay) calFocus(focusedDay);
  renderCalAgenda();
}

function calStep(dir) {
  calAnchor = calMode === 'week'
    ? new Date(calAnchor.getFullYear(), calAnchor.getMonth(), calAnchor.getDate() + dir * 7)
    : new Date(calAnchor.getFullYear(), calAnchor.getMonth() + dir, 1);
  renderCalendar();
}

export function init(deps) {
  recordSource = deps.recordSource;
  openTaskDialog = deps.openTaskDialog;
  todayDate = deps.todayDate;
  toInputValue = deps.toInputValue;
  dayDiff = deps.dayDiff;
  subjects = deps.subjects;
  clampPopoverPosition = deps.clampPopoverPosition || null;
  scheduleModule = deps.schedule || null;
  calMode = 'month';
  calAnchor = todayDate();
  calSelected = null;
  calAgendaSig = '';
  calSubjectFilter = '';
  calSubjectSig = '';
  closeDayPopover(false);
  calPhone = window.matchMedia('(max-width: 719px)');
  document.querySelector('#cal-prev').addEventListener('click', () => calStep(-1));
  document.querySelector('#cal-next').addEventListener('click', () => calStep(1));
  document.querySelector('#cal-today').addEventListener('click', () => { calAnchor = todayDate(); calSelected = calAnchor; renderCalendar(); });
  document.querySelector('#cal-subject-filter')?.addEventListener('change', (e) => {
    calSubjectFilter = e.target.value;
    calAgendaSig = '';
    renderCalendar();
  });
  document.querySelector('#cal-filter-reset')?.addEventListener('click', () => {
    calSubjectFilter = '';
    calAgendaSig = '';
    renderCalendar();
    document.querySelector('#cal-subject-filter')?.focus();
  });
  calPhone.addEventListener('change', renderCalendar);
  document.querySelectorAll('[data-cal-mode]').forEach((b) => b.addEventListener('click', () => { calMode = b.dataset.calMode; syncCalTabs(); renderCalendar(); }));
  syncCalTabs();
}
