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

cacheDom();
// Preferences are watched once here, at startup, so a slow or failed board fetch cannot delay them.
motion.init();
settings.mountSectionBadges();

// --- Admin access: Basic Auth signs in once (api/login.php), then an HttpOnly session cookie does the rest ---
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
    // A saved ?admin link signs in on its own, unless this device was logged out on purpose.
    if (!ok && wanted && localStorage.getItem(SIGNED_OUT_KEY) !== '1') ok = await signIn();
    if (ok) { localStorage.setItem(ADMIN_KEY, '1'); localStorage.removeItem(SIGNED_OUT_KEY); }
    return ok;
  } catch (e) { return false; }
}

// Move the announcement editor from the Class tasks page into Admin
if (dom.adminAnnounce && dom.adminEmpty) dom.adminEmpty.before(dom.adminAnnounce);

// --- Pure constant maps: js/util.js (slice 2.2) ------------------------------------------------
// COLUMN_TO_STATUS, STATUS_TO_COLUMN, KEYS and API moved to js/util.js: pure data, no DOM, no state.
const myTasks = [];              // admin draft (definitions only)

const isEditable = (task) => state.isAdmin && !state.previewing && myTasks.includes(task);


tasks.init({
  Task, dayDiff, sortTasks, STATUS_LABELS, statusChangeMessage, sanitizeDoc, clampPopoverPosition, myTasks,
  isEditable, createSubjectTag, startNewTask, TTFiles, openDuePicker, calendar, publish,
});

function setPublished(data) {
  const board = normalizeBoard(data) || { tasks: [], announcements: [] };
  state.publishedTasks = board.tasks.map((o) => Task.fromJSON(o));
  state.publishedAnnouncements = board.announcements;
  tasks.applyProgress(state.publishedTasks);
  // Students render the published catalogue; an admin edits a draft copy that is only sent on Publish.
  if (!state.isAdmin) syncCatalog(Array.isArray(board.subjects) ? board.subjects : []);
  else if (!state.draftSubjects.length) {
    // A legacy draft carries no catalogue: it starts from the published one, never from a reset.
    state.draftSubjects = (Array.isArray(board.subjects) ? board.subjects : []).map((s) => ({ ...s }));
    syncCatalog(state.draftSubjects);
    subjectsEditor.render();
  }
}

// --- Update notice: one popup per visit listing tasks that are new or changed since this device last saw the Board ---
const SEEN_KEY = sectionKey('class_tasks_seen');
let noticeShown = false;
const noticeStamp = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const isSeenMap = (seen) => !!seen && typeof seen === 'object' && !Array.isArray(seen);

function checkUpdateNotice(board) {
  if (!board || state.isAdmin || state.previewing || noticeShown || !board.tasks.length) return;
  if (!dom.tourOverlay.hidden || !dom.importOverlay.hidden || !dom.dialogOverlay.hidden) return;
  // Raw authoritative-board stamps stay outside Task.fromJSON; Task never carries changedAt.
  const stamps = {};
  board.tasks.forEach((t) => { stamps[String(t.id)] = noticeStamp(t.changedAt); });
  const seen = readJSON(SEEN_KEY, null);
  if (!isSeenMap(seen)) { writeJSON(SEEN_KEY, stamps); return; }  // first visit: start quietly
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
  // Start hidden before it enters the document, so the native entrance samples 0, not 1.
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
  });
  note.hidden = !offline;
  // Server-proved deletions are applied first, even for an empty board and even while a task
  // dialog is open: a pending overlay must not postpone erasing progress the server forbade.
  if (authoritative && cleaned) tasks.applyProgress(state.publishedTasks);
  if (state.currentTask) return;
  setPublished(board);
  checkUpdateNotice(state.liveBoard);
  tasks.renderAllTasks();
  announcements.renderAnnouncements();
}

// --- Calendar: js/calendar.js (slice 2.3) -------------------------------------------------------
// The moved listeners register here, exactly where they used to, so their order against the other
// element listeners on this page is unchanged. `subjects` is a thunk: SUBJECTS is declared below
// this point, and the module reads the map when it renders, not while this call runs.
calendar.init({
  recordSource: tasks.recordSource, openTaskDialog: tasks.openTaskDialog, todayDate, toInputValue, dayDiff, subjects: () => tasks.SUBJECTS,
});

// --- Search (overview stats and the nav badge moved to js/tasks.js, slice 2.6) ---

document.querySelector('#task-search').addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  tasks.renderAllTasks();
});

// Class tasks search: title, subject code, notes text. Separate from the admin search.
document.querySelector('#class-task-search').addEventListener('input', (e) => {
  state.classSearchQuery = e.target.value;
  tasks.renderClassTasks();
  
});

// Class filters: the Board stays search-only; the List combines search, subject and status.
document.querySelector('#class-subject-filter').addEventListener('change', (e) => {
  state.classSubjectFilter = e.target.value;
  tasks.renderClassTasks();
});
document.querySelector('#class-status-filter').addEventListener('change', (e) => {
  state.classStatusFilter = e.target.value;
  tasks.renderClassTasks();
});

// --- New task, theme, and view switch ---
function startNewTask() {
  quickAdd.openQuickAdd();
}
document.querySelector('#new-task-btn')?.addEventListener('click', startNewTask);
document.querySelector('#empty-add-btn')?.addEventListener('click', startNewTask);

// Theme: moved to js/settings.js (slice 2.4); its toggle registers from settings.init() below.

// View switch (board / list), remembered per page
const VIEW_KEYS = { class: 'class_tasks_view_class', admin: 'class_tasks_view_admin' };
const VIEW_DEFAULTS = { class: 'list', admin: 'board' };
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
  // OS or data-motion reduced changes the view synchronously; only the local CSS fade is used.
  if (!animate || motion.isReducedMotion()) return;
  const page = document.querySelector(SCOPES[scope].page);
  page.classList.remove('is-swapping');
  void page.offsetWidth;
  page.classList.add('is-swapping');
}
document.querySelectorAll('.view-tab[data-view]').forEach((b) => {
  b.addEventListener('click', () => setView(b.closest('#page-my-tasks') ? 'admin' : 'class', b.dataset.view));
});

// --- Subjects, quick add, announcements, shortcuts ---
function createSubjectTag(code) {
  const tag = document.createElement('span');
  const def = subjects.subjectFor(state.catalog, code);
  if (def) {
    // A palette colour keeps its shipped class, so an unchanged subject renders byte-identically;
    // a custom colour gets validated custom properties instead of any class or CSS string.
    const cls = subjects.classForColor(def.color);
    tag.className = `subject-tag ${cls}`.trim();
    if (!cls) {
      tag.style.setProperty('--tag', def.color);
      tag.style.setProperty('--tag-ink', subjects.subjectTextColor(def.color));
    }
    tag.textContent = def.name || def.code;
    return tag;
  }
  // No catalogue yet (or an unknown legacy code): a neutral retired chip, never a silent recolour.
  const retired = subjects.retiredSubject(code);
  tag.className = 'subject-tag';
  tag.style.setProperty('--tag', retired.color);
  tag.style.setProperty('--tag-ink', subjects.subjectTextColor(retired.color));
  tag.textContent = code;
  return tag;
}

// One place a catalogue change becomes visible: rendering, the pickers and the calendar cache.
function syncCatalog(list) {
  state.catalog = Array.isArray(list) ? list : [];
  tasks.syncSubjectMap(state.catalog);
  tasks.refreshSubjectChoices();
  calendar.invalidateAgenda();   // a rename or recolour must repaint the calendar
}

// --- Quick-add overlay: js/quick-add.js ---------------------------------------------------------
quickAdd.init({
  lookup, parseTimeWord, WEEKDAYS, dayDiff, toInputValue, STATUS_LABELS, Task,
  createSubjectTag, openDuePicker, closeDuePicker, myTasks,
  setStatus: tasks.setStatus, saveTasks: tasks.saveTasks, setPage: nav.setPage, renderAllTasks: tasks.renderAllTasks, openTaskDialog: tasks.openTaskDialog, showToast: tasks.showToast,
  subjects: () => tasks.SUBJECTS,
});

// --- Announcements: js/announcements.js (slice 2.5) ---------------------------------------------
// The moved listeners register here, exactly where the announcement region's first listener used to,
// so the page's listener order is unchanged: the note-tool selectionchange above, then the announce
// editor, toolbar and form listeners, then the keyboard shortcuts, the publish/history Escape
// handler, settings, tour and the transfer/import and focus-trap listeners. renderAnnouncements is
// exported because loadPublished, the bootstrap init and js/transfer.js's replaced-draft path call
// it. updateAdminBar and diffDraft come from js/publish.js, which moved them in this slice.
announcements.init({
  lookup, linkify: tasks.linkify, dropHasFiles: tasks.dropHasFiles, showToast: tasks.showToast, saveTasks: tasks.saveTasks, updateAdminBar: publish.updateAdminBar, diffDraft: publish.diffDraft,
});

// --- Keyboard shortcuts: N = new task (admin), / = search ---
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

// --- Due date picker (shared by task dialog and quick add) ---
let dpEl = null;
let dpState = null;

function formatDateText(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function closeDuePicker(reason) {
  if (!dpEl) return;
  const done = dpState && dpState.onDone;
  const el = dpEl;
  dpEl = null;
  dpState = null;
  el.remove();
  if (done && (reason === 'esc' || reason === 'done')) done();
}

// opts: { anchor, focus: 'date'|'time', date, endDate, time, onChange({date, endDate, time}), onDone }
function openDuePicker(opts) {
  if (dpEl && dpState.anchor === opts.anchor && dpState.focus === opts.focus) { closeDuePicker(); return; }
  closeDuePicker();

  const s = {
    anchor: opts.anchor, focus: opts.focus, onChange: opts.onChange, onDone: opts.onDone,
    date: opts.date || null, endDate: opts.endDate || null, time: opts.time || null,
    rangeMode: !!(opts.date && opts.endDate && opts.endDate.getTime() >= opts.date.getTime()),
    activeField: 'start',
    view: null,
  };
  const seed = s.date || todayDate();
  s.view = new Date(seed.getFullYear(), seed.getMonth(), 1);

  const el = document.createElement('div');
  el.className = 'due-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Due date and time');
  el.innerHTML = `
    <div class="dp-fields${s.rangeMode ? ' is-range' : ''}">
      <input class="dp-input dp-date" type="text" placeholder="${s.rangeMode ? 'Start date' : 'Date &amp; time'}" aria-label="${s.rangeMode ? 'Start date' : 'Date and time, time optional'}" autocomplete="off" spellcheck="false" enterkeyhint="done">
      <input class="dp-input dp-end-date" type="text" placeholder="End date" aria-label="End date" autocomplete="off" spellcheck="false" enterkeyhint="done"${s.rangeMode ? '' : ' hidden'}>
    </div>
    <div class="dp-head">
      <span class="dp-month"></span>
      <button type="button" class="dp-nav dp-today">Today</button>
      <button type="button" class="dp-nav dp-prev" aria-label="Previous month"><svg class="i" aria-hidden="true"><use href="#i-chevron-left"/></svg></button>
      <button type="button" class="dp-nav dp-next" aria-label="Next month"><svg class="i" aria-hidden="true"><use href="#i-chevron-right"/></svg></button>
    </div>
    <div class="dp-grid" role="grid"></div>
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
    // Which endpoint the next day tap moves, since the caret only shows after a field is focused.
    dateIn.classList.toggle('is-active', s.activeField === 'start');
    endIn.classList.toggle('is-active', s.activeField === 'end');
    $('.dp-hint').textContent = s.rangeMode ? 'Time is optional on the start · e.g. thu 3pm' : 'Time is optional · e.g. fri 3pm';
  };
  const gotoMonth = (d) => { s.view = new Date(d.getFullYear(), d.getMonth(), 1); renderGrid(); };

  function renderGrid() {
    monthEl.textContent = s.view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    grid.replaceChildren();
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((l) => {
      const c = document.createElement('span');
      c.className = 'dp-dow';
      c.textContent = l;
      grid.appendChild(c);
    });
    const start = new Date(s.view.getFullYear(), s.view.getMonth(), 1 - s.view.getDay());
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const b = document.createElement('button');
      const t = d.getTime();
      const sTime = s.date ? s.date.getTime() : null;
      const eTime = s.rangeMode && s.endDate ? s.endDate.getTime() : null;
      const isStart = sTime !== null && t === sTime;
      const isEnd = eTime !== null && t === eTime;
      const selected = isStart || isEnd;
      const inRange = sTime !== null && eTime !== null && t > sTime && t < eTime;
      b.type = 'button';
      b.className = 'dp-day';
      b.textContent = d.getDate();
      b.setAttribute('aria-label', d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
      b.setAttribute('aria-pressed', String(selected));
      if (d.getMonth() !== s.view.getMonth()) b.classList.add('is-outside');
      if (dayDiff(d) === 0) b.classList.add('is-today');
      if (isStart) b.classList.add('is-range-start');
      if (isEnd) b.classList.add('is-range-end');
      if (inRange) b.classList.add('is-in-range');
      if (selected) b.classList.add('is-selected');
      b.addEventListener('click', () => {
        if (!s.rangeMode) {
          s.date = d;
          s.endDate = null;
        } else if (s.activeField === 'end' && s.date) {
          if (t < s.date.getTime()) { s.endDate = s.date; s.date = d; }
          else { s.endDate = d; }
        } else {
          s.date = d;
          if (s.endDate && t > s.endDate.getTime()) s.endDate = null;
          s.activeField = 'end';
        }
        syncFields();
        renderGrid();
        emit();
      });
      grid.appendChild(b);
    }
  }

  // Date field also understands a time: "fri 3pm"
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
    if (r.date) { s.date = r.date; s.time = r.time || null; gotoMonth(r.date); changed = true; }
    else if (r.timeOnly) {
      s.time = r.time;
      if (!s.date) { s.date = todayDate(); gotoMonth(s.date); }
      changed = true;
    }
    if (changed) { renderGrid(); emit(); }
  });

  dateIn.addEventListener('focus', () => { s.activeField = 'start'; });
  endIn.addEventListener('focus', () => { s.activeField = 'end'; });

  // shortcut: the end field is date-only — a time typed here is dropped on blur, when the field
  // re-renders from state. Upgrade when a range needs its own end time.
  endIn.addEventListener('input', () => {
    const r = parseDateField(endIn.value);
    if (r.empty || !r.date) return;
    if (!s.date) { s.date = r.date; s.endDate = r.date; }
    else if (r.date.getTime() < s.date.getTime()) { s.endDate = s.date; s.date = r.date; }
    else { s.endDate = r.date; }
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
    // Switching off only stops emitting the end date; keeping it in state means switching back on
    // restores it, so one mis-tap no longer destroys a picked date.
    if (s.rangeMode && s.endDate && s.date && s.endDate.getTime() < s.date.getTime()) s.endDate = null;
    s.activeField = s.rangeMode && s.date ? 'end' : 'start';
    syncFields();
    renderGrid();
    if (s.date) emit();
    if (s.rangeMode) endIn.focus();
  });

  $('.dp-prev').addEventListener('click', () => gotoMonth(new Date(s.view.getFullYear(), s.view.getMonth() - 1, 1)));
  $('.dp-next').addEventListener('click', () => gotoMonth(new Date(s.view.getFullYear(), s.view.getMonth() + 1, 1)));
  $('.dp-today').addEventListener('click', () => { s.date = todayDate(); if (s.endDate && s.endDate.getTime() < s.date.getTime()) s.endDate = null; gotoMonth(s.date); syncFields(); emit(); });
  $('.dp-clear').addEventListener('click', () => { s.date = null; s.endDate = null; s.time = null; emit(); closeDuePicker(); });

  document.body.appendChild(el);
  dpEl = el;
  dpState = s;
  syncFields();
  renderGrid();
  
  const r = s.anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  el.style.top = `${top}px`;
  el.style.left = `${Math.max(8, Math.min(r.left, document.documentElement.clientWidth - w - 8))}px`;

  dateIn.focus();
  dateIn.select();
}

// Esc closes only the picker (capture phase so the dialog / quick add stay open)
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

// --- Navigation and routing: js/nav.js (slice 2.4) ----------------------------------------------
// The moved listeners register here, exactly where they used to, so their order against the other
// element and document listeners on this page is unchanged (the Escape chain depends on it). The
// phone breakpoint now lives in styles.css alone (max-width: 719px). setPage moved with them: the
// nav-item listeners, the deep-link handler, app.js's own call sites and the quick-add, settings
// and tour init deps now reach it as nav.setPage. `pageFromHash`
// is the logic.js import above; `setPreview` is js/publish.js's export below, so passing it by value
// is safe (quickAdd.init already passes renderAllTasks the same way).
nav.init({
  pageFromHash, setPreview: publish.setPreview,
});

// --- Publish: js/publish.js (slice 2.5) ---------------------------------------------------------
// The moved listeners register here, exactly where the admin region's first listener used to, so the
// page's listener order is unchanged: the announce handlers above, then this region's element
// listeners and the Ctrl/Cmd+S, Ctrl/Cmd+Enter and Escape handlers, then settings, tour, the
// transfer/import listeners and the focus trap. snapshot, restoreDraft, diffDraft, updateAdminBar
// and setPreview are exported because the nav, tour and transfer init deps and renderAllTasks below
// call them; the module gets every app.js name it needs through init(deps). `$` stays: publish.js
// and the focus-trap selector list both use it, and it has to be declared before the init calls.
const $ = (sel) => document.querySelector(sel);

publish.init({
  $, myTasks, showToast: tasks.showToast, saveTasks: tasks.saveTasks, renderAllTasks: tasks.renderAllTasks,
  renderAnnouncements: announcements.renderAnnouncements, applyProgress: tasks.applyProgress,
  setPublished, Task, setPage: nav.setPage,
  syncCatalog,
  catalog: {
    // The draft catalogue is what Publish sends; a legacy install with no draft keeps the published
    // definitions. A definition is never invented for an unknown code (see unknownFor below).
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

// Duplicate (task dialog)
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

// --- Settings and theme: js/settings.js (slice 2.4) ---------------------------------------------
settings.init({
  $, adminHint, signIn, showToast: tasks.showToast,
  JSON_POST, ADMIN_KEY, SIGNED_OUT_KEY,
});

// --- Tutorial: js/tour.js (slice 2.3) -----------------------------------------------------------
tour.init({
  $, STATUS_LABELS, STATUS_ORDER: tasks.STATUS_ORDER, createSubjectTag,
  setPreview: publish.setPreview, setPage: nav.setPage, closeSettings: settings.closeSettings,
});

// --- Transfer and import: js/transfer.js (slice 2.4) --------------------------------------------
const INCOMING_TRANSFER = transfer.takeTransferToken();
transfer.init({
  $, showToast: tasks.showToast, closeSettings: settings.closeSettings,
  myTasks, applyProgress: tasks.applyProgress, saveTasks: tasks.saveTasks, renderAllTasks: tasks.renderAllTasks,
  snapshot: publish.snapshot, restoreDraft: publish.restoreDraft, mergeProgress, Task, taskIdOk, STATUS_ORDER: tasks.STATUS_ORDER,
});

// --- Focus trap: Tab stays inside the open dialog ---
const TRAP_SELECTORS = ['.confirm-overlay', '#notice-overlay', '#import-overlay', '#transfer-overlay', '#tour-overlay', '#quick-overlay', '#publish-overlay', '#history-overlay', '#settings-overlay', '#task-dialog-overlay'];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const ov = TRAP_SELECTORS.map((s) => document.querySelector(s)).find((o) => o && !o.hidden && !o.classList.contains('is-closing'));
  if (!ov) return;
  // The date picker and menus live outside the dialog, let them handle Tab themselves
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

// --- Initialization ---

// Skip link: jumps to the page content without touching the location hash (the hash is the router).
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

  // Time-based overdue: re-render each minute unless something is open
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
  });
  // The bin and the catalogue are server state, so they load when the Admin page is opened.
  const loadAdminPanels = () => {
    if (!state.isAdmin || document.querySelector('#page-my-tasks').hidden) return;
    bin.load();
    subjectsEditor.render();
    subjectsEditor.loadPresets();
  };
  subjectsEditor.init({
    syncCatalog,
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