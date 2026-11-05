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
const findTask = (id) => [...myTasks, ...state.publishedTasks].find((t) => t.id === id);

// Leaving Done needs an explicit yes. Returns true when the change may proceed.
const isReopen = (task, status) => task.status === 'done' && status !== 'done';

dom.dialogFileInput.accept = TTFiles.ACCEPT;
dom.dialogAttachBtn.addEventListener('click', () => dom.dialogFileInput.click());
dom.dialogFileInput.addEventListener('change', () => {
  const picked = [...dom.dialogFileInput.files];
  dom.dialogFileInput.value = '';
  if (picked.length) attachFiles(picked);
});

// Title is a one-line-looking textarea that grows with its content
function fitDialogTitle() {
  dom.dialogTitleInput.style.height = 'auto';
  dom.dialogTitleInput.style.height = dom.dialogTitleInput.scrollHeight + 'px';
}
dom.dialogTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) e.preventDefault();
});
dom.dialogTitleInput.addEventListener('input', () => {
  const clean = dom.dialogTitleInput.value.replace(/[\r\n]+/g, ' ');
  if (clean !== dom.dialogTitleInput.value) dom.dialogTitleInput.value = clean;
  fitDialogTitle();
});
window.addEventListener('resize', () => { if (state.currentTask) fitDialogTitle(); });

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
}

// --- Update notice: one popup per visit listing tasks that are new or changed since this device last saw the Board ---
const SEEN_KEY = 'class_tasks_seen';

function checkUpdateNotice(board) {
  if (!board || state.isAdmin || state.previewing || state.noticeShown || !board.tasks.length) return;
  if (!dom.tourOverlay.hidden || !dom.importOverlay.hidden || !dom.dialogOverlay.hidden) return;
  const stamps = {};
  board.tasks.forEach((t) => { stamps[String(t.id)] = Number.isFinite(t.changedAt) ? t.changedAt : 0; });
  const seen = readJSON(SEEN_KEY, null);
  if (!seen || typeof seen !== 'object' || Array.isArray(seen)) { writeJSON(SEEN_KEY, stamps); return; }  // first visit: start quietly
  const fresh = board.tasks.filter((t) => { const id = String(t.id); return !Object.hasOwn(seen, id) || (seen[id] > 0 && stamps[id] > seen[id]); });
  if (!fresh.length) { writeJSON(SEEN_KEY, stamps); return; }
  state.noticeShown = true;
  showUpdateNotice(fresh.map((t) => ({ isNew: !Object.hasOwn(seen, String(t.id)), task: Task.fromJSON(t) })), () => writeJSON(SEEN_KEY, stamps));
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
    list.appendChild(el('li', '', `${isNew ? 'New' : 'Updated'}: ${task.subject ? task.subject + ' · ' : ''}${task.title} · ${task.getDueShort()}`));
  });
  if (items.length > 8) list.appendChild(el('li', '', `and ${items.length - 8} more`));
  body.appendChild(list);
  const foot = el('div', 'dialog-footer');
  const ok = el('button', 'primary-button', 'Got it');
  ok.type = 'button';
  foot.appendChild(ok);
  box.append(head, body, foot);
  overlay.appendChild(box);
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
  ok.focus();
}

async function loadPublished() {
  const note = document.querySelector('#sync-note');
  let board = null;
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
    writeJSON(KEYS.cache, board);
    note.hidden = true;
    state.liveBoard = board;
  } catch (e) {
    board = normalizeBoard(readJSON(KEYS.cache, null));
    note.hidden = false;
    state.liveBoard = null;
  }
  if (state.currentTask) return;
  setPublished(board);
  checkUpdateNotice(state.liveBoard);
  tasks.pruneProgress(state.liveBoard);
  tasks.renderAllTasks();
  announcements.renderAnnouncements();
}

function updateDialogDue(task) {
  dom.dialogDateBtn.textContent = task.getDueShort();
  dom.dialogDueHint.textContent = task.status === 'done' ? '' : task.getDueHint();
  dom.dialogDueHint.classList.toggle('is-overdue', task.status !== 'done' && task.isOverdue());
  dom.dialogDateBtn.classList.toggle('empty-value', !task.dueDate);
  dom.dialogDueClear.hidden = !task.dueDate || !isEditable(task);
}

function updateDialogStatus(task) {
  const map = {
    not_started: { label: 'Not started', dot: 'dot-not-started', cls: 'is-not-started' },
    in_progress: { label: 'In progress', dot: 'dot-in-progress', cls: 'is-in-progress' },
    done: { label: 'Done', dot: 'dot-done', cls: 'is-done' },
  };
  const s = map[task.status] || map.not_started;
  dom.dialogStatusLabel.textContent = s.label;
  dom.dialogStatusDot.className = `status-dot ${s.dot}`;
  dom.dialogStatusBtn.className = `prop-value status-value ${s.cls}`;
}

// --- Links in notes: made at render time, never stored. sanitizeDoc flattens <a> back to its text on save. ---
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
function unlinkify(root) {
  root.querySelectorAll('a').forEach((a) => a.replaceWith(document.createTextNode(a.textContent)));
  root.normalize();
}
function linkify(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    const text = node.nodeValue;
    URL_RE.lastIndex = 0;
    let last = 0, m, frag = null;
    while ((m = URL_RE.exec(text))) {
      let url = m[0], prev;
      do {
        prev = url;
        url = url.replace(/[.,;:!?\]}]+$/, '');
        if (url.endsWith(')') && (url.match(/\)/g).length > (url.match(/\(/g) || []).length)) url = url.slice(0, -1);
      } while (url !== prev);
      try { const u = new URL(url); if (u.protocol !== 'http:' && u.protocol !== 'https:') continue; } catch (e) { continue; }
      if (!frag) frag = document.createDocumentFragment();
      frag.append(text.slice(last, m.index));
      const a = document.createElement('a');
      a.href = url;
      a.textContent = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      if (root.isContentEditable) a.title = 'Ctrl+click to open';
      frag.append(a);
      last = m.index + url.length;
    }
    if (frag) { frag.append(text.slice(last)); node.replaceWith(frag); }
  });
}
function refreshLinks(root) { unlinkify(root); linkify(root); }

function getCloseBtn() {
  if (state.dialogCloseBtn) return state.dialogCloseBtn;
  state.dialogCloseBtn = document.createElement('button');
  state.dialogCloseBtn.type = 'button';
  state.dialogCloseBtn.className = dom.dialogDelete.className;
  state.dialogCloseBtn.textContent = 'Close for class';
  state.dialogCloseBtn.addEventListener('click', () => {
    const task = state.currentTask;
    if (!task || !isEditable(task)) return;
    task.closedAt = Date.now();
    tasks.saveTasks();
    closeTaskDialog();
    tasks.renderAllTasks();
    tasks.showToast('Moved to Past tasks', 'Undo', () => { task.closedAt = 0; tasks.saveTasks(); tasks.renderAllTasks(); });
  });
  dom.dialogDelete.insertAdjacentElement('beforebegin', state.dialogCloseBtn);
  return state.dialogCloseBtn;
}

function openTaskDialog(task) {
  state.dialogReturn = { el: document.activeElement, id: task.id };
  state.currentTask = task;
  const ro = !isEditable(task);
  dom.dialog.classList.toggle('is-readonly', ro);
  dom.dialogTitleInput.readOnly = ro;
  dom.dialogDoc.contentEditable = ro ? 'false' : 'true';
  dom.dialogDoc.dataset.placeholder = ro ? 'No notes for this task.' : 'Write notes, or drop images here';
  dom.dialogSubjectBtn.disabled = ro;
  dom.dialogDateBtn.disabled = ro;
  dom.dialogDelete.hidden = ro;
  dom.dialogDuplicate.hidden = ro;
  getCloseBtn().hidden = ro || task.closedAt > 0;
  dom.dialogTitleInput.value = task.title === 'New Task' ? '' : task.title;
  updateDialogDue(task);
  updateDialogStatus(task);
  dom.dialogDoc.innerHTML = sanitizeDoc(task.notes || '');
  refreshLinks(dom.dialogDoc);
  updateDialogSubject(task);
  renderDialogFiles(task);
  dom.dialogOverlay.classList.remove('is-closing');
  dom.dialogOverlay.hidden = false;
  dom.dialogOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  fitDialogTitle();
  (ro ? dom.dialogStatusBtn : dom.dialogTitleInput).focus();
}

function closeTaskDialog() {
  if (!state.currentTask) return;
  if (isEditable(state.currentTask)) {
    state.currentTask.title = dom.dialogTitleInput.value.trim() || 'New Task';
    state.currentTask.notes = sanitizeDoc(dom.dialogDoc.innerHTML);
    tasks.saveTasks();
  }
  state.currentTask = null;
  closeStatusPopover();
  hideAnimated(dom.dialogOverlay);
  dom.dialogOverlay.setAttribute('aria-hidden', 'true');
  dom.dialogSubjectDropdown.hidden = true;
  dom.dialogSubjectBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  tasks.renderAllTasks();
  const back = state.dialogReturn;
  state.dialogReturn = null;
  if (back) {
    const target = back.el && back.el.isConnected ? back.el : document.querySelector(`[data-task-id="${CSS.escape(String(back.id))}"]`);
    if (target) target.focus();
  }
}

function updateColumn(columnEl) {
  const n = columnEl.querySelectorAll('.task-card').length;
  columnEl.querySelector('.column-count').textContent = `(${n})`;
  const contentEl = columnEl.querySelector('.column-content');
  const isEmpty = n === 0;
  contentEl.classList.toggle('is-empty', isEmpty);
  const emptyMsg = contentEl.querySelector('.column-empty');
  if (emptyMsg) {
    if (!emptyMsg.dataset.default) emptyMsg.dataset.default = emptyMsg.textContent;
    const searching = columnEl.closest('#page-class-tasks') ? state.classSearchQuery.trim()
      : columnEl.closest('#page-my-tasks') ? state.searchQuery.trim() : '';
    emptyMsg.textContent = searching ? 'No tasks match your search.' : emptyMsg.dataset.default;
    emptyMsg.hidden = !isEmpty;
  }
}

// --- Drag & Drop ---

function handleDragStart(e) {
  state.draggedCard = e.target.closest('.task-card');
  if (!state.draggedCard) return;
  state.draggedCard.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', state.draggedCard.dataset.taskId);
}

function clearDropPlaceholder() {
  document.querySelectorAll('.drop-placeholder').forEach((p) => p.remove());
}

function handleDragEnd(e) {
  clearDropPlaceholder();
  if (state.draggedCard) {
    state.draggedCard.classList.remove('is-dragging');
    state.draggedCard = null;
  }
  document.querySelectorAll('.kanban-column').forEach(col => col.classList.remove('drag-over'));
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const columnEl = e.target.closest('.kanban-column');
  if (columnEl) {
    document.querySelectorAll('.kanban-column').forEach(col => col.classList.remove('drag-over'));
    columnEl.classList.add('drag-over');
    const content = columnEl.querySelector('.column-content');
    const sameColumn = state.draggedCard && state.draggedCard.dataset.status === COLUMN_TO_STATUS[columnEl.dataset.status];
    if (!sameColumn && !content.querySelector('.drop-placeholder')) {
      clearDropPlaceholder();
      const ph = document.createElement('div');
      ph.className = 'drop-placeholder';
      ph.textContent = 'Move here';
      ph.setAttribute('aria-hidden', 'true');
      content.prepend(ph);
    }
  }
}

function handleDrop(e) {
  e.preventDefault();
  const columnEl = e.target.closest('.kanban-column');
  if (!columnEl || !state.draggedCard) return;

  const taskId = state.draggedCard.dataset.taskId;
  const task = findTask(taskId);
  if (!task) return;

  const newStatus = COLUMN_TO_STATUS[columnEl.dataset.status];
  if (newStatus && newStatus !== task.status) {
    if (isReopen(task, newStatus)) {
      tasks.confirmReopen(task, newStatus, () => {
        const prev = state.progress[task.id] ? { ...state.progress[task.id] } : null;
        tasks.setStatus(task, newStatus);
        tasks.renderAllTasks();
        tasks.showToast(statusChangeMessage(newStatus), 'Undo', () => tasks.restoreProgress(task.id, prev));
      });
    } else {
      const prev = state.progress[task.id] ? { ...state.progress[task.id] } : null;
      tasks.setStatus(task, newStatus);
      tasks.renderAllTasks();
      if (newStatus === 'done') {
        tasks.showToast(statusChangeMessage('done'), 'Undo', () => tasks.restoreProgress(task.id, prev));
      }
    }
  }

  document.querySelectorAll('.kanban-column').forEach(col => col.classList.remove('drag-over'));
}

// --- Event Listeners ---

dom.dialogClose.addEventListener('click', closeTaskDialog);
dom.dialogOverlay.addEventListener('click', (e) => { if (e.target === dom.dialogOverlay) closeTaskDialog(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dom.dialogOverlay.hidden && !(state.statusPopoverEl && !state.statusPopoverEl.hidden)) closeTaskDialog();
});

dom.dialogStatusBtn.addEventListener('click', () => { if (state.currentTask) openStatusPopover(state.currentTask, dom.dialogStatusBtn); });

function openDialogDuePicker(anchor, focus) {
  if (!state.currentTask) return;
  openDuePicker({
    anchor,
    focus,
    date: state.currentTask.dueDate || null,
    time: state.currentTask.dueTime || null,
    onChange: ({ date, time }) => {
      if (!state.currentTask) return;
      state.currentTask.dueDate = date || undefined;
      state.currentTask.dueTime = date ? (time || undefined) : undefined;
      updateDialogDue(state.currentTask);
      autosave();
    },
  });
}
dom.dialogDateBtn.addEventListener('click', () => openDialogDuePicker(dom.dialogDateBtn, 'date'));
dom.dialogDueClear.addEventListener('click', (e) => {
  e.stopPropagation();
  if (state.currentTask) {
    state.currentTask.dueDate = undefined;
    state.currentTask.dueTime = undefined;
    updateDialogDue(state.currentTask);
    autosave();
  }
});

// --- Doc editor: typing, pasting and dropping images inline ---
function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 800 / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = reader.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function insertDocImage(src) {
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  dom.dialogDoc.focus();
  const sel = getSelection();
  let range = sel.rangeCount && dom.dialogDoc.contains(sel.getRangeAt(0).startContainer) ? sel.getRangeAt(0) : null;
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(dom.dialogDoc);
    range.collapse(false);
  }
  range.deleteContents();
  range.insertNode(img);
  if (!img.nextSibling) img.after(document.createElement('br'));
  range.setStartAfter(img);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

async function insertDocImages(files) {
  for (const file of files) {
    let src = null;
    try {
      const { blob, name } = await TTFiles.prepare(file);
      const out = await TTFiles.upload(blob, name);
      src = TTFiles.urlFor(out.id);
    } catch (e) {
      src = await fileToDataUrl(file);   // not signed in or offline: keep it inline instead of losing it
      if (!src) { tasks.showToast(e.message || 'Could not add that image'); continue; }
    }
    insertDocImage(src);
  }
  autosave();
}

async function attachFiles(files) {
  const task = state.currentTask;
  if (!task || !isEditable(task)) return;
  let added = 0;
  for (const file of files) {
    if (task.files.length >= 10) { tasks.showToast('A task can have up to 10 files.'); break; }
    try {
      tasks.showToast(`Uploading ${file.name || 'file'}…`);
      const { blob, name } = await TTFiles.prepare(file);
      const out = await TTFiles.upload(blob, name);
      task.files.push({ id: out.id, name: out.name, size: out.size });
      added++;
      tasks.saveTasks();
      if (state.currentTask === task) renderDialogFiles(task);
    } catch (e) {
      tasks.showToast(e.message === 'Failed to fetch' ? 'Cannot reach the server.' : e.message);
      return;
    }
  }
  if (added) { tasks.flashSaved(); tasks.showToast(added === 1 ? 'File attached' : `${added} files attached`); }
}

function renderDialogFiles(task) {
  const editable = isEditable(task);
  dom.dialogFilesField.hidden = !editable && !task.files.length;
  dom.dialogAttachBtn.hidden = !editable;
  dom.dialogFiles.replaceChildren();
  task.files.forEach((f) => {
    const li = document.createElement('li');
    li.className = 'file-item';
    const a = document.createElement('a');
    a.href = TTFiles.urlFor(f.id);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = f.name;
    if (/\.(pptx|docx)$/.test(f.id)) a.download = f.name;
    const size = document.createElement('span');
    size.className = 'file-size';
    size.textContent = TTFiles.formatSize(f.size);
    li.append(a, size);
    if (editable) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'text-button';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => {
        const index = task.files.indexOf(f);
        if (index === -1) return;
        task.files.splice(index, 1);
        tasks.saveTasks();
        renderDialogFiles(task);
        tasks.showToast('File removed', 'Undo', () => {
          task.files.splice(Math.min(index, task.files.length), 0, f);
          tasks.saveTasks();
          if (state.currentTask === task) renderDialogFiles(task);
        });
      });
      li.append(rm);
    }
    dom.dialogFiles.append(li);
  });
}

function rangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  const pos = document.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const r = document.createRange();
  r.setStart(pos.offsetNode, pos.offset);
  r.collapse(true);
  return r;
}

dom.dialogDoc.addEventListener('input', () => {
  if (/^(<div>)?<br>(<\/div>)?$/.test(dom.dialogDoc.innerHTML)) dom.dialogDoc.innerHTML = '';
  clearTimeout(state.docTimer);
  state.docTimer = setTimeout(autosave, 500);
});

dom.dialogDoc.addEventListener('paste', (e) => {
  e.preventDefault();
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    const docs = files.filter((f) => !f.type.startsWith('image/'));
    if (imgs.length) insertDocImages(imgs);
    if (docs.length) attachFiles(docs);
    return;
  }
  document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
});

// Read-only (students): the browser opens the link itself (new tab). Admin editing: plain click places the caret, Ctrl/Cmd+click opens.
dom.dialogDoc.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a') : null;
  if (!a || !dom.dialogDoc.contains(a) || !dom.dialogDoc.isContentEditable) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) window.open(a.href, '_blank', 'noopener,noreferrer');
});
// Rebuild links when leaving the box, so URLs typed or pasted while editing become links.
dom.dialogDoc.addEventListener('focusout', () => { if (state.currentTask) refreshLinks(dom.dialogDoc); });

// Note formatting toolbar. sanitizeDoc keeps only b, i, ul and li, so nothing else can be stored.
dom.dialogDoc.addEventListener('focus', () => document.execCommand('styleWithCSS', false, false));
function syncNoteTools() {
  dom.noteTools.forEach((b) => {
    let on = false;
    try { on = document.activeElement === dom.dialogDoc && document.queryCommandState(b.dataset.cmd); } catch (e) {}
    b.setAttribute('aria-pressed', String(on));
  });
}
dom.noteTools.forEach((b) => {
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection in the note
  b.addEventListener('click', () => {
    if (!state.currentTask || !isEditable(state.currentTask)) return;
    dom.dialogDoc.focus();
    document.execCommand(b.dataset.cmd);
    autosave();
    syncNoteTools();
  });
});
document.addEventListener('selectionchange', () => { if (document.activeElement === dom.dialogDoc) syncNoteTools(); });

const dropHasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
dom.dialog.addEventListener('dragover', (e) => {
  if (!dropHasFiles(e) || dom.dialog.classList.contains('is-readonly')) return;
  e.preventDefault();
  dom.dialog.classList.add('is-dropping');
});
dom.dialog.addEventListener('dragleave', (e) => {
  if (!dom.dialog.contains(e.relatedTarget)) dom.dialog.classList.remove('is-dropping');
});
dom.dialog.addEventListener('drop', (e) => {
  dom.dialog.classList.remove('is-dropping');
  const all = [...(e.dataTransfer?.files || [])];
  if (!all.length) return;
  e.preventDefault();
  if (dom.dialog.classList.contains('is-readonly')) return;
  const imgs = all.filter((f) => f.type.startsWith('image/'));
  const docs = all.filter((f) => !f.type.startsWith('image/'));
  if (imgs.length) {
    const range = rangeFromPoint(e.clientX, e.clientY);
    if (range && dom.dialogDoc.contains(range.startContainer)) {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    insertDocImages(imgs);
  }
  if (docs.length) attachFiles(docs);
});

dom.dialogDelete.addEventListener('click', () => {
  if (!state.currentTask) return;
  const task = state.currentTask;
  closeStatusPopover();
  hideAnimated(dom.dialogOverlay);
  document.body.style.overflow = '';
  const idx = myTasks.indexOf(task);
  if (idx !== -1) tasks.deleteTask(task); else closeTaskDialog();
  state.currentTask = null;
});

// Column drop zones (My Tasks page)
document.querySelectorAll('.kanban-column').forEach(columnEl => {
  columnEl.addEventListener('dragover', handleDragOver);
  columnEl.addEventListener('drop', handleDrop);
  columnEl.addEventListener('dragleave', (e) => {
    if (!columnEl.contains(e.relatedTarget)) {
      columnEl.classList.remove('drag-over');
      clearDropPlaceholder();
    }
  });
});

// --- Toast, autosave feedback, skeletons ---

// Plays the CSS exit animation, then hides. Skips the wait for reduced motion.
function hideAnimated(el, ms = 180) {
  if (el._returnFocus && el._returnFocus.isConnected) el._returnFocus.focus();
  el._returnFocus = null;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.hidden = true; return; }
  el.classList.add('is-closing');
  setTimeout(() => {
    if (el.classList.contains('is-closing')) { el.hidden = true; el.classList.remove('is-closing'); }
  }, ms);
}


// --- Tasks: js/tasks.js (slice 2.6) -------------------------------------------------------------
// The hub and the renderers moved here. init() runs at the spot where the toast listeners used to
// register, so the order of the page listeners is unchanged: the dialog, drop-zone, search and view
// listeners above, then these two, then the keyboard shortcuts, the due picker, publish, settings,
// tour, transfer and the focus trap. showToast, saveTasks, setStatus, applyProgress and
// renderAllTasks are passed on to the other modules as tasks.<name>; the values js/tasks.js needs
// from app.js arrive as its init deps. Until commit 2 moves the dialog into the module, the dialog
// code still in this file calls those functions as tasks.<name>.
tasks.init({
  Task, dayDiff, sortTasks, STATUS_LABELS, statusChangeMessage, myTasks, isEditable, hideAnimated, createSubjectTag,
  startNewTask, updateColumn, createStatusCheck, handleDragStart, handleDragEnd, openStatusPopover, closeStatusPopover,
  updateDialogStatus, updateDialogDue, openTaskDialog, calendar, publish,
});

// Saves the task being edited in the panel and confirms it.
function autosave() {
  if (!state.currentTask || !isEditable(state.currentTask)) return;
  state.currentTask.notes = sanitizeDoc(dom.dialogDoc.innerHTML);
  tasks.saveTasks();
  tasks.flashSaved();
}

// --- Calendar: js/calendar.js (slice 2.3) -------------------------------------------------------
// The moved listeners register here, exactly where they used to, so their order against the other
// element listeners on this page is unchanged. `subjects` is a thunk: SUBJECTS is declared below
// this point, and the module reads the map when it renders, not while this call runs.
calendar.init({
  recordSource: tasks.recordSource, openTaskDialog, todayDate, toInputValue, dayDiff, subjects: () => SUBJECTS,
});

// --- Search, overview stats, nav badge ---

document.querySelector('#task-search').addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  tasks.renderAllTasks();
});

// Class tasks search: title, subject code, notes text. Separate from the admin search.
document.querySelector('#class-task-search').addEventListener('input', (e) => {
  state.classSearchQuery = e.target.value;
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
  const run = () => applyView(scope, view);
  if (!animate) { run(); return; }
  if (document.startViewTransition) { document.startViewTransition(run); return; }
  run();
  const page = document.querySelector(SCOPES[scope].page);
  page.classList.remove('is-swapping');
  void page.offsetWidth;
  page.classList.add('is-swapping');
}
document.querySelectorAll('.view-tab[data-view]').forEach((b) => {
  b.addEventListener('click', () => setView(b.closest('#page-my-tasks') ? 'admin' : 'class', b.dataset.view));
});

// --- Subjects, quick add, announcements, shortcuts ---
const SUBJECTS = {
  GENSCI: 'bg-cyan', GENMATH: 'bg-pink', PKLP: 'bg-sunglow', EFFCOM: 'bg-green',
  MABKOM: 'bg-sand', PERDEV: 'bg-yellow', PE: 'bg-yellow', THEOLOGY: 'bg-stone', CP104: 'bg-blue', FINMATH101: 'bg-mauve',
};
const STATUS_CODES = {
  ns: 'not_started', todo: 'not_started', 'not started': 'not_started',
  ip: 'in_progress', started: 'in_progress', doing: 'in_progress', 'in progress': 'in_progress',
  dn: 'done', done: 'done',
};

function createSubjectTag(code) {
  const tag = document.createElement('span');
  tag.className = `subject-tag ${SUBJECTS[code] || ''}`;
  tag.textContent = code;
  return tag;
}

const STATUS_ORDER = ['not_started', 'in_progress', 'done'];

function ensureStatusPopover() {
  if (state.statusPopoverEl) return state.statusPopoverEl;
  const el = document.createElement('div');
  el.className = 'status-dropdown status-popover';
  el.setAttribute('role', 'listbox');
  el.hidden = true;
  STATUS_ORDER.forEach((status) => {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'status-option';
    opt.setAttribute('role', 'option');
    opt.dataset.status = status;
    opt.innerHTML = `<span class="status-dot dot-${status.replace(/_/g, '-')}"></span> ${STATUS_LABELS[status]}`;
    opt.addEventListener('click', () => {
      if (!state.statusPopoverTask) return;
      const picked = state.statusPopoverTask;
      const next = opt.dataset.status;
      if (isReopen(picked, next)) {
        closeStatusPopover();
        tasks.confirmReopen(picked, next, () => {
          const prev = state.progress[picked.id] ? { ...state.progress[picked.id] } : null;
          tasks.setStatus(picked, next);
          if (picked.id === state.currentTask?.id) { updateDialogStatus(picked); updateDialogDue(picked); tasks.flashSaved(); }
          tasks.renderAllTasks();
          tasks.showToast(statusChangeMessage(next), 'Undo', () => tasks.restoreProgress(picked.id, prev));
        });
        return;
      }
      const prev = state.progress[picked.id] ? { ...state.progress[picked.id] } : null;
      tasks.setStatus(picked, opt.dataset.status);
      if (picked.id === state.currentTask?.id) { updateDialogStatus(picked); updateDialogDue(picked); tasks.flashSaved(); }
      closeStatusPopover();
      tasks.renderAllTasks();
      if (opt.dataset.status === 'done') {
        tasks.showToast(statusChangeMessage('done'), 'Undo', () => tasks.restoreProgress(picked.id, prev));
      }
    });
    el.appendChild(opt);
  });
  document.body.appendChild(el);
  state.statusPopoverEl = el;
  return el;
}

function closeStatusPopover() {
  if (!state.statusPopoverEl) return;
  state.statusPopoverEl.hidden = true;
  state.statusPopoverTask = null;
}

function openStatusPopover(task, anchorEl) {
  const el = ensureStatusPopover();
  state.statusPopoverTask = task;
  state.statusPopoverIndex = STATUS_ORDER.indexOf(task.status);
  [...el.children].forEach((opt, i) => opt.classList.toggle('is-active', i === state.statusPopoverIndex));
  const rect = anchorEl.getBoundingClientRect();
  el.hidden = false;
  const { top, left } = clampPopoverPosition(rect, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight);
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

function createStatusCheck(task) {
  const check = document.createElement('button');
  check.type = 'button';
  check.className = `status-check is-${task.status.replace(/_/g, '-')}` + (task.id === state.justChangedId ? ' is-popping' : '');
  check.setAttribute('aria-label', 'Change status');
  check.innerHTML = task.status === 'done' ? '<svg class="i" aria-hidden="true"><use href="#i-check"/></svg>'
    : task.status === 'in_progress' ? '<svg class="i" aria-hidden="true"><use href="#i-minus"/></svg>' : '';
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.statusPopoverTask === task && state.statusPopoverEl && !state.statusPopoverEl.hidden) { closeStatusPopover(); return; }
    openStatusPopover(task, check);
  });
  return check;
}

document.addEventListener('click', (e) => {
  if (state.statusPopoverEl && !state.statusPopoverEl.hidden && !state.statusPopoverEl.contains(e.target) && !e.target.closest('.status-check, .status-value')) {
    closeStatusPopover();
  }
});
document.addEventListener('keydown', (e) => {
  if (!state.statusPopoverEl || state.statusPopoverEl.hidden) return;
  if (e.key === 'Escape') { closeStatusPopover(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    state.statusPopoverIndex = (state.statusPopoverIndex + (e.key === 'ArrowDown' ? 1 : -1) + STATUS_ORDER.length) % STATUS_ORDER.length;
    [...state.statusPopoverEl.children].forEach((opt, i) => opt.classList.toggle('is-active', i === state.statusPopoverIndex));
  }
  if (e.key === 'Enter') { state.statusPopoverEl.children[state.statusPopoverIndex].click(); }
});

function updateDialogSubject(task) {
  dom.dialogSubjectBtn.innerHTML = '';
  dom.dialogSubjectBtn.classList.toggle('empty-value', !task.subject);
  if (task.subject) dom.dialogSubjectBtn.appendChild(createSubjectTag(task.subject));
  else dom.dialogSubjectBtn.textContent = 'Empty';
  dom.dialogSubjectDropdown.hidden = true;
}
function selectSubject(code) {
  if (!state.currentTask) return;
  state.currentTask.subject = code;
  updateDialogSubject(state.currentTask);
  autosave();
}
[''].concat(Object.keys(SUBJECTS)).forEach((code) => {
  const opt = document.createElement('button');
  opt.type = 'button';
  opt.className = 'status-option';
  opt.setAttribute('role', 'option');
  if (code) opt.appendChild(createSubjectTag(code)); else opt.textContent = 'None';
  opt.addEventListener('click', () => selectSubject(code));
  dom.dialogSubjectDropdown.appendChild(opt);
});
// Lives on <body> (same as the status menu) so the dialog's scroll area can't clip it
dom.dialogSubjectDropdown.classList.add('status-popover');
document.body.appendChild(dom.dialogSubjectDropdown);

dom.dialogSubjectBtn.addEventListener('click', () => {
  const open = dom.dialogSubjectBtn.getAttribute('aria-expanded') === 'true';
  dom.dialogSubjectBtn.setAttribute('aria-expanded', String(!open));
  dom.dialogSubjectDropdown.hidden = open;
  if (open) return;
  const r = dom.dialogSubjectBtn.getBoundingClientRect();
  const h = dom.dialogSubjectDropdown.offsetHeight;
  const w = dom.dialogSubjectDropdown.offsetWidth;
  const below = window.innerHeight - r.bottom - 8;
  const top = h > below && r.top > below ? Math.max(8, r.top - h - 4) : r.bottom + 4;
  dom.dialogSubjectDropdown.style.top = `${top}px`;
  dom.dialogSubjectDropdown.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
});
window.addEventListener('resize', () => {
  dom.dialogSubjectDropdown.hidden = true;
  dom.dialogSubjectBtn.setAttribute('aria-expanded', 'false');
});
document.addEventListener('click', (e) => {
  if (!dom.dialogSubjectBtn.contains(e.target) && !dom.dialogSubjectDropdown.contains(e.target)) {
    dom.dialogSubjectBtn.setAttribute('aria-expanded', 'false');
    dom.dialogSubjectDropdown.hidden = true;
  }
});

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
  const out = { subject: '', status: null, typedStatus: false, dueDate: undefined, dueTime: undefined, title: '' };
  const rest = [];
  const now = new Date();
  quickWords(text).forEach((word) => {
    const lower = word.toLowerCase();
    const md = /^(\d{1,2})[\/-](\d{1,2})$/.exec(word);
    const time = parseTimeWord(word);
    const weekday = lookup(WEEKDAYS, lower);
    if (!out.subject && lookup(SUBJECTS, word.toUpperCase())) {
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
  if (state.quickPicked.date) { out.dueDate = state.quickPicked.date; out.dueTime = state.quickPicked.time || undefined; }   // picker wins
  if (!out.dueDate) out.dueTime = undefined;              // time needs a date
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
  setStatus: tasks.setStatus, saveTasks: tasks.saveTasks, setPage: nav.setPage, renderAllTasks: tasks.renderAllTasks, openTaskDialog, showToast: tasks.showToast,
  subjects: () => SUBJECTS, statusCodes: () => STATUS_CODES,
});

// --- Announcements: js/announcements.js (slice 2.5) ---------------------------------------------
// The moved listeners register here, exactly where the announcement region's first listener used to,
// so the page's listener order is unchanged: the note-tool selectionchange above, then the announce
// editor, toolbar and form listeners, then the keyboard shortcuts, the publish/history Escape
// handler, settings, tour and the transfer/import and focus-trap listeners. renderAnnouncements is
// exported because loadPublished, the bootstrap init and js/transfer.js's replaced-draft path call
// it. updateAdminBar and diffDraft come from js/publish.js, which moved them in this slice.
announcements.init({
  lookup, linkify, dropHasFiles, showToast: tasks.showToast, saveTasks: tasks.saveTasks, updateAdminBar: publish.updateAdminBar, diffDraft: publish.diffDraft,
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

// opts: { anchor, focus: 'date'|'time', date, time, onChange({date, time}), onDone }
function openDuePicker(opts) {
  if (state.dpEl && state.dpState.anchor === opts.anchor && state.dpState.focus === opts.focus) { closeDuePicker(); return; }
  closeDuePicker();

  const s = {
    anchor: opts.anchor, focus: opts.focus, onChange: opts.onChange, onDone: opts.onDone,
    date: opts.date || null, time: opts.time || null, view: null,
  };
  const seed = s.date || todayDate();
  s.view = new Date(seed.getFullYear(), seed.getMonth(), 1);

  const el = document.createElement('div');
  el.className = 'due-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Due date and time');
  el.innerHTML = `
    <div class="dp-fields">
      <input class="dp-input dp-date" type="text" placeholder="Date &amp; time" aria-label="Date and time, time optional" autocomplete="off" spellcheck="false" enterkeyhint="done">
    </div>
    <div class="dp-head">
      <span class="dp-month"></span>
      <button type="button" class="dp-nav dp-today">Today</button>
      <button type="button" class="dp-nav dp-prev" aria-label="Previous month"><svg class="i" aria-hidden="true"><use href="#i-chevron-left"/></svg></button>
      <button type="button" class="dp-nav dp-next" aria-label="Next month"><svg class="i" aria-hidden="true"><use href="#i-chevron-right"/></svg></button>
    </div>
    <div class="dp-grid" role="grid"></div>
    <div class="dp-foot">
      <span class="dp-hint">Time is optional · e.g. fri 3pm</span>
      <button type="button" class="text-button dp-clear">Clear</button>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const dateIn = $('.dp-date');
  const grid = $('.dp-grid');
  const monthEl = $('.dp-month');

  const emit = () => s.onChange({ date: s.date, time: s.time });
  const syncFields = () => {
    dateIn.value = s.date ? formatDateText(s.date) + (s.time ? ' ' + formatTime(s.time) : '') : '';
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
      const selected = !!s.date && d.getTime() === s.date.getTime();
      b.type = 'button';
      b.className = 'dp-day';
      b.textContent = d.getDate();
      b.setAttribute('aria-label', d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
      b.setAttribute('aria-pressed', String(selected));
      if (d.getMonth() !== s.view.getMonth()) b.classList.add('is-outside');
      if (dayDiff(d) === 0) b.classList.add('is-today');
      if (selected) b.classList.add('is-selected');
      b.addEventListener('click', () => { s.date = d; syncFields(); renderGrid(); emit(); });
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

  const commitDate = () => {
    if (!dateIn.value.trim() && s.date) { s.date = null; s.time = null; renderGrid(); emit(); }
    syncFields();
  };
  dateIn.addEventListener('blur', commitDate);
  dateIn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    commitDate();
    closeDuePicker('done');
  });

  $('.dp-prev').addEventListener('click', () => gotoMonth(new Date(s.view.getFullYear(), s.view.getMonth() - 1, 1)));
  $('.dp-next').addEventListener('click', () => gotoMonth(new Date(s.view.getFullYear(), s.view.getMonth() + 1, 1)));
  $('.dp-today').addEventListener('click', () => { s.date = todayDate(); gotoMonth(s.date); syncFields(); emit(); });
  $('.dp-clear').addEventListener('click', () => { s.date = null; s.time = null; emit(); closeDuePicker(); });

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
  el.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - w - 8)}px`;

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
  if (state.dpEl && !state.dpEl.contains(e.target) && !state.dpState.anchor.contains(e.target)) closeDuePicker();
});

// --- Navigation and routing: js/nav.js (slice 2.4) ----------------------------------------------
// The moved listeners register here, exactly where they used to, so their order against the other
// element and document listeners on this page is unchanged (the Escape chain depends on it), and
// the phone-sidebar media query is built at the same point. setPage and setSidebarOpen moved with
// them: the nav-item listeners, the deep-link handler, app.js's own call sites and the quick-add,
// settings and tour init deps now reach them as nav.setPage / nav.setSidebarOpen. `pageFromHash`
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
});

// Duplicate (task dialog)
dom.dialogDuplicate.addEventListener('click', () => {
  if (!state.currentTask || !isEditable(state.currentTask)) return;
  const source = state.currentTask;
  closeTaskDialog();
  const copy = Task.fromJSON({ ...source.toJSON(), id: undefined, title: `${source.title} (copy)` });
  myTasks.push(copy);
  state.justChangedId = copy.id;
  tasks.saveTasks();
  tasks.renderAllTasks();
  openTaskDialog(copy);
});

// --- Settings and theme: js/settings.js (slice 2.4) ---------------------------------------------
// The moved listeners register here, exactly where the settings panel's listeners used to, so their
// order against the publish/history Escape handler above and the tour listeners below is unchanged.
// The theme toggle moved here too (its block sat next to the new-task button); it is the only
// listener on #theme-toggle, so its later registration competes with nothing. Every dep is declared
// above this point, so it can be passed by value - phoneQuery is a MediaQueryList and the module only
// reads .matches when closeSettings runs.
settings.init({
  $, setSidebarOpen: nav.setSidebarOpen, hideAnimated, phoneQuery: nav.phoneQuery, adminHint, signIn, showToast: tasks.showToast,
  JSON_POST, SIDEBAR_KEY: nav.SIDEBAR_KEY, ADMIN_KEY, SIGNED_OUT_KEY,
});

// --- Tutorial: js/tour.js (slice 2.3) -----------------------------------------------------------
// The moved listeners register here, exactly where they used to, so the tour's document keydown
// handler keeps its place in the Escape chain and its resize handler keeps its order against the
// other window listeners. `$` is app.js's querySelector shorthand (declared above); the rest are
// the hub functions the module still calls.
tour.init({
  $, STATUS_LABELS, STATUS_ORDER, createSubjectTag,
  setPreview: publish.setPreview, setPage: nav.setPage, setSidebarOpen: nav.setSidebarOpen, hideAnimated, closeSettings: settings.closeSettings,
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
  snapshot: publish.snapshot, restoreDraft: publish.restoreDraft, mergeProgress, Task, taskIdOk, STATUS_ORDER,
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

function init() {
  tasks.loadTasks();
  announcements.renderAnnouncements();
  ['class', 'admin'].forEach((scope) => {
    let v = null;
    try { v = localStorage.getItem(VIEW_KEYS[scope]); } catch (e) {}
    setView(scope, v === 'list' || v === 'board' ? v : VIEW_DEFAULTS[scope], false);
  });
  tasks.showSkeletons();
  state.staggerNext = true;
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}