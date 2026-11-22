import { state } from './state.js';
import { dom } from './dom.js';
import { plural, currentSection } from './util.js';
import { openOverlay, hideOverlay } from './motion.js';
import { filterDeletedProgress } from './recovery.js';

let $ = null;
let showToast = null;
let closeSettings = null;
let myTasks = null;
let applyProgress = null;
let saveTasks = null;
let renderAllTasks = null;
let snapshot = null;
let restoreDraft = null;
let mergeProgress = null;
let Task = null;
let taskIdOk = null;
let STATUS_ORDER = null;

let activeTransfer = null;
let transferTimer = null;
let transferBusy = false;
let transferQrOk = false;
let pendingImport = null;

const TRANSFER_API = 'transfer.php';
const TRANSFER_TOKEN_RE = /^[a-f0-9]{32}$/;

export function takeTransferToken() {
  try {
    const p = new URLSearchParams(location.search);
    if (!p.has('transfer')) return null;
    const t = p.get('transfer');
    p.delete('transfer');
    const q = p.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    return TRANSFER_TOKEN_RE.test(t || '') ? t : null;
  } catch (e) { return null; }
}

const transferHeaders = { 'Content-Type': 'application/json' };

export function buildTransferPayload(activeSection = currentSection() || 'a') {
  const payload = { v: 1, section: activeSection, progress: state.progress };
  if (state.isAdmin && myTasks) {

    const draft = {
      schemaVersion: 2,
      tasks: myTasks.map((t) => t.toJSON()),
      announcements: state.announcements,
      subjects: state.draftSubjects,
    };

    if (JSON.stringify(draft).length < 700000) payload.draft = draft;
  }
  return payload;
}

function transferUrl(token) {
  return location.origin + location.pathname.replace(/[^/]*$/, '') + '?transfer=' + token;
}

function setTransferView(view, message) {
  const ready = view === 'ready';
  $('#transfer-qr-frame').hidden = !ready || !transferQrOk;
  $('#transfer-link-row').hidden = !ready;
  $('#transfer-cancel-link').hidden = !ready;
  $('#transfer-new').hidden = !(view === 'expired' || view === 'cancelled' || view === 'error');
  $('#transfer-error').hidden = view !== 'error';
  if (view === 'error') $('#transfer-error').textContent = message || 'Something went wrong.';
  $('#transfer-intro').textContent = ready
    ? (transferQrOk
      ? 'Scan this code or open the link on your other device. It works for 10 minutes.'
      : 'The QR code could not be drawn. Open the link on your other device. It works for 10 minutes.')
    : view === 'loading' ? 'Creating a link for your progress.'
    : 'Create a new link whenever you need one.';
  if (view === 'loading') $('#transfer-countdown').textContent = 'Creating link…';
  else if (view === 'expired') $('#transfer-countdown').textContent = 'This link has expired.';
  else if (view === 'cancelled') $('#transfer-countdown').textContent = 'This link was cancelled.';
  else if (view === 'error') $('#transfer-countdown').textContent = '';
}

function tickTransfer() {
  if (!activeTransfer) return;
  const left = Math.max(0, Math.ceil((activeTransfer.expiresAt - Date.now()) / 1000));
  if (left === 0) {
    clearInterval(transferTimer);
    transferTimer = null;
    activeTransfer = null;
    setTransferView('expired');
    dom.actionFeedback.textContent = 'Transfer link expired.';
    return;
  }
  $('#transfer-countdown').textContent = `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

function showTransferLink() {
  const url = transferUrl(activeTransfer.token);
  $('#transfer-link').value = url;
  transferQrOk = typeof window.drawTransferQR === 'function' && window.drawTransferQR($('#transfer-qr'), url, { size: 240 });
  setTransferView('ready');
  tickTransfer();
  clearInterval(transferTimer);
  transferTimer = setInterval(tickTransfer, 1000);
}

async function createTransfer() {
  if (transferBusy) return;
  transferBusy = true;
  setTransferView('loading');
  try {
    const res = await fetch(TRANSFER_API, {
      method: 'POST', headers: transferHeaders, cache: 'no-store',
      body: JSON.stringify({ payload: buildTransferPayload() }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Could not create the link.');
    if (!TRANSFER_TOKEN_RE.test(out.token || '') || !Number.isFinite(out.expiresIn)) throw new Error('Unexpected response from the server.');
    activeTransfer = { token: out.token, expiresAt: Date.now() + out.expiresIn * 1000 };
    if (!dom.transferOverlay.hidden) showTransferLink();
  } catch (ex) {
    setTransferView('error', ex.message === 'Failed to fetch' ? 'Cannot reach the server.' : ex.message);
  } finally { transferBusy = false; }
}

async function cancelTransfer() {
  if (!activeTransfer || transferBusy) return;
  const token = activeTransfer.token;
  const btn = $('#transfer-cancel-link');
  transferBusy = true;
  btn.disabled = true;
  try {
    const res = await fetch(TRANSFER_API, { method: 'POST', headers: transferHeaders, body: JSON.stringify({ cancel: token }) });
    if (!res.ok) throw new Error();
    clearInterval(transferTimer);
    transferTimer = null;
    activeTransfer = null;
    setTransferView('cancelled');
    dom.actionFeedback.textContent = 'Transfer link cancelled.';
    $('#transfer-new').focus();
  } catch (ex) {
    showToast('Could not cancel the link. It still expires on its own.');
  } finally { transferBusy = false; btn.disabled = false; }
}

async function copyTransferLink() {
  const input = $('#transfer-link');
  try {
    await navigator.clipboard.writeText(input.value);
    showToast('Link copied');
  } catch (e) {
    input.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) {}
    showToast(ok ? 'Link copied' : 'Press Ctrl+C to copy');
  }
}

function openTransfer() {
  closeSettings();
  dom.transferOverlay._returnFocus = document.activeElement;
  openOverlay(dom.transferOverlay);
  $('#transfer-close').focus();
  if (activeTransfer && activeTransfer.expiresAt > Date.now()) showTransferLink();
  else { activeTransfer = null; createTransfer(); }
}

function closeTransfer() {
  clearInterval(transferTimer);
  transferTimer = null;
  hideOverlay(dom.transferOverlay);
}

export function transferSectionError(p, activeSection = currentSection() || 'a') {
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.v !== 1) return null;
  const expected = String(activeSection || 'a').toLowerCase() || 'a';
  if (p.section === undefined) {
    return expected === 'a'
      ? null
      : `This transfer is from Section A and cannot be imported into Section ${expected.toUpperCase()}.`;
  }
  if (typeof p.section !== 'string') return 'The transfer data could not be read.';
  if (p.section !== expected) {
    return `This transfer is for Section ${p.section ? p.section.toUpperCase() : '?'} and cannot be imported into Section ${expected.toUpperCase()}.`;
  }
  return null;
}

export function validateTransfer(p, activeSection = currentSection() || 'a', deps = {}) {
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  if (!isObj(p) || p.v !== 1) return null;
  if (transferSectionError(p, activeSection)) return null;
  const checkId = deps.taskIdOk || taskIdOk;
  const statuses = deps.STATUS_ORDER || STATUS_ORDER;
  const TaskCtor = deps.Task || Task;
  const raw = Array.isArray(p.progress) && p.progress.length === 0 ? {} : p.progress;
  if (!isObj(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > 5000) return null;
  const clean = {};
  for (const [id, e] of entries) {
    if (!checkId(id)) return null;
    if (!isObj(e) || !statuses.includes(e.status) || !Number.isFinite(e.movedAt) || e.movedAt < 0) return null;
    clean[id] = { status: e.status, movedAt: e.movedAt };
  }
  let draft = null;
  if (p.draft != null) {
    const d = p.draft;
    if (!isObj(d) || !Array.isArray(d.tasks) || d.tasks.length > 2000) return null;
    if (d.announcements != null && !Array.isArray(d.announcements)) return null;
    const tasks = d.tasks.filter(isObj);

    if (!tasks.every((o) => checkId(o.id))) return null;
    draft = {
      tasks: tasks.map((o) => TaskCtor.fromJSON(o).toJSON()),
      announcements: (d.announcements || [])
        .filter((a) => isObj(a) && typeof a.text === 'string' && Number.isFinite(a.createdAt))
        .slice(0, 200)
        .map((a) => ({
          id: typeof a.id === 'string' ? a.id.slice(0, 20) : Math.random().toString(36).slice(2, 10),
          text: a.text.slice(0, 1000),
          html: typeof a.html === 'string' && a.html.length <= 8000 ? a.html : '',
          createdAt: a.createdAt,
        })),
      ...(Array.isArray(d.subjects) ? { subjects: d.subjects } : {}),
    };
  }
  return { progress: clean, draft };
}

function openImport(data) {
  pendingImport = data;
  const r = mergeProgress(state.progress, data.progress);
  const list = $('#import-summary');
  list.replaceChildren();
  const line = (text) => { const li = document.createElement('li'); li.textContent = text; list.appendChild(li); };
  line(`${plural(r.added, 'task')} added to your progress, ${plural(r.updated, 'task')} updated to the newer status.`);
  if (r.kept) line(`${plural(r.kept, 'task')} stay as they are here, because they changed more recently on this device.`);

  const hasDraft = !!data.draft;
  $('#import-draft-row').hidden = !(hasDraft && state.isAdmin);
  $('#import-draft-note').hidden = !(hasDraft && !state.isAdmin);
  if (hasDraft && state.isAdmin) {
    $('#import-draft-check').checked = true;
    $('#import-draft-text').textContent =
      `Replace my draft here (${plural(myTasks.length, 'task')}) with the draft from the other device (${plural(data.draft.tasks.length, 'task')}, ${plural(data.draft.announcements.length, 'announcement')}).`;
  }
  openOverlay(dom.importOverlay);
  $('#import-cancel').focus();
}

function closeImport() {
  pendingImport = null;
  hideOverlay(dom.importOverlay);
}

async function applyImport() {
  if (!pendingImport) return;
  const data = pendingImport;
  const before = { progress: JSON.parse(JSON.stringify(state.progress)), draft: state.isAdmin ? snapshot() : null };
  const merged = mergeProgress(state.progress, data.progress).merged;
  state.progress = filterDeletedProgress(merged, state.verifiedDeletedIds).progress;
  applyProgress(myTasks);
  applyProgress(state.publishedTasks);
  const withDraft = !!(data.draft && state.isAdmin && $('#import-draft-check').checked);
  let saved = true;
  if (withDraft) {

    const replaced = await restoreDraft(data.draft);
    if (!replaced) {
      state.progress = before.progress;
      applyProgress(myTasks);
      applyProgress(state.publishedTasks);
      return;
    }
  } else {
    saved = saveTasks();
    renderAllTasks();
  }
  closeImport();
  if (!saved) showToast('Merged progress could not be saved on this device. Storage may be full.');
  else showToast(withDraft ? 'Progress merged and draft replaced' : 'Progress merged', 'Undo', async () => {
    state.progress = filterDeletedProgress(before.progress, state.verifiedDeletedIds).progress;
    applyProgress(myTasks);
    applyProgress(state.publishedTasks);
    if (withDraft && before.draft) await restoreDraft(before.draft);
    else { saveTasks(); renderAllTasks(); }
  });
}

export async function checkIncomingTransfer(token, opts = {}) {
  const fetchFn = opts.fetchFn || fetch;
  const notify = opts.showToast || showToast;
  const activeSection = opts.activeSection || currentSection() || 'a';
  const open = opts.openImport || openImport;
  try {
    const res = await fetchFn(`${TRANSFER_API}?t=${token}`, { cache: 'no-store' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      notify(res.status === 429 ? 'Too many attempts. Try again in a few minutes.' : 'This transfer link is not valid or has expired.');
      return;
    }
    const secErr = transferSectionError(out.payload, activeSection);
    if (secErr) { notify(secErr); return; }
    const data = validateTransfer(out.payload, activeSection, opts);
    if (!data) { notify('The transfer data could not be read.'); return; }
    open(data);
  } catch (ex) {
    notify(ex.message === 'Failed to fetch' ? 'Cannot reach the server.' : 'Could not load the transfer.');
  }
}

export function init(deps) {
  $ = deps.$; showToast = deps.showToast; closeSettings = deps.closeSettings;
  myTasks = deps.myTasks; applyProgress = deps.applyProgress; saveTasks = deps.saveTasks;
  renderAllTasks = deps.renderAllTasks;
  snapshot = deps.snapshot; restoreDraft = deps.restoreDraft; mergeProgress = deps.mergeProgress;
  Task = deps.Task; taskIdOk = deps.taskIdOk; STATUS_ORDER = deps.STATUS_ORDER;

$('#settings-transfer').addEventListener('click', openTransfer);
$('#transfer-close').addEventListener('click', closeTransfer);
$('#transfer-done').addEventListener('click', closeTransfer);
$('#transfer-new').addEventListener('click', createTransfer);
$('#transfer-cancel-link').addEventListener('click', cancelTransfer);
$('#transfer-copy').addEventListener('click', copyTransferLink);
$('#transfer-link').addEventListener('focus', (e) => e.target.select());
dom.transferOverlay.addEventListener('click', (e) => { if (e.target === dom.transferOverlay) closeTransfer(); });
$('#import-apply').addEventListener('click', applyImport);
$('#import-cancel').addEventListener('click', closeImport);
$('#import-close').addEventListener('click', closeImport);
dom.importOverlay.addEventListener('click', (e) => { if (e.target === dom.importOverlay) closeImport(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!dom.importOverlay.hidden && !dom.importOverlay.classList.contains('is-closing')) closeImport();
  else if (!dom.transferOverlay.hidden && !dom.transferOverlay.classList.contains('is-closing')) closeTransfer();
});
}
