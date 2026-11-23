import { state } from './state.js';
import { dom } from './dom.js';

let lookup = null;
let linkify = null;
let dropHasFiles = null;
let showToast = null;
let saveTasks = null;
let updateAdminBar = null;
let diffDraft = null;

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

  const text = items[0] && items[0].querySelector('.announce-text');
  const measurable = box.getClientRects().length > 0;
  const clipped = collapsed && !!text && (measurable ? text.scrollHeight > text.clientHeight + 1 : true);
  toggle.hidden = !items.length || (collapsed && items.length < 2 && !clipped);
  toggle.setAttribute('aria-expanded', String(!collapsed));

  toggle.textContent = pinnedOpen ? 'Show less' : (items.length > 2 ? `Show ${items.length - 1} more` : 'Show more');
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

const ANNOUNCE_MAX = 280;

function updateAnnounceCount() {
  const left = ANNOUNCE_MAX - cleanAnnounce(dom.announceInput).text.length;
  const touch = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: none)').matches;
  dom.announceCount.textContent = (left < 0 ? `${-left} over` : `${left} left`) + (touch ? '' : ' · Ctrl+Enter to pin');
  dom.announceCount.classList.toggle('is-low', left <= 20);
}

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

function fillAnnounce(el, a) {
  el.replaceChildren();
  const rich = typeof a.html === 'string' && a.html !== '';
  el.classList.toggle('is-rich', rich);
  if (rich) {
    const tpl = document.createElement('template');
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
  b.addEventListener('mousedown', (e) => e.preventDefault());
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
window.addEventListener('hashchange', () => requestAnimationFrame(syncPinned));
document.addEventListener('app:page-shown', () => requestAnimationFrame(syncPinned));
if (document.fonts) document.fonts.ready.then(syncPinned);

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
