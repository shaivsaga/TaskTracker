import { state } from './state.js';
import { dom } from './dom.js';
import { readJSON, writeJSON, KEYS, API, fmtWhen } from './util.js';
import { catalogSignature, subjectDisplayName } from './subjects.js';
import { openOverlay, hideOverlay } from './motion.js';
import { store, normalizeBoard, newOperationId } from './store.js';

let $ = null;
let myTasks = null;
let showToast = null;
let armInlineConfirm = null;
let saveTasks = null;
let renderAllTasks = null;
let renderAnnouncements = null;
let applyProgress = null;
let setPublished = null;
let Task = null;
let catalog = null;
let syncCatalog = null;
let setPage = null;
let adoptInlineImages = null;
let rewriteNotes = null;
let files = null;

let lastSavedAt = null;
let serverVersions = [];
let clearTimer = null;
let conflictBoard = null;

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
    lastSavedAt && `Checkpoint ${new Date(lastSavedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
  ].filter(Boolean).join(' · ');
  $('#admin-bar').classList.toggle('is-clean', !diff.total);
  $('#btn-apply').disabled = !diff.total;
  const discard = $('#btn-discard');
  discard.disabled = !diff.total;
  if (!diff.total && discard.dataset.armed) {
    delete discard.dataset.armed;
    discard.textContent = 'Discard changes';
    discard.removeAttribute('aria-label');
  }
  const badge = $('#nav-badge');
  badge.textContent = diff.total ? String(diff.total) : '';
  badge.hidden = !diff.total;
  // The badge is part of the Admin tile's visible text (WCAG 2.5.3 label in name).
  $('#nav-admin').setAttribute('aria-label', diff.total ? `Admin, ${diff.total} unpublished ${diff.total === 1 ? 'change' : 'changes'}` : 'Admin');
}

export async function restoreDraft(snap) {
  const out = await store.replaceDraft(snap, {
    myTasks, Task, syncCatalog, applyProgress, saveTasks, renderAllTasks, renderAnnouncements, showToast,
  });
  return out.ok;
}

function saveCheckpoint() {
  const list = readJSON(KEYS.checkpoints, []);
  list.unshift({ at: Date.now(), ...snapshot() });
  if (!writeJSON(KEYS.checkpoints, list.slice(0, 20))) { showToast('Storage is full. Checkpoint not saved.'); return; }
  lastSavedAt = Date.now();
  updateAdminBar(diffDraft());
  if (!dom.historyOverlay.hidden) renderHistory();
  showToast('Checkpoint saved');
}

export function setPreview(on) {
  state.previewing = on;
  $('#preview-banner').hidden = !on;
  if (on) setPage('class-tasks');
  renderAllTasks();
  renderAnnouncements();
}

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
      d.textContent = (t.subject ? `${subjectDisplayName(state.catalog, t.subject)} · ` : '') + t.title;
      detail.appendChild(d);
    });
    preview.addEventListener('click', () => { detail.hidden = !detail.hidden; });
    restore.addEventListener('click', async () => {
      const before = snapshot();
      if (!(await restoreDraft(it.snap))) return;
      hideOverlay(dom.historyOverlay);
      showToast('Restored to draft. Nothing is live until you publish.', 'Undo', () => restoreDraft(before));
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'text-button is-danger';
    del.textContent = 'Delete';
    const runDelete = async () => {
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
    };
    if (armInlineConfirm) armInlineConfirm(del, 'Delete', 'Confirm deleting this version', runDelete);
    else del.addEventListener('click', runDelete);
    const actions = document.createElement('div');
    actions.className = 'history-actions';
    actions.append(preview, restore, del);
    head.append(label, count);
    li.append(head, actions, detail);
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

export function init(deps) {
  $ = deps.$;
  myTasks = deps.myTasks;
  showToast = deps.showToast;
  saveTasks = deps.saveTasks;
  renderAllTasks = deps.renderAllTasks;
  renderAnnouncements = deps.renderAnnouncements;
  applyProgress = deps.applyProgress;
  setPublished = deps.setPublished;
  Task = deps.Task;
  catalog = deps.catalog || null;
  syncCatalog = deps.syncCatalog || null;
  setPage = deps.setPage;
  adoptInlineImages = deps.adoptInlineImages;
  rewriteNotes = deps.rewriteNotes;
  files = deps.files;
  armInlineConfirm = deps.armInlineConfirm || null;
$('#publish-clear-input').addEventListener('input', syncPublishClear);

$('#publish-rebase').addEventListener('click', async () => {
  const newer = conflictBoard;
  if (!newer) return;
  conflictBoard = null;
  $('#publish-conflict').hidden = true;
  $('#publish-error').hidden = true;

  const { board, authoritative } = await store.fetchBoard({ fallbackToCache: false });
  if (!board || !authoritative) {
    $('#publish-error').textContent = 'That newer board could not be adopted. Reload the page.';
    $('#publish-error').hidden = false;
    return;
  }
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

      const adopted = await adoptInlineImages(snap.tasks, files);
      if (adopted.count) {
        snap.tasks = adopted.tasks;

        myTasks.forEach((t) => { if (t.notes) t.notes = rewriteNotes(t.notes, adopted.map); });
        saveTasks();
      }
      body = { ...snap, note };
    }

    const unknown = catalog && catalog.unknownFor ? catalog.unknownFor(body.tasks) : [];
    if (unknown.length) {
      throw new Error(`These subjects are not configured: ${unknown.join(', ')}. Add them to the catalogue before publishing.`);
    }
    body = {
      schemaVersion: 2,
      operationId: newOperationId(),
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

      if (out.code === 'committed_recovery_pending') throw new Error(out.error || 'Published, but the archive is still settling. Reload.');

      if (out.code === 'stale_base') {
        conflictBoard = out.current || null;
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

    store.adoptAuthoritativeBoard(board, { onPersistError: () => showToast('Could not update saved progress on this device.') });
    setPublished(board);
    hideOverlay(dom.publishOverlay);
    renderAllTasks();
    renderAnnouncements();

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

[[dom.publishOverlay, '#publish-close, #publish-cancel'], [dom.historyOverlay, '#history-close']].forEach(([ov, sel]) => {
  ov.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => hideOverlay(ov)));
  ov.addEventListener('click', (e) => { if (e.target === ov) hideOverlay(ov); });
});
$('#btn-save').addEventListener('click', saveCheckpoint);
$('#btn-apply').addEventListener('click', openPublishDialog);
$('#btn-preview').addEventListener('click', () => setPreview(true));
$('#preview-exit').addEventListener('click', () => setPreview(false));
const runDiscard = async () => {
  const before = snapshot();
  const ok = await restoreDraft({
    tasks: state.publishedTasks.map((t) => t.toJSON()),
    announcements: state.publishedAnnouncements,
    subjects: state.liveBoard && Array.isArray(state.liveBoard.subjects) ? state.liveBoard.subjects : [],
  });
  if (ok) showToast('Draft reset to published', 'Undo', () => restoreDraft(before));
};
if (armInlineConfirm) armInlineConfirm($('#btn-discard'), 'Discard changes', 'Confirm discarding unpublished changes', runDiscard);
else $('#btn-discard').addEventListener('click', runDiscard);

document.addEventListener('keydown', (e) => {
  if (!state.isAdmin || !(e.metaKey || e.ctrlKey)) return;
  const typing = e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]');
  if (e.key.toLowerCase() === 's') { e.preventDefault(); saveCheckpoint(); }
  if (e.key === 'Enter' && !typing && dom.dialogOverlay.hidden && dom.quickOverlay.hidden && dom.tourOverlay.hidden) { e.preventDefault(); openPublishDialog(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!dom.publishOverlay.hidden) hideOverlay(dom.publishOverlay);
  else if (!dom.historyOverlay.hidden) hideOverlay(dom.historyOverlay);
});
}
