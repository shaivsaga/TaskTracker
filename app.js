import {
  Task, dayDiff, toInputValue, sortTasks, lookup, parseTimeWord,
  mergeProgress, todayDate, parseDateText, WEEKDAYS, sanitizeDoc,
  clampPopoverPosition, pageFromHash, taskIdOk, STATUS_LABELS, statusChangeMessage
} from './logic.js?v=5';
import { state } from './js/state.js';
import { dom, cacheDom } from './js/dom.js';
import { readJSON, writeJSON, plural, fmtWhen, formatTime, COLUMN_TO_STATUS, STATUS_TO_COLUMN, KEYS, API } from './js/util.js';
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
import * as recovery from './js/recovery.js';
import * as bin from './js/bin.js';
import * as subjects from './js/subjects.js';
import * as subjectsEditor from './js/subjects-editor.js';
import { selectNoticeChanges } from './js/update-notice.js';

// --- Module state: js/state.js (slice 2.1) ----------------------------------------------------
// Every top-level mutable variable moved to the single `state` object. Deleting the declarations
// here is deliberate: a missed site throws a ReferenceError instead of reading a second copy.
// calAnchor is the only field whose initial value needs a call (todayDate()), so state.js keeps it
// null and this line sets it at module-eval time, before anything reads it.
state.calAnchor = todayDate();

// --- Element cache: js/dom.js (slice 2.2) -----------------------------------------------------
// cacheDom() fills the `dom` object once, here, before the first use of any cached element. The
// top-level `const` lookups that used to live in app.js are gone on purpose: a missed site now
// throws instead of quietly re-querying, and js/dom.js touches no DOM while it is evaluated.
cacheDom();
// Preferences are watched once here, at startup, so a slow or failed board fetch cannot delay them.
motion.init();

// --- Admin access: Basic Auth signs in once (api/login.php), then an HttpOnly session cookie does the rest ---
const ADMIN_KEY = 'class_tasks_admin';
const SIGNED_OUT_KEY = 'class_tasks_signed_out';

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


// --- Tasks: js/tasks.js (slice 2.6) -------------------------------------------------------------
// init() runs at the spot where the first dialog listener used to be registered, and every moved
// listener is registered inside it in source order, so the order of the page listeners - including
// the dialog/popover Escape chain and the due-picker capture handler - is unchanged. The hub
// functions the other modules receive are passed on from here as tasks.<name>.
// --- Private recycle bin: the client side of the archive-first deletion -----------------------
// Every call carries one intent id and the admin revision it decided from. A stale base is
// answered with the current revision, so the intent is retried once with the same operation id
// rather than duplicated; a conflict on the id itself is reported, never retried blindly.
const newOperationId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''));

// The catalogue definition a bin record keeps so the archived task still reads correctly.
// A code with no configured definition keeps a neutral retired one; the task is never re-tagged.
function subjectDef(code) {
  if (!code) return [];
  return [{ code: String(code), name: String(code), color: '#c3c7d6', active: false }];
}

async function adminPost(payload) {
  const res = await fetch(API.versions, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (typeof data?.adminRevision === 'number') state.adminRevision = data.adminRevision;
  return { ok: res.ok, status: res.status, code: data && data.code, data };
}

async function adminAction(action, fields) {
  const operationId = newOperationId();
  const send = (base) => adminPost({ action, operationId, baseAdminRevision: base, ...fields });
  let out = await send(state.adminRevision);
  if (!out.ok && out.code === 'stale_admin_base') {
    // Learn the current private revision, then retry the SAME intent once.
    const summary = await fetch(`${API.versions}?view=admin`, { cache: 'no-store' });
    const data = await summary.json().catch(() => null);
    if (typeof data?.adminRevision === 'number') state.adminRevision = data.adminRevision;
    out = await send(state.adminRevision);
  }
  return out;
}

const recoveryApi = {
  async archive(task) {
    const definition = task && typeof task.toJSON === 'function' ? task.toJSON() : task;
    try {
      const out = await adminAction('bin-archive', { task: definition, subjects: subjectDef(task && task.subject) });
      return out.ok ? { ok: true, binId: out.data && out.data.binId } : { ok: false, status: out.status, code: out.code };
    } catch (e) {
      return { ok: false, reason: 'offline' };
    }
  },
  // Authority is checked when the user acts, not when the toast was created.
  mustRecoverAsNewId(id) {
    return state.verifiedDeletedIds.includes(String(id));
  },
};

tasks.init({
  Task, dayDiff, sortTasks, STATUS_LABELS, statusChangeMessage, sanitizeDoc, clampPopoverPosition, myTasks,
  isEditable, hideAnimated, createSubjectTag, startNewTask, TTFiles, openDuePicker, calendar, publish,
  recovery: recoveryApi,
});

// Returns a clean { tasks, announcements } or null when the data is not a usable board.
function normalizeBoard(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.tasks)) return null;
  if (data.announcements != null && !Array.isArray(data.announcements)) return null;
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  return {
    ...data,
    tasks: data.tasks.filter(isObj),
    announcements: (data.announcements || []).filter((a) => isObj(a) && typeof a.text === 'string' && Number.isFinite(a.createdAt)),
  };
}

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
const SEEN_KEY = 'class_tasks_seen';
const noticeStamp = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const isSeenMap = (seen) => !!seen && typeof seen === 'object' && !Array.isArray(seen);

function checkUpdateNotice(board) {
  if (!board || state.isAdmin || state.previewing || state.noticeShown || !board.tasks.length) return;
  if (!dom.tourOverlay.hidden || !dom.importOverlay.hidden || !dom.dialogOverlay.hidden) return;
  // Raw authoritative-board stamps stay outside Task.fromJSON; Task never carries changedAt.
  const stamps = {};
  board.tasks.forEach((t) => { stamps[String(t.id)] = noticeStamp(t.changedAt); });
  const seen = readJSON(SEEN_KEY, null);
  if (!isSeenMap(seen)) { writeJSON(SEEN_KEY, stamps); return; }  // first visit: start quietly
  const fresh = selectNoticeChanges(board.tasks, seen);
  if (!fresh.length) return;
  const byId = new Map(board.tasks.map((t) => [String(t.id), t]));
  state.noticeShown = true;
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
    hideAnimated(overlay);
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

// --- Deletion authority -----------------------------------------------------------------------
// Only a validated successful schema-2 response proves a permanent deletion. A cache, a 404, a
// truncated body or an offline fallback prove nothing, so nothing is erased from those.
function acceptAuthoritativeBoard(board) {
  const next = recovery.nextAuthority(
    { revision: state.verifiedRevision, deletedIds: state.verifiedDeletedIds },
    board,
  );
  if (!next) return false;
  state.verifiedRevision = next.revision;
  state.verifiedDeletedIds = next.deletedIds;
  return true;
}

// Erase exactly the progress the server proved deleted - even when the board has no tasks, and
// before any early return for an open dialog. Absence alone never erases an entry.
function applyDeletionAuthority() {
  const before = state.progress;
  const filtered = recovery.filterDeletedProgress(before, state.verifiedDeletedIds);
  if (!filtered.removed.length) return true;
  state.progress = filtered.progress;
  if (!writeJSON(KEYS.progress, state.progress)) {
    state.progress = before;   // never claim a cleanup that did not persist
    tasks.showToast('Could not update saved progress on this device.');
    return false;
  }
  return true;
}

async function loadPublished() {
  const note = document.querySelector('#sync-note');
  let board = null;
  let authoritative = false;
  try {
    // S2: a unique ?t= URL can never match a cache entry, and no-store forbids the
    // conditional request as well, so every visit downloaded the whole 1.70 MB board.
    // A stable URL plus no-cache lets nginx answer 304 from its ETag; the timeout
    // still bounds a slow board fetch.
    const res = await fetch(API.current, { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
    let data;
    if (res.status === 404) data = { tasks: [], announcements: [] };
    else if (res.ok) data = await res.json();
    else throw new Error(String(res.status));
    board = normalizeBoard(data);
    if (!board) throw new Error('Invalid board data');
    // A 404 body is not a board: it proves nothing, so it never becomes authority.
    authoritative = res.ok && acceptAuthoritativeBoard(board);
    writeJSON(KEYS.cache, board);
    note.hidden = true;
    state.liveBoard = board;
  } catch (e) {
    board = normalizeBoard(readJSON(KEYS.cache, null));
    note.hidden = false;
    state.liveBoard = null;
  }
  // Server-proved deletions are applied first, even for an empty board and even while a task
  // dialog is open: a pending overlay must not postpone erasing progress the server forbade.
  if (authoritative && applyDeletionAuthority()) tasks.applyProgress(state.publishedTasks);
  if (state.currentTask) return;
  setPublished(board);
  checkUpdateNotice(state.liveBoard);
  tasks.renderAllTasks();
  announcements.renderAnnouncements();
}


// --- Toast and autosave feedback (hideAnimated); skeletons moved to js/tasks.js (slice 2.6) ---

// Hands the logical close to the shared overlay owner, then restores focus to the opener.
function hideAnimated(el, ms = 180) {
  const returnFocus = motion.hideOverlay(el, ms);
  if (returnFocus && returnFocus.isConnected) returnFocus.focus();
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
const STATUS_CODES = {
  ns: 'not_started', todo: 'not_started', 'not started': 'not_started',
  ip: 'in_progress', started: 'in_progress', doing: 'in_progress', 'in progress': 'in_progress',
  dn: 'done', done: 'done',
};

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
  state.calAgendaSig = '';   // a rename or recolour must repaint the calendar
}

// --- Quick add: "GENMATH worksheet ip 10/5" ---

// Splits on spaces but keeps "not started" and "in progress" as one word.
function quickWords(text) {
  const raw = text.trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const pair = (raw[i] + ' ' + (raw[i + 1] || '')).toLowerCase();
    if (pair === 'not started' || pair === 'in progress') { out.push(raw[i] + ' ' + raw[i + 1]); i++; }
    else out.push(raw[i]);
  }
  return out;
}

function parseQuickAdd(text) {
  const out = { subject: '', status: null, typedStatus: false, dueDate: undefined, endDate: undefined, dueTime: undefined, title: '' };
  const rest = [];
  const now = new Date();
  quickWords(text).forEach((word) => {
    const lower = word.toLowerCase();
    const md = /^(\d{1,2})[\/-](\d{1,2})$/.exec(word);
    const time = parseTimeWord(word);
    const weekday = lookup(WEEKDAYS, lower);
    if (!out.subject && lookup(tasks.SUBJECTS, word.toUpperCase())) {
      out.subject = word.toUpperCase();
    } else if (!out.status && lookup(STATUS_CODES, lower)) {
      out.status = lookup(STATUS_CODES, lower);
      out.typedStatus = true;
    } else if (!out.dueDate && md) {
      const d = new Date(now.getFullYear(), +md[1] - 1, +md[2]);
      if (d.getMonth() === +md[1] - 1) out.dueDate = d; else rest.push(word);
    } else if (!out.dueDate && (lower === 'today' || lower === 'tmr' || lower === 'tomorrow')) {
      out.dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (lower === 'today' ? 0 : 1));
    } else if (!out.dueDate && weekday !== undefined) {
      const ahead = ((weekday - now.getDay() + 7) % 7) || 7;
      out.dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
    } else if (!out.dueTime && time) {
      out.dueTime = time;
    } else {
      rest.push(word);
    }
  });
  if (state.quickPicked.date) { out.dueDate = state.quickPicked.date; out.endDate = state.quickPicked.endDate || undefined; out.dueTime = state.quickPicked.time || undefined; }   // picker wins
  if (!out.dueDate) { out.endDate = undefined; out.dueTime = undefined; }              // time and end date need a start date
  out.status = out.status || 'not_started';
  out.title = (rest.join(' ') || (out.subject ? `${out.subject} task` : 'New Task')).slice(0, 500);
  return out;
}

// --- Quick-add overlay: js/quick-add.js (slice 2.3) ---------------------------------------------
// The moved listeners register here, exactly where they used to, so their order against the other
// element listeners on this page is unchanged. quickWords/parseQuickAdd stay above - the brief's
// natural-language parser has no logic.js home at this tip, so it arrives through init(deps) with the
// logic.js material. The two maps are thunks: the module reads them while it renders.
quickAdd.init({
  quickWords, parseQuickAdd,
  lookup, parseTimeWord, WEEKDAYS, dayDiff, toInputValue, STATUS_LABELS, Task,
  createSubjectTag, openDuePicker, closeDuePicker, hideAnimated, myTasks,
  setStatus: tasks.setStatus, saveTasks: tasks.saveTasks, setPage: nav.setPage, renderAllTasks: tasks.renderAllTasks, openTaskDialog: tasks.openTaskDialog, showToast: tasks.showToast,
  subjects: () => tasks.SUBJECTS, statusCodes: () => STATUS_CODES,
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

// --- Keyboard shortcuts: N = new task, / = search ---
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return;
  if (!state.isAdmin || !dom.dialogOverlay.hidden || !dom.quickOverlay.hidden || !dom.tourOverlay.hidden) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); quickAdd.openQuickAdd(); }
  if (e.key === '/') { e.preventDefault(); nav.setPage('my-tasks'); document.querySelector('#task-search').focus(); }
});

// --- Due date picker (shared by task dialog and quick add) ---

function formatDateText(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function closeDuePicker(reason) {
  if (!state.dpEl) return;
  const done = state.dpState && state.dpState.onDone;
  const el = state.dpEl;
  state.dpEl = null;
  state.dpState = null;
  el.remove();
  if (done && (reason === 'esc' || reason === 'done')) done();
}

// opts: { anchor, focus: 'date'|'time', date, endDate, time, onChange({date, endDate, time}), onDone }
function openDuePicker(opts) {
  if (state.dpEl && state.dpState.anchor === opts.anchor && state.dpState.focus === opts.focus) { closeDuePicker(); return; }
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
        <span class="dp-toggle-label">End date</span>
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
    if (!s.rangeMode) {
      s.endDate = null;
      s.activeField = 'start';
    } else {
      s.activeField = s.date ? 'end' : 'start';
    }
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
  state.dpEl = el;
  state.dpState = s;
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
  if (state.dpEl && e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeDuePicker('esc');
  }
}, true);
document.addEventListener('click', (e) => {
  if (state.dpEl && !e.composedPath().includes(state.dpEl) && !state.dpState.anchor.contains(e.target)) closeDuePicker();
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
  $, myTasks, showToast: tasks.showToast, hideAnimated, saveTasks: tasks.saveTasks, renderAllTasks: tasks.renderAllTasks,
  renderAnnouncements: announcements.renderAnnouncements, applyProgress: tasks.applyProgress,
  normalizeBoard, setPublished, Task, setPage: nav.setPage,
  acceptAuthority: (board) => { if (acceptAuthoritativeBoard(board)) applyDeletionAuthority(); },
  archive: (task) => recoveryApi.archive(task),
  syncCatalog,
  catalog: {
    newOperationId,
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
// The moved listeners register here, exactly where the settings panel's listeners used to, so their
// order against the publish/history Escape handler above and the tour listeners below is unchanged.
// The theme toggle moved here too (its block sat next to the new-task button); it is the only
// listener on #theme-toggle, so its later registration competes with nothing. Every dep is declared
// above this point, so it can be passed by value.
settings.init({
  $, hideAnimated, adminHint, signIn, showToast: tasks.showToast,
  JSON_POST, ADMIN_KEY, SIGNED_OUT_KEY,
});

// --- Tutorial: js/tour.js (slice 2.3) -----------------------------------------------------------
// The moved listeners register here, exactly where they used to, so the tour's document keydown
// handler keeps its place in the Escape chain and its resize handler keeps its order against the
// other window listeners. `$` is app.js's querySelector shorthand (declared above); the rest are
// the hub functions the module still calls.
tour.init({
  $, STATUS_LABELS, STATUS_ORDER: tasks.STATUS_ORDER, createSubjectTag,
  setPreview: publish.setPreview, setPage: nav.setPage, hideAnimated, closeSettings: settings.closeSettings,
});

// --- Transfer and import: js/transfer.js (slice 2.4) --------------------------------------------
// One init() registers the region's listeners here, exactly where the transfer region's first
// listener used to register, so the page's listener order is unchanged: the publish/history Escape
// handler, then settings, then tour, then the transfer and import listeners plus their Escape
// handler, then the focus trap below. The token is still read at module-evaluation time - before
// start() awaits checkAdmin() - and app.js's bootstrap init() still calls checkIncomingTransfer with
// it. Every dep is declared (or, for renderAllTasks, hoisted) above this point, so passing them by
// value is safe; myTasks is the same array instance the draft code mutates.
const INCOMING_TRANSFER = transfer.takeTransferToken();
transfer.init({
  $, hideAnimated, showToast: tasks.showToast, closeSettings: settings.closeSettings,
  myTasks, applyProgress: tasks.applyProgress, saveTasks: tasks.saveTasks, renderAllTasks: tasks.renderAllTasks, renderAnnouncements: announcements.renderAnnouncements,
  snapshot: publish.snapshot, restoreDraft: publish.restoreDraft, mergeProgress, Task, taskIdOk, STATUS_ORDER: tasks.STATUS_ORDER,
  syncCatalog,
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
  else if (!tour.tourSeen()) setTimeout(tour.startTour, 800);

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
    adminAction,
    archive: (task) => recoveryApi.archive(task),
    newId: () => (crypto.randomUUID ? crypto.randomUUID() : newOperationId()),
    acceptAuthority: (board) => { if (acceptAuthoritativeBoard(board)) applyDeletionAuthority(); },
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
    adminAction,
    apiVersions: API.versions,
    confirm: (message) => new Promise((resolve) => tasks.confirmDialog({
      title: 'Apply subject preset?', message, okLabel: 'Apply preset',
      onConfirm: () => resolve(true), onCancel: () => resolve(false),
    })),
  });
  window.addEventListener('hashchange', loadAdminPanels);
  if (state.isAdmin) setTimeout(loadAdminPanels, 0);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}