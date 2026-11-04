// js/publish.js - the admin draft, publish and history (app.js split, slice 2.5).
//
// Moved verbatim out of app.js: the admin block - snapshot, describeDiff, diffDraft, updateAdminBar,
// restoreDraft, saveCheckpoint, setPreview, the clear-board phrase helpers (CLEAR_PHRASE,
// isClearBoardPublish, clearPhraseOk), syncPublishClear, openPublishDialog, the publish POST,
// renderHistory, loadVersions, and the listeners for the publish and history overlays, the
// Save/Apply/Preview/Discard buttons, Ctrl/Cmd+S, Ctrl/Cmd+Enter and Escape.
//
// Preserved exactly, per the slice brief:
//   - localStorage: class_tasks_checkpoints (a checkpoint is { at, ...snapshot() }, newest 20),
//     class_tasks_published_cache (the normalised board a publish writes back) and, through
//     app.js's saveTasks, class_tasks_progress and class_tasks_draft.
//   - the publish request: POST api/publish.php, Content-Type: application/json, body
//     { ...snapshot(), note } or, in clear-board mode, { tasks: [], announcements: [], note,
//     clearBoard: { confirm: CLEAR_PHRASE, expectedCount } }; the response is normalised and
//     written to the published cache before setPublished.
//   - the version list: GET api/versions.php with cache: 'no-store'; a delete is POST
//     api/versions.php { id } and clear-all is POST api/versions.php { all: true }.
//   - the history overlay markup and wording (Checkpoint / Published rows, the fmtWhen timestamp,
//     'No saved versions yet.', Restore, Delete, the two-click 'Click again to confirm' clear
//     button) and the publish dialog's summary wording, clear-board warning and error text.
//   - the admin gating: updateAdminBar, the Ctrl/Cmd+S and Ctrl/Cmd+Enter shortcuts and the
//     Publish/Apply entry points all still check state.isAdmin.
//
// The task dialog's Duplicate handler is not part of this region and stays in app.js, as does the
// one-time #announce-admin move next to the auth block.
//
// D6: this module never imports logic.js and never reads a bare global. Task (logic.js),
// normalizeBoard, setPublished, applyProgress, saveTasks, renderAllTasks, renderAnnouncements,
// showToast, hideAnimated, myTasks and app.js's $ shorthand arrive through init(deps); nav.setPage
// arrives as setPage. state and dom are module imports; readJSON, writeJSON, KEYS, API and fmtWhen
// come from util.js.
//
// init() runs at the position where the region's first listener used to be registered, so the
// page's document/element listener order is unchanged: the note-tool and announce handlers above,
// then this region's element listeners and the shortcuts/Escape handlers, then settings, tour, the
// transfer/import listeners and the focus trap. Every other region line is a declaration and keeps
// its place; the listener blocks are the only lines that moved, to the bottom of init, and they are
// byte-identical.
//
// Importing this module touches nothing: no DOM read, no listener, no state read and no timer at
// evaluation time, so
//   node --input-type=module -e "await import('./js/publish.js')"
// is clean under plain Node (docs/p6-architecture-findings.md 4-5, DECISIONS.md D6).

import { state } from './state.js';
import { dom } from './dom.js';
import { readJSON, writeJSON, KEYS, API, fmtWhen } from './util.js';

let $ = null;                   // app.js: its querySelector shorthand
let myTasks = null;             // app.js: the live draft array, mutated in place by restoreDraft
let showToast = null;           // app.js: every message, the 'Undo' label and its action
let hideAnimated = null;        // app.js: the publish and history overlays close animated
let saveTasks = null;           // app.js: persists progress and the draft after a restore
let renderAllTasks = null;      // app.js: re-renders the board after a preview, restore or publish
let renderAnnouncements = null; // js/announcements.js: the same, for the announcement list
let applyProgress = null;       // app.js: restoreDraft re-applies the saved statuses
let normalizeBoard = null;      // app.js: the publish response is normalised before setPublished
let setPublished = null;        // app.js: the live board is replaced after a publish
let Task = null;                // logic.js: restoreDraft rebuilds each task through Task.fromJSON
let setPage = null;             // nav.setPage: setPreview(true) switches to the Class tasks page
// --- Admin: diff, checkpoints, publish, history, import/export, preview ---

export const snapshot = () => ({ tasks: myTasks.map((t) => t.toJSON()), announcements: JSON.parse(JSON.stringify(state.announcements)) });
const describeDiff = (d) => [d.added && `${d.added} added`, d.edited && `${d.edited} edited`, d.removed && `${d.removed} removed`, d.ann && 'announcements changed'].filter(Boolean).join(', ') || 'No changes';

export function diffDraft() {
  const defs = (list) => new Map(list.map((t) => [t.id, JSON.stringify(t.toJSON())]));
  const pub = defs(state.publishedTasks);
  const cur = defs(myTasks);
  const changed = new Set();
  let added = 0, edited = 0, removed = 0;
  cur.forEach((json, id) => {
    if (!pub.has(id)) { added++; changed.add(id); }
    else if (pub.get(id) !== json) { edited++; changed.add(id); }
  });
  pub.forEach((_, id) => { if (!cur.has(id)) removed++; });
  const ann = JSON.stringify(state.announcements) !== JSON.stringify(state.publishedAnnouncements);
  return { added, edited, removed, ann, changed, total: added + edited + removed + (ann ? 1 : 0) };
}

export function updateAdminBar(diff) {
  if (!state.isAdmin) return;
  $('#admin-status').textContent = [
    diff.total ? `Unpublished changes: ${diff.total}` : 'No unpublished changes',
    state.lastSavedAt && `Saved ${new Date(state.lastSavedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
  ].filter(Boolean).join(' · ');
  $('#btn-apply').disabled = !diff.total;
  $('#btn-discard').disabled = !diff.total;
}

export function restoreDraft(snap) {
  myTasks.length = 0;
  (snap.tasks || []).forEach((o) => myTasks.push(Task.fromJSON(o)));
  state.announcements = snap.announcements ? JSON.parse(JSON.stringify(snap.announcements)) : [];
  applyProgress(myTasks);
  saveTasks();
  renderAllTasks();
  renderAnnouncements();
}

function saveCheckpoint() {
  const list = readJSON(KEYS.checkpoints, []);
  list.unshift({ at: Date.now(), ...snapshot() });
  if (!writeJSON(KEYS.checkpoints, list.slice(0, 20))) { showToast('Storage is full. Checkpoint not saved.'); return; }
  state.lastSavedAt = Date.now();
  updateAdminBar(diffDraft());
  showToast('Checkpoint saved');
}

export function setPreview(on) {
  state.previewing = on;
  $('#preview-banner').hidden = !on;
  if (on) setPage('class-tasks');
  renderAllTasks();
  renderAnnouncements();
}

// Clear-board mode: the draft has no tasks but the live board does. Publishing then needs the typed phrase, and the request carries an explicit clearBoard intent (the server refuses a bare empty publish).
const CLEAR_PHRASE = 'CLEAR BOARD';
const isClearBoardPublish = () => myTasks.length === 0 && state.publishedTasks.length > 0;
const clearPhraseOk = () => $('#publish-clear-input').value.trim() === CLEAR_PHRASE;
function syncPublishClear() {
  const clear = isClearBoardPublish();
  $('#publish-clear-warning').hidden = !clear;
  $('#publish-clear').hidden = !clear;
  $('#publish-submit').disabled = clear && !clearPhraseOk();
}

function openPublishDialog() {
  const d = diffDraft();
  if (!d.total) { showToast('Nothing to publish'); return; }
  const undated = myTasks.filter((t) => !t.dueDate).length;
  const n = state.publishedTasks.length;
  $('#publish-summary').textContent = isClearBoardPublish()
    ? `This removes all ${n} published assignment${n === 1 ? '' : 's'} from the class board.` + (d.ann ? ' Announcement changes stay unpublished.' : '')
    : `${describeDiff(d)}.` + (undated ? ` ${undated} task${undated === 1 ? ' has' : 's have'} no due date.` : '');
  $('#publish-note').value = '';
  $('#publish-clear-input').value = '';
  $('#publish-error').hidden = true;
  syncPublishClear();
  dom.publishOverlay._returnFocus = document.activeElement;
  dom.publishOverlay.classList.remove('is-closing');
  dom.publishOverlay.hidden = false;
  $('#publish-note').focus();
}

// History
function renderHistory() {
  const list = $('#history-list');
  const items = [
    ...readJSON(KEYS.checkpoints, []).map((c) => ({ kind: 'Checkpoint', at: c.at, snap: c })),
    ...state.serverVersions.map((v) => ({ kind: 'Published', at: v.publishedAt * 1000, note: v.note, snap: v, id: v.id })),
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
      hideAnimated(dom.historyOverlay);
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
          state.serverVersions = state.serverVersions.filter((v) => v.id !== it.id);
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
    state.serverVersions = out.versions;
  } catch (ex) { showToast(ex.message === 'Failed to fetch' ? 'Cannot reach the server.' : ex.message); }
  renderHistory();
}

// Called once by app.js, at the spot the moved listeners used to occupy.
export function init(deps) {
  $ = deps.$;
  myTasks = deps.myTasks;
  showToast = deps.showToast;
  hideAnimated = deps.hideAnimated;
  saveTasks = deps.saveTasks;
  renderAllTasks = deps.renderAllTasks;
  renderAnnouncements = deps.renderAnnouncements;
  applyProgress = deps.applyProgress;
  normalizeBoard = deps.normalizeBoard;
  setPublished = deps.setPublished;
  Task = deps.Task;
  setPage = deps.setPage;
$('#publish-clear-input').addEventListener('input', syncPublishClear);

$('#publish-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#publish-submit');
  const err = $('#publish-error');
  const clearing = isClearBoardPublish();
  if (clearing && !clearPhraseOk()) { err.textContent = `Type ${CLEAR_PHRASE} exactly to confirm.`; err.hidden = false; return; }
  btn.disabled = true;
  btn.classList.add('is-loading');
  err.hidden = true;
  try {
    const note = $('#publish-note').value.trim();
    const body = clearing
      ? { tasks: [], announcements: [], note, clearBoard: { confirm: CLEAR_PHRASE, expectedCount: state.publishedTasks.length } }
      : { ...snapshot(), note };
    const res = await fetch(API.publish, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Publish failed');
    const board = normalizeBoard(out.current);
    if (!board) throw new Error('Published, but the response was unreadable. Reload to check.');
    writeJSON(KEYS.cache, board);
    setPublished(board);
    hideAnimated(dom.publishOverlay);
    renderAllTasks();
    renderAnnouncements();
    showToast('Published');
  } catch (ex) {
    err.textContent = ex.message === 'Failed to fetch' ? 'Cannot reach the server.' : ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = clearing && !clearPhraseOk();
    btn.classList.remove('is-loading');
  }
});

$('#btn-history').addEventListener('click', () => {
  renderHistory();
  dom.historyOverlay._returnFocus = document.activeElement;
  dom.historyOverlay.classList.remove('is-closing');
  dom.historyOverlay.hidden = false;
  $('#history-close').focus();
  loadVersions();
});

$('#history-clear').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = 'Click again to confirm';
    state.clearTimer = setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Clear all history'; }, 4000);
    return;
  }
  clearTimeout(state.clearTimer);
  delete btn.dataset.armed;
  btn.textContent = 'Clear all history';
  btn.disabled = true;
  writeJSON(KEYS.checkpoints, []);
  try {
    const res = await fetch(API.versions, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) });
    if (!res.ok) throw new Error();
    state.serverVersions = [];
    showToast('History cleared');
  } catch (ex) { showToast('Checkpoints cleared. Server versions could not be.'); }
  btn.disabled = false;
  renderHistory();
});

// Wiring
[[dom.publishOverlay, '#publish-close, #publish-cancel'], [dom.historyOverlay, '#history-close']].forEach(([ov, sel]) => {
  ov.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => hideAnimated(ov)));
  ov.addEventListener('click', (e) => { if (e.target === ov) hideAnimated(ov); });
});
$('#btn-save').addEventListener('click', saveCheckpoint);
$('#btn-apply').addEventListener('click', openPublishDialog);
$('#btn-preview').addEventListener('click', () => setPreview(true));
$('#preview-exit').addEventListener('click', () => setPreview(false));
$('#btn-discard').addEventListener('click', () => {
  const before = snapshot();
  restoreDraft({ tasks: state.publishedTasks.map((t) => t.toJSON()), announcements: state.publishedAnnouncements });
  showToast('Draft reset to published', 'Undo', () => restoreDraft(before));
});

// Shortcuts: Ctrl/Cmd+S = checkpoint, Ctrl/Cmd+Enter = apply
document.addEventListener('keydown', (e) => {
  if (!state.isAdmin || !(e.metaKey || e.ctrlKey)) return;
  const typing = e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]');
  if (e.key.toLowerCase() === 's') { e.preventDefault(); saveCheckpoint(); }
  if (e.key === 'Enter' && !typing && dom.dialogOverlay.hidden && dom.quickOverlay.hidden && dom.tourOverlay.hidden) { e.preventDefault(); openPublishDialog(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!dom.publishOverlay.hidden) hideAnimated(dom.publishOverlay);
  else if (!dom.historyOverlay.hidden) hideAnimated(dom.historyOverlay);
});
}
