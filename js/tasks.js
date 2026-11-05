// js/tasks.js - the task hub: renderers, dialog, status popover and drag & drop (app.js split, slice 2.6).
//
// Moved verbatim out of app.js, in three commits. This file is commit 1 of that slice; the
// values below arrive through init(deps) because app.js still owns them:
//   Task - logic.js: rebuilds each stored task through Task.fromJSON
//   dayDiff - logic.js: day counts for due badges and the overview
//   sortTasks - logic.js: the renderers sort through it
//   STATUS_LABELS - logic.js: the confirm dialog and the popover wording
//   statusChangeMessage - logic.js: the undo toast text on every status change
//   myTasks - app.js: the live draft array, mutated in place
//   isEditable - app.js: admin, not previewing, in the draft
//   hideAnimated - app.js: overlays close with their exit animation
//   createSubjectTag - app.js: the subject chip (it owns SUBJECTS)
//   startNewTask - app.js: the list footer opens quick add
//   updateColumn - app.js: the column count and empty state (moves in commit 3)
//   createStatusCheck - app.js: the card status button (moves in commit 3)
//   handleDragStart - app.js: the card drag handlers (move in commit 3)
//   handleDragEnd - app.js: the card drag handlers (move in commit 3)
//   openStatusPopover - app.js: the popover (moves in commit 3)
//   closeStatusPopover - app.js: the popover (moves in commit 3)
//   updateDialogStatus - app.js: the dialog status line (moves in commit 2)
//   updateDialogDue - app.js: the dialog due line (moves in commit 2)
//   openTaskDialog - app.js: the dialog (moves in commit 2)
//   calendar - app.js: its namespace, renderAllTasks repaints the calendar
//   publish - app.js: its namespace, renderAllTasks and diffDraft update the admin bar
//
// D6: this module never imports logic.js, never imports another feature module and never reads a bare
// global. state and dom are the only module imports besides the util.js helpers. Everything that used to
// be an app.js top-level binding is either declared here or assigned from init(deps): the call sites are
// byte-identical, so a dep that is never assigned is a loud TypeError instead of a silent second copy.
//
// init() runs at the position where the first moved listener used to be registered, and every moved
// listener block is registered inside it in source order, so the order of the page listeners is
// unchanged - the due-picker Escape handler (capture + stopPropagation) and the dialog/popover Escape
// chain depend on it (docs/p6-architecture-findings.md 5).
//
// Importing this module touches nothing: no DOM read, no listener, no state read and no timer at
// evaluation time, so
//   node --input-type=module -e "await import('./js/tasks.js'); console.log('import clean')"
// is clean under plain Node (docs/p6-architecture-findings.md 4-5, DECISIONS.md D6).

import { state } from './state.js';
import { dom } from './dom.js';
import { readJSON, writeJSON, KEYS, STATUS_TO_COLUMN, COLUMN_TO_STATUS } from './util.js';

// --- Values app.js passes in through init(deps) ------------------------------------------------
let Task = null;
let dayDiff = null;
let sortTasks = null;
let STATUS_LABELS = null;
let statusChangeMessage = null;
let myTasks = null;
let isEditable = null;
let hideAnimated = null;
let createSubjectTag = null;
let startNewTask = null;
let updateColumn = null;
let createStatusCheck = null;
let handleDragStart = null;
let handleDragEnd = null;
let openStatusPopover = null;
let closeStatusPopover = null;
let updateDialogStatus = null;
let updateDialogDue = null;
let openTaskDialog = null;
let calendar = null;
let publish = null;

// --- Moved verbatim from app.js ----------------------------------------------------------------
export function applyProgress(list) {
  list.forEach((t) => { const p = state.progress[t.id]; t.status = p ? p.status : 'not_started'; t.movedAt = p ? p.movedAt : 0; });
}
export function setStatus(task, status) {
  state.progress[task.id] = { status, movedAt: Date.now() };
  if (status === 'done') navigator.vibrate?.(12);
  applyProgress(myTasks);
  applyProgress(state.publishedTasks);
  state.justChangedId = task.id;
  saveTasks();
}
function ensureConfirmDialog() {
  if (state.confirmOverlayEl) return state.confirmOverlayEl;
  const overlay = document.createElement('div');
  overlay.className = 'task-dialog-overlay confirm-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="task-dialog confirm-dialog" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <div class="dialog-header"><h2 class="dialog-heading" id="confirm-title"></h2></div>
      <div class="dialog-body"><p class="confirm-message" id="confirm-message"></p></div>
      <div class="dialog-footer">
        <button type="button" class="secondary-button" data-confirm="cancel">Cancel</button>
        <button type="button" class="primary-button" data-confirm="ok"></button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  state.confirmOverlayEl = overlay;
  return overlay;
}
// Asks before a Done task is reopened. Runs onConfirm only on an explicit yes.
export function confirmReopen(task, newStatus, onConfirm) {
  const overlay = ensureConfirmDialog();
  if (!overlay.hidden) return;
  const okBtn = overlay.querySelector('[data-confirm="ok"]');
  const cancelBtn = overlay.querySelector('[data-confirm="cancel"]');
  const opener = document.activeElement;

  overlay.querySelector('#confirm-title').textContent = 'Reopen this task?';
  overlay.querySelector('#confirm-message').textContent =
    `\u201C${task.title}\u201D will move from Done to ${STATUS_LABELS[newStatus]}.`;
  okBtn.textContent = 'Reopen';

  const close = (accept) => {
    overlay.removeEventListener('keydown', onKey, true);
    overlay.removeEventListener('click', onBackdrop);
    okBtn.onclick = null;
    cancelBtn.onclick = null;
    hideAnimated(overlay);
    if (opener && opener.isConnected) opener.focus();
    if (accept) onConfirm();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation(); // keep the task dialog behind from closing too
      close(false);
      return;
    }
    if (e.key !== 'Tab') return;
    e.stopImmediatePropagation();
    const active = document.activeElement;
    if (active !== cancelBtn && active !== okBtn) { e.preventDefault(); cancelBtn.focus(); }
    else if (e.shiftKey && active === cancelBtn) { e.preventDefault(); okBtn.focus(); }
    else if (!e.shiftKey && active === okBtn) { e.preventDefault(); cancelBtn.focus(); }
    else if (!e.shiftKey && active === cancelBtn) { e.preventDefault(); okBtn.focus(); }
    else if (e.shiftKey && active === okBtn) { e.preventDefault(); cancelBtn.focus(); }
  };
  const onBackdrop = (e) => { if (e.target === overlay) close(false); };

  okBtn.onclick = () => close(true);
  cancelBtn.onclick = () => close(false);
  overlay.addEventListener('click', onBackdrop);
  overlay.addEventListener('keydown', onKey, true);
  overlay.classList.remove('is-closing');
  overlay.hidden = false;
  cancelBtn.focus();
}
// --- Persistence: progress (everyone) + draft (admin) ---
export function saveTasks() {
  const ok = writeJSON(KEYS.progress, state.progress)
    && (!state.isAdmin || writeJSON(KEYS.draft, { tasks: myTasks.map((t) => t.toJSON()), announcements: state.announcements }));
  if (!ok) showToast('Storage is full. Remove large images.');
}
function migrateLegacy() {
  try {
    const raw = localStorage.getItem(KEYS.legacy);
    if (!raw || localStorage.getItem(KEYS.draft)) return;
    localStorage.setItem(KEYS.legacy + '_backup', raw);
    const old = JSON.parse(raw);
    old.forEach((o) => { if (o.status && o.status !== 'not_started') state.progress[o.id] = { status: o.status, movedAt: 0 }; });
    writeJSON(KEYS.progress, state.progress);
    writeJSON(KEYS.draft, {
      tasks: old.map((o) => Task.fromJSON(o).toJSON()),
      announcements: readJSON('class_tasks_announcements', []),
    });
  } catch (e) { console.warn('Migration skipped:', e); }
}
export function loadTasks() {
  state.progress = readJSON(KEYS.progress, {});
  if (!state.isAdmin) return;
  migrateLegacy();
  const draft = readJSON(KEYS.draft, { tasks: [], announcements: [] });
  myTasks.length = 0;
  (draft.tasks || []).forEach((o) => myTasks.push(Task.fromJSON(o)));
  state.announcements = Array.isArray(draft.announcements) ? draft.announcements : [];
  applyProgress(myTasks);
}
// Drops progress for tasks that are gone from the Board and from this browser's Draft. Runs only after a live, non-empty Board load, so a failed or empty load never wipes anything.
export function pruneProgress(board) {
  if (!board || !board.tasks.length) return;
  const keep = new Set(board.tasks.map((t) => String(t.id)));
  myTasks.forEach((t) => keep.add(t.id));
  const draft = readJSON(KEYS.draft, null);
  (draft && Array.isArray(draft.tasks) ? draft.tasks : []).forEach((t) => { if (t && t.id !== undefined) keep.add(String(t.id)); });
  const gone = Object.keys(state.progress).filter((id) => !keep.has(id));
  if (!gone.length) return;
  gone.forEach((id) => { delete state.progress[id]; });
  writeJSON(KEYS.progress, state.progress);
}
// --- Task Card Creation ---
export function createTaskCard(task) {
  const article = document.createElement('article');
  article.className = 'task-card';
  article.dataset.taskId = task.id;
  article.draggable = true;

  const header = document.createElement('div');
  header.className = 'task-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'task-card-title';
  titleEl.textContent = task.title;

  article.dataset.status = task.status;
  article.tabIndex = 0;
  article.addEventListener('click', (e) => {
    if (e.target.closest('.task-delete-btn')) return;
    openTaskDialog(task, article.closest('.kanban-column'), false);
  });
  article.addEventListener('keydown', (e) => {
    if (e.target === article && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openTaskDialog(task, article.closest('.kanban-column'), false);
    }
  });

  if (task.id === state.justChangedId) article.classList.add('is-entering');
  if (isEditable(task) && state.changedIds.has(task.id)) article.classList.add('is-changed');
  header.append(createStatusCheck(task), titleEl);

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'task-delete-btn';
  deleteBtn.type = 'button';
  deleteBtn.setAttribute('aria-label', 'Delete task');
  deleteBtn.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-trash-2"/></svg>';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task);
  });
  if (isEditable(task)) header.appendChild(deleteBtn);

  article.appendChild(header);

  if (task.subject || task.dueDate) {
    const footer = document.createElement('div');
    footer.className = 'task-card-footer';
    if (task.subject) footer.appendChild(createSubjectTag(task.subject));
    if (task.dueDate) {
      const diff = dayDiff(task.dueDate);
      const isDone = task.status === 'done';
      const overdueNow = task.isOverdue();
      const due = document.createElement('span');
      due.className = 'due-badge' + (overdueNow && !isDone ? ' overdue' : diff <= 3 && !isDone ? ' due-soon' : '');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'i');
      icon.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-' + (diff < 0 && !isDone ? 'alarm-clock' : 'calendar'));
      icon.appendChild(use);
      const label = document.createElement('span');
      label.textContent = isDone ? task.getDueDateDisplay() : task.getDueLabel();
      if (!isDone) due.title = task.getDueShort();
      due.append(icon, label);
      footer.appendChild(due);
    }
    article.appendChild(footer);
  }

  // Drag events
  article.addEventListener('dragstart', handleDragStart);
  article.addEventListener('dragend', handleDragEnd);

  return article;
}
// --- Delete Task ---
export function deleteTask(task) {
  const index = myTasks.indexOf(task);
  if (index === -1) return;
  myTasks.splice(index, 1);
  saveTasks();
  renderAllTasks();
  showToast('Task deleted', 'Undo', () => {
    myTasks.splice(Math.min(index, myTasks.length), 0, task);
    saveTasks();
    renderAllTasks();
  });
}
export function hideToast() {
  clearTimeout(state.toastTimer);
  dom.toastEl.hidden = true;
}
export function showToast(message, actionLabel, onAction) {
  dom.toastMessage.textContent = message;
  dom.toastAction.textContent = actionLabel || '';
  dom.toastAction.hidden = !actionLabel;
  dom.toastAction.onclick = () => { hideToast(); if (onAction) onAction(); };
  dom.toastEl.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(hideToast, actionLabel ? 8000 : 5000);
  dom.actionFeedback.textContent = '';
  setTimeout(() => { dom.actionFeedback.textContent = message + (actionLabel ? `. ${actionLabel} available.` : ''); }, 60);
}
export function flashSaved() {
  dom.saveState.textContent = 'Saved';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => { dom.saveState.textContent = ''; }, 1600);
}
export function showSkeletons() {
  document.querySelectorAll('.column-content').forEach((content) => {
    content.classList.remove('is-empty');
    const msg = content.querySelector('.column-empty');
    if (msg) msg.hidden = true;
    for (let i = 0; i < 2; i++) {
      const s = document.createElement('div');
      s.className = 'skeleton skeleton-card';
      s.setAttribute('aria-hidden', 'true');
      content.appendChild(s);
    }
  });
  [dom.taskListEl, dom.classListEl].forEach((list) => {
    list.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const s = document.createElement('div');
      s.className = 'skeleton skeleton-row';
      s.setAttribute('aria-hidden', 'true');
      list.appendChild(s);
    }
  });
}
// --- Class tasks: published list, same builders as admin, student-safe ---
export function renderClassTasks() {
  const board = document.querySelector('#class-board');
  board.querySelectorAll('.column-content').forEach((c) => {
    c.querySelectorAll('.task-card, .skeleton').forEach((n) => n.remove());
  });
  const all = (state.previewing ? myTasks : state.publishedTasks).filter((t) => !t.isPast());
  const q = state.classSearchQuery.trim().toLowerCase();
  const source = sortTasks(q ? all.filter((t) => matchesClassSearch(t, q)) : all);
  source.forEach((task) => {
    const col = board.querySelector(`.kanban-column[data-status="${STATUS_TO_COLUMN[task.status] || 'todo'}"] .column-content`);
    if (col) col.appendChild(createTaskCard(task));
  });
  board.querySelectorAll('.kanban-column').forEach(updateColumn);

  dom.classListEl.replaceChildren(...source.map(createTaskRow));
  if (!source.length) {
    const none = document.createElement('p');
    none.className = 'list-empty';
    none.textContent = q && all.length ? 'No tasks match your search.' : 'No class assignments yet.';
    dom.classListEl.appendChild(none);
  }
}
// --- Completed tasks page ---
export const recordSource = () => ((state.isAdmin || state.previewing) ? myTasks : state.publishedTasks);
export function renderPastPage() {
  const host = document.querySelector('#past-list');
  if (!host) return;
  host.replaceChildren();
  // Finished tasks first, so the tab opens on wins before leftovers.
  const past = sortTasks(recordSource().filter((t) => t.isPast()))
    .sort((a, b) => (b.status === 'done') - (a.status === 'done'));
  if (!past.length) {
    const none = document.createElement('p');
    none.className = 'list-empty';
    none.textContent = 'Nothing here yet. Tasks land here once they are closed or a week past their due date.';
    host.appendChild(none);
    return;
  }
  const canEdit = state.isAdmin && !state.previewing;
  const mkBtn = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'text-button';
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  past.forEach((task) => {
    const isDone = task.status === 'done';
    const row = document.createElement('div');
    row.className = 'task-row done-row';
    row.tabIndex = 0;
    const dot = createStatusCheck(task);
    const title = document.createElement('span');
    title.className = 'task-row-title' + (isDone ? ' is-done' : '');
    title.textContent = task.title;
    const tag = document.createElement('span');
    tag.className = 'task-row-due';
    tag.textContent = isDone ? 'Done' : task.getPastLabel();
    const actions = document.createElement('span');
    actions.style.cssText = 'display:flex;gap:12px;justify-content:flex-end';
    if (isDone) {
      const reopen = mkBtn('Mark not done', () => {});
      reopenWithConfirm(reopen, task);
      actions.appendChild(reopen);
    } else {
      actions.appendChild(mkBtn('Mark done', () => { setStatus(task, 'done'); renderAllTasks(); }));
    }
    if (canEdit) {
      actions.appendChild(mkBtn('Restore', () => {
        task.closedAt = 0;
        saveTasks();
        renderAllTasks();
        if (task.isExpired()) {
          openTaskDialog(task);
          showToast('Pick a new due date to bring this task back.');
        } else {
          showToast('Task restored');
        }
      }));
      actions.appendChild(mkBtn('Delete', () => deleteTask(task)));
    }
    row.addEventListener('click', () => openTaskDialog(task));
    row.addEventListener('keydown', (e) => {
      if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTaskDialog(task); }
    });
    row.append(dot, title, task.subject ? createSubjectTag(task.subject) : document.createElement('span'), tag, actions);
    host.appendChild(row);
  });
}
// Restore a task's progress entry to what it was before the last status change.
// Shared by every Undo action so all of them persist and re-render the same way.
export function restoreProgress(taskId, prev) {
  if (prev) state.progress[taskId] = prev; else delete state.progress[taskId];
  applyProgress(myTasks);
  applyProgress(state.publishedTasks);
  saveTasks();
  // A dialog may still be open on this task: refresh it so it shows the restored status.
  // Write the restored values onto currentTask itself so the refresh does not depend on
  // currentTask being the same instance applyProgress just updated.
  if (state.currentTask && state.currentTask.id === taskId) {
    const p = state.progress[taskId];
    state.currentTask.status = p ? p.status : 'not_started';
    state.currentTask.movedAt = p ? p.movedAt : 0;
    updateDialogStatus(state.currentTask);
    updateDialogDue(state.currentTask);
  }
  renderAllTasks();
}
// Reopening a done task replaces its completed time, so ask first and offer Undo.
export function reopenWithConfirm(btn, task) {
  const label = btn.textContent;
  let timer = null;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Confirm?';
      btn.setAttribute('aria-label', 'Confirm marking this task not done');
      timer = setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; btn.removeAttribute('aria-label'); }, 4000);
      return;
    }
    clearTimeout(timer);
    const prev = state.progress[task.id] ? { ...state.progress[task.id] } : null;
    setStatus(task, 'not_started');
    renderAllTasks();
    showToast(statusChangeMessage('not_started'), 'Undo', () => restoreProgress(task.id, prev));
  });
}
export function renderDonePage() {
  const host = document.querySelector('#done-list');
  const done = sortTasks(recordSource().filter((t) => t.status === 'done'));
  host.replaceChildren();
  if (!done.length) {
    const none = document.createElement('p');
    none.className = 'list-empty';
    none.textContent = 'No completed tasks yet. Mark a task done and it appears here.';
    host.appendChild(none);
    return;
  }
  const stamp = (ms) => {
    const d = new Date(ms);
    const diff = dayDiff(d);
    const day = diff === 0 ? 'Today' : diff === -1 ? 'Yesterday' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${day}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  };
  done.forEach((task) => {
    const row = document.createElement('div');
    row.className = 'task-row done-row' + (task.id === state.justChangedId ? ' is-entering' : '');
    row.tabIndex = 0;
    const dot = createStatusCheck(task);
    const title = document.createElement('span');
    title.className = 'task-row-title is-done';
    title.textContent = task.title;
    const when = document.createElement('span');
    when.className = 'task-row-due';
    when.textContent = task.movedAt ? stamp(task.movedAt) : '';
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'text-button';
    undo.textContent = 'Mark not done';
    reopenWithConfirm(undo, task);
    row.addEventListener('click', () => openTaskDialog(task));
    row.addEventListener('keydown', (e) => {
      if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTaskDialog(task); }
    });
    row.append(dot, title, task.subject ? createSubjectTag(task.subject) : document.createElement('span'), when, undo);
    host.appendChild(row);
  });
}
export function getVisibleTasks() {
  const q = state.searchQuery.trim().toLowerCase();
  const active = myTasks.filter((t) => !t.isPast());
  return sortTasks(q
    ? active.filter((t) => t.title.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q))
    : active);
}
export function updateOverview() {
  const open = myTasks.filter((t) => t.status !== 'done' && !t.isPast());
  const dueToday = open.filter((t) => t.dueDate && dayDiff(t.dueDate) === 0).length;
  const overdue = open.filter((t) => t.dueDate && t.isOverdue()).length;
  const inProgress = myTasks.filter((t) => t.status === 'in_progress' && !t.isPast()).length;
  document.querySelector('#sum-open').textContent = `${open.length} open`;
  document.querySelector('#sum-progress').textContent = `${inProgress} in progress`;
  const sumToday = document.querySelector('#sum-today');
  sumToday.textContent = `${dueToday} due today`;
  sumToday.hidden = dueToday === 0;
  const sumOverdue = document.querySelector('#sum-overdue');
  sumOverdue.textContent = `${overdue} overdue`;
  sumOverdue.hidden = overdue === 0;
  const badge = document.querySelector('#nav-badge');
  badge.textContent = open.length;
  badge.hidden = open.length === 0;
  document.querySelector('#page-my-tasks').classList.toggle('is-blank', myTasks.length === 0);
}
const notesTextCache = new WeakMap();
function plainNotes(task) {
  const hit = notesTextCache.get(task);
  if (hit && hit.html === task.notes) return hit.text;
  const tpl = document.createElement('template'); // inert: embedded images are not loaded
  tpl.innerHTML = (task.notes || '').replace(/<(?:br|\/div|\/p|\/li)\b[^>]*>/gi, ' ');
  const text = (tpl.content.textContent || '').toLowerCase();
  notesTextCache.set(task, { html: task.notes, text });
  return text;
}
function matchesClassSearch(task, q) {
  return task.title.toLowerCase().includes(q) || task.subject.toLowerCase().includes(q) || plainNotes(task).includes(q);
}
export function createTaskRow(task) {
  const row = document.createElement('div');
  row.className = 'task-row';
  row.tabIndex = 0;
  row.dataset.taskId = task.id;

  // Checkbox: empty = not started, minus = in progress, check = done
  const check = createStatusCheck(task);
  if (task.id === state.justChangedId) row.classList.add('is-entering');
  if (isEditable(task) && state.changedIds.has(task.id)) row.classList.add('is-changed');

  const title = document.createElement('span');
  title.className = 'task-row-title'
    + (task.title === 'New Task' ? ' is-ghost' : '')
    + (task.status === 'done' ? ' is-done' : '');
  title.textContent = task.title;

  const due = document.createElement('span');
  const overdue = task.dueDate && task.status !== 'done' && task.isOverdue();
  due.className = 'task-row-due' + (overdue ? ' is-overdue' : '');
  due.textContent = task.status === 'done' ? task.getDueDateDisplay() : task.getDueLabel();
  if (task.status !== 'done') due.title = task.getDueShort();

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'task-delete-btn';
  del.setAttribute('aria-label', 'Delete task');
  del.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-trash-2"/></svg>';
  del.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(task); });

  row.append(check, title, task.subject ? createSubjectTag(task.subject) : document.createElement('span'), due, isEditable(task) ? del : document.createElement('span'));
  row.addEventListener('click', () => openTaskDialog(task, null, false));
  row.addEventListener('keydown', (e) => {
    if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openTaskDialog(task, null, false);
    }
  });
  return row;
}
export function renderTaskList() {
  dom.taskListEl.innerHTML = '';
  const visible = getVisibleTasks();
  visible.forEach((task) => dom.taskListEl.appendChild(createTaskRow(task)));
  if (visible.length === 0 && state.searchQuery.trim()) {
    const none = document.createElement('p');
    none.className = 'list-empty';
    none.textContent = 'No tasks match your search.';
    dom.taskListEl.appendChild(none);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'task-list-add';
  add.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-plus"/></svg><span>New task</span>';
  add.addEventListener('click', startNewTask);
  dom.taskListEl.appendChild(add);
}
export function renderAllTasks() {
  if (state.isAdmin) {
    const diff = publish.diffDraft();
    state.changedIds = diff.changed;
    publish.updateAdminBar(diff);
  }
  document.querySelectorAll('#page-my-tasks .column-content').forEach((content) => {
    content.querySelectorAll('.task-card, .skeleton, .drop-placeholder').forEach((c) => c.remove());
  });
  getVisibleTasks().forEach((task) => {
    const content = document.querySelector(`#page-my-tasks .kanban-column[data-status="${STATUS_TO_COLUMN[task.status] || 'todo'}"] .column-content`);
    if (content) content.appendChild(createTaskCard(task));
  });
  document.querySelectorAll('#page-my-tasks .kanban-column').forEach(updateColumn);
  renderTaskList();
  renderClassTasks();
  renderDonePage();
  renderPastPage();
  calendar.renderCalendar();
  updateOverview();
  if (state.staggerNext) {
    document.querySelectorAll('.kanban-board .task-card, .task-list .task-row').forEach((el, i) => {
      el.classList.add('is-entering');
      el.style.animationDelay = `${Math.min(i, 8) * 40}ms`;
    });
    state.staggerNext = false;
  }
  state.justChangedId = null;
  
}

// Called once by app.js, at the spot the moved listeners used to occupy.
export function init(deps) {
  Task = deps.Task;
  dayDiff = deps.dayDiff;
  sortTasks = deps.sortTasks;
  STATUS_LABELS = deps.STATUS_LABELS;
  statusChangeMessage = deps.statusChangeMessage;
  myTasks = deps.myTasks;
  isEditable = deps.isEditable;
  hideAnimated = deps.hideAnimated;
  createSubjectTag = deps.createSubjectTag;
  startNewTask = deps.startNewTask;
  updateColumn = deps.updateColumn;
  createStatusCheck = deps.createStatusCheck;
  handleDragStart = deps.handleDragStart;
  handleDragEnd = deps.handleDragEnd;
  openStatusPopover = deps.openStatusPopover;
  closeStatusPopover = deps.closeStatusPopover;
  updateDialogStatus = deps.updateDialogStatus;
  updateDialogDue = deps.updateDialogDue;
  openTaskDialog = deps.openTaskDialog;
  calendar = deps.calendar;
  publish = deps.publish;
// Don't dismiss the toast while someone is tabbing to its Undo button
dom.toastEl.addEventListener('focusin', () => clearTimeout(state.toastTimer));
dom.toastEl.addEventListener('focusout', () => { clearTimeout(state.toastTimer); state.toastTimer = setTimeout(hideToast, 3000); });
}
