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
let canonicalSchedule = null;
let validateSchedule = null;
let renderScheduleEditor = null;
let renderScheduleView = null;

let lastSavedAt = null;
let serverVersions = [];
let clearTimer = null;
let conflictBoard = null;

export function createPublishIntent(makeId = newOperationId) {
  let pending = null;
  return {
    operationIdFor(key) {
      if (pending && pending.key === key) return pending.operationId;
      pending = { key, operationId: makeId() };
      return pending.operationId;
    },
    clear() {
      pending = null;
    },
  };
}

const publishIntent = createPublishIntent();

function fallbackCanonicalSchedule(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.slots)) return null;
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const slots = raw.slots
    .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
    .map((x) => {
      const kind = x.kind || (x.subject ? 'subject' : 'activity');
      const out = { day: x.day, start: x.start, end: x.end, kind };
      if (kind === 'subject') out.subject = x.subject;
      else out.label = str(x.label);
      if (str(x.teacher)) out.teacher = str(x.teacher);
      return out;
    })
    .sort((a, b) => (a.day - b.day) || String(a.start).localeCompare(String(b.start)) || String(a.end).localeCompare(String(b.end)));
  return {
    term: str(raw.term),
    sectionLabel: str(raw.sectionLabel),
    adviser: str(raw.adviser),
    room: str(raw.room),
    slots,
  };
}

const scheduleSig = (s) => JSON.stringify((canonicalSchedule || fallbackCanonicalSchedule)(s));

export const snapshot = () => ({
  schemaVersion: 2,
  tasks: myTasks.map((t) => t.toJSON()),
  announcements: JSON.parse(JSON.stringify(state.announcements)),
  subjects: JSON.parse(JSON.stringify(state.draftSubjects)),
  schedule: state.draftSchedule ? JSON.parse(JSON.stringify(state.draftSchedule)) : null,
});
const describeDiff = (d) => [
  d.added && `${d.added} added`,
  d.edited && `${d.edited} edited`,
  d.removed && `${d.removed} removed`,
  d.ann && 'announcements changed',
  d.subjectsChanged && 'subjects changed',
  d.scheduleChanged && 'schedule changed',
].filter(Boolean).join(', ') || 'No changes';

export function computePublishDiff(pubBoard, draftSnap, opts = {}) {
  const pubList = Array.isArray(pubBoard?.tasks) ? pubBoard.tasks : [];
  const draftList = opts.clearBoard ? [] : (Array.isArray(draftSnap?.tasks) ? draftSnap.tasks : []);
  const pubMap = new Map(pubList.map((t) => [String(t.id), t]));
  const draftMap = new Map(draftList.map((t) => [String(t.id), t]));
  const added = [];
  const edited = [];
  const removed = [];

  for (const dt of draftList) {
    const id = String(dt.id);
    const pt = pubMap.get(id);
    if (!pt) {
      added.push({ id, title: dt.title || '', subject: dt.subject || '' });
      continue;
    }
    const fields = [];
    if ((pt.title || '') !== (dt.title || '')) fields.push('title');
    if ((pt.subject || '') !== (dt.subject || '')) fields.push('subject');
    if ((pt.dueDate || '') !== (dt.dueDate || '') || (pt.endDate || '') !== (dt.endDate || '') || (pt.dueTime || '') !== (dt.dueTime || '')) {
      fields.push('due date');
    }
    if ((pt.notes || '') !== (dt.notes || '')) fields.push('notes');
    if (JSON.stringify(pt.files || []) !== JSON.stringify(dt.files || [])) fields.push('files');
    if ((pt.closedAt || 0) !== (dt.closedAt || 0)) fields.push('archive state');
    if (fields.length) edited.push({ id, title: dt.title || pt.title || '', subject: dt.subject || '', fields });
  }
  for (const pt of pubList) {
    const id = String(pt.id);
    if (!draftMap.has(id)) removed.push({ id, title: pt.title || '', subject: pt.subject || '' });
  }

  const pubAnn = Array.isArray(pubBoard?.announcements) ? pubBoard.announcements : [];
  const draftAnn = Array.isArray(draftSnap?.announcements) ? draftSnap.announcements : [];
  const pubAnnMap = new Map(pubAnn.map((a) => [String(a.id), a]));
  const draftAnnMap = new Map(draftAnn.map((a) => [String(a.id), a]));
  const annChanged = !opts.clearBoard && JSON.stringify(pubAnn) !== JSON.stringify(draftAnn);
  const annAdded = opts.clearBoard ? [] : draftAnn.filter((a) => !pubAnnMap.has(String(a.id))).map((a) => a.text || '');
  const annRemoved = opts.clearBoard ? [] : pubAnn.filter((a) => !draftAnnMap.has(String(a.id))).map((a) => a.text || '');

  const pubSubs = Array.isArray(pubBoard?.subjects) ? pubBoard.subjects : [];
  const draftSubs = opts.clearBoard ? pubSubs : (Array.isArray(draftSnap?.subjects) ? draftSnap.subjects : []);
  const pubSubMap = new Map(pubSubs.map((s) => [s.code, s]));
  const draftSubMap = new Map(draftSubs.map((s) => [s.code, s]));
  const subChanges = { added: [], updated: [], retired: [], restored: [], removed: [] };
  if (!opts.clearBoard) {
    for (const s of draftSubs) {
      const prev = pubSubMap.get(s.code);
      if (!prev) subChanges.added.push(s.code);
      else {
        if (prev.name !== s.name || String(prev.color || '').toLowerCase() !== String(s.color || '').toLowerCase()) subChanges.updated.push(s.code);
        if (prev.active !== false && s.active === false) subChanges.retired.push(s.code);
        else if (prev.active === false && s.active !== false) subChanges.restored.push(s.code);
      }
    }
    for (const s of pubSubs) {
      if (!draftSubMap.has(s.code)) subChanges.removed.push(s.code);
    }
  }

  const canonFn = opts.canonicalSchedule || canonicalSchedule || fallbackCanonicalSchedule;
  const pubSched = canonFn(pubBoard && pubBoard.schedule);
  const draftSched = canonFn(draftSnap && draftSnap.schedule);
  const schedChanged = !opts.clearBoard && JSON.stringify(pubSched) !== JSON.stringify(draftSched);
  const schedAction = !schedChanged ? 'none' : (!pubSched && draftSched ? 'added' : (pubSched && !draftSched ? 'cleared' : 'updated'));
  const scheduleDiff = {
    changed: schedChanged,
    action: schedAction,
    slotCount: draftSched && Array.isArray(draftSched.slots) ? draftSched.slots.length : 0,
  };

  return {
    added,
    edited,
    removed,
    announcements: { changed: annChanged, added: annAdded, removed: annRemoved, liveCount: pubAnn.length, draftCount: draftAnn.length },
    subjects: subChanges,
    schedule: scheduleDiff,
  };
}

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

  const pubCat = state.liveBoard && Array.isArray(state.liveBoard.subjects) ? state.liveBoard.subjects : [];
  const subjectsChanged = catalogSignature(state.draftSubjects) !== catalogSignature(pubCat);
  const scheduleChanged = scheduleSig(state.draftSchedule) !== scheduleSig(state.publishedSchedule);
  return {
    added, edited, removed, ann, subjectsChanged, scheduleChanged, changed,
    total: added + edited + removed + (ann ? 1 : 0) + (subjectsChanged ? 1 : 0) + (scheduleChanged ? 1 : 0),
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
    validateSchedule, renderScheduleEditor, renderScheduleView,
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
  renderScheduleView?.();
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

function renderPublishDiff() {
  const host = $('#publish-diff');
  if (!host) return;
  host.replaceChildren();
  const clear = isClearBoardPublish();
  const pubBoard = {
    tasks: state.publishedTasks.map((t) => t.toJSON()),
    announcements: state.publishedAnnouncements,
    subjects: state.liveBoard && Array.isArray(state.liveBoard.subjects) ? state.liveBoard.subjects : [],
    schedule: state.publishedSchedule,
  };
  const d = computePublishDiff(pubBoard, snapshot(), { clearBoard: clear });
  const addGroup = (label, items, formatter) => {
    if (!items.length) return;
    const grp = document.createElement('div');
    grp.className = 'publish-diff-group';
    const h = document.createElement('p');
    h.className = 'publish-diff-title';
    h.textContent = `${label} (${items.length})`;
    const ul = document.createElement('ul');
    ul.className = 'publish-diff-list';
    items.forEach((item) => {
      const li = document.createElement('li');
      formatter(li, item);
      ul.appendChild(li);
    });
    grp.append(h, ul);
    host.appendChild(grp);
  };
  const taskLabel = (item) => (item.subject ? `${subjectDisplayName(state.catalog, item.subject)} · ` : '') + (item.title || 'Untitled');
  addGroup('Added tasks', d.added, (li, item) => { li.textContent = taskLabel(item); });
  addGroup('Edited tasks', d.edited, (li, item) => {
    li.append(document.createTextNode(taskLabel(item)));
    if (item.fields.length) {
      const meta = document.createElement('span');
      meta.className = 'publish-diff-meta';
      meta.textContent = ` — changed: ${item.fields.join(', ')}`;
      li.appendChild(meta);
    }
  });
  addGroup('Removed tasks', d.removed, (li, item) => { li.textContent = taskLabel(item); });
  if (d.announcements.changed) {
    const annRows = [];
    d.announcements.added.forEach((t) => annRows.push(`Added: ${t}`));
    d.announcements.removed.forEach((t) => annRows.push(`Removed: ${t}`));
    if (!annRows.length) annRows.push(`Updated pinned announcements (${d.announcements.draftCount} live after publish)`);
    addGroup('Announcements', annRows, (li, txt) => { li.textContent = txt; });
  }
  const subParts = [
    ...d.subjects.added.map((c) => `Added ${c}`),
    ...d.subjects.updated.map((c) => `Updated ${c}`),
    ...d.subjects.retired.map((c) => `Retired ${c}`),
    ...d.subjects.restored.map((c) => `Restored ${c}`),
    ...d.subjects.removed.map((c) => `Removed ${c}`),
  ];
  addGroup('Subjects', subParts, (li, txt) => { li.textContent = txt; });
  if (d.schedule && d.schedule.changed) {
    const msg = d.schedule.action === 'added'
      ? `Added class schedule (${d.schedule.slotCount} slot${d.schedule.slotCount === 1 ? '' : 's'})`
      : (d.schedule.action === 'cleared'
        ? 'Cleared class schedule'
        : `Updated class schedule (${d.schedule.slotCount} slot${d.schedule.slotCount === 1 ? '' : 's'})`);
    addGroup('Schedule', [msg], (li, txt) => { li.textContent = txt; });
  }
  host.hidden = host.children.length === 0;
}

function updatePublishPreview() {
  const d = diffDraft();
  const undated = myTasks.filter((t) => !t.dueDate).length;
  const n = state.publishedTasks.length;
  $('#publish-summary').textContent = isClearBoardPublish()
    ? `This removes all ${n} published task${n === 1 ? '' : 's'} from the class board.` + (d.ann ? ' Draft announcement changes stay unpublished until a normal publish.' : '')
    : `${describeDiff(d)}.` + (undated ? ` ${undated} task${undated === 1 ? ' has' : 's have'} no due date.` : '');
  renderPublishDiff();
  syncPublishClear();
}

function openPublishDialog() {
  const d = diffDraft();
  if (!d.total) { showToast('Nothing to publish'); return; }
  updatePublishPreview();
  $('#publish-note').value = '';
  $('#publish-clear-input').value = '';
  $('#publish-error').hidden = true;
  $('#publish-conflict').hidden = true;
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
    serverVersions = Array.isArray(out.versions) ? out.versions : [];
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
  canonicalSchedule = deps.canonicalSchedule || null;
  validateSchedule = deps.validateSchedule || null;
  renderScheduleEditor = deps.renderScheduleEditor || null;
  renderScheduleView = deps.renderScheduleView || null;
$('#publish-clear-input').addEventListener('input', syncPublishClear);

$('#publish-rebase').addEventListener('click', async () => {
  const newer = conflictBoard;
  if (!newer) return;
  conflictBoard = null;
  publishIntent.clear();
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
  updatePublishPreview();
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

    const unknown = catalog && catalog.unknownFor ? catalog.unknownFor(body.tasks, clearing ? null : body.schedule) : [];
    if (unknown.length) {
      throw new Error(`These subjects are not configured: ${unknown.join(', ')}. Add them to the catalogue before publishing.`);
    }
    const sentSubjects = body.subjects ?? (catalog ? catalog.forPublish(body.tasks) : []);
    const baseRevision = state.verifiedRevision;
    const intentKey = JSON.stringify({
      baseRevision,
      tasks: body.tasks,
      announcements: body.announcements,
      subjects: sentSubjects,
      schedule: clearing ? '__inherited__' : (body.schedule ?? null),
      note: body.note,
      clearBoard: body.clearBoard || null,
    });
    body = {
      schemaVersion: 2,
      operationId: publishIntent.operationIdFor(intentKey),
      baseRevision,
      ...body,
      subjects: sentSubjects,
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
        publishIntent.clear();
        conflictBoard = out.current || null;
        const newer = out.current || {};
        const live = Array.isArray(newer.tasks) ? newer.tasks.length : null;
        $('#publish-conflict-text').textContent =
          `The class board was updated elsewhere (${live === null ? 'task count unavailable' : `${live} live task${live === 1 ? '' : 's'}`}). Nothing was published. Review the newer board, then choose whether to publish your draft over it.`;
        $('#publish-conflict').hidden = false;
        $('#publish-rebase').focus();
        throw new Error(`${out.error || 'The board changed since you loaded it.'} Your draft is unchanged.`);
      }
      throw new Error(out.error || 'Publish failed');
    }
    publishIntent.clear();
    const board = normalizeBoard(out.current);
    if (!board) throw new Error('Published, but the response was unreadable. Reload to check.');
    writeJSON(KEYS.cache, board);

    const cleanMatch = JSON.stringify(snapshot()) === sentFingerprint;
    if (!clearing && cleanMatch) {
      state.hasDraftSchedule = false;
    }
    store.adoptAuthoritativeBoard(board, { onPersistError: () => showToast('Could not update saved progress on this device.') });
    setPublished(board);
    if (!clearing && cleanMatch) {
      saveTasks();
    }
    hideOverlay(dom.publishOverlay);
    renderAllTasks();
    renderAnnouncements();
    renderScheduleEditor?.();
    renderScheduleView?.();
    updateAdminBar(diffDraft());

    if (!cleanMatch) showToast('Published. Your newer edits are still unpublished.');
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
    schedule: state.publishedSchedule ? JSON.parse(JSON.stringify(state.publishedSchedule)) : null,
  });
  if (ok) {
    state.hasDraftSchedule = false;
    saveTasks();
    updateAdminBar(diffDraft());
    showToast('Draft reset to published', 'Undo', () => restoreDraft(before));
  }
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
