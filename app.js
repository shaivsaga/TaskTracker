const navItems = [...document.querySelectorAll('[data-page]')];
const pages = [...document.querySelectorAll('[data-page-view]')];
const breadcrumbCurrent = document.querySelector('#breadcrumb-current');
const sidebar = document.querySelector('.sidebar');
const mobileMenu = document.querySelector('.mobile-menu');
const actionFeedback = document.querySelector('#action-feedback');

// --- Admin access: the server login (api/ Basic Auth) is the real gate ---
const ADMIN_KEY = 'class_tasks_admin';
let isAdmin = false;

async function checkAdmin() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('admin')) {
      localStorage.setItem(ADMIN_KEY, '1');
      history.replaceState(null, '', location.pathname + location.hash);
    }
    if (localStorage.getItem(ADMIN_KEY) !== '1') return false;
    const res = await fetch('api/versions.php', { cache: 'no-store' });
    if (res.ok) return true;
    localStorage.removeItem(ADMIN_KEY);
    return false;
  } catch (e) { return false; }
}

// Move the announcement editor from the Class tasks page into Admin
const adminAnnounce = document.querySelector('#announce-admin');
const adminEmpty = document.querySelector('#page-my-tasks .empty-state');
if (adminAnnounce && adminEmpty) adminEmpty.before(adminAnnounce);

// --- Date helpers (calendar days, local time) ---
function dayDiff(date) {
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((start(date) - start(new Date())) / 86400000);
}
function toInputValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// --- Task Data Model (Feature 1) ---
class Task {
  constructor(opts = {}) {
    this.title = opts.title === undefined ? 'New Task' : String(opts.title);
    if (this.title === '') this.title = 'New Task';

    this.dueDate = opts.dueDate instanceof Date ? opts.dueDate : undefined;
    this.dueTime = typeof opts.dueTime === 'string' ? opts.dueTime : undefined;

    this.status = opts.status !== undefined ? String(opts.status) : 'not_started';
    this.movedAt = typeof opts.movedAt === 'number' ? opts.movedAt : 0;

    this.id = opts.id !== undefined ? String(opts.id) : Math.random().toString(36).substring(2, 12);

    this.notes = typeof opts.notes === 'string' ? opts.notes : '';

    this.subject = typeof opts.subject === 'string' ? opts.subject : '';

  }

  getDueDateDisplay() {
    if (!this.dueDate) return '';
    const diff = dayDiff(this.dueDate);
    const full = this.dueDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    if (diff < 0) return full;
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    const dayName = this.dueDate.toLocaleDateString(undefined, { weekday: 'long' });
    const daysToNextMonday = ((8 - new Date().getDay()) % 7) || 7;
    if (diff < daysToNextMonday) return dayName;
    if (diff < daysToNextMonday + 7) return `Next ${dayName}`;
    return full;
  }

  getDueTimestamp() {
    if (!this.dueDate) return null;
    const d = new Date(this.dueDate);
    if (this.dueTime) {
      const [h, m] = this.dueTime.split(':').map(Number);
      d.setHours(h, m, 0, 0);
    } else {
      d.setHours(23, 59, 59, 999);
    }
    return d;
  }

  isOverdue() {
    const ts = this.getDueTimestamp();
    if (!ts) return false;
    return ts.getTime() < Date.now();
  }

  getCountdown() {
    if (!this.dueDate) return 'Someday';
    if (this.isOverdue()) return 'Past Due';
    const diff = dayDiff(this.dueDate);
    const time = this.getTimeLabel();
    const dow = this.dueDate.toLocaleDateString('en-US', { weekday: 'short' });
    const md = this.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    if (diff === 0) {
      if (!this.dueTime) return 'Due Today';
      const mins = Math.max(1, Math.ceil((this.getDueTimestamp().getTime() - Date.now()) / 60000));
      if (mins < 60) return `Due in ${plural(mins, 'Minute')}`;
      if (parseInt(this.dueTime, 10) >= 20) return `Due Tonight at ${time}`;
      return `Due in ${plural(Math.floor(mins / 60), 'Hour')}`;
    }
    if (diff === 1) return this.dueTime ? `Due Tomorrow at ${time}` : 'Due Tomorrow';
    if (diff <= 13) return this.dueTime ? `Due in ${diff} Days at ${time} (${dow})` : `Due in ${diff} Days (${dow})`;
    if (diff <= 29) return `Due in ${plural(Math.round(diff / 7), 'Week')} (${dow}, ${md})`;
    return `Due in ${plural(Math.floor(diff / 30), 'Month')} (${md})`;
  }

  getTimeLabel() {
    if (!this.dueTime) return '';
    const [h, m] = this.dueTime.split(':').map(Number);
    const d = new Date(); d.setHours(h, m);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      dueDate: this.dueDate ? toInputValue(this.dueDate) : undefined,
      dueTime: this.dueTime,
      notes: this.notes,
      subject: this.subject
    };
  }

  static fromJSON(obj) {
    let notes = obj.notes || '';
    if (!/<[a-z][\s\S]*>/i.test(notes)) {
      const esc = document.createElement('div');
      esc.textContent = notes;
      notes = esc.innerHTML.replace(/\n/g, '<br>');
    }
    (Array.isArray(obj.images) ? obj.images : []).forEach((src) => { notes += `<div><img src="${src}"></div>`; });
    return new Task({
      id: obj.id,
      title: obj.title,
      dueDate: obj.dueDate ? new Date(obj.dueDate + 'T00:00:00') : undefined,
      dueTime: obj.dueTime,
      notes: sanitizeDoc(notes),
      subject: obj.subject
    });
  }
}

// ----------------------------------------------------------------------------

const COLUMN_TO_STATUS = {
  todo: 'not_started',
  progress: 'in_progress',
  done: 'done',
};

const STATUS_TO_COLUMN = {
  not_started: 'todo',
  in_progress: 'progress',
  done: 'done',
};

const KEYS = {
  draft: 'class_tasks_draft', progress: 'class_tasks_progress', checkpoints: 'class_tasks_checkpoints',
  cache: 'class_tasks_published_cache', legacy: 'class_tasks_mvp',
};
const API = { publish: 'api/publish.php', versions: 'api/versions.php', current: 'data/current.json' };
const myTasks = [];              // admin draft (definitions only)
let publishedTasks = [];         // what the class sees
let publishedAnnouncements = [];
let progress = {};               // taskId -> { status, movedAt }, per browser
let previewing = false;
let changedIds = new Set();

const readJSON = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch (e) { return fallback; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const isEditable = (task) => isAdmin && !previewing && myTasks.includes(task);
const findTask = (id) => [...myTasks, ...publishedTasks].find((t) => t.id === id);

function applyProgress(list) {
  list.forEach((t) => { const p = progress[t.id]; t.status = p ? p.status : 'not_started'; t.movedAt = p ? p.movedAt : 0; });
}
function setStatus(task, status) {
  progress[task.id] = { status, movedAt: Date.now() };
  if (status === 'done') navigator.vibrate?.(12);
  applyProgress(myTasks);
  applyProgress(publishedTasks);
  justChangedId = task.id;
  saveTasks();
}
function sortTasks(list) {
  const byDue = (a, b) => (a.dueDate && b.dueDate ? a.dueDate - b.dueDate : a.dueDate ? -1 : b.dueDate ? 1 : 0);
  return list.slice().sort((a, b) => (b.movedAt - a.movedAt) || byDue(a, b));
}

const dialogOverlay = document.querySelector('#task-dialog-overlay');
const dialog = document.querySelector('.task-dialog');
const dialogClose = document.querySelector('#dialog-close');
const dialogTitleInput = document.querySelector('#dialog-title-input');
const dialogStatusBtn = document.querySelector('#dialog-status-btn');
const dialogStatusDot = document.querySelector('#dialog-status-dot');
const dialogStatusLabel = document.querySelector('#dialog-status-label');
const dialogDateBtn = document.querySelector('#dialog-date-btn');
const dialogDueClear = document.querySelector('#dialog-due-clear');
const dialogDoc = document.querySelector('#dialog-doc');
const dialogDelete = document.querySelector('#dialog-delete');
const dialogDuplicate = document.querySelector('#dialog-duplicate');

let currentTask = null;

// --- Persistence: progress (everyone) + draft (admin) ---
function saveTasks() {
  const ok = writeJSON(KEYS.progress, progress)
    && (!isAdmin || writeJSON(KEYS.draft, { tasks: myTasks.map((t) => t.toJSON()), announcements }));
  if (!ok) showToast('Storage is full. Remove large images.');
}

function migrateLegacy() {
  try {
    const raw = localStorage.getItem(KEYS.legacy);
    if (!raw || localStorage.getItem(KEYS.draft)) return;
    localStorage.setItem(KEYS.legacy + '_backup', raw);
    const old = JSON.parse(raw);
    old.forEach((o) => { if (o.status && o.status !== 'not_started') progress[o.id] = { status: o.status, movedAt: 0 }; });
    writeJSON(KEYS.progress, progress);
    writeJSON(KEYS.draft, {
      tasks: old.map((o) => Task.fromJSON(o).toJSON()),
      announcements: readJSON('class_tasks_announcements', []),
    });
  } catch (e) { console.warn('Migration skipped:', e); }
}

function loadTasks() {
  progress = readJSON(KEYS.progress, {});
  if (!isAdmin) return;
  migrateLegacy();
  const draft = readJSON(KEYS.draft, { tasks: [], announcements: [] });
  myTasks.length = 0;
  (draft.tasks || []).forEach((o) => myTasks.push(Task.fromJSON(o)));
  announcements = Array.isArray(draft.announcements) ? draft.announcements : [];
  applyProgress(myTasks);
}

function setPublished(data) {
  publishedTasks = ((data && data.tasks) || []).map((o) => Task.fromJSON(o));
  publishedAnnouncements = (data && data.announcements) || [];
  applyProgress(publishedTasks);
}

async function loadPublished() {
  const note = document.querySelector('#sync-note');
  let data = null;
  try {
    const res = await fetch(`${API.current}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (res.status === 404) data = { tasks: [], announcements: [] };
    else if (res.ok) data = await res.json();
    else throw new Error(String(res.status));
    writeJSON(KEYS.cache, data);
    note.hidden = true;
  } catch (e) {
    data = readJSON(KEYS.cache, null);
    note.hidden = false;
  }
  if (currentTask) return;
  setPublished(data);
  renderAllTasks();
  renderAnnouncements();
}

function updateDialogDue(task) {
  dialogDateBtn.textContent = task.getCountdown();
  dialogDateBtn.classList.toggle('empty-value', !task.dueDate);
  dialogDueClear.hidden = !task.dueDate || !isEditable(task);
}

function updateDialogStatus(task) {
  const map = {
    not_started: { label: 'Not started', dot: 'dot-not-started', cls: 'is-not-started' },
    in_progress: { label: 'In progress', dot: 'dot-in-progress', cls: 'is-in-progress' },
    done: { label: 'Done', dot: 'dot-done', cls: 'is-done' },
  };
  const s = map[task.status] || map.not_started;
  dialogStatusLabel.textContent = s.label;
  dialogStatusDot.className = `status-dot ${s.dot}`;
  dialogStatusBtn.className = `prop-value status-value ${s.cls}`;
}

// Keeps only text, line breaks, blocks and data: images. Everything else is stripped.
function sanitizeDoc(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const out = document.createElement('div');
  const walk = (src, dst) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        dst.appendChild(document.createTextNode(n.textContent));
      } else if (n.nodeType === 1) {
        const tag = n.tagName.toLowerCase();
        if (tag === 'img') {
          const s = n.getAttribute('src') || '';
          if (/^data:image\//.test(s)) { const i = document.createElement('img'); i.src = s; i.alt = ''; dst.appendChild(i); }
        } else if (tag === 'br') {
          dst.appendChild(document.createElement('br'));
        } else if (tag === 'div' || tag === 'p') {
          const el = document.createElement('div');
          walk(n, el);
          dst.appendChild(el);
        } else if (tag !== 'script' && tag !== 'style') {
          walk(n, dst);
        }
      }
    });
  };
  walk(tpl.content, out);
  return out.innerHTML;
}

function openTaskDialog(task) {
  currentTask = task;
  const ro = !isEditable(task);
  dialog.classList.toggle('is-readonly', ro);
  dialogTitleInput.readOnly = ro;
  dialogDoc.contentEditable = ro ? 'false' : 'true';
  dialogDoc.dataset.placeholder = ro ? 'No notes for this task.' : 'Write notes, or drop images here';
  dialogSubjectBtn.disabled = ro;
  dialogDateBtn.disabled = ro;
  dialogDelete.hidden = ro;
  dialogDuplicate.hidden = ro;
  dialogTitleInput.value = task.title === 'New Task' ? '' : task.title;
  updateDialogDue(task);
  updateDialogStatus(task);
  dialogDoc.innerHTML = sanitizeDoc(task.notes || '');
  updateDialogSubject(task);
  dialogOverlay.classList.remove('is-closing');
  dialogOverlay.hidden = false;
  dialogOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  (ro ? dialogStatusBtn : dialogTitleInput).focus();
}

function closeTaskDialog() {
  if (!currentTask) return;
  if (isEditable(currentTask)) {
    currentTask.title = dialogTitleInput.value.trim() || 'New Task';
    currentTask.notes = sanitizeDoc(dialogDoc.innerHTML);
    saveTasks();
  }
  currentTask = null;
  closeStatusPopover();
  hideAnimated(dialogOverlay);
  dialogOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  renderAllTasks();
}

// --- Task Card Creation ---
function createTaskCard(task) {
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

  if (task.id === justChangedId) article.classList.add('is-entering');
  if (isEditable(task) && changedIds.has(task.id)) article.classList.add('is-changed');
  header.append(createStatusCheck(task), titleEl);

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'task-delete-btn';
  deleteBtn.type = 'button';
  deleteBtn.setAttribute('aria-label', 'Delete task');
  deleteBtn.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
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
      due.className = 'due-badge' + (overdueNow && !isDone ? ' overdue' : diff <= 1 && !isDone ? ' due-soon' : '');
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', diff < 0 && !isDone ? 'alarm-clock' : 'calendar');
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = isDone ? task.getDueDateDisplay() : task.getCountdown();
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

function updateColumn(columnEl) {
  const n = columnEl.querySelectorAll('.task-card').length;
  columnEl.querySelector('.column-count').textContent = `(${n})`;
  const contentEl = columnEl.querySelector('.column-content');
  const isEmpty = n === 0;
  contentEl.classList.toggle('is-empty', isEmpty);
  const emptyMsg = contentEl.querySelector('.column-empty');
  if (emptyMsg) {
    if (!emptyMsg.dataset.default) emptyMsg.dataset.default = emptyMsg.textContent;
    emptyMsg.textContent = searchQuery.trim() && columnEl.closest('#page-my-tasks') ? 'No tasks match your search.' : emptyMsg.dataset.default;
    emptyMsg.hidden = !isEmpty;
  }
}

// --- Delete Task ---
function deleteTask(task) {
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

// --- Drag & Drop ---
let draggedCard = null;

function handleDragStart(e) {
  draggedCard = e.target.closest('.task-card');
  if (!draggedCard) return;
  draggedCard.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedCard.dataset.taskId);
}

function clearDropPlaceholder() {
  document.querySelectorAll('.drop-placeholder').forEach((p) => p.remove());
}

function handleDragEnd(e) {
  clearDropPlaceholder();
  if (draggedCard) {
    draggedCard.classList.remove('is-dragging');
    draggedCard = null;
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
    const sameColumn = draggedCard && draggedCard.dataset.status === COLUMN_TO_STATUS[columnEl.dataset.status];
    if (!sameColumn && !content.querySelector('.drop-placeholder')) {
      clearDropPlaceholder();
      const ph = document.createElement('div');
      ph.className = 'drop-placeholder';
      ph.textContent = 'Moves to top';
      ph.setAttribute('aria-hidden', 'true');
      content.prepend(ph);
    }
  }
}

function handleDrop(e) {
  e.preventDefault();
  const columnEl = e.target.closest('.kanban-column');
  if (!columnEl || !draggedCard) return;

  const taskId = draggedCard.dataset.taskId;
  const task = findTask(taskId);
  if (!task) return;

  const newStatus = COLUMN_TO_STATUS[columnEl.dataset.status];
  if (newStatus && newStatus !== task.status) {
    setStatus(task, newStatus);
    renderAllTasks();
  }

  document.querySelectorAll('.kanban-column').forEach(col => col.classList.remove('drag-over'));
}

// --- Event Listeners ---

dialogClose.addEventListener('click', closeTaskDialog);
dialogOverlay.addEventListener('click', (e) => { if (e.target === dialogOverlay) closeTaskDialog(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dialogOverlay.hidden && !(statusPopoverEl && !statusPopoverEl.hidden)) closeTaskDialog();
});

dialogStatusBtn.addEventListener('click', () => { if (currentTask) openStatusPopover(currentTask, dialogStatusBtn); });

function openDialogDuePicker(anchor, focus) {
  if (!currentTask) return;
  openDuePicker({
    anchor,
    focus,
    date: currentTask.dueDate || null,
    time: currentTask.dueTime || null,
    onChange: ({ date, time }) => {
      if (!currentTask) return;
      currentTask.dueDate = date || undefined;
      currentTask.dueTime = date ? (time || undefined) : undefined;
      updateDialogDue(currentTask);
      autosave();
    },
  });
}
dialogDateBtn.addEventListener('click', () => openDialogDuePicker(dialogDateBtn, 'date'));
dialogDueClear.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentTask) {
    currentTask.dueDate = undefined;
    currentTask.dueTime = undefined;
    updateDialogDue(currentTask);
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
  dialogDoc.focus();
  const sel = getSelection();
  let range = sel.rangeCount && dialogDoc.contains(sel.getRangeAt(0).startContainer) ? sel.getRangeAt(0) : null;
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(dialogDoc);
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
    const src = await fileToDataUrl(file);
    if (src) insertDocImage(src);
  }
  autosave();
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

let docTimer = null;
dialogDoc.addEventListener('input', () => {
  if (/^(<div>)?<br>(<\/div>)?$/.test(dialogDoc.innerHTML)) dialogDoc.innerHTML = '';
  clearTimeout(docTimer);
  docTimer = setTimeout(autosave, 500);
});

dialogDoc.addEventListener('paste', (e) => {
  e.preventDefault();
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { insertDocImages(files); return; }
  document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
});

const dropHasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
dialog.addEventListener('dragover', (e) => {
  if (!dropHasFiles(e) || dialog.classList.contains('is-readonly')) return;
  e.preventDefault();
  dialog.classList.add('is-dropping');
});
dialog.addEventListener('dragleave', (e) => {
  if (!dialog.contains(e.relatedTarget)) dialog.classList.remove('is-dropping');
});
dialog.addEventListener('drop', (e) => {
  dialog.classList.remove('is-dropping');
  const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  if (dialog.classList.contains('is-readonly')) return;
  const range = rangeFromPoint(e.clientX, e.clientY);
  if (range && dialogDoc.contains(range.startContainer)) {
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  insertDocImages(files);
});

dialogDelete.addEventListener('click', () => {
  if (!currentTask) return;
  const task = currentTask;
  closeStatusPopover();
  hideAnimated(dialogOverlay);
  document.body.style.overflow = '';
  const idx = myTasks.indexOf(task);
  if (idx !== -1) deleteTask(task); else closeTaskDialog();
  currentTask = null;
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
const toastEl = document.querySelector('#toast');
const toastMessage = document.querySelector('#toast-message');
const toastAction = document.querySelector('#toast-action');
const saveState = document.querySelector('#save-state');
let toastTimer = null;
let saveTimer = null;

// Plays the CSS exit animation, then hides. Skips the wait for reduced motion.
function hideAnimated(el, ms = 180) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.hidden = true; return; }
  el.classList.add('is-closing');
  setTimeout(() => {
    if (el.classList.contains('is-closing')) { el.hidden = true; el.classList.remove('is-closing'); }
  }, ms);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastEl.hidden = true;
}

function showToast(message, actionLabel, onAction) {
  toastMessage.textContent = message;
  toastAction.textContent = actionLabel || '';
  toastAction.hidden = !actionLabel;
  toastAction.onclick = () => { hideToast(); if (onAction) onAction(); };
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function flashSaved() {
  saveState.textContent = 'Saved';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveState.textContent = ''; }, 1600);
}

// Saves the task being edited in the panel and confirms it.
function autosave() {
  if (!currentTask || !isEditable(currentTask)) return;
  currentTask.notes = sanitizeDoc(dialogDoc.innerHTML);
  saveTasks();
  flashSaved();
}

function showSkeletons() {
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
  [taskListEl, classListEl].forEach((list) => {
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
function renderClassTasks() {
  const board = document.querySelector('#class-board');
  board.querySelectorAll('.column-content').forEach((c) => {
    c.querySelectorAll('.task-card, .skeleton').forEach((n) => n.remove());
  });
  const source = sortTasks(previewing ? myTasks : publishedTasks);
  source.forEach((task) => {
    const col = board.querySelector(`.kanban-column[data-status="${STATUS_TO_COLUMN[task.status] || 'todo'}"] .column-content`);
    if (col) col.appendChild(createTaskCard(task));
  });
  board.querySelectorAll('.kanban-column').forEach(updateColumn);

  classListEl.replaceChildren(...source.map(createTaskRow));
  if (!source.length) {
    const none = document.createElement('p');
    none.className = 'list-empty';
    none.textContent = 'No class assignments yet.';
    classListEl.appendChild(none);
  }
}

// --- Completed tasks page ---
const recordSource = () => ((isAdmin || previewing) ? myTasks : publishedTasks);

function renderDonePage() {
  const host = document.querySelector('#done-list');
  const done = recordSource().filter((t) => t.status === 'done').sort((a, b) => b.movedAt - a.movedAt);
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
    row.className = 'task-row done-row' + (task.id === justChangedId ? ' is-entering' : '');
    row.tabIndex = 0;
    const dot = document.createElement('span');
    dot.className = 'status-dot dot-done';
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
    undo.addEventListener('click', (e) => { e.stopPropagation(); setStatus(task, 'not_started'); renderAllTasks(); });
    row.addEventListener('click', () => openTaskDialog(task));
    row.addEventListener('keydown', (e) => {
      if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTaskDialog(task); }
    });
    row.append(dot, title, task.subject ? createSubjectTag(task.subject) : document.createElement('span'), when, undo);
    host.appendChild(row);
  });
}

// --- Calendar ---
let calMode = 'month';
let calAnchor = todayDate();
const calSort = (a, b) => (a.dueTime || '').localeCompare(b.dueTime || '');

function calRange() {
  const a = calAnchor;
  if (calMode === 'week') return { start: new Date(a.getFullYear(), a.getMonth(), a.getDate() - a.getDay()), days: 7 };
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  return { start: new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay()), days: Math.ceil((first.getDay() + last.getDate()) / 7) * 7 };
}

function createCalChip(task) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'cal-chip' + (task.status !== 'done' && task.isOverdue() ? ' is-overdue' : '');
  chip.dataset.status = task.status;
  chip.title = (task.subject ? `${task.subject} · ` : '') + task.title;
  if (task.subject) { const dot = document.createElement('span'); dot.className = `cal-dot ${SUBJECTS[task.subject] || ''}`; chip.appendChild(dot); }
  if (task.dueTime) { const t = document.createElement('span'); t.className = 'cal-time'; t.textContent = task.getTimeLabel(); chip.appendChild(t); }
  const title = document.createElement('span');
  title.className = 'cal-chip-title';
  title.textContent = task.title;
  chip.appendChild(title);
  chip.addEventListener('click', () => openTaskDialog(task));
  return chip;
}

function syncCalTabs() {
  document.querySelectorAll('[data-cal-mode]').forEach((b) => {
    const on = b.dataset.calMode === calMode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function renderCalendar() {
  const grid = document.querySelector('#cal-grid');
  if (!grid) return;
  const { start, days } = calRange();
  const dated = recordSource().filter((t) => t.dueDate);
  const byDay = new Map();
  dated.forEach((t) => { const k = toInputValue(t.dueDate); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(t); });
  const short = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  document.querySelector('#cal-title').textContent = calMode === 'week'
    ? `${short(start)} – ${short(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))}`
    : calAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  grid.dataset.mode = calMode;
  grid.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const h = document.createElement('div');
    h.className = 'cal-dow';
    h.textContent = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).toLocaleDateString(undefined, { weekday: 'short' });
    grid.appendChild(h);
  }
  const max = calMode === 'week' ? 12 : 3;
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const cell = document.createElement('div');
    cell.className = 'cal-day' + (calMode === 'month' && d.getMonth() !== calAnchor.getMonth() ? ' is-outside' : '') + (dayDiff(d) === 0 ? ' is-today' : '');
    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = d.getDate();
    cell.appendChild(num);
    const list = (byDay.get(toInputValue(d)) || []).slice().sort(calSort);
    list.slice(0, max).forEach((t) => cell.appendChild(createCalChip(t)));
    if (list.length > max) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'cal-more';
      more.textContent = `+${list.length - max} more`;
      more.addEventListener('click', () => { calAnchor = d; calMode = 'week'; syncCalTabs(); renderCalendar(); });
      cell.appendChild(more);
    }
    grid.appendChild(cell);
  }
  document.querySelector('#cal-empty').hidden = dated.length > 0;
}

function calStep(dir) {
  calAnchor = calMode === 'week'
    ? new Date(calAnchor.getFullYear(), calAnchor.getMonth(), calAnchor.getDate() + dir * 7)
    : new Date(calAnchor.getFullYear(), calAnchor.getMonth() + dir, 1);
  renderCalendar();
}
document.querySelector('#cal-prev').addEventListener('click', () => calStep(-1));
document.querySelector('#cal-next').addEventListener('click', () => calStep(1));
document.querySelector('#cal-today').addEventListener('click', () => { calAnchor = todayDate(); renderCalendar(); });
document.querySelectorAll('[data-cal-mode]').forEach((b) => b.addEventListener('click', () => { calMode = b.dataset.calMode; syncCalTabs(); renderCalendar(); }));

// --- Search, overview stats, nav badge ---
let searchQuery = '';

function getVisibleTasks() {
  const q = searchQuery.trim().toLowerCase();
  return sortTasks(q
    ? myTasks.filter((t) => t.title.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q))
    : myTasks);
}

function updateOverview() {
  const open = myTasks.filter((t) => t.status !== 'done');
  const dueToday = open.filter((t) => t.dueDate && dayDiff(t.dueDate) === 0).length;
  const overdue = open.filter((t) => t.dueDate && t.isOverdue()).length;
  const inProgress = myTasks.filter((t) => t.status === 'in_progress').length;
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

document.querySelector('#task-search').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderAllTasks();
});

// --- New task, theme, and view switch ---
function startNewTask() {
  openQuickAdd();
}
document.querySelector('#new-task-btn')?.addEventListener('click', startNewTask);
document.querySelector('#empty-add-btn')?.addEventListener('click', startNewTask);

// Theme
const themeToggle = document.querySelector('#theme-toggle');
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  try { localStorage.setItem('class_tasks_theme', theme); } catch (e) {}
}
themeToggle.setAttribute('aria-label',
  document.documentElement.dataset.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
themeToggle.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

// View switch (board / list), remembered per page
const VIEW_KEYS = { class: 'class_tasks_view_class', admin: 'class_tasks_view_admin' };
const VIEW_DEFAULTS = { class: 'list', admin: 'board' };
const SCOPES = {
  class: { page: '#page-class-tasks', board: '#class-board', list: '#class-task-list' },
  admin: { page: '#page-my-tasks', board: '#page-my-tasks .kanban-board', list: '#task-list' },
};
const taskListEl = document.querySelector('#task-list');
const classListEl = document.querySelector('#class-task-list');

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

function createTaskRow(task) {
  const row = document.createElement('div');
  row.className = 'task-row';
  row.tabIndex = 0;
  row.dataset.taskId = task.id;

  // Checkbox: empty = not started, minus = in progress, check = done
  const check = createStatusCheck(task);
  if (task.id === justChangedId) row.classList.add('is-entering');
  if (isEditable(task) && changedIds.has(task.id)) row.classList.add('is-changed');

  const title = document.createElement('span');
  title.className = 'task-row-title'
    + (task.title === 'New Task' ? ' is-ghost' : '')
    + (task.status === 'done' ? ' is-done' : '');
  title.textContent = task.title;

  const due = document.createElement('span');
  const overdue = task.dueDate && task.status !== 'done' && task.isOverdue();
  due.className = 'task-row-due' + (overdue ? ' is-overdue' : '');
  due.textContent = task.status === 'done' ? task.getDueDateDisplay() : task.getCountdown();

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'task-delete-btn';
  del.setAttribute('aria-label', 'Delete task');
  del.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
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

function renderTaskList() {
  taskListEl.innerHTML = '';
  const visible = getVisibleTasks();
  visible.forEach((task) => taskListEl.appendChild(createTaskRow(task)));
  if (visible.length === 0 && searchQuery.trim()) {
    const none = document.createElement('p');
    none.className = 'list-empty';
    none.textContent = 'No tasks match your search.';
    taskListEl.appendChild(none);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'task-list-add';
  add.innerHTML = '<i data-lucide="plus" aria-hidden="true"></i><span>New task</span>';
  add.addEventListener('click', startNewTask);
  taskListEl.appendChild(add);
}

// --- Subjects, quick add, announcements, shortcuts ---
const SUBJECTS = {
  GENSCI: 'bg-cyan', GENMATH: 'bg-pink', PKLP: 'bg-sunglow', EFFCOM: 'bg-green',
  MABKOM: 'bg-white', PERDEV: 'bg-yellow', PE: 'bg-yellow', THEOLOGY: 'bg-white', CP104: 'bg-blue',
};
const STATUS_CODES = {
  ns: 'not_started', todo: 'not_started', 'not started': 'not_started',
  ip: 'in_progress', started: 'in_progress', doing: 'in_progress', 'in progress': 'in_progress',
  c: 'done', d: 'done', done: 'done',
};
const WEEKDAYS = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const STATUS_LABELS = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' };
let justChangedId = null;
let staggerNext = false;

function createSubjectTag(code) {
  const tag = document.createElement('span');
  tag.className = `subject-tag ${SUBJECTS[code] || ''}`;
  tag.textContent = code;
  return tag;
}

let statusPopoverEl = null;
let statusPopoverTask = null;
let statusPopoverIndex = 0;
const STATUS_ORDER = ['not_started', 'in_progress', 'done'];

function ensureStatusPopover() {
  if (statusPopoverEl) return statusPopoverEl;
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
      if (!statusPopoverTask) return;
      const picked = statusPopoverTask;
      const prev = progress[picked.id] ? { ...progress[picked.id] } : null;
      setStatus(picked, opt.dataset.status);
      if (picked === currentTask) { updateDialogStatus(picked); flashSaved(); }
      closeStatusPopover();
      renderAllTasks();
      if (opt.dataset.status === 'done') {
        showToast('Marked done', 'Undo', () => {
          if (prev) progress[picked.id] = prev; else delete progress[picked.id];
          applyProgress(myTasks);
          applyProgress(publishedTasks);
          saveTasks();
          renderAllTasks();
        });
      }
    });
    el.appendChild(opt);
  });
  document.body.appendChild(el);
  statusPopoverEl = el;
  return el;
}

function closeStatusPopover() {
  if (!statusPopoverEl) return;
  statusPopoverEl.hidden = true;
  statusPopoverTask = null;
}

function openStatusPopover(task, anchorEl) {
  const el = ensureStatusPopover();
  statusPopoverTask = task;
  statusPopoverIndex = STATUS_ORDER.indexOf(task.status);
  [...el.children].forEach((opt, i) => opt.classList.toggle('is-active', i === statusPopoverIndex));
  const rect = anchorEl.getBoundingClientRect();
  el.hidden = false;
  el.style.top = `${rect.bottom + 4}px`;
  el.style.left = `${rect.left}px`;
}

function createStatusCheck(task) {
  const check = document.createElement('button');
  check.type = 'button';
  check.className = `status-check is-${task.status.replace(/_/g, '-')}` + (task.id === justChangedId ? ' is-popping' : '');
  check.setAttribute('aria-label', 'Change status');
  check.innerHTML = task.status === 'done' ? '<i data-lucide="check" aria-hidden="true"></i>'
    : task.status === 'in_progress' ? '<i data-lucide="minus" aria-hidden="true"></i>' : '';
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    if (statusPopoverTask === task && statusPopoverEl && !statusPopoverEl.hidden) { closeStatusPopover(); return; }
    openStatusPopover(task, check);
  });
  return check;
}

document.addEventListener('click', (e) => {
  if (statusPopoverEl && !statusPopoverEl.hidden && !statusPopoverEl.contains(e.target) && !e.target.closest('.status-check, .status-value')) {
    closeStatusPopover();
  }
});
document.addEventListener('keydown', (e) => {
  if (!statusPopoverEl || statusPopoverEl.hidden) return;
  if (e.key === 'Escape') { closeStatusPopover(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    statusPopoverIndex = (statusPopoverIndex + (e.key === 'ArrowDown' ? 1 : -1) + STATUS_ORDER.length) % STATUS_ORDER.length;
    [...statusPopoverEl.children].forEach((opt, i) => opt.classList.toggle('is-active', i === statusPopoverIndex));
  }
  if (e.key === 'Enter') { statusPopoverEl.children[statusPopoverIndex].click(); }
});

const dialogSubjectBtn = document.querySelector('#dialog-subject-btn');
const dialogSubjectDropdown = document.querySelector('#dialog-subject-dropdown');

function updateDialogSubject(task) {
  dialogSubjectBtn.innerHTML = '';
  dialogSubjectBtn.classList.toggle('empty-value', !task.subject);
  if (task.subject) dialogSubjectBtn.appendChild(createSubjectTag(task.subject));
  else dialogSubjectBtn.textContent = 'Empty';
  dialogSubjectDropdown.hidden = true;
}
function selectSubject(code) {
  if (!currentTask) return;
  currentTask.subject = code;
  updateDialogSubject(currentTask);
  autosave();
}
[''].concat(Object.keys(SUBJECTS)).forEach((code) => {
  const opt = document.createElement('button');
  opt.type = 'button';
  opt.className = 'status-option';
  opt.setAttribute('role', 'option');
  if (code) opt.appendChild(createSubjectTag(code)); else opt.textContent = 'None';
  opt.addEventListener('click', () => selectSubject(code));
  dialogSubjectDropdown.appendChild(opt);
});
dialogSubjectBtn.addEventListener('click', () => {
  const open = dialogSubjectBtn.getAttribute('aria-expanded') === 'true';
  dialogSubjectBtn.setAttribute('aria-expanded', String(!open));
  dialogSubjectDropdown.hidden = open;
});
document.addEventListener('click', (e) => {
  if (!dialogSubjectBtn.contains(e.target) && !dialogSubjectDropdown.contains(e.target)) {
    dialogSubjectBtn.setAttribute('aria-expanded', 'false');
    dialogSubjectDropdown.hidden = true;
  }
});

// --- Quick add: "GENMATH worksheet ip 10/5" ---
const quickOverlay = document.querySelector('#quick-overlay');
const quickInput = document.querySelector('#quick-input');
const quickPreview = document.querySelector('#quick-preview');
let quickReturnFocus = null;
let quickPicked = { date: null, time: null };

const lookup = (map, key) => (Object.hasOwn(map, key) ? map[key] : undefined);

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

// "3pm", "3:30pm", "15:30" -> "HH:MM" (or null)
function parseTimeWord(w) {
  let m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/i.exec(w);
  if (m) {
    let h = +m[1];
    const min = +(m[2] || 0);
    if (h < 1 || h > 12 || min > 59) return null;
    if (m[3].toLowerCase() === 'pm' && h < 12) h += 12;
    if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(w);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function isDateWord(w) {
  const l = w.toLowerCase();
  return /^(\d{1,2})[\/-](\d{1,2})$/.test(w) || ['today', 'tmr', 'tomorrow'].includes(l) || lookup(WEEKDAYS, l) !== undefined;
}

function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function openQuickPicker(kind) {
  const p = parseQuickAdd(quickInput.value);
  const chip = quickChipEls.find((c) => c.dataset.type === (kind === 'time' ? 'time' : 'pick'));
  openDuePicker({
    anchor: chip || quickInput,
    focus: kind,
    date: p.dueDate || null,
    time: p.dueTime || null,
    onChange: ({ date, time }) => {
      if (!date) { clearQuickDue(false); return; }
      quickPicked = { date, time };
      renderQuickPreview();
    },
    onDone: () => quickInput.focus(),
  });
}

function clearQuickDue(refocus = true) {
  quickPicked = { date: null, time: null };
  const kept = quickWords(quickInput.value).filter((w) => !isDateWord(w) && !parseTimeWord(w));
  quickInput.value = kept.length ? kept.join(' ') + ' ' : '';
  closeDuePicker();
  if (refocus) quickInput.focus();
  renderQuickPreview();
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
  if (quickPicked.date) { out.dueDate = quickPicked.date; out.dueTime = quickPicked.time || undefined; }   // picker wins
  if (!out.dueDate) out.dueTime = undefined;              // time needs a date
  out.status = out.status || 'not_started';
  out.title = rest.join(' ') || (out.subject ? `${out.subject} task` : 'New Task');
  return out;
}

let quickPrev = { subject: '', status: '', due: '' };
let quickChipEls = [];

function quickText(text, cls) {
  const s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = text;
  return s;
}

function quickField(label, content, changed) {
  const row = document.createElement('div');
  row.className = 'quick-field';
  const value = quickText('', 'quick-field-value');
  if (content) value.appendChild(content);
  else { value.textContent = '—'; value.classList.add('is-empty'); }
  if (changed) value.classList.add('is-changed');
  row.append(quickText(label, 'quick-field-label'), value);
  return row;
}

function renderQuickPreview() {
  quickPreview.replaceChildren();
  const p = (quickInput.value.trim() || quickPicked.date) ? parseQuickAdd(quickInput.value) : null;
  const next = {
    subject: p ? p.subject : '',
    status: p && p.typedStatus ? p.status : '',
    due: p && p.dueDate ? toInputValue(p.dueDate) + (p.dueTime || '') : '',
  };
  const changed = (k) => next[k] !== '' && next[k] !== quickPrev[k];
  let dueNode = null;
  if (p && p.dueDate) {
    dueNode = document.createElement('span');
    dueNode.className = 'quick-due';
    dueNode.appendChild(quickText(
      p.dueDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      'quick-chip is-mono'
    ));
    if (p.dueTime) dueNode.appendChild(quickText(formatTime(p.dueTime), 'quick-chip is-mono'));
  }
  quickPreview.append(
    quickField('Task', p && quickText(p.title, 'quick-title')),
    quickField('Subject', p && p.subject ? createSubjectTag(p.subject) : null, changed('subject')),
    quickField('Status', p ? quickText(STATUS_LABELS[p.status], 'quick-chip') : null, changed('status')),
    quickField('Due', dueNode, changed('due'))
  );
  quickPrev = next;
  syncQuickChips(p);
}

function renderQuickChips() {
  const host = document.querySelector('#quick-chips');
  host.replaceChildren();
  quickChipEls = [];
  const groups = [
    ['Subject', Object.keys(SUBJECTS).map((code) => ({ type: 'subject', code }))],
    ['Status', [['ns', 'Not started', 'ns'], ['ip', 'In progress', 'ip'], ['d', 'Done', 'c/d']].map(([code, label, shown]) => ({ type: 'status', code, label, shown }))],
    ['Due', [
      { type: 'date', code: 'today', label: 'Today', shown: 'today' },
      { type: 'date', code: 'tmr', label: 'Tomorrow', shown: 'tmr' },
      { type: 'pick', code: 'pick', label: 'Date & time', shown: 'cal' },
      { type: 'clear', code: 'clear', label: 'Clear' },
    ]],
  ];
  groups.forEach(([name, items]) => {
    const group = document.createElement('div');
    group.className = 'quick-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', name);
    group.appendChild(quickText(name, 'quick-group-label'));
    items.forEach(({ type, code, label, shown }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quick-chip-btn';
      btn.dataset.type = type;
      btn.dataset.code = code;
      btn.title = type === 'subject' ? code : shown ? `Shortcut: ${shown}` : label;
      btn.setAttribute('aria-pressed', 'false');
      if (type === 'subject') {
        btn.classList.add('is-subject');
        btn.appendChild(createSubjectTag(code));
      } else {
        btn.appendChild(quickText(label));
        if (shown) btn.appendChild(quickText(shown, 'quick-code'));
      }
      btn.addEventListener('click', () => applyQuickToken(type, code));
      group.appendChild(btn);
      quickChipEls.push(btn);
    });
    host.appendChild(group);
  });
}

function syncQuickChips(p) {
  quickChipEls.forEach((el) => {
    const { type, code } = el.dataset;
    let on = false;
    if (p) {
      if (type === 'subject') on = p.subject === code;
      else if (type === 'status') on = p.typedStatus && p.status === STATUS_CODES[code];
      else if (type === 'date') on = !!p.dueDate && !quickPicked.date && dayDiff(p.dueDate) === (code === 'today' ? 0 : 1);
      else if (type === 'pick') on = !!quickPicked.date;
      else if (type === 'time') on = !!p.dueTime;
    }
    if (type === 'clear') el.hidden = !(p && p.dueDate);
    el.classList.toggle('is-selected', on);
    el.setAttribute('aria-pressed', String(on));
  });
}

// Clicking a chip swaps that token in the input; clicking it again removes it.
function applyQuickToken(type, code) {
  if (type === 'pick') { openQuickPicker('date'); return; }
  if (type === 'time') { openQuickPicker('time'); return; }
  if (type === 'clear') { clearQuickDue(); return; }
  const isToken = {
    subject: (w) => !!lookup(SUBJECTS, w.toUpperCase()),
    status: (w) => !!lookup(STATUS_CODES, w.toLowerCase()),
    date: isDateWord,
  }[type];
  const wasOn = quickChipEls.some((c) => c.dataset.type === type && c.dataset.code === code && c.classList.contains('is-selected'));
  if (type === 'date') quickPicked.date = null;
  const kept = quickWords(quickInput.value).filter((w) => !isToken(w));
  if (!wasOn) { if (type === 'subject') kept.unshift(code); else kept.push(code); }
  quickInput.value = kept.length ? kept.join(' ') + ' ' : '';
  quickInput.focus();
  renderQuickPreview();
}

function openQuickAdd() {
  if (!dialogOverlay.hidden && !dialogOverlay.classList.contains('is-closing')) return;
  quickReturnFocus = document.activeElement;
  quickInput.value = '';
  quickPicked = { date: null, time: null };
  closeDuePicker();
  quickPrev = { subject: '', status: '', due: '' };
  renderQuickChips();
  renderQuickPreview();
  quickOverlay.classList.remove('is-closing');
  quickOverlay.hidden = false;
  quickInput.focus();
}

function closeQuickAdd() {
  hideAnimated(quickOverlay, 120);
  if (quickReturnFocus && quickReturnFocus.focus) quickReturnFocus.focus();
}

function submitQuickAdd(openDetails) {
  if (!quickInput.value.trim()) return;
  const p = parseQuickAdd(quickInput.value);
  const task = new Task({ title: p.title, subject: p.subject, dueDate: p.dueDate, dueTime: p.dueTime });
  myTasks.push(task);
  if (p.status !== 'not_started') setStatus(task, p.status);
  else { justChangedId = task.id; saveTasks(); }
  hideAnimated(quickOverlay, 120);
  if (searchQuery) { searchQuery = ''; document.querySelector('#task-search').value = ''; }
  setPage('my-tasks');
  renderAllTasks();
  if (openDetails) openTaskDialog(task, null, false);
  else showToast('Task added');
}

quickInput.addEventListener('input', () => {
  const m = /(^|\s)(cal|date)\s$/i.exec(quickInput.value);
  if (m) {
    quickInput.value = quickInput.value.slice(0, m.index + m[1].length);
    renderQuickPreview();
    openQuickPicker('date');
    return;
  }
  renderQuickPreview();
});
quickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(e.shiftKey); }
  if (e.key === 'Escape') { e.preventDefault(); closeQuickAdd(); }
});
quickOverlay.addEventListener('click', (e) => { if (e.target === quickOverlay) closeQuickAdd(); });

function renderPublicAnnouncements() {
  const list = document.querySelector('#announce-list-public');
  if (!list) return;
  const items = (previewing || isAdmin) ? announcements : publishedAnnouncements;
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'announce-empty';
    empty.textContent = 'No pinned announcements.';
    list.appendChild(empty);
    return;
  }
  items.forEach((a) => {
    const li = document.createElement('li');
    li.className = 'announce-item';
    const text = document.createElement('p');
    text.className = 'announce-text';
    text.textContent = a.text;
    const date = document.createElement('span');
    date.className = 'announce-date';
    date.textContent = new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    li.append(text, date);
    list.appendChild(li);
  });
}

// --- Pinned announcements ---
const announceList = document.querySelector('#announce-list');
const announceForm = document.querySelector('#announce-form');
const announceInput = document.querySelector('#announce-input');
let announcements = [];
const announceCount = document.querySelector('#announce-count');
const ANNOUNCE_MAX = 280;

function updateAnnounceCount() {
  const left = ANNOUNCE_MAX - announceInput.value.length;
  announceCount.textContent = `${left} left · Ctrl+Enter to pin`;
  announceCount.classList.toggle('is-low', left <= 20);
}
announceInput.addEventListener('input', updateAnnounceCount);

function saveAnnouncements() { saveTasks(); updateAdminBar(diffDraft()); }

function renderAnnouncements() {
  renderPublicAnnouncements();
  announceList.replaceChildren();
  if (!announcements.length) {
    const empty = document.createElement('li');
    empty.className = 'announce-empty';
    empty.textContent = 'No pinned announcements.';
    announceList.appendChild(empty);
    return;
  }
  announcements.forEach((a) => {
    const li = document.createElement('li');
    li.className = 'announce-item';
    const text = document.createElement('p');
    text.className = 'announce-text';
    text.textContent = a.text;
    const date = document.createElement('span');
    date.className = 'announce-date';
    date.textContent = new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'task-delete-btn';
    del.setAttribute('aria-label', 'Remove announcement');
    del.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
    del.addEventListener('click', () => {
      const index = announcements.indexOf(a);
      announcements.splice(index, 1);
      saveAnnouncements();
      renderAnnouncements();
      showToast('Announcement removed', 'Undo', () => {
        announcements.splice(Math.min(index, announcements.length), 0, a);
        saveAnnouncements();
        renderAnnouncements();
      });
    });
    li.append(text, date, del);
    announceList.appendChild(li);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function toggleAnnounceForm(show) {
  announceForm.hidden = !show;
  if (show) announceInput.focus();
  else announceInput.value = '';
  updateAnnounceCount();
}
document.querySelector('#announce-add-btn').addEventListener('click', () => toggleAnnounceForm(announceForm.hidden));
document.querySelector('#announce-cancel').addEventListener('click', () => toggleAnnounceForm(false));
announceForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = announceInput.value.trim();
  if (!text) return;
  announcements.unshift({ id: Math.random().toString(36).slice(2, 10), text, createdAt: Date.now() });
  saveAnnouncements();
  renderAnnouncements();
  toggleAnnounceForm(false);
});
announceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); announceForm.requestSubmit(); }
  if (e.key === 'Escape') { e.preventDefault(); toggleAnnounceForm(false); }
});

// --- Keyboard shortcuts: N = new task, / = search ---
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return;
  if (!isAdmin || !dialogOverlay.hidden || !quickOverlay.hidden) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openQuickAdd(); }
  if (e.key === '/') { e.preventDefault(); setPage('my-tasks'); document.querySelector('#task-search').focus(); }
});

// --- Due date picker (shared by task dialog and quick add) ---
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function makeDate(y, mo, d) {
  const dt = new Date(y, mo, d);
  return dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d ? dt : null;
}

function todayDate() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function formatDateText(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// today, tmr, fri, 10/5, 10/5/2026, oct 5, 5 oct 2026, 2026-10-05
function parseDateText(raw) {
  const s = raw.trim().toLowerCase().replace(/,/g, '');
  if (!s) return null;
  const t = todayDate();
  const y = t.getFullYear();
  const yr = (v) => (v === undefined ? y : +v < 100 ? 2000 + +v : +v);
  if (s === 'today') return t;
  if (s === 'tmr' || s === 'tomorrow') return new Date(y, t.getMonth(), t.getDate() + 1);
  const wd = lookup(WEEKDAYS, s);
  if (wd !== undefined) return new Date(y, t.getMonth(), t.getDate() + (((wd - t.getDay() + 7) % 7) || 7));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return makeDate(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/.exec(s);
  if (m) return makeDate(yr(m[3]), +m[1] - 1, +m[2]);
  m = /^([a-z]{3})[a-z]*\.? (\d{1,2})(?: (\d{4}))?$/.exec(s);
  if (m && MONTH_ABBR.includes(m[1])) return makeDate(yr(m[3]), MONTH_ABBR.indexOf(m[1]), +m[2]);
  m = /^(\d{1,2}) ([a-z]{3})[a-z]*(?: (\d{4}))?$/.exec(s);
  if (m && MONTH_ABBR.includes(m[2])) return makeDate(yr(m[3]), MONTH_ABBR.indexOf(m[2]), +m[1]);
  return null;
}

let dpEl = null;
let dpState = null;

function closeDuePicker(reason) {
  if (!dpEl) return;
  const done = dpState && dpState.onDone;
  const el = dpEl;
  dpEl = null;
  dpState = null;
  el.remove();
  if (done && (reason === 'esc' || reason === 'done')) done();
}

// opts: { anchor, focus: 'date'|'time', date, time, onChange({date, time}), onDone }
function openDuePicker(opts) {
  if (dpEl && dpState.anchor === opts.anchor && dpState.focus === opts.focus) { closeDuePicker(); return; }
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
      <input class="dp-input dp-date" type="text" placeholder="Date" aria-label="Date" autocomplete="off" spellcheck="false">
      <input class="dp-input dp-time" type="text" placeholder="Time (optional)" aria-label="Time, optional" autocomplete="off" spellcheck="false">
    </div>
    <div class="dp-head">
      <span class="dp-month"></span>
      <button type="button" class="dp-nav dp-today">Today</button>
      <button type="button" class="dp-nav dp-prev" aria-label="Previous month"><i data-lucide="chevron-left" aria-hidden="true"></i></button>
      <button type="button" class="dp-nav dp-next" aria-label="Next month"><i data-lucide="chevron-right" aria-hidden="true"></i></button>
    </div>
    <div class="dp-grid" role="grid"></div>
    <div class="dp-foot">
      <span class="dp-hint">Time is optional · e.g. fri 3pm</span>
      <button type="button" class="text-button dp-clear">Clear</button>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const dateIn = $('.dp-date');
  const timeIn = $('.dp-time');
  const grid = $('.dp-grid');
  const monthEl = $('.dp-month');

  const emit = () => s.onChange({ date: s.date, time: s.time });
  const syncFields = () => {
    dateIn.value = s.date ? formatDateText(s.date) : '';
    timeIn.value = s.time ? formatTime(s.time) : '';
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
    if (r.date) { s.date = r.date; gotoMonth(r.date); changed = true; }
    if (r.time && (r.date || r.timeOnly)) {
      s.time = r.time;
      if (!s.date) { s.date = todayDate(); gotoMonth(s.date); }
      changed = true;
    }
    if (changed) { timeIn.value = s.time ? formatTime(s.time) : ''; renderGrid(); emit(); }
  });

  timeIn.addEventListener('input', () => {
    const t = parseTimeWord(timeIn.value.replace(/\s+/g, ''));
    if (!t) return;
    s.time = t;
    if (!s.date) { s.date = todayDate(); dateIn.value = formatDateText(s.date); gotoMonth(s.date); }
    emit();
  });

  const commitDate = () => {
    if (!dateIn.value.trim() && s.date) { s.date = null; s.time = null; renderGrid(); emit(); }
    syncFields();
  };
  const commitTime = () => {
    if (!timeIn.value.trim() && s.time) { s.time = null; emit(); }
    syncFields();
  };
  dateIn.addEventListener('blur', commitDate);
  timeIn.addEventListener('blur', commitTime);
  [dateIn, timeIn].forEach((inp) => inp.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    if (inp === dateIn) commitDate(); else commitTime();
    closeDuePicker('done');
  }));

  $('.dp-prev').addEventListener('click', () => gotoMonth(new Date(s.view.getFullYear(), s.view.getMonth() - 1, 1)));
  $('.dp-next').addEventListener('click', () => gotoMonth(new Date(s.view.getFullYear(), s.view.getMonth() + 1, 1)));
  $('.dp-today').addEventListener('click', () => { s.date = todayDate(); gotoMonth(s.date); syncFields(); emit(); });
  $('.dp-clear').addEventListener('click', () => { s.date = null; s.time = null; emit(); closeDuePicker(); });

  document.body.appendChild(el);
  dpEl = el;
  dpState = s;
  syncFields();
  renderGrid();
  if (typeof lucide !== 'undefined') lucide.createIcons();

  const r = s.anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  el.style.top = `${top}px`;
  el.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - w - 8)}px`;

  const target = s.focus === 'time' ? timeIn : dateIn;
  target.focus();
  target.select();
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
  if (dpEl && !dpEl.contains(e.target) && !dpState.anchor.contains(e.target)) closeDuePicker();
});

// --- Sidebar collapse ---
const SIDEBAR_KEY = 'class_tasks_sidebar';
const sidebarToggle = document.querySelector('#sidebar-toggle');
function setSidebarCollapsed(collapsed, save = true) {
  document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'open';
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  navItems.forEach((item) => {
    if (collapsed) item.title = item.querySelector('span:not(.nav-badge)').textContent;
    else item.removeAttribute('title');
  });
  if (save) { try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch (e) {} }
}
sidebarToggle.addEventListener('click', () => {
  setSidebarCollapsed(document.documentElement.dataset.sidebar !== 'collapsed');
});
setSidebarCollapsed(document.documentElement.dataset.sidebar === 'collapsed', false);

// --- Navigation ---
function setPage(pageName, updateHash = true) {
  const activeItem = navItems.find((item) => item.dataset.page === (pageName === 'my-tasks' && !isAdmin ? 'class-tasks' : pageName)) || navItems[0];
  const activePageName = activeItem.dataset.page;
  const activePage = pages.find((page) => page.dataset.pageView === activePageName);

  navItems.forEach((item) => {
    const isActive = item === activeItem;
    item.classList.toggle('is-active', isActive);
    item.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  pages.forEach((page) => {
    page.hidden = page !== activePage;
  });

  breadcrumbCurrent.textContent = activeItem.querySelector('span:not(.nav-badge)').textContent;
  document.title = `${activeItem.querySelector('span:not(.nav-badge)').textContent} — TaskTracker`;

  if (updateHash && window.location.hash !== `#${activePageName}`) {
    history.replaceState(null, '', `#${activePageName}`);
  }

  sidebar.classList.remove('is-open');
  mobileMenu?.setAttribute('aria-expanded', 'false');
}

navItems.forEach((item) => {
  item.addEventListener('click', (event) => {
    event.preventDefault();
    if (previewing) setPreview(false);
    setPage(item.dataset.page);
  });
});

mobileMenu?.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('is-open');
  mobileMenu.setAttribute('aria-expanded', String(isOpen));
});

// --- Admin: diff, checkpoints, publish, history, import/export, preview ---
let lastSavedAt = null;
const $ = (sel) => document.querySelector(sel);
const publishOverlay = $('#publish-overlay');
const historyOverlay = $('#history-overlay');

const snapshot = () => ({ tasks: myTasks.map((t) => t.toJSON()), announcements: JSON.parse(JSON.stringify(announcements)) });
const fmtWhen = (ts) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const describeDiff = (d) => [d.added && `${d.added} added`, d.edited && `${d.edited} edited`, d.removed && `${d.removed} removed`, d.ann && 'announcements changed'].filter(Boolean).join(', ') || 'No changes';

function diffDraft() {
  const defs = (list) => new Map(list.map((t) => [t.id, JSON.stringify(t.toJSON())]));
  const pub = defs(publishedTasks);
  const cur = defs(myTasks);
  const changed = new Set();
  let added = 0, edited = 0, removed = 0;
  cur.forEach((json, id) => {
    if (!pub.has(id)) { added++; changed.add(id); }
    else if (pub.get(id) !== json) { edited++; changed.add(id); }
  });
  pub.forEach((_, id) => { if (!cur.has(id)) removed++; });
  const ann = JSON.stringify(announcements) !== JSON.stringify(publishedAnnouncements);
  return { added, edited, removed, ann, changed, total: added + edited + removed + (ann ? 1 : 0) };
}

function updateAdminBar(diff) {
  if (!isAdmin) return;
  $('#admin-status').textContent = [
    diff.total ? `Unpublished changes: ${diff.total}` : 'No unpublished changes',
    lastSavedAt && `Saved ${new Date(lastSavedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
  ].filter(Boolean).join(' · ');
  $('#btn-apply').disabled = !diff.total;
  $('#btn-discard').disabled = !diff.total;
}

function restoreDraft(snap) {
  myTasks.length = 0;
  (snap.tasks || []).forEach((o) => myTasks.push(Task.fromJSON(o)));
  announcements = snap.announcements ? JSON.parse(JSON.stringify(snap.announcements)) : [];
  applyProgress(myTasks);
  saveTasks();
  renderAllTasks();
  renderAnnouncements();
}

function saveCheckpoint() {
  const list = readJSON(KEYS.checkpoints, []);
  list.unshift({ at: Date.now(), ...snapshot() });
  if (!writeJSON(KEYS.checkpoints, list.slice(0, 20))) { showToast('Storage is full. Checkpoint not saved.'); return; }
  lastSavedAt = Date.now();
  updateAdminBar(diffDraft());
  showToast('Checkpoint saved');
}

function setPreview(on) {
  previewing = on;
  $('#preview-banner').hidden = !on;
  if (on) setPage('class-tasks');
  renderAllTasks();
  renderAnnouncements();
}

function openPublishDialog() {
  const d = diffDraft();
  if (!d.total) { showToast('Nothing to publish'); return; }
  const undated = myTasks.filter((t) => !t.dueDate).length;
  $('#publish-summary').textContent = `${describeDiff(d)}.` + (undated ? ` ${undated} task${undated === 1 ? ' has' : 's have'} no due date.` : '');
  $('#publish-note').value = '';
  $('#publish-error').hidden = true;
  publishOverlay.classList.remove('is-closing');
  publishOverlay.hidden = false;
  $('#publish-note').focus();
}

$('#publish-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#publish-submit');
  const err = $('#publish-error');
  btn.disabled = true;
  btn.classList.add('is-loading');
  err.hidden = true;
  try {
    const res = await fetch(API.publish, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...snapshot(), note: $('#publish-note').value.trim() }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Publish failed');
    writeJSON(KEYS.cache, out.current);
    setPublished(out.current);
    hideAnimated(publishOverlay);
    renderAllTasks();
    renderAnnouncements();
    showToast('Published');
  } catch (ex) {
    err.textContent = ex.message === 'Failed to fetch' ? 'Cannot reach the server.' : ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
});

// History
let serverVersions = [];
function renderHistory() {
  const list = $('#history-list');
  const items = [
    ...readJSON(KEYS.checkpoints, []).map((c) => ({ kind: 'Checkpoint', at: c.at, snap: c })),
    ...serverVersions.map((v) => ({ kind: 'Published', at: v.publishedAt * 1000, note: v.note, snap: v, id: v.id })),
  ].sort((a, b) => b.at - a.at);
  list.replaceChildren();
  if (!items.length) {
    const none = document.createElement('li');
    none.className = 'announce-empty';
    none.textContent = 'No saved versions yet.';
    list.appendChild(none);
    return;
  }
  items.forEach((it) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    const head = document.createElement('div');
    head.className = 'history-head';
    const label = document.createElement('span');
    label.className = 'history-label';
    label.textContent = `${it.kind} · ${fmtWhen(it.at)}` + (it.note ? ` · ${it.note}` : '');
    const count = document.createElement('span');
    count.className = 'announce-date';
    count.textContent = `${it.snap.tasks.length} tasks`;
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'text-button';
    preview.textContent = 'Preview';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'text-button';
    restore.textContent = 'Restore to draft';
    const detail = document.createElement('ul');
    detail.className = 'history-detail';
    detail.hidden = true;
    it.snap.tasks.forEach((t) => {
      const d = document.createElement('li');
      d.textContent = (t.subject ? `${t.subject} · ` : '') + t.title;
      detail.appendChild(d);
    });
    preview.addEventListener('click', () => { detail.hidden = !detail.hidden; });
    restore.addEventListener('click', () => {
      const before = snapshot();
      restoreDraft(it.snap);
      hideAnimated(historyOverlay);
      showToast('Restored to draft. Nothing is live until you apply.', 'Undo', () => restoreDraft(before));
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'text-button';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (it.kind === 'Checkpoint') {
        writeJSON(KEYS.checkpoints, readJSON(KEYS.checkpoints, []).filter((c) => c.at !== it.at));
      } else {
        try {
          const res = await fetch(API.versions, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id }) });
          if (!res.ok) throw new Error();
          serverVersions = serverVersions.filter((v) => v.id !== it.id);
        } catch (ex) { showToast('Could not delete that version'); return; }
      }
      renderHistory();
    });
    head.append(label, count, preview, restore, del);
    li.append(head, detail);
    list.appendChild(li);
  });
}

async function loadVersions() {
  try {
    const res = await fetch(API.versions, { cache: 'no-store' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Could not load versions');
    serverVersions = out.versions;
  } catch (ex) { showToast(ex.message === 'Failed to fetch' ? 'Cannot reach the server.' : ex.message); }
  renderHistory();
}

$('#btn-history').addEventListener('click', () => {
  renderHistory();
  historyOverlay.classList.remove('is-closing');
  historyOverlay.hidden = false;
  loadVersions();
});

let clearTimer = null;
$('#history-clear').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = 'Click again to confirm';
    clearTimer = setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Clear all history'; }, 4000);
    return;
  }
  clearTimeout(clearTimer);
  delete btn.dataset.armed;
  btn.textContent = 'Clear all history';
  btn.disabled = true;
  writeJSON(KEYS.checkpoints, []);
  try {
    const res = await fetch(API.versions, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) });
    if (!res.ok) throw new Error();
    serverVersions = [];
    showToast('History cleared');
  } catch (ex) { showToast('Checkpoints cleared. Server versions could not be.'); }
  btn.disabled = false;
  renderHistory();
});

// Wiring
[[publishOverlay, '#publish-close, #publish-cancel'], [historyOverlay, '#history-close']].forEach(([ov, sel]) => {
  ov.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => hideAnimated(ov)));
  ov.addEventListener('click', (e) => { if (e.target === ov) hideAnimated(ov); });
});
$('#btn-save').addEventListener('click', saveCheckpoint);
$('#btn-apply').addEventListener('click', openPublishDialog);
$('#btn-preview').addEventListener('click', () => setPreview(true));
$('#preview-exit').addEventListener('click', () => setPreview(false));
$('#btn-discard').addEventListener('click', () => {
  const before = snapshot();
  restoreDraft({ tasks: publishedTasks.map((t) => t.toJSON()), announcements: publishedAnnouncements });
  showToast('Draft reset to published', 'Undo', () => restoreDraft(before));
});

// Duplicate (task dialog)
dialogDuplicate.addEventListener('click', () => {
  if (!currentTask || !isEditable(currentTask)) return;
  const source = currentTask;
  closeTaskDialog();
  const copy = Task.fromJSON({ ...source.toJSON(), id: undefined, title: `${source.title} (copy)` });
  myTasks.push(copy);
  justChangedId = copy.id;
  saveTasks();
  renderAllTasks();
  openTaskDialog(copy);
});

// Shortcuts: Ctrl/Cmd+S = checkpoint, Ctrl/Cmd+Enter = apply
document.addEventListener('keydown', (e) => {
  if (!isAdmin || !(e.metaKey || e.ctrlKey)) return;
  const typing = e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]');
  if (e.key.toLowerCase() === 's') { e.preventDefault(); saveCheckpoint(); }
  if (e.key === 'Enter' && !typing && dialogOverlay.hidden && quickOverlay.hidden) { e.preventDefault(); openPublishDialog(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!publishOverlay.hidden) hideAnimated(publishOverlay);
  else if (!historyOverlay.hidden) hideAnimated(historyOverlay);
});

// --- Initialization ---
function renderAllTasks() {
  if (isAdmin) {
    const diff = diffDraft();
    changedIds = diff.changed;
    updateAdminBar(diff);
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
  renderCalendar();
  updateOverview();
  if (staggerNext) {
    document.querySelectorAll('.kanban-board .task-card, .task-list .task-row').forEach((el, i) => {
      el.classList.add('is-entering');
      el.style.animationDelay = `${Math.min(i, 8) * 40}ms`;
    });
    staggerNext = false;
  }
  justChangedId = null;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function init() {
  loadTasks();
  renderAnnouncements();
  ['class', 'admin'].forEach((scope) => {
    let v = null;
    try { v = localStorage.getItem(VIEW_KEYS[scope]); } catch (e) {}
    setView(scope, v === 'list' || v === 'board' ? v : VIEW_DEFAULTS[scope], false);
  });
  showSkeletons();
  staggerNext = true;
  loadPublished();
  setInterval(loadPublished, 300000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadPublished(); });

  if (typeof lucide !== 'undefined') lucide.createIcons();

  setPage(window.location.hash.slice(1) || 'class-tasks', false);

  // Time-based overdue: re-render each minute unless something is open
  setInterval(() => {
    const popoverOpen = statusPopoverEl && !statusPopoverEl.hidden;
    if (document.hidden || popoverOpen || !dialogOverlay.hidden || !quickOverlay.hidden) return;
    renderAllTasks();
  }, 60000);
}

async function start() {
  isAdmin = await checkAdmin();
  document.querySelector('#nav-admin').hidden = !isAdmin;
  init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}