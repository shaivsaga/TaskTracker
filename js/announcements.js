// js/announcements.js - the pinned announcements (app.js split, slice 2.5).
//
// Moved verbatim out of app.js: the announcement region - renderPublicAnnouncements (the class-side
// list), the ANNOUNCE_MAX cap, updateAnnounceCount, the ANN_INLINE whitelist, cleanAnnounce,
// fillAnnounce, syncAnnounceTools, saveAnnouncements, renderAnnouncements (the admin list with its
// delete/undo), toggleAnnounceForm, the admin form's submit handler and the editor and announce-tool
// listeners. renderAnnouncements is exported because app.js (loadPublished and the bootstrap init),
// js/publish.js (restoreDraft and the publish POST) and js/transfer.js (a replaced draft) all
// re-render the list. renderPublicAnnouncements stays private: renderAnnouncements is its only caller.
//
// Preserved exactly, per the slice brief:
//   - localStorage: this region writes no key of its own. saveAnnouncements() calls app.js's
//     saveTasks(), which still writes class_tasks_progress and class_tasks_draft (the draft is
//     { tasks, announcements }); an announcement keeps the shape { id, text, html, createdAt } and
//     its id is still Math.random().toString(36).slice(2, 10).
//   - the admin-only gating: renderPublicAnnouncements still picks the draft list only when
//     state.previewing || state.isAdmin, and the admin editor stays inside #announce-admin.
//   - the editor behaviour (add/edit/delete, list order, unshift on add, splice at the removed index
//     with the Undo toast, the "No pinned announcements." empty state) and the markup/wording.
//
// Two things stay in app.js on purpose: the one-time move of #announce-admin out of the Class tasks
// page (a module-eval statement next to the auth block), and dom.noteTools / syncNoteTools, which are
// the task dialog's doc editor, not this region.
//
// D6: this module never imports logic.js and never reads a bare global. lookup (logic.js), linkify
// and dropHasFiles (app.js), showToast, saveTasks, updateAdminBar and diffDraft arrive through
// init(deps) - the last two are app.js's until slice 2.5's publish commit moves them into
// js/publish.js, which then supplies them. state and dom are module imports.
//
// init() runs at the position where the first of the moved listeners used to be registered, so the
// page's document/element listener order is unchanged (the announce editor's keydown handler still
// registers above the keyboard-shortcut handler). Every other region line is a declaration and keeps
// its place; the listener blocks are the only lines that moved, to the bottom of init, and they are
// byte-identical.
//
// Importing this module touches nothing: no DOM read, no listener, no state read and no timer at
// evaluation time, so
//   node --input-type=module -e "await import('./js/announcements.js')"
// is clean under plain Node (docs/p6-architecture-findings.md 4-5, DECISIONS.md D6).

import { state } from './state.js';
import { dom } from './dom.js';

let lookup = null;           // logic.js: cleanAnnounce's whitelist lookup
let linkify = null;          // app.js: fillAnnounce links URLs in rendered announcements and notes
let dropHasFiles = null;     // app.js: the editor refuses a file drop
let showToast = null;        // app.js: the removed / over-limit / too-much-formatting messages
let saveTasks = null;        // app.js: persists progress and the admin draft after every edit
let updateAdminBar = null;   // app.js -> js/publish.js (slice 2.5): the unpublished-changes bar
let diffDraft = null;        // app.js -> js/publish.js (slice 2.5): the draft-vs-published diff
// Pinned block (critique P0, then P2 for desktop): collapsed to the newest announcement so the first
// task row stays on screen; the toggle opens the rest. On phones that one item is also clamped to two
// lines (CSS); on larger screens it shows in full.
let pinnedOpen = false;
function syncPinned() {
  const box = document.querySelector('#announce-public');
  const list = document.querySelector('#announce-list-public');
  const toggle = document.querySelector('#announce-toggle');
  if (!box || !list || !toggle) return;
  const items = list.querySelectorAll('.announce-item');
  const collapsed = !pinnedOpen;
  box.classList.toggle('is-empty', items.length === 0);
  box.classList.toggle('is-collapsed', collapsed);
  // Clipped text can only be measured while the page is on screen; off screen, fall back to length.
  const text = items[0] && items[0].querySelector('.announce-text');
  const clipped = collapsed && !!text && (box.getClientRects().length
    ? text.scrollHeight > text.clientHeight + 1
    : text.textContent.length > 70);
  toggle.hidden = !items.length || (!pinnedOpen && items.length < 2 && !clipped);
  toggle.setAttribute('aria-expanded', String(pinnedOpen));
  toggle.textContent = pinnedOpen ? 'Show less' : (items.length > 1 ? `Show all ${items.length}` : 'Show more');
}

function renderPublicAnnouncements() {
  const list = document.querySelector('#announce-list-public');
  if (!list) return;
  const items = (state.previewing || state.isAdmin) ? state.announcements : state.publishedAnnouncements;
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'announce-empty';
    empty.textContent = 'No pinned announcements.';
    list.appendChild(empty);
    syncPinned();
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
    fillAnnounce(text, a);
    li.append(text, date);
    list.appendChild(li);
  });
  syncPinned();
}

// --- Pinned announcements ---
const ANNOUNCE_MAX = 280;

function updateAnnounceCount() {
  const left = ANNOUNCE_MAX - cleanAnnounce(dom.announceInput).text.length;
  dom.announceCount.textContent = (left < 0 ? `${-left} over` : `${left} left`) + ' · Ctrl+Enter to pin';
  dom.announceCount.classList.toggle('is-low', left <= 20);
}
// Rich announcements: a separate whitelist from sanitizeDoc. Stored as b, i, ul, li, br only.
const ANN_INLINE = { b: 'b', strong: 'b', i: 'i', em: 'i' };
function cleanAnnounce(root) {
  const out = document.createElement('div');
  const isBlock = (n) => n && (n.nodeName === 'BR' || n.nodeName === 'UL');
  const walk = (src, dst) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.textContent.replace(/\u00a0/g, ' '))); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      const inline = lookup(ANN_INLINE, tag);
      if (tag === 'br') {
        dst.appendChild(document.createElement('br'));
      } else if (inline) {
        const el = document.createElement(inline);
        walk(n, el);
        if (el.childNodes.length) dst.appendChild(el);
      } else if (tag === 'ul' || tag === 'ol') {
        const ul = document.createElement('ul');
        let loose = null;
        n.childNodes.forEach((c) => {
          if (c.nodeType === 1 && c.tagName.toLowerCase() === 'li') {
            loose = null;
            const li = document.createElement('li');
            walk(c, li);
            ul.appendChild(li);
          } else if (!(c.nodeType === 3 && !c.textContent.trim())) {
            if (!loose) { loose = document.createElement('li'); ul.appendChild(loose); }
            walk({ childNodes: [c] }, loose);
          }
        });
        if (ul.childNodes.length) dst.appendChild(ul);
      } else if (tag === 'div' || tag === 'p' || tag === 'li') {
        if (dst.lastChild && !isBlock(dst.lastChild)) dst.appendChild(document.createElement('br'));
        walk(n, dst);
      } else if (tag !== 'script' && tag !== 'style') {
        walk(n, dst);
      }
    });
  };
  walk(root, out);
  while (out.firstChild && out.firstChild.nodeName === 'BR') out.firstChild.remove();
  while (out.lastChild && out.lastChild.nodeName === 'BR') out.lastChild.remove();
  const parts = [];
  const gather = (n) => n.childNodes.forEach((c) => {
    if (c.nodeType === 3) parts.push(c.textContent);
    else if (c.nodeName === 'BR') parts.push('\n');
    else if (c.nodeName === 'LI') { if (c.textContent.trim()) { parts.push('\n- '); gather(c); } }
    else gather(c);
  });
  gather(out);
  const text = parts.join('').trim();
  return { node: out, html: text ? out.innerHTML : '', text };
}

// Builds an announcement body with DOM calls only. Old plain announcements fall back to text.
function fillAnnounce(el, a) {
  el.replaceChildren();
  const rich = typeof a.html === 'string' && a.html !== '';
  el.classList.toggle('is-rich', rich);
  if (rich) {
    const tpl = document.createElement('template'); // inert: nothing runs or loads
    tpl.innerHTML = a.html;
    el.append(...cleanAnnounce(tpl.content).node.childNodes);
  } else {
    el.textContent = a.text;
  }
  linkify(el);
}

function syncAnnounceTools() {
  dom.announceTools.forEach((b) => {
    let on = false;
    try { on = document.activeElement === dom.announceInput && document.queryCommandState(b.dataset.cmd); } catch (e) {}
    b.setAttribute('aria-pressed', String(on));
  });
}

function saveAnnouncements() { saveTasks(); updateAdminBar(diffDraft()); }

export function renderAnnouncements() {
  renderPublicAnnouncements();
  dom.announceList.replaceChildren();
  if (!state.announcements.length) {
    const empty = document.createElement('li');
    empty.className = 'announce-empty';
    empty.textContent = 'No pinned announcements.';
    dom.announceList.appendChild(empty);
    return;
  }
  state.announcements.forEach((a) => {
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
    del.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-trash-2"/></svg>';
    del.addEventListener('click', () => {
      const index = state.announcements.indexOf(a);
      state.announcements.splice(index, 1);
      saveAnnouncements();
      renderAnnouncements();
      showToast('Announcement removed', 'Undo', () => {
        state.announcements.splice(Math.min(index, state.announcements.length), 0, a);
        saveAnnouncements();
        renderAnnouncements();
      });
    });
    fillAnnounce(text, a);
    li.append(text, date, del);
    dom.announceList.appendChild(li);
  });
  
}

function toggleAnnounceForm(show) {
  dom.announceForm.hidden = !show;
  if (show) dom.announceInput.focus();
  else dom.announceInput.innerHTML = '';
  updateAnnounceCount();
}

// Called once by app.js, at the spot the moved listeners used to occupy.
export function init(deps) {
  lookup = deps.lookup;
  linkify = deps.linkify;
  dropHasFiles = deps.dropHasFiles;
  showToast = deps.showToast;
  saveTasks = deps.saveTasks;
  updateAdminBar = deps.updateAdminBar;
  diffDraft = deps.diffDraft;
dom.announceInput.addEventListener('input', () => {
  if (/^(<div>)?<br>(<\/div>)?$/.test(dom.announceInput.innerHTML)) dom.announceInput.innerHTML = '';
  updateAnnounceCount();
});
dom.announceInput.addEventListener('focus', () => document.execCommand('styleWithCSS', false, false));
dom.announceInput.addEventListener('paste', (e) => {
  e.preventDefault();
  document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
});
dom.announceInput.addEventListener('drop', (e) => { if (dropHasFiles(e)) e.preventDefault(); });

dom.announceTools.forEach((b) => {
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection in the editor
  b.addEventListener('click', () => {
    dom.announceInput.focus();
    document.execCommand(b.dataset.cmd);
    updateAnnounceCount();
    syncAnnounceTools();
  });
});
document.addEventListener('selectionchange', () => { if (document.activeElement === dom.announceInput) syncAnnounceTools(); });

document.querySelector('#announce-toggle').addEventListener('click', () => { pinnedOpen = !pinnedOpen; syncPinned(); });
window.addEventListener('resize', syncPinned);
window.addEventListener('hashchange', () => requestAnimationFrame(syncPinned)); // the router: the page may just have appeared
if (document.fonts) document.fonts.ready.then(syncPinned); // line breaks change once the body font loads

document.querySelector('#announce-add-btn').addEventListener('click', () => toggleAnnounceForm(dom.announceForm.hidden));
document.querySelector('#announce-cancel').addEventListener('click', () => toggleAnnounceForm(false));
dom.announceForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const { html, text } = cleanAnnounce(dom.announceInput);
  if (!text) return;
  if (text.length > ANNOUNCE_MAX) { showToast(`Announcement is ${text.length - ANNOUNCE_MAX} characters over the limit`); return; }
  if (html.length > 8000) { showToast('Too much formatting in this announcement'); return; }
  state.announcements.unshift({ id: Math.random().toString(36).slice(2, 10), text, html, createdAt: Date.now() });
  saveAnnouncements();
  renderAnnouncements();
  toggleAnnounceForm(false);
});
dom.announceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); dom.announceForm.requestSubmit(); }
  if (e.key === 'Escape') { e.preventDefault(); toggleAnnounceForm(false); }
});
}
