// js/transfer.js - the transfer and import flow (app.js split, slice 2.4).
//
// Moved verbatim out of app.js: the whole "Phase 7: transfer by QR code and link" region - the
// send side (TRANSFER_API, TRANSFER_TOKEN_RE, takeTransferToken, transferHeaders,
// buildTransferPayload, transferUrl, setTransferView, tickTransfer, showTransferLink,
// createTransfer, cancelTransfer, copyTransferLink, openTransfer, closeTransfer) and the receive
// side (validateTransfer, openImport, closeImport, applyImport, checkIncomingTransfer), plus every
// listener of the transfer and import overlays and the region's document-level Escape handler.
//
// Kept exactly as they were (STATE.md pins them, and the slice brief repeats them):
//   - takeTransferToken reads ?transfer= and strips it with history.replaceState. app.js still
//     calls it at module-evaluation time - `const INCOMING_TRANSFER = transfer.takeTransferToken()`
//     - i.e. before start() awaits checkAdmin(), which is the order the region had.
//   - TRANSFER_TOKEN_RE = /^[a-f0-9]{32}$/, applied to the incoming token and to the POST reply.
//   - `cache: 'no-store'` on the transfer.php fetch in checkIncomingTransfer.
//   - mergeProgress is logic.js's and arrives through init(deps); this module never imports
//     logic.js, so the merge semantics and the tie rule stay the caller's own function.
//   - the summary wording ("N tasks added ... stay as they are here ..."), the Undo toast and the
//     admin draft checkbox are byte-identical.
//   - the localStorage keys and shapes are untouched: this region writes none of them itself; it
//     edits state.progress / state.pendingImport and calls app.js's saveTasks(), which keeps
//     writing class_tasks_progress, class_tasks_draft and class_tasks_published_cache.
//
// init() registers the moved listeners from app.js, at the position in the page where the first of
// them used to register, so the document/element listener order does not change: the publish/history
// Escape handler, then settings, then tour, then this region (transfer clicks, import clicks, the
// region's Escape handler), then the focus trap. Inside the module the listeners are gathered at the
// bottom in their original order; between them in app.js sat only function declarations, which have
// no effect until called.
//
// D6: this module never imports logic.js and never reads a bare global. `$`, hideAnimated,
// showToast, closeSettings, myTasks, applyProgress, saveTasks, renderAllTasks, renderAnnouncements,
// snapshot, restoreDraft, mergeProgress, Task, taskIdOk and STATUS_ORDER arrive through init(deps);
// each is declared (or, for renderAllTasks, hoisted) above the call site in app.js, so passing them
// by value is safe. `state` and `dom` are module imports. Importing this module touches nothing: no
// DOM read, no listener, no state read and no timer at evaluation time, so
//   node --input-type=module -e "await import('./js/transfer.js')"
// is clean under plain Node (docs/p6-architecture-findings.md 4-5, DECISIONS.md D6).

import { state } from './state.js';
import { dom } from './dom.js';
import { plural } from './util.js';
import { validateSubjects } from './subjects.js';
import { openOverlay } from './motion.js';

let $ = null;                    // app.js's querySelector shorthand (declared above the init call site)
let hideAnimated = null;         // app.js: closeTransfer / closeImport hide their overlay animated
let showToast = null;            // app.js: every failure message, the merge toast and its Undo label
let closeSettings = null;        // app.js: openTransfer closes Settings before it opens (settings.closeSettings)
let myTasks = null;              // app.js: buildTransferPayload sends the draft; applyImport replaces it
let applyProgress = null;        // app.js: the merged statuses are re-applied to the drafts
let saveTasks = null;            // app.js: persists progress and draft after a merge and after Undo
let renderAllTasks = null;       // app.js: re-renders the board after a merge and after Undo
let renderAnnouncements = null;  // app.js: a replaced draft carries its own announcements
let snapshot = null;             // app.js: applyImport snapshots this device before it merges
let restoreDraft = null;         // app.js: the same Undo path puts the snapshot back
let mergeProgress = null;
let syncCatalog = null;      // app.js: a received catalogue must repaint tags and pickers
let Task = null;                 // logic.js: validateTransfer rebuilds a received draft through Task.fromJSON
let taskIdOk = null;             // logic.js: the id guard on received progress and draft tasks
let STATUS_ORDER = null;         // app.js: openImport looks up where each task sits on the board

// --- Phase 7: transfer by QR code and link ---
const TRANSFER_API = 'transfer.php';
const TRANSFER_TOKEN_RE = /^[a-f0-9]{32}$/;

// Read the token before checkAdmin() rewrites the address bar, then remove it from the URL.
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

// ---- Sending ----
function buildTransferPayload() {
  const payload = { v: 1, progress: state.progress };
  if (state.isAdmin) {
    // The catalogue travels with the draft so the receiving device can render and publish it. The
    // base revision and every deletion marker stay behind: authority belongs to the server.
    const draft = {
      schemaVersion: 2,
      tasks: myTasks.map((t) => t.toJSON()),
      announcements: state.announcements,
      subjects: state.draftSubjects,
    };
    // The size guard counts the catalogue too, so an oversized draft is reported, never silently
    // stripped back to progress plus tasks.
    if (JSON.stringify(draft).length < 700000) payload.draft = draft;
  }
  return payload;
}

function transferUrl(token) {
  return location.origin + location.pathname.replace(/[^/]*$/, '') + '?transfer=' + token;
}

function setTransferView(view, message) {
  const ready = view === 'ready';
  $('#transfer-qr-frame').hidden = !ready || !state.transferQrOk;
  $('#transfer-link-row').hidden = !ready;
  $('#transfer-cancel-link').hidden = !ready;
  $('#transfer-new').hidden = !(view === 'expired' || view === 'cancelled' || view === 'error');
  $('#transfer-error').hidden = view !== 'error';
  if (view === 'error') $('#transfer-error').textContent = message || 'Something went wrong.';
  $('#transfer-intro').textContent = ready
    ? (state.transferQrOk
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
  if (!state.activeTransfer) return;
  const left = Math.max(0, Math.ceil((state.activeTransfer.expiresAt - Date.now()) / 1000));
  if (left === 0) {
    clearInterval(state.transferTimer);
    state.transferTimer = null;
    state.activeTransfer = null;
    setTransferView('expired');
    dom.actionFeedback.textContent = 'Transfer link expired.';
    return;
  }
  $('#transfer-countdown').textContent = `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

function showTransferLink() {
  const url = transferUrl(state.activeTransfer.token);
  $('#transfer-link').value = url;
  state.transferQrOk = typeof window.drawTransferQR === 'function' && window.drawTransferQR($('#transfer-qr'), url, { size: 240 });
  setTransferView('ready');
  tickTransfer();
  clearInterval(state.transferTimer);
  state.transferTimer = setInterval(tickTransfer, 1000);
}

async function createTransfer() {
  if (state.transferBusy) return;
  state.transferBusy = true;
  setTransferView('loading');
  try {
    const res = await fetch(TRANSFER_API, {
      method: 'POST', headers: transferHeaders, cache: 'no-store',
      body: JSON.stringify({ payload: buildTransferPayload() }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Could not create the link.');
    if (!TRANSFER_TOKEN_RE.test(out.token || '') || !Number.isFinite(out.expiresIn)) throw new Error('Unexpected response from the server.');
    state.activeTransfer = { token: out.token, expiresAt: Date.now() + out.expiresIn * 1000 };
    if (!dom.transferOverlay.hidden) showTransferLink();
  } catch (ex) {
    setTransferView('error', ex.message === 'Failed to fetch' ? 'Cannot reach the server.' : ex.message);
  } finally { state.transferBusy = false; }
}

async function cancelTransfer() {
  if (!state.activeTransfer || state.transferBusy) return;
  const token = state.activeTransfer.token;
  const btn = $('#transfer-cancel-link');
  state.transferBusy = true;
  btn.disabled = true;
  try {
    const res = await fetch(TRANSFER_API, { method: 'POST', headers: transferHeaders, body: JSON.stringify({ cancel: token }) });
    if (!res.ok) throw new Error();
    clearInterval(state.transferTimer);
    state.transferTimer = null;
    state.activeTransfer = null;
    setTransferView('cancelled');
    dom.actionFeedback.textContent = 'Transfer link cancelled.';
    $('#transfer-new').focus();
  } catch (ex) {
    showToast('Could not cancel the link. It still expires on its own.');
  } finally { state.transferBusy = false; btn.disabled = false; }
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
  if (state.activeTransfer && state.activeTransfer.expiresAt > Date.now()) showTransferLink();
  else { state.activeTransfer = null; createTransfer(); }
}

function closeTransfer() {
  clearInterval(state.transferTimer);
  state.transferTimer = null;
  hideAnimated(dom.transferOverlay);
}

// ---- Receiving ----
// Returns { progress, draft } rebuilt from scratch, or null when the data is not usable.
function validateTransfer(p) {
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  if (!isObj(p) || p.v !== 1) return null;
  const raw = Array.isArray(p.progress) && p.progress.length === 0 ? {} : p.progress;
  if (!isObj(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > 5000) return null;
  const clean = {};
  for (const [id, e] of entries) {
    if (!taskIdOk(id)) return null;
    if (!isObj(e) || !STATUS_ORDER.includes(e.status) || !Number.isFinite(e.movedAt) || e.movedAt < 0) return null;
    clean[id] = { status: e.status, movedAt: e.movedAt };
  }
  let draft = null;
  if (p.draft != null) {
    const d = p.draft;
    if (!isObj(d) || !Array.isArray(d.tasks) || d.tasks.length > 2000) return null;
    if (d.announcements != null && !Array.isArray(d.announcements)) return null;
    const tasks = d.tasks.filter(isObj);
    // Task.fromJSON only does String(opts.id), and that id later lands in a CSS attribute selector.
    if (!tasks.every((o) => taskIdOk(o.id))) return null;
    draft = {
      tasks: tasks.map((o) => Task.fromJSON(o).toJSON()),
      announcements: (d.announcements || [])
        .filter((a) => isObj(a) && typeof a.text === 'string' && Number.isFinite(a.createdAt))
        .slice(0, 200)
        .map((a) => ({
          id: typeof a.id === 'string' ? a.id.slice(0, 20) : Math.random().toString(36).slice(2, 10),
          text: a.text.slice(0, 1000),
          html: typeof a.html === 'string' && a.html.length <= 8000 ? a.html : '',
          createdAt: a.createdAt,
        })),
    };
  }
  return { progress: clean, draft };
}

function openImport(data) {
  state.pendingImport = data;
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
  state.pendingImport = null;
  hideAnimated(dom.importOverlay);
}

function applyImport() {
  if (!state.pendingImport) return;
  const data = state.pendingImport;
  const before = { progress: JSON.parse(JSON.stringify(state.progress)), draft: state.isAdmin ? snapshot() : null };
  state.progress = mergeProgress(state.progress, data.progress).merged;
  applyProgress(myTasks);
  applyProgress(state.publishedTasks);
  const withDraft = !!(data.draft && state.isAdmin && $('#import-draft-check').checked);
  if (withDraft) {
    myTasks.length = 0;
    data.draft.tasks.forEach((o) => myTasks.push(Task.fromJSON(o)));
    state.announcements = data.draft.announcements.map((a) => ({ ...a }));
    // A schema-2 sender carries a catalogue; a legacy sender carries none, so the receiving
    // catalogue is kept instead of being reset to a generic one.
    if (Array.isArray(data.draft.subjects) && data.draft.subjects.length) {
      const checked = validateSubjects(data.draft.subjects);
      if (!checked.error) { state.draftSubjects = checked.subjects; syncCatalog(checked.subjects); }
    }
    applyProgress(myTasks);
  }
  // A partial write is reported, never rounded up to success: the merge is already in memory and
  // the filtered progress must not be silently reverted.
  const saved = saveTasks();
  renderAllTasks();
  renderAnnouncements();
  closeImport();
  if (!saved) showToast('Merged progress could not be saved on this device. Storage may be full.');
  else showToast(withDraft ? 'Progress merged and draft replaced' : 'Progress merged', 'Undo', () => {
    state.progress = before.progress;
    applyProgress(myTasks);
    applyProgress(state.publishedTasks);
    if (before.draft) restoreDraft(before.draft);
    else { saveTasks(); renderAllTasks(); }
  });
}

export async function checkIncomingTransfer(token) {
  try {
    const res = await fetch(`${TRANSFER_API}?t=${token}`, { cache: 'no-store' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(res.status === 429 ? 'Too many attempts. Try again in a few minutes.' : 'This transfer link is not valid or has expired.');
      return;
    }
    const data = validateTransfer(out.payload);
    if (!data) { showToast('The transfer data could not be read.'); return; }
    openImport(data);
  } catch (ex) {
    showToast(ex.message === 'Failed to fetch' ? 'Cannot reach the server.' : 'Could not load the transfer.');
  }
}

export function init(deps) {
  $ = deps.$; hideAnimated = deps.hideAnimated; showToast = deps.showToast; closeSettings = deps.closeSettings;
  myTasks = deps.myTasks; applyProgress = deps.applyProgress; saveTasks = deps.saveTasks;
  renderAllTasks = deps.renderAllTasks; renderAnnouncements = deps.renderAnnouncements;
  snapshot = deps.snapshot; restoreDraft = deps.restoreDraft; mergeProgress = deps.mergeProgress;
  Task = deps.Task; taskIdOk = deps.taskIdOk; STATUS_ORDER = deps.STATUS_ORDER;
  syncCatalog = deps.syncCatalog;

  // The moved listeners, in the order they registered in app.js (the Escape chain depends on it).
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
