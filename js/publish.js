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
import { validateSubjects, catalogSignature } from './subjects.js';
import { prepareRecoveredDraft } from './recovery.js';
import { openOverlay } from './motion.js';

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
let acceptAuthority = null;     // app.js: adopts a returned board's revision and deletion markers
let catalog = null;             // app.js: the draft subject catalogue and its operation ids
let archive = null;             // app.js: archive-first, so a replacement never loses a draft copy
let syncCatalog = null;         // app.js: a restored catalogue must repaint tags and pickers
let setPage = null;             // nav.setPage: setPreview(true) switches to the Class tasks page
let adoptInlineImages = null;   // js/note-images.js: publish moves inline note images to uploads/
let rewriteNotes = null;        // js/note-images.js: the same rewrite for the in-memory draft
let files = null;               // app.js: window.TTFiles, the upload client
// --- Admin: diff, checkpoints, publish, history, import/export, preview ---

// The draft content, including its catalogue, in the one shape checkpoints, restore, discard and
// transfer all share. It carries no authority: a base revision in a snapshot is history, never a
// licence to write.
export const snapshot = () => ({
  schemaVersion: 2,
  tasks: myTasks.map((t) => t.toJSON()),
  announcements: JSON.parse(JSON.stringify(state.announcements)),
  subjects: JSON.parse(JSON.stringify(state.draftSubjects)),
});
const describeDiff = (d) => [
  d.added && `${d.added} added`,
  d.edited && `${d.edited} edited`,
  d.removed && `${d.removed} removed`,
  d.ann && 'announcements changed',
  d.subjectsChanged && 'subjects changed',
].filter(Boolean).join(', ') || 'No changes';

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
  // A catalogue-only edit is a real unpublished change: a rename, a recolour or a retire must
  // enable Publish even when not a single task moved.
  const publishedCatalog = state.liveBoard && Array.isArray(state.liveBoard.subjects) ? state.liveBoard.subjects : [];
  const subjectsChanged = catalogSignature(state.draftSubjects) !== catalogSignature(publishedCatalog);
  return {
    added, edited, removed, ann, subjectsChanged, changed,
    total: added + edited + removed + (ann ? 1 : 0) + (subjectsChanged ? 1 : 0),
  };
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

// One path for history, checkpoints, discard and their Undo. The replacement's own catalogue and
// base are never adopted: the receiver keeps its publishing base and its authority.
// Before anything is replaced, a draft-only definition that would otherwise lose its last copy is
// archived. If that archive fails, the draft is left exactly as it was.
export async function restoreDraft(snap) {
  const incoming = Array.isArray(snap && snap.tasks) ? snap.tasks : [];
  const keep = new Set(incoming.map((t) => String(t && t.id)));
  const publishedIds = new Set(state.publishedTasks.map((t) => String(t.id)));
  const onlyHere = myTasks.filter((t) => !keep.has(String(t.id)) && !publishedIds.has(String(t.id)));
  if (onlyHere.length && typeof archive !== 'function') {
    showToast('The recycle bin is unavailable, so the draft was left unchanged.');
    return false;
  }
  for (const task of onlyHere) {
    const archived = await archive(task);
    if (!archived || !archived.ok) {
      showToast('Could not save a draft-only task to the recycle bin, so the draft was left unchanged.');
      return false;
    }
  }

  // A permanently deleted id may not come back as itself from any source - a checkpoint, a history
  // version, a transfer or an Undo. It returns as a clearly labelled new copy, with no progress.
  const prepared = prepareRecoveredDraft(
    { tasks: incoming },
    state.verifiedDeletedIds,
    () => (crypto.randomUUID ? crypto.randomUUID() : newIntentId()),
  );
  myTasks.length = 0;
  prepared.content.tasks.forEach((o) => myTasks.push(Task.fromJSON(o)));
  if (prepared.recovered.length) {
    showToast(prepared.recovered.length === 1
      ? 'Restored one task as a new copy: its old id was permanently deleted.'
      : `Restored ${prepared.recovered.length} tasks as new copies: their old ids were permanently deleted.`);
  }
  state.announcements = snap.announcements ? JSON.parse(JSON.stringify(snap.announcements)) : [];
  if (Array.isArray(snap.subjects) && snap.subjects.length) {
    const checked = validateSubjects(snap.subjects);
    if (!checked.error) { state.draftSubjects = checked.subjects; syncCatalog(checked.subjects); }
  }
  applyProgress(myTasks);
  saveTasks();
  renderAllTasks();
  renderAnnouncements();
  return true;
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
    ? `This removes all ${n} published task${n === 1 ? '' : 's'} from the class board.` + (d.ann ? ' Announcement changes stay unpublished.' : '')
    : `${describeDiff(d)}.` + (undated ? ` ${undated} task${undated === 1 ? ' has' : 's have'} no due date.` : '');
  $('#publish-note').value = '';
  $('#publish-clear-input').value = '';
  $('#publish-error').hidden = true;
  syncPublishClear();
  dom.publishOverlay._returnFocus = document.activeElement;
  openOverlay(dom.publishOverlay);
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
      showToast('Restored to draft. Nothing is live until you publish.', 'Undo', () => restoreDraft(before));
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
// One stable intent id per user action: a transport retry repeats it, so the server can tell a
// replay from a second edit.
const newIntentId = () => (crypto.randomUUID
  ? crypto.randomUUID().replace(/-/g, '')
  : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''));

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
  acceptAuthority = deps.acceptAuthority || null;
  catalog = deps.catalog || null;
  archive = deps.archive || null;
  syncCatalog = deps.syncCatalog || null;
  setPage = deps.setPage;
  adoptInlineImages = deps.adoptInlineImages;
  rewriteNotes = deps.rewriteNotes;
  files = deps.files;
$('#publish-clear-input').addEventListener('input', syncPublishClear);
// Explicit review step for a refused stale publish: adopting the newer board is the admin's
// decision, and it only moves the publishing base - it never edits or replaces the draft.
$('#publish-rebase').addEventListener('click', async () => {
  const newer = state.conflictBoard;
  if (!newer) return;
  state.conflictBoard = null;
  $('#publish-conflict').hidden = true;
  $('#publish-error').hidden = true;
  // A refused response is evidence that the write lost, not authority: re-read the board with a
  // fresh successful request and adopt only that. A failure body could otherwise smuggle markers in.
  let fresh = null;
  try {
    const res = await fetch(API.current, { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
    if (res.ok) fresh = await res.json();
  } catch (e) { fresh = null; }
  const board = normalizeBoard(fresh);
  if (!board || !acceptAuthority(board)) {
    $('#publish-error').textContent = 'That newer board could not be adopted. Reload the page.';
    $('#publish-error').hidden = false;
    return;
  }
  writeJSON(KEYS.cache, board);
  setPublished(board);
  updateAdminBar(diffDraft());
  showToast('Now publishing over the newer board. Review your draft, then publish again.');
  $('#publish-submit').focus();
});

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
    let body;
    if (clearing) {
      body = { tasks: [], announcements: [], note, clearBoard: { confirm: CLEAR_PHRASE, expectedCount: state.publishedTasks.length } };
    } else {
      const snap = snapshot();
      // Inline note images are board weight: move each one to uploads/ before the board is sent, so
      // the shared JSON stays kilobytes instead of megabytes. Throws (and the dialog shows why)
      // rather than publishing a board that carries the image bytes.
      const adopted = await adoptInlineImages(snap.tasks, files);
      if (adopted.count) {
        snap.tasks = adopted.tasks;
        // The draft must drop the bytes too, or the next publish uploads the same images again.
        myTasks.forEach((t) => { if (t.notes) t.notes = rewriteNotes(t.notes, adopted.map); });
        saveTasks();
      }
      body = { ...snap, note };
    }
    // One intent id for this publish, held across a transport retry; the base is the revision this
    // editor actually reviewed, so the server can refuse a stale write instead of overwriting it.
    const unknown = catalog && catalog.unknownFor ? catalog.unknownFor(body.tasks) : [];
    if (unknown.length) {
      throw new Error(`These subjects are not configured: ${unknown.join(', ')}. Add them to the catalogue before publishing.`);
    }
    body = {
      schemaVersion: 2,
      operationId: catalog && catalog.newOperationId ? catalog.newOperationId() : newIntentId(),
      baseRevision: state.verifiedRevision,
      subjects: catalog ? catalog.forPublish(body.tasks) : [],
      ...body,
    };
    const sentFingerprint = JSON.stringify(snapshot());
    const res = await fetch(API.publish, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Post-commit is not "nothing changed": say what actually happened.
      if (out.code === 'committed_recovery_pending') throw new Error(out.error || 'Published, but the archive is still settling. Reload.');
      // A stale write is refused, never retried blindly or rebased silently: keep the draft and let
      // the admin review the newer board before publishing over it.
      if (out.code === 'stale_base') {
        state.conflictBoard = out.current || null;
        const newer = out.current || {};
        const live = Array.isArray(newer.tasks) ? newer.tasks.length : null;
        $('#publish-conflict-text').textContent =
          `The class board changed since you opened this draft (${live === null ? 'unknown' : live} live task(s), revision ${newer.revision ?? '?'}). Nothing was published. Review the newer board, then choose whether to publish your draft over it.`;
        $('#publish-conflict').hidden = false;
        $('#publish-rebase').focus();
        throw new Error(`${out.error || 'The board changed since you loaded it.'} Your draft is unchanged.`);
      }
      throw new Error(out.error || 'Publish failed');
    }
    const board = normalizeBoard(out.current);
    if (!board) throw new Error('Published, but the response was unreadable. Reload to check.');
    writeJSON(KEYS.cache, board);
    // A successful publish is authoritative: adopt its revision and markers, then erase progress
    // the server proved deleted (a publish may carry a permanent-deletion marker).
    if (typeof acceptAuthority === 'function') acceptAuthority(board);
    setPublished(board);
    hideAnimated(dom.publishOverlay);
    renderAllTasks();
    renderAnnouncements();
    // Editing while the request was in flight is legitimate; those edits stay unpublished, and the
    // toast must not claim they went out with this publish.
    if (JSON.stringify(snapshot()) !== sentFingerprint) showToast('Published. Your newer edits are still unpublished.');
    else showToast('Published');
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
  openOverlay(dom.historyOverlay);
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
  restoreDraft({
    tasks: state.publishedTasks.map((t) => t.toJSON()),
    announcements: state.publishedAnnouncements,
    subjects: state.liveBoard && Array.isArray(state.liveBoard.subjects) ? state.liveBoard.subjects : [],
  });
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
