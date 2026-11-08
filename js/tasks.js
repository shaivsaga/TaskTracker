// js/tasks.js - the task hub: renderers, dialog, status popover and drag & drop (app.js split, slice 2.6).
//
// Moved verbatim out of app.js, in three commits. This file is commit 3 of that slice; the
// values below arrive through init(deps) because app.js still owns them:
//   Task - logic.js: rebuilds each stored task through Task.fromJSON
//   dayDiff - logic.js: day counts for due badges and the overview
//   sortTasks - logic.js: the renderers sort through it
//   STATUS_LABELS - logic.js: the confirm dialog and the popover wording
//   statusChangeMessage - logic.js: the undo toast text on every status change
//   sanitizeDoc - logic.js: the note editor stores only its allow-list
//   clampPopoverPosition - logic.js: keeps the status popover on screen
//   myTasks - app.js: the live draft array, mutated in place
//   isEditable - app.js: admin, not previewing, in the draft
//   hideAnimated - app.js: overlays close with their exit animation
//   createSubjectTag - app.js: the subject chip (it owns SUBJECTS)
//   startNewTask - app.js: the list footer opens quick add
//   TTFiles - attachments.js: the classic-script file helper (ACCEPT, MAX_*)
//   openDuePicker - app.js: the due date picker stays in app.js (quick add uses it too)
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
import * as motion from './motion.js';   // leaf helper: imports nothing, reads the DOM only

// --- Values app.js passes in through init(deps) ------------------------------------------------
let Task = null;
let dayDiff = null;
let sortTasks = null;
let STATUS_LABELS = null;
let statusChangeMessage = null;
let sanitizeDoc = null;
let clampPopoverPosition = null;
let myTasks = null;
let isEditable = null;
let hideAnimated = null;
let createSubjectTag = null;
let startNewTask = null;
let TTFiles = null;
let openDuePicker = null;
let calendar = null;
let publish = null;

// --- Moved verbatim from app.js ----------------------------------------------------------------
const findTask = (id) => [...myTasks, ...state.publishedTasks].find((t) => t.id === id);
// A control the user can actually land on: laid out, not inside a hidden page or a closed popover.
// Rows themselves are not tab stops, so returning focus to one leaves it on <body>.
const isLiveControl = (el) => !!(el && el.isConnected && el.getClientRects().length && !el.closest('[hidden]'));
// Renders rebuild the row or card that opened the dialog/confirm, so its old element is gone. Find
// the same task's replacement title first (the only row-opening tab stop), then its status control.
function focusTaskControl(taskId) {
  const scope = `[data-task-id="${CSS.escape(String(taskId))}"]`;
  for (const sel of ['button.task-row-title', 'button.task-title-open', 'button.status-check']) {
    const el = [...document.querySelectorAll(`${scope} ${sel}`)].find(isLiveControl);
    if (el) { el.focus(); return el; }
  }
  return null;
}
// Last resort after a task leaves the visible page (e.g. reopened from Done): the active nav tile is
// a meaningful, visible control, never the hidden page, a closed popover or <body>.
function focusFallbackControl() {
  const nav = [...document.querySelectorAll('.nav-item[aria-current="page"], .nav-item.is-active')].find(isLiveControl);
  if (nav) { nav.focus(); return nav; }
  const first = [...document.querySelectorAll('button, a[href], input, textarea, select')]
    .find((el) => isLiveControl(el) && el.tabIndex >= 0 && !el.disabled);
  if (first) { first.focus(); return first; }
  return null;
}
export function applyProgress(list) {
  list.forEach((t) => { const p = state.progress[t.id]; t.status = p ? p.status : 'not_started'; t.movedAt = p ? p.movedAt : 0; });
}
export function setStatus(task, status) {
  // Motion measures the old layout now; renderAllTasks() plays it once the new one exists.
  motion.begin(task.id, state.progress[task.id]?.status || 'not_started', status);
  state.progress[task.id] = { status, movedAt: Date.now() };
  if (status === 'done') navigator.vibrate?.(12);
  applyProgress(myTasks);
  applyProgress(state.publishedTasks);
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
function confirmReopen(task, newStatus, onConfirm, openerHint) {
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
    if (accept) onConfirm();   // rebuilds the page first: the opener may not survive it
    // The option that opened this confirm may be a hidden popover item; only a laid-out control counts.
    if (isLiveControl(opener) && opener.tabIndex >= 0) opener.focus();
    else if (isLiveControl(openerHint)) openerHint.focus();
    else if (!focusTaskControl(task.id)) focusFallbackControl();
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
  // The title is the card's own control: it names the card and carries the keyboard path, while the
  // card keeps its click-anywhere gesture (the button's click bubbles to the article). A focusable
  // <article> with no role had no accessible name, so a screen reader reached a nameless stop.
  const titleBtn = document.createElement('button');
  titleBtn.type = 'button';
  titleBtn.className = 'task-title-open';
  titleBtn.textContent = task.title;
  titleEl.appendChild(titleBtn);

  article.dataset.status = task.status;
  article.addEventListener('click', (e) => {
    if (e.target.closest('.task-delete-btn')) return;
    openTaskDialog(task, article.closest('.kanban-column'), false);
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
// --- Tasks: published list, same builders as admin, student-safe ---
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
    none.textContent = q && all.length ? 'No tasks match your search.' : 'No tasks yet.';
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
  // A destructive action that removes a published task asks first: the button arms for 4s and the
  // second press runs it, the same inline confirm the Done page's reopen uses.
  const mkBtn = (label, fn, confirmLabel) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'text-button';
    b.textContent = label;
    if (confirmLabel) armInlineConfirm(b, label, confirmLabel, fn);
    else b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  past.forEach((task) => {
    const isDone = task.status === 'done';
    const row = document.createElement('div');
    row.className = 'task-row done-row';
    row.dataset.taskId = task.id;
    row.setAttribute('role', 'listitem');
    const dot = createStatusCheck(task);
    const title = document.createElement('button');
    title.type = 'button';
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
      actions.appendChild(mkBtn('Delete', () => deleteTask(task), 'Confirm deleting this task'));
    }
    row.addEventListener('click', () => openTaskDialog(task));
    row.append(dot, title, task.subject ? createSubjectTag(task.subject) : document.createElement('span'), tag, actions);
    host.appendChild(row);
  });
}
// Restore a task's progress entry to what it was before the last status change.
// Shared by every Undo action so all of them persist and re-render the same way.
// The last open task gets the same motion as any other; only the words change.
function doneMessage() {
  const open = recordSource().filter((x) => !x.isPast());
  return open.length && open.every((x) => x.status === 'done') ? 'All caught up' : statusChangeMessage('done');
}
export function restoreProgress(taskId, prev) {
  // Undo during the flight: drop the ghost, then let the rows glide back.
  motion.cancel(taskId);
  motion.begin(taskId, state.progress[taskId]?.status || 'not_started', prev ? prev.status : 'not_started');
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
// The app's inline destructive confirm: the first press arms the button for 4s, the second runs it.
function armInlineConfirm(btn, label, confirmLabel, onConfirm) {
  let timer = null;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Confirm?';
      btn.setAttribute('aria-label', confirmLabel);
      timer = setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; btn.removeAttribute('aria-label'); }, 4000);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  });
}
// Reopening a done task replaces its completed time, so ask first and offer Undo.
export function reopenWithConfirm(btn, task) {
  armInlineConfirm(btn, btn.textContent, 'Confirm marking this task not done', () => {
    const prev = state.progress[task.id] ? { ...state.progress[task.id] } : null;
    setStatus(task, 'not_started');
    renderAllTasks();
    // The armed button was just replaced. Move to the task's new control, or a visible fallback when
    // it left this page (Done), instead of dropping focus onto <body>.
    if (!focusTaskControl(task.id)) focusFallbackControl();
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
    row.className = 'task-row done-row' + (task.movedAt && Date.now() - task.movedAt < 8000 ? ' is-landed' : '');
    row.dataset.taskId = task.id;
    row.setAttribute('role', 'listitem');
    const dot = createStatusCheck(task);
    const title = document.createElement('button');
    title.type = 'button';
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
  badge.textContent = open.length ? String(open.length) : '';
  badge.hidden = open.length === 0;
  // The badge is the tile's visible text too, so the accessible name has to follow the count
  // (WCAG 2.5.3 label in name); it is written here because this is the badge's only writer.
  document.querySelector('#nav-admin').setAttribute('aria-label', open.length === 0 ? 'Admin' : 'Admin ' + open.length);
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
  row.dataset.taskId = task.id;
  row.setAttribute('role', 'listitem');

  // Checkbox: empty = not started, minus = in progress, check = done
  const check = createStatusCheck(task);
  if (task.id === state.justChangedId) row.classList.add('is-entering');
  if (isEditable(task) && state.changedIds.has(task.id)) row.classList.add('is-changed');

  // The row itself is no longer a tab stop: a focusable div with no role announced nothing. The title
  // is the row's control and the click still opens from anywhere in the row (the click bubbles).
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'task-row-title'
    + (task.title === 'New Task' ? ' is-ghost' : '')
    + (task.status === 'done' ? ' is-done' : '');
  title.textContent = task.title;

  const due = document.createElement('span');
  const overdue = task.dueDate && task.status !== 'done' && task.isOverdue();
  // Same rule as the board badge (within 3 days): amber, with the words "Due today" / "Due tomorrow" / "In 2 days" doing the work, so colour is never the only cue.
  const soon = !!task.dueDate && task.status !== 'done' && !overdue && dayDiff(task.dueDate) <= 3;
  due.className = 'task-row-due' + (overdue ? ' is-overdue' : soon ? ' is-due-soon' : '');
  const dueLabel = document.createElement('span');
  dueLabel.textContent = task.status === 'done' ? task.getDueDateDisplay() : task.getDueLabel();
  if (task.dueDate) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'i');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + (overdue ? 'alarm-clock' : 'calendar'));
    icon.appendChild(use);
    due.append(icon);
  }
  due.append(dueLabel);
  if (task.status !== 'done') due.title = task.getDueShort();

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'task-delete-btn';
  del.setAttribute('aria-label', 'Delete task');
  del.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-trash-2"/></svg>';
  del.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(task); });

  row.append(check, title, task.subject ? createSubjectTag(task.subject) : document.createElement('span'), due, isEditable(task) ? del : document.createElement('span'));
  row.addEventListener('click', () => openTaskDialog(task, null, false));
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
  state.justChangedId = null;
  motion.play();
  
}
// Title is a one-line-looking textarea that grows with its content
export function fitDialogTitle() {
  dom.dialogTitleInput.style.height = 'auto';
  dom.dialogTitleInput.style.height = dom.dialogTitleInput.scrollHeight + 'px';
}
export function updateDialogDue(task) {
  dom.dialogDateBtn.textContent = task.dueDate ? task.getDueShort() : 'Add due date';
  dom.dialogDueHint.textContent = task.status === 'done' ? '' : task.getDueHint();
  dom.dialogDueHint.classList.toggle('is-overdue', task.status !== 'done' && task.isOverdue());
  dom.dialogDateBtn.classList.toggle('empty-value', !task.dueDate);
  dom.dialogDueClear.hidden = !task.dueDate || !isEditable(task);
}
export function updateDialogStatus(task) {
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
export function unlinkify(root) {
  root.querySelectorAll('a').forEach((a) => a.replaceWith(document.createTextNode(a.textContent)));
  root.normalize();
}
export function linkify(root) {
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
export function refreshLinks(root) { unlinkify(root); linkify(root); }
export function getCloseBtn() {
  if (state.dialogCloseBtn) return state.dialogCloseBtn;
  state.dialogCloseBtn = document.createElement('button');
  state.dialogCloseBtn.type = 'button';
  state.dialogCloseBtn.className = dom.dialogDelete.className;
  state.dialogCloseBtn.textContent = 'Close for class';
  state.dialogCloseBtn.addEventListener('click', () => {
    const task = state.currentTask;
    if (!task || !isEditable(task)) return;
    task.closedAt = Date.now();
    saveTasks();
    closeTaskDialog();
    renderAllTasks();
    showToast('Moved to Past tasks', 'Undo', () => { task.closedAt = 0; saveTasks(); renderAllTasks(); });
  });
  dom.dialogDelete.insertAdjacentElement('beforebegin', state.dialogCloseBtn);
  return state.dialogCloseBtn;
}
export function openTaskDialog(task) {
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
export function closeTaskDialog() {
  if (!state.currentTask) return;
  if (isEditable(state.currentTask)) {
    state.currentTask.title = dom.dialogTitleInput.value.trim() || 'New Task';
    state.currentTask.notes = sanitizeDoc(dom.dialogDoc.innerHTML);
    saveTasks();
  }
  state.currentTask = null;
  closeStatusPopover();
  hideAnimated(dom.dialogOverlay);
  dom.dialogOverlay.setAttribute('aria-hidden', 'true');
  dom.dialogSubjectDropdown.hidden = true;
  dom.dialogSubjectBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  renderAllTasks();
  const back = state.dialogReturn;
  state.dialogReturn = null;
  if (back) {
    // The page was just rebuilt: keep the same control if it survived, otherwise focus the task's
    // replacement title/status control. The old row fallback was not a tab stop, so focus fell to body.
    if (isLiveControl(back.el) && back.el.tabIndex >= 0) back.el.focus();
    else if (!focusTaskControl(back.id)) focusFallbackControl();
  }
}
export function openDialogDuePicker(anchor, focus) {
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
export function fileToDataUrl(file) {
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
export function insertDocImage(src) {
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
export async function insertDocImages(files) {
  for (const file of files) {
    let src = null;
    try {
      const { blob, name } = await TTFiles.prepare(file);
      const out = await TTFiles.upload(blob, name);
      src = TTFiles.urlFor(out.id);
    } catch (e) {
      src = await fileToDataUrl(file);   // not signed in or offline: keep it inline instead of losing it
      if (!src) { showToast(e.message || 'Could not add that image'); continue; }
    }
    insertDocImage(src);
  }
  autosave();
}
export async function attachFiles(files) {
  const task = state.currentTask;
  if (!task || !isEditable(task)) return;
  let added = 0;
  for (const file of files) {
    if (task.files.length >= 10) { showToast('A task can have up to 10 files.'); break; }
    try {
      showToast(`Uploading ${file.name || 'file'}…`);
      const { blob, name } = await TTFiles.prepare(file);
      const out = await TTFiles.upload(blob, name);
      task.files.push({ id: out.id, name: out.name, size: out.size });
      added++;
      saveTasks();
      if (state.currentTask === task) renderDialogFiles(task);
    } catch (e) {
      showToast(e.message === 'Failed to fetch' ? 'Cannot reach the server.' : e.message);
      return;
    }
  }
  if (added) { flashSaved(); showToast(added === 1 ? 'File attached' : `${added} files attached`); }
}
export function renderDialogFiles(task) {
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
        saveTasks();
        renderDialogFiles(task);
        showToast('File removed', 'Undo', () => {
          task.files.splice(Math.min(index, task.files.length), 0, f);
          saveTasks();
          if (state.currentTask === task) renderDialogFiles(task);
        });
      });
      li.append(rm);
    }
    dom.dialogFiles.append(li);
  });
}
export function rangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  const pos = document.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const r = document.createRange();
  r.setStart(pos.offsetNode, pos.offset);
  r.collapse(true);
  return r;
}
export function syncNoteTools() {
  dom.noteTools.forEach((b) => {
    let on = false;
    try { on = document.activeElement === dom.dialogDoc && document.queryCommandState(b.dataset.cmd); } catch (e) {}
    b.setAttribute('aria-pressed', String(on));
  });
}
export const dropHasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
// Saves the task being edited in the panel and confirms it.
export function autosave() {
  if (!state.currentTask || !isEditable(state.currentTask)) return;
  state.currentTask.notes = sanitizeDoc(dom.dialogDoc.innerHTML);
  saveTasks();
  flashSaved();
}
// Leaving Done needs an explicit yes. Returns true when the change may proceed.
const isReopen = (task, status) => task.status === 'done' && status !== 'done';
export function updateColumn(columnEl) {
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

export function handleDragStart(e) {
  state.draggedCard = e.target.closest('.task-card');
  if (!state.draggedCard) return;
  state.draggedCard.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', state.draggedCard.dataset.taskId);
}
export function clearDropPlaceholder() {
  document.querySelectorAll('.drop-placeholder').forEach((p) => p.remove());
}
export function handleDragEnd(e) {
  clearDropPlaceholder();
  if (state.draggedCard) {
    state.draggedCard.classList.remove('is-dragging');
    state.draggedCard = null;
  }
  document.querySelectorAll('.kanban-column').forEach(col => col.classList.remove('drag-over'));
}
export function handleDragOver(e) {
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
export function handleDrop(e) {
  e.preventDefault();
  const columnEl = e.target.closest('.kanban-column');
  if (!columnEl || !state.draggedCard) return;

  const taskId = state.draggedCard.dataset.taskId;
  const task = findTask(taskId);
  if (!task) return;

  const newStatus = COLUMN_TO_STATUS[columnEl.dataset.status];
  if (newStatus && newStatus !== task.status) {
    if (isReopen(task, newStatus)) {
      confirmReopen(task, newStatus, () => {
        const prev = state.progress[task.id] ? { ...state.progress[task.id] } : null;
        setStatus(task, newStatus);
        renderAllTasks();
        showToast(statusChangeMessage(newStatus), 'Undo', () => restoreProgress(task.id, prev));
      });
    } else {
      const prev = state.progress[task.id] ? { ...state.progress[task.id] } : null;
      setStatus(task, newStatus);
      renderAllTasks();
      if (newStatus === 'done') {
        showToast(doneMessage(), 'Undo', () => restoreProgress(task.id, prev));
      }
    }
  }

  document.querySelectorAll('.kanban-column').forEach(col => col.classList.remove('drag-over'));
}
export const SUBJECTS = {
  GENSCI: 'bg-cyan', GENMATH: 'bg-pink', PKLP: 'bg-sunglow', EFFCOM: 'bg-green',
  MABKOM: 'bg-sand', PERDEV: 'bg-teal', PE: 'bg-yellow', THEOLOGY: 'bg-stone', CP104: 'bg-blue', FINMATH101: 'bg-mauve',
};
export const STATUS_ORDER = ['not_started', 'in_progress', 'done'];
export function ensureStatusPopover() {
  if (state.statusPopoverEl) return state.statusPopoverEl;
  const el = document.createElement('div');
  el.className = 'status-dropdown status-popover';
  el.setAttribute('role', 'listbox');
  el.setAttribute('aria-label', 'Status');
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
      const pickedFrom = statusPopoverAnchor;
      if (isReopen(picked, next)) {
        closeStatusPopover();
        // The focused option is now hidden; hand the confirm the trigger that is still on screen.
        confirmReopen(picked, next, () => {
          const prev = state.progress[picked.id] ? { ...state.progress[picked.id] } : null;
          setStatus(picked, next);
          if (picked.id === state.currentTask?.id) { updateDialogStatus(picked); updateDialogDue(picked); flashSaved(); }
          renderAllTasks();
          showToast(statusChangeMessage(next), 'Undo', () => restoreProgress(picked.id, prev));
        }, pickedFrom);
        return;
      }
      const prev = state.progress[picked.id] ? { ...state.progress[picked.id] } : null;
      setStatus(picked, opt.dataset.status);
      if (picked.id === state.currentTask?.id) { updateDialogStatus(picked); updateDialogDue(picked); flashSaved(); }
      closeStatusPopover();
      renderAllTasks();
      focusStatusTrigger(picked, pickedFrom);
      if (opt.dataset.status === 'done') {
        showToast(doneMessage(), 'Undo', () => restoreProgress(picked.id, prev));
      }
    });
    el.appendChild(opt);
  });
  document.body.appendChild(el);
  state.statusPopoverEl = el;
  return el;
}
// The control that opened the popover. Kept here so closing can reset aria-expanded and hand focus back.
let statusPopoverAnchor = null;
function paintStatusPopover() {
  const task = state.statusPopoverTask;
  [...state.statusPopoverEl.children].forEach((opt, i) => {
    opt.classList.toggle('is-active', i === state.statusPopoverIndex);
    opt.setAttribute('aria-selected', String(!!task && opt.dataset.status === task.status));
  });
}
// A pick re-renders the lists, so the old trigger is gone: find the task's new visible check, or the dialog button.
function focusStatusTrigger(task, anchor) {
  if (anchor && anchor.isConnected && anchor.getClientRects().length) { anchor.focus(); return; }
  const next = [...document.querySelectorAll(`[data-task-id="${task.id}"] .status-check`)].find((el) => el.getClientRects().length);
  if (next) next.focus();
}
export function closeStatusPopover(refocus = false) {
  if (!state.statusPopoverEl) return;
  const anchor = statusPopoverAnchor;
  state.statusPopoverEl.hidden = true;
  state.statusPopoverTask = null;
  statusPopoverAnchor = null;
  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  if (refocus && anchor && anchor.isConnected) anchor.focus();
}
export function openStatusPopover(task, anchorEl) {
  const el = ensureStatusPopover();
  state.statusPopoverTask = task;
  state.statusPopoverIndex = STATUS_ORDER.indexOf(task.status);
  statusPopoverAnchor = anchorEl;
  anchorEl.setAttribute('aria-haspopup', 'listbox');
  anchorEl.setAttribute('aria-expanded', 'true');
  paintStatusPopover();
  const rect = anchorEl.getBoundingClientRect();
  el.hidden = false;
  const { top, left } = clampPopoverPosition(rect, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight);
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  // Real focus moves into the list, so a screen reader announces the option and its selected state.
  el.children[state.statusPopoverIndex].focus();
}
export function createStatusCheck(task) {
  const check = document.createElement('button');
  check.type = 'button';
  check.className = `status-check is-${task.status.replace(/_/g, '-')}` + '';
  // Names the task and its current status: "Read chapter 3: Not started. Change status".
  check.setAttribute('aria-label', `${task.title}: ${STATUS_LABELS[task.status] || task.status}. Change status`);
  check.setAttribute('aria-haspopup', 'listbox');
  check.setAttribute('aria-expanded', 'false');
  check.innerHTML = task.status === 'done' ? '<svg class="i" aria-hidden="true"><use href="#i-check"/></svg>'
    : task.status === 'in_progress' ? '<svg class="i" aria-hidden="true"><use href="#i-minus"/></svg>' : '';
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.statusPopoverTask === task && state.statusPopoverEl && !state.statusPopoverEl.hidden) { closeStatusPopover(); return; }
    openStatusPopover(task, check);
  });
  return check;
}
export function updateDialogSubject(task) {
  dom.dialogSubjectBtn.innerHTML = '';
  dom.dialogSubjectBtn.classList.toggle('empty-value', !task.subject);
  if (task.subject) dom.dialogSubjectBtn.appendChild(createSubjectTag(task.subject));
  else dom.dialogSubjectBtn.textContent = 'Add subject';
  dom.dialogSubjectDropdown.hidden = true;
}
export function selectSubject(code) {
  if (!state.currentTask) return;
  state.currentTask.subject = code;
  updateDialogSubject(state.currentTask);
  autosave();
}

// Called once by app.js, at the spot the moved listeners used to occupy.
export function init(deps) {
  Task = deps.Task;
  dayDiff = deps.dayDiff;
  sortTasks = deps.sortTasks;
  STATUS_LABELS = deps.STATUS_LABELS;
  statusChangeMessage = deps.statusChangeMessage;
  sanitizeDoc = deps.sanitizeDoc;
  clampPopoverPosition = deps.clampPopoverPosition;
  myTasks = deps.myTasks;
  isEditable = deps.isEditable;
  hideAnimated = deps.hideAnimated;
  createSubjectTag = deps.createSubjectTag;
  startNewTask = deps.startNewTask;
  TTFiles = deps.TTFiles;
  openDuePicker = deps.openDuePicker;
  calendar = deps.calendar;
  publish = deps.publish;
// Don't dismiss the toast while someone is tabbing to its Undo button
dom.toastEl.addEventListener('focusin', () => clearTimeout(state.toastTimer));
dom.toastEl.addEventListener('focusout', () => { clearTimeout(state.toastTimer); state.toastTimer = setTimeout(hideToast, 3000); });
dom.dialogFileInput.accept = TTFiles.ACCEPT;
dom.dialogAttachBtn.addEventListener('click', () => dom.dialogFileInput.click());
dom.dialogFileInput.addEventListener('change', () => {
  const picked = [...dom.dialogFileInput.files];
  dom.dialogFileInput.value = '';
  if (picked.length) attachFiles(picked);
});
dom.dialogTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) e.preventDefault();
});
dom.dialogTitleInput.addEventListener('input', () => {
  const clean = dom.dialogTitleInput.value.replace(/[\r\n]+/g, ' ');
  if (clean !== dom.dialogTitleInput.value) dom.dialogTitleInput.value = clean;
  fitDialogTitle();
});
window.addEventListener('resize', () => { if (state.currentTask) fitDialogTitle(); });
// --- Event Listeners ---

dom.dialogClose.addEventListener('click', closeTaskDialog);
dom.dialogOverlay.addEventListener('click', (e) => { if (e.target === dom.dialogOverlay) closeTaskDialog(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dom.dialogOverlay.hidden && !(state.statusPopoverEl && !state.statusPopoverEl.hidden)) closeTaskDialog();
});
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
  if (idx !== -1) deleteTask(task); else closeTaskDialog();
  state.currentTask = null;
});
dom.dialogStatusBtn.addEventListener('click', () => { if (state.currentTask) openStatusPopover(state.currentTask, dom.dialogStatusBtn); });
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
document.addEventListener('click', (e) => {
  if (state.statusPopoverEl && !state.statusPopoverEl.hidden && !state.statusPopoverEl.contains(e.target) && !e.target.closest('.status-check, .status-value')) {
    closeStatusPopover();
  }
});
document.addEventListener('keydown', (e) => {
  if (!state.statusPopoverEl || state.statusPopoverEl.hidden) return;
  if (e.key === 'Escape') { closeStatusPopover(true); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    state.statusPopoverIndex = (state.statusPopoverIndex + (e.key === 'ArrowDown' ? 1 : -1) + STATUS_ORDER.length) % STATUS_ORDER.length;
    paintStatusPopover();
    state.statusPopoverEl.children[state.statusPopoverIndex].focus();
  }
  // A focused option activates itself on Enter; only click from here when focus is elsewhere.
  if (e.key === 'Enter' && !state.statusPopoverEl.contains(document.activeElement)) { state.statusPopoverEl.children[state.statusPopoverIndex].click(); }
});
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
}
