import {
  Task, dayDiff, toInputValue, sortTasks, lookup, parseTimeWord,
  mergeProgress, todayDate, parseDateText, WEEKDAYS, sanitizeDoc,
  clampPopoverPosition, pageFromHash, taskIdOk, STATUS_LABELS, statusChangeMessage
} from './logic.js?v=5';
import { state } from './js/state.js';
import { dom, cacheDom } from './js/dom.js';
import { readJSON, writeJSON, formatTime, sectionKey } from './js/util.js';
import * as calendar from './js/calendar.js';
import * as quickAdd from './js/quick-add.js';
import * as tour from './js/tour.js';
import * as settings from './js/settings.js';
import * as nav from './js/nav.js';
import * as transfer from './js/transfer.js';
import * as announcements from './js/announcements.js';
import * as publish from './js/publish.js';
import * as tasks from './js/tasks.js';
import * as motion from './js/motion.js';
import * as noteImages from './js/note-images.js';
import { store, normalizeBoard } from './js/store.js';
import * as bin from './js/bin.js';
import * as subjects from './js/subjects.js';
import * as subjectsEditor from './js/subjects-editor.js';
import { selectNoticeChanges } from './js/update-notice.js';
import { insightsUi } from './js/insights-ui.js';

cacheDom();

motion.init();
settings.mountSectionBadges();

const ADMIN_KEY = sectionKey('class_tasks_admin');
const SIGNED_OUT_KEY = sectionKey('class_tasks_signed_out');

const JSON_POST = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' };
const adminHint = () => {
  try { return localStorage.getItem(ADMIN_KEY) === '1' || new URLSearchParams(location.search).has('admin'); } catch (e) { return false; }
};
async function hasSession() {
  try { return (await fetch('api/versions.php', { cache: 'no-store' })).ok; } catch (e) { return false; }
}
async function signIn() {
  try { return (await fetch('api/login.php', JSON_POST)).ok; } catch (e) { return false; }
}
async function checkAdmin() {
  try {
    const wanted = new URLSearchParams(location.search).has('admin');
    if (!wanted && localStorage.getItem(ADMIN_KEY) !== '1') return false;
    let ok = await hasSession();

    if (!ok && wanted && localStorage.getItem(SIGNED_OUT_KEY) !== '1') ok = await signIn();
    if (ok) { localStorage.setItem(ADMIN_KEY, '1'); localStorage.removeItem(SIGNED_OUT_KEY); }
    return ok;
  } catch (e) { return false; }
}

if (dom.adminAnnounce && dom.adminEmpty) dom.adminEmpty.before(dom.adminAnnounce);

const myTasks = [];

const isEditable = (task) => state.isAdmin && !state.previewing && myTasks.includes(task);

tasks.init({
  Task, dayDiff, sortTasks, STATUS_LABELS, statusChangeMessage, sanitizeDoc, clampPopoverPosition, myTasks,
  isEditable, createSubjectTag, startNewTask, TTFiles, openDuePicker, calendar, publish, insightsUi,
});

function setPublished(data) {
  const board = normalizeBoard(data) || { tasks: [], announcements: [] };
  state.publishedTasks = board.tasks.map((o) => Task.fromJSON(o));
  state.publishedAnnouncements = board.announcements;
  state.publishedCatalog = Array.isArray(board.subjects) ? board.subjects.map((s) => ({ ...s })) : [];
  tasks.applyProgress(state.publishedTasks);

  if (!state.isAdmin) syncCatalog(state.publishedCatalog);
  else if (!state.draftSubjects.length) {

    state.draftSubjects = state.publishedCatalog.map((s) => ({ ...s }));
    syncCatalog(state.draftSubjects);
    subjectsEditor.render();
  }
  calendar.invalidateAgenda();
}

const SEEN_KEY = sectionKey('class_tasks_seen');
let noticeShown = false;
const noticeStamp = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const isSeenMap = (seen) => !!seen && typeof seen === 'object' && !Array.isArray(seen);

function checkUpdateNotice(board) {
  if (!board || state.isAdmin || state.previewing || noticeShown || !board.tasks.length) return;
  if (!dom.tourOverlay.hidden || !dom.importOverlay.hidden || !dom.dialogOverlay.hidden) return;

  const stamps = {};
  board.tasks.forEach((t) => { stamps[String(t.id)] = noticeStamp(t.changedAt); });
  const seen = readJSON(SEEN_KEY, null);
  if (!isSeenMap(seen)) { writeJSON(SEEN_KEY, stamps); return; }
  const fresh = selectNoticeChanges(board.tasks, seen);
  if (!fresh.length) return;
  const byId = new Map(board.tasks.map((t) => [String(t.id), t]));
  noticeShown = true;
  showUpdateNotice(fresh.map(({ id, isNew }) => ({ isNew, task: Task.fromJSON(byId.get(id)) })), () => writeJSON(SEEN_KEY, stamps));
}

function showUpdateNotice(items, onDismiss) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const overlay = el('div', 'task-dialog-overlay');
  overlay.id = 'notice-overlay';
  const box = el('div', 'task-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'notice-title');
  const head = el('div', 'dialog-header');
  const title = el('h2', 'dialog-heading', 'What changed');
  title.id = 'notice-title';
  const x = el('button', 'panel-close');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  x.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-x"/></svg>';
  head.append(title, x);
  const body = el('div', 'dialog-body');
  body.appendChild(el('p', 'dialog-summary', items.length === 1 ? '1 task is new or changed since your last visit.' : `${items.length} tasks are new or changed since your last visit.`));
  const list = el('ul', 'import-summary');
  items.slice(0, 8).forEach(({ isNew, task }) => {
    list.appendChild(el('li', '', `${isNew ? 'New' : 'Updated'}: ${task.subject ? subjects.subjectDisplayName(state.catalog, task.subject) + ' · ' : ''}${task.title} · ${task.getDueShort()}`));
  });
  if (items.length > 8) list.appendChild(el('li', '', `and ${items.length - 8} more`));
  body.appendChild(list);
  const foot = el('div', 'dialog-footer');
  const ok = el('button', 'primary-button', 'Got it');
  ok.type = 'button';
  foot.appendChild(ok);
  box.append(head, body, foot);
  overlay.appendChild(box);

  overlay.hidden = true;
  document.body.appendChild(overlay);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    motion.hideOverlay(overlay);
    setTimeout(() => overlay.remove(), 300);
    onDismiss();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ok.addEventListener('click', close);
  x.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay._returnFocus = document.activeElement;
  motion.openOverlay(overlay);
  ok.focus();
}

async function loadPublished() {
  const note = document.querySelector('#sync-note');
  const { board, authoritative, offline, cleaned } = await store.fetchBoard({
    onPersistError: () => tasks.showToast('Could not update saved progress on this device.'),
    onActivityDegraded: (res) => insightsUi.handleStorageDegraded(res),
  });
  note.hidden = !offline;

  if (authoritative && cleaned) tasks.applyProgress(state.publishedTasks);
  if (state.currentTask) return;
  setPublished(board);
  checkUpdateNotice(state.liveBoard);
  tasks.renderAllTasks();
  announcements.renderAnnouncements();
}

calendar.init({
  recordSource: tasks.recordSource, openTaskDialog: tasks.openTaskDialog, todayDate, toInputValue, dayDiff,
  subjects: () => tasks.SUBJECTS, clampPopoverPosition,
});

document.querySelector('#task-search').addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  tasks.renderAllTasks();
});
document.querySelector('#admin-subject-filter')?.addEventListener('change', (e) => {
  state.adminSubjectFilter = e.target.value;
  tasks.renderAllTasks();
});

document.querySelector('#class-task-search').addEventListener('input', (e) => {
  state.classSearchQuery = e.target.value;
  tasks.renderClassTasks();

});

document.querySelector('#class-subject-filter').addEventListener('change', (e) => {
  state.classSubjectFilter = e.target.value;
  tasks.renderClassTasks();
});
document.querySelector('#class-status-filter').addEventListener('change', (e) => {
  state.classStatusFilter = e.target.value;
  tasks.renderClassTasks();
});

function startNewTask() {
  quickAdd.openQuickAdd();
}
document.querySelector('#new-task-btn')?.addEventListener('click', startNewTask);
document.querySelector('#empty-add-btn')?.addEventListener('click', startNewTask);

const VIEW_KEYS = { class: 'class_tasks_view_class', admin: 'class_tasks_view_admin' };
const VIEW_DEFAULTS = { class: 'list', admin: 'list' };
const SCOPES = {
  class: { page: '#page-class-tasks', board: '#class-board', list: '#class-task-list' },
  admin: { page: '#page-my-tasks', board: '#page-my-tasks .kanban-board', list: '#task-list' },
};

function applyView(scope, view) {
  const s = SCOPES[scope];
  const page = document.querySelector(s.page);
  page.dataset.view = view;
  document.querySelector(s.board).hidden = view !== 'board';
  document.querySelector(s.list).hidden = view !== 'list';
  page.querySelectorAll('.view-tab').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function setView(scope, view, animate = true) {
  try { localStorage.setItem(VIEW_KEYS[scope], view); } catch (e) {}
  applyView(scope, view);

  if (!animate || motion.isReducedMotion()) return;
  const page = document.querySelector(SCOPES[scope].page);
  page.classList.remove('is-swapping');
  void page.offsetWidth;
  page.classList.add('is-swapping');
}
document.querySelectorAll('.view-tab[data-view]').forEach((b) => {
  b.addEventListener('click', () => {
    const scope = b.closest('#page-my-tasks') ? 'admin' : 'class';
    const nextView = b.dataset.view;
    const clearClassStatus = scope === 'class' && nextView === 'board' && state.classStatusFilter;
    if (clearClassStatus) {
      state.classStatusFilter = '';
      const sel = document.querySelector('#class-status-filter');
      if (sel) sel.value = '';
    }
    setView(scope, nextView);
    if (clearClassStatus) tasks.renderClassTasks();
  });
});

function createSubjectTag(code, catalogList = state.catalog) {
  const tag = document.createElement('span');
  const def = subjects.subjectFor(Array.isArray(catalogList) && catalogList.length ? catalogList : state.catalog, code);
  if (def) {

    const cls = subjects.classForColor(def.color);
    tag.className = `subject-tag ${cls}`.trim();
    if (!cls) {
      tag.style.setProperty('--tag', def.color);
      tag.style.setProperty('--tag-ink', subjects.subjectTextColor(def.color));
    }
    tag.textContent = def.name || def.code;
    return tag;
  }

  const retired = subjects.retiredSubject(code);
  tag.className = 'subject-tag';
  tag.style.setProperty('--tag', retired.color);
  tag.style.setProperty('--tag-ink', subjects.subjectTextColor(retired.color));
  tag.textContent = code;
  return tag;
}

function syncCatalog(list) {
  state.catalog = Array.isArray(list) ? list : [];
  tasks.syncSubjectMap(state.catalog);
  tasks.refreshSubjectChoices();
  calendar.invalidateAgenda();
}

quickAdd.init({
  lookup, parseTimeWord, WEEKDAYS, dayDiff, toInputValue, STATUS_LABELS, Task,
  createSubjectTag, openDuePicker, closeDuePicker, myTasks,
  setStatus: tasks.setStatus, saveTasks: tasks.saveTasks, setPage: nav.setPage, renderAllTasks: tasks.renderAllTasks, openTaskDialog: tasks.openTaskDialog, showToast: tasks.showToast,
  subjects: () => tasks.SUBJECTS,
});

announcements.init({
  lookup, linkify: tasks.linkify, dropHasFiles: tasks.dropHasFiles, showToast: tasks.showToast, saveTasks: tasks.saveTasks, updateAdminBar: publish.updateAdminBar, diffDraft: publish.diffDraft,
});

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return;
  if (!dom.dialogOverlay.hidden || !dom.quickOverlay.hidden || !dom.tourOverlay.hidden) return;
  if (e.key === '/') {
    e.preventDefault();
    const onAdmin = state.isAdmin && !document.querySelector('#page-my-tasks').hidden;
    if (onAdmin) { document.querySelector('#task-search').focus(); return; }
    nav.setPage('class-tasks');
    document.querySelector('#class-task-search').focus();
    return;
  }
  if (!state.isAdmin) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); quickAdd.openQuickAdd(); }
});

let dpEl = null;
let dpState = null;

function formatDateText(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function closeDuePicker(reason) {
  if (!dpEl) return;
  const done = dpState && dpState.onDone;
  const anchor = dpState && dpState.anchor;
  const el = dpEl;
  dpEl = null;
  dpState = null;
  el.remove();
  if (reason === 'esc' || reason === 'done') {
    if (done) done();
    else if (anchor && anchor.focus) anchor.focus();
  }
}

function addMonthsClamped(d, deltaMonths) {
  const first = new Date(d.getFullYear(), d.getMonth() + deltaMonths, 1);
  const maxDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), maxDay));
}

function openDuePicker(opts) {
  if (dpEl && dpState.anchor === opts.anchor && dpState.focus === opts.focus) { closeDuePicker(); return; }
  closeDuePicker();

  const s = {
    anchor: opts.anchor, focus: opts.focus, onChange: opts.onChange, onDone: opts.onDone,
    date: opts.date || null, endDate: opts.endDate || null, time: opts.time || null,
    rangeMode: !!(opts.date && opts.endDate && opts.endDate.getTime() >= opts.date.getTime()),
    activeField: 'start',
    view: null,
    focusDate: null,
  };
  const seed = s.date || todayDate();
  s.focusDate = new Date(seed.getFullYear(), seed.getMonth(), seed.getDate());
  s.view = new Date(seed.getFullYear(), seed.getMonth(), 1);

  const el = document.createElement('div');
  el.className = 'due-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Due date and time');
  el.innerHTML = `
    <div class="dp-fields${s.rangeMode ? ' is-range' : ''}">
      <input class="dp-input dp-date" type="text" placeholder="${s.rangeMode ? 'Start date' : 'Date &amp; time'}" aria-label="${s.rangeMode ? 'Start date' : 'Date and time, time optional'}" autocomplete="off" spellcheck="false" enterkeyhint="done">
      <input class="dp-input dp-end-date" type="text" placeholder="End date" aria-label="End date" autocomplete="off" spellcheck="false" enterkeyhint="done"${s.rangeMode ? '' : ' hidden'}>
    </div>
    <div class="dp-head">
      <span class="dp-month" id="dp-month-label"></span>
      <button type="button" class="dp-nav dp-today">Today</button>
      <button type="button" class="dp-nav dp-prev" aria-label="Previous month"><svg class="i" aria-hidden="true"><use href="#i-chevron-left"/></svg></button>
      <button type="button" class="dp-nav dp-next" aria-label="Next month"><svg class="i" aria-hidden="true"><use href="#i-chevron-right"/></svg></button>
    </div>
    <div class="dp-grid" role="grid" aria-labelledby="dp-month-label"></div>
    <div class="dp-options">
      <label class="dp-toggle">
        <span class="dp-toggle-label">Add an end date</span>
        <input type="checkbox" role="switch" class="dp-end-toggle"${s.rangeMode ? ' checked' : ''}>
        <span class="dp-switch" aria-hidden="true"></span>
      </label>
    </div>
    <div class="dp-foot">
      <span class="dp-hint">Time is optional · e.g. fri 3pm</span>
      <button type="button" class="text-button dp-clear">Clear</button>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const fieldsEl = $('.dp-fields');
  const dateIn = $('.dp-date');
  const endIn = $('.dp-end-date');
  const endToggle = $('.dp-end-toggle');
  const grid = $('.dp-grid');
  const monthEl = $('.dp-month');

  const emit = () => s.onChange({ date: s.date, endDate: s.rangeMode ? s.endDate : null, time: s.time });
  const syncFields = () => {
    dateIn.value = s.date ? formatDateText(s.date) + (s.time ? ' ' + formatTime(s.time) : '') : '';
    endIn.value = s.endDate ? formatDateText(s.endDate) : '';
    fieldsEl.classList.toggle('is-range', s.rangeMode);
    dateIn.placeholder = s.rangeMode ? 'Start date' : 'Date & time';
    dateIn.setAttribute('aria-label', s.rangeMode ? 'Start date' : 'Date and time, time optional');
    endIn.hidden = !s.rangeMode;
    endToggle.checked = s.rangeMode;

    dateIn.classList.toggle('is-active', s.activeField === 'start');
    endIn.classList.toggle('is-active', s.activeField === 'end');
    $('.dp-hint').textContent = s.rangeMode ? 'Time is optional on the start · e.g. thu 3pm' : 'Time is optional · e.g. fri 3pm';
  };
  const gotoMonth = (d) => {
    s.view = new Date(d.getFullYear(), d.getMonth(), 1);
    if (s.focusDate.getMonth() !== s.view.getMonth() || s.focusDate.getFullYear() !== s.view.getFullYear()) {
      s.focusDate = addMonthsClamped(s.focusDate, (s.view.getFullYear() - s.focusDate.getFullYear()) * 12 + (s.view.getMonth() - s.focusDate.getMonth()));
    }
    renderGrid();
  };

  function selectDay(d, refocus) {
    const t = d.getTime();
    s.focusDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (!s.rangeMode) {
      s.date = s.focusDate;
      s.endDate = null;
    } else if (s.activeField === 'end' && s.date) {
      if (t < s.date.getTime()) { s.endDate = s.date; s.date = s.focusDate; }
      else { s.endDate = s.focusDate; }
    } else {
      s.date = s.focusDate;
      if (s.endDate && t > s.endDate.getTime()) s.endDate = null;
      s.activeField = 'end';
    }
    syncFields();
    renderGrid();
    emit();
    if (refocus) grid.querySelector(`.dp-day[data-date="${toInputValue(s.focusDate)}"]`)?.focus();
  }

  function renderGrid() {
    monthEl.textContent = s.view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    grid.replaceChildren();
    const headRow = document.createElement('div');
    headRow.className = 'dp-row dp-row-head';
    headRow.setAttribute('role', 'row');
    [
      ['Sunday', 'S'], ['Monday', 'M'], ['Tuesday', 'T'], ['Wednesday', 'W'],
      ['Thursday', 'T'], ['Friday', 'F'], ['Saturday', 'S'],
    ].forEach(([full, short]) => {
      const c = document.createElement('span');
      c.className = 'dp-dow';
      c.setAttribute('role', 'columnheader');
      c.setAttribute('aria-label', full);
      c.textContent = short;
      headRow.appendChild(c);
    });
    grid.appendChild(headRow);
    const start = new Date(s.view.getFullYear(), s.view.getMonth(), 1 - s.view.getDay());
    const gridEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 41);
    const focusT = s.focusDate ? s.focusDate.getTime() : -1;
    const focusVisible = focusT >= start.getTime() && focusT <= gridEnd.getTime();
    const activeKey = focusVisible ? toInputValue(s.focusDate) : toInputValue(new Date(s.view.getFullYear(), s.view.getMonth(), 1));
    for (let w = 0; w < 6; w++) {
      const row = document.createElement('div');
      row.className = 'dp-row';
      row.setAttribute('role', 'row');
      for (let col = 0; col < 7; col++) {
        const i = w * 7 + col;
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const key = toInputValue(d);
        const cell = document.createElement('div');
        cell.className = 'dp-cell';
        cell.setAttribute('role', 'gridcell');
        const b = document.createElement('button');
        const t = d.getTime();
        const sTime = s.date ? s.date.getTime() : null;
        const eTime = s.rangeMode && s.endDate ? s.endDate.getTime() : null;
        const isStart = sTime !== null && t === sTime;
        const isEnd = eTime !== null && t === eTime;
        const selected = isStart || isEnd;
        const inRange = sTime !== null && eTime !== null && t > sTime && t < eTime;
        cell.setAttribute('aria-selected', String(selected));
        b.type = 'button';
        b.className = 'dp-day';
        b.dataset.date = key;
        b.tabIndex = key === activeKey ? 0 : -1;
        b.textContent = d.getDate();
        b.setAttribute('aria-label', d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
        if (d.getMonth() !== s.view.getMonth()) b.classList.add('is-outside');
        if (dayDiff(d) === 0) {
          b.classList.add('is-today');
          b.setAttribute('aria-current', 'date');
        }
        if (isStart) b.classList.add('is-range-start');
        if (isEnd) b.classList.add('is-range-end');
        if (inRange) b.classList.add('is-in-range');
        if (selected) b.classList.add('is-selected');
        b.addEventListener('click', (ev) => selectDay(d, ev.detail === 0));
        cell.appendChild(b);
        row.appendChild(cell);
      }
      grid.appendChild(row);
    }
  }

  grid.addEventListener('keydown', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('.dp-day') : null;
    if (!btn || !btn.dataset.date) return;
    const parts = btn.dataset.date.split('-').map(Number);
    const cur = new Date(parts[0], parts[1] - 1, parts[2]);
    let next = null;
    if (e.key === 'ArrowLeft') next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 1);
    else if (e.key === 'ArrowRight') next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    else if (e.key === 'ArrowUp') next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 7);
    else if (e.key === 'ArrowDown') next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 7);
    else if (e.key === 'Home') next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - cur.getDay());
    else if (e.key === 'End') next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + (6 - cur.getDay()));
    else if (e.key === 'PageUp') next = addMonthsClamped(cur, e.shiftKey ? -12 : -1);
    else if (e.key === 'PageDown') next = addMonthsClamped(cur, e.shiftKey ? 12 : 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectDay(cur, true);
      return;
    }
    if (!next) return;
    e.preventDefault();
    s.focusDate = next;
    if (next.getMonth() !== s.view.getMonth() || next.getFullYear() !== s.view.getFullYear()) {
      s.view = new Date(next.getFullYear(), next.getMonth(), 1);
    }
    renderGrid();
    grid.querySelector(`.dp-day[data-date="${toInputValue(next)}"]`)?.focus();
  });

  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = [...el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.hidden && !node.closest('[hidden]') && node.getClientRects().length);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function parseDateField(text) {
    const norm = text.trim().replace(/(\d)\s+(am|pm)\b/gi, '$1$2');
    if (!norm) return { empty: true };
    let time = null;
    const rest = norm.split(/\s+/).filter((w) => {
      const t = parseTimeWord(w);
      if (t && !time) { time = t; return false; }
      return true;
    });
    return { date: rest.length ? parseDateText(rest.join(' ')) : null, time, timeOnly: !rest.length && !!time };
  }

  dateIn.addEventListener('input', () => {
    const r = parseDateField(dateIn.value);
    if (r.empty) return;
    let changed = false;
    if (r.date) { s.date = r.date; s.focusDate = r.date; s.time = r.time || null; gotoMonth(r.date); changed = true; }
    else if (r.timeOnly) {
      s.time = r.time;
      if (!s.date) { s.date = todayDate(); s.focusDate = s.date; gotoMonth(s.date); }
      changed = true;
    }
    if (changed) { renderGrid(); emit(); }
  });

  dateIn.addEventListener('focus', () => { s.activeField = 'start'; });
  endIn.addEventListener('focus', () => { s.activeField = 'end'; });

  endIn.addEventListener('input', () => {
    const r = parseDateField(endIn.value);
    if (r.empty || !r.date) return;
    if (!s.date) { s.date = r.date; s.endDate = r.date; }
    else if (r.date.getTime() < s.date.getTime()) { s.endDate = s.date; s.date = r.date; }
    else { s.endDate = r.date; }
    s.focusDate = r.date;
    gotoMonth(r.date);
    renderGrid();
    emit();
  });

  const commitDate = () => {
    if (!dateIn.value.trim() && s.date) { s.date = null; s.endDate = null; s.time = null; renderGrid(); emit(); }
    if (s.rangeMode && !endIn.value.trim() && s.endDate) { s.endDate = null; renderGrid(); emit(); }
    syncFields();
  };
  dateIn.addEventListener('blur', commitDate);
  endIn.addEventListener('blur', commitDate);
  const onEnter = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    commitDate();
    closeDuePicker('done');
  };
  dateIn.addEventListener('keydown', onEnter);
  endIn.addEventListener('keydown', onEnter);

  endToggle.addEventListener('change', () => {
    s.rangeMode = endToggle.checked;

    if (s.rangeMode && s.endDate && s.date && s.endDate.getTime() < s.date.getTime()) s.endDate = null;
    s.activeField = s.rangeMode && s.date ? 'end' : 'start';
    syncFields();
    renderGrid();
    if (s.date) emit();
    if (s.rangeMode) endIn.focus();
  });

  $('.dp-prev').addEventListener('click', () => gotoMonth(new Date(s.view.getFullYear(), s.view.getMonth() - 1, 1)));
  $('.dp-next').addEventListener('click', () => gotoMonth(new Date(s.view.getFullYear(), s.view.getMonth() + 1, 1)));
  $('.dp-today').addEventListener('click', () => { s.date = todayDate(); s.focusDate = s.date; if (s.endDate && s.endDate.getTime() < s.date.getTime()) s.endDate = null; gotoMonth(s.date); syncFields(); emit(); });
  $('.dp-clear').addEventListener('click', () => { s.date = null; s.endDate = null; s.time = null; emit(); closeDuePicker(); });

  document.body.appendChild(el);
  dpEl = el;
  dpState = s;
  syncFields();
  renderGrid();

  const r = s.anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const hMargin = document.documentElement.clientWidth <= 374 ? 4 : 8;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  el.style.top = `${top}px`;
  el.style.left = `${Math.max(hMargin, Math.min(r.left, document.documentElement.clientWidth - w - hMargin))}px`;

  dateIn.focus();
  dateIn.select();
}

document.addEventListener('keydown', (e) => {
  if (dpEl && e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeDuePicker('esc');
  }
}, true);
document.addEventListener('click', (e) => {
  if (dpEl && !e.composedPath().includes(dpEl) && !dpState.anchor.contains(e.target)) closeDuePicker();
});

nav.init({
  pageFromHash, setPreview: publish.setPreview,
});

const $ = (sel) => document.querySelector(sel);

publish.init({
  $, myTasks, showToast: tasks.showToast, saveTasks: tasks.saveTasks, renderAllTasks: tasks.renderAllTasks,
  renderAnnouncements: announcements.renderAnnouncements, applyProgress: tasks.applyProgress,
  setPublished, Task, setPage: nav.setPage,
  syncCatalog,
  catalog: {

    forPublish: () => (state.draftSubjects.length
      ? state.draftSubjects
      : (state.liveBoard && Array.isArray(state.liveBoard.subjects) ? state.liveBoard.subjects : [])),
    unknownFor: (draftTasks) => {
      const source = state.draftSubjects.length
        ? state.draftSubjects
        : (state.liveBoard && Array.isArray(state.liveBoard.subjects) ? state.liveBoard.subjects : []);
      const known = new Set(source.map((s) => s && s.code).filter(Boolean));
      const missing = new Set();
      for (const t of Array.isArray(draftTasks) ? draftTasks : []) {
        const code = t && t.subject;
        if (typeof code === 'string' && code !== '' && !known.has(code)) missing.add(code);
      }
      return [...missing];
    },
  },
  adoptInlineImages: noteImages.adoptInlineImages, rewriteNotes: noteImages.rewriteNotes, files: window.TTFiles,
  armInlineConfirm: tasks.armInlineConfirm,
});

dom.dialogDuplicate.addEventListener('click', () => {
  if (!state.currentTask || !isEditable(state.currentTask)) return;
  const source = state.currentTask;
  tasks.closeTaskDialog();
  const copy = Task.fromJSON({ ...source.toJSON(), id: undefined, title: `${source.title} (copy)` });
  myTasks.push(copy);
  state.justChangedId = copy.id;
  tasks.saveTasks();
  tasks.renderAllTasks();
  tasks.openTaskDialog(copy);
});

settings.init({
  $, adminHint, signIn, showToast: tasks.showToast,
  JSON_POST, ADMIN_KEY, SIGNED_OUT_KEY,
  onOpenSettings: () => insightsUi.syncSettings(),
});

insightsUi.init({
  getTasks: tasks.classTasksSource,
  getProgress: () => state.progress,
  getCatalog: tasks.activeClassCatalog,
  createSubjectTag,
  renderClassTasks: tasks.renderClassTasks,
  renderAllTasks: tasks.renderAllTasks,
  openSettings: settings.openSettings,
  reloadProgressFromStorage: tasks.reloadProgressFromStorage,
});

tour.init({
  $, STATUS_LABELS, STATUS_ORDER: tasks.STATUS_ORDER, createSubjectTag,
  setPreview: publish.setPreview, setPage: nav.setPage, closeSettings: settings.closeSettings,
});

const INCOMING_TRANSFER = transfer.takeTransferToken();
transfer.init({
  $, showToast: tasks.showToast, closeSettings: settings.closeSettings,
  myTasks, applyProgress: tasks.applyProgress, saveTasks: tasks.saveTasks, renderAllTasks: tasks.renderAllTasks,
  snapshot: publish.snapshot, restoreDraft: publish.restoreDraft, mergeProgress, Task, taskIdOk, STATUS_ORDER: tasks.STATUS_ORDER,
});

const TRAP_SELECTORS = ['.confirm-overlay', '#notice-overlay', '#import-overlay', '#transfer-overlay', '#tour-overlay', '#quick-overlay', '#publish-overlay', '#history-overlay', '#insights-overlay', '#settings-overlay', '#task-dialog-overlay'];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const ov = TRAP_SELECTORS.map((s) => document.querySelector(s)).find((o) => o && !o.hidden && !o.classList.contains('is-closing'));
  if (!ov) return;

  if (e.target instanceof Element && e.target.closest('.due-picker, .status-popover')) return;
  const items = [...ov.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden]') && el.getClientRects().length);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (!ov.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (ov.classList.contains('confirm-overlay') && !e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (ov.classList.contains('confirm-overlay') && e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function initSkipLink() {
  const link = document.querySelector('#skip-link');
  const main = document.querySelector('main');
  if (!link || !main) return;
  main.tabIndex = -1;
  link.addEventListener('click', (e) => { e.preventDefault(); main.focus({ preventScroll: false }); });
}

function init() {
  initSkipLink();
  tasks.loadTasks();
  if (state.isAdmin && state.draftSubjects.length) syncCatalog(state.draftSubjects);
  announcements.renderAnnouncements();
  ['class', 'admin'].forEach((scope) => {
    let v = null;
    try { v = localStorage.getItem(VIEW_KEYS[scope]); } catch (e) {}
    setView(scope, v === 'list' || v === 'board' ? v : VIEW_DEFAULTS[scope], false);
  });
  tasks.showSkeletons();
  loadPublished();
  setInterval(loadPublished, 300000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadPublished(); });

  nav.setPage(pageFromHash(window.location.hash, nav.NAV_PAGES, state.isAdmin), false);
  if (INCOMING_TRANSFER) transfer.checkIncomingTransfer(INCOMING_TRANSFER);
  else if (!tour.tourSeen()) tour.showTourCue();

  setInterval(() => {
    const popoverOpen = state.statusPopoverEl && !state.statusPopoverEl.hidden;
    if (document.hidden || popoverOpen || !dom.dialogOverlay.hidden || !dom.quickOverlay.hidden) return;
    tasks.renderAllTasks();
  }, 60000);
}

async function start() {
  state.isAdmin = await checkAdmin();
  document.querySelector('#nav-admin').hidden = !state.isAdmin;
  init();
  bin.init({
    myTasks,
    Task,
    saveTasks: tasks.saveTasks,
    renderAllTasks: tasks.renderAllTasks,
    confirmDialog: tasks.confirmDialog,
  });

  const loadAdminPanels = () => {
    if (!state.isAdmin || document.querySelector('#page-my-tasks').hidden) return;
    bin.load();
    subjectsEditor.render();
    subjectsEditor.loadPresets();
  };
  subjectsEditor.init({
    syncCatalog: (list) => { syncCatalog(list); tasks.renderAllTasks(); },
    saveTasks: tasks.saveTasks,
    referencedCodes: () => [...new Set(
      [...myTasks, ...state.publishedTasks].map((t) => t && t.subject).filter(Boolean),
    )],
    confirm: (message) => new Promise((resolve) => tasks.confirmDialog({
      title: 'Apply subject preset?', message, okLabel: 'Apply preset',
      onConfirm: () => resolve(true), onCancel: () => resolve(false),
    })),
    armInlineConfirm: tasks.armInlineConfirm,
  });
  window.addEventListener('hashchange', loadAdminPanels);
  if (state.isAdmin) setTimeout(loadAdminPanels, 0);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}