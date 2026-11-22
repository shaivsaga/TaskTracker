const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const FLY_MS = 380;
const HOLD = 0.18;
const GLIDE_MS = 180;
const CAP = 6;

const ROWS = '.task-row[data-task-id], .task-card[data-task-id]';

export function isReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.motion === 'reduce';
}
const reduced = () => isReducedMotion();
const visible = (el) => el.getClientRects().length > 0 && !el.closest('.motion-ghost');
const tabSprite = () => document.querySelector('.tn[data-page="done"] .sp');

let pending = null;
const flights = new Map();

function measure() {
  const out = new Map();
  document.querySelectorAll(ROWS).forEach((el) => {
    if (!visible(el)) return;
    const id = el.dataset.taskId;
    if (!out.has(id)) out.set(id, { rect: el.getBoundingClientRect(), card: el.classList.contains('task-card') });
  });
  return out;
}

function makeGhost(id) {
  const src = [...document.querySelectorAll(ROWS)].find((el) => el.dataset.taskId === id && visible(el));
  if (!src || src.classList.contains('task-card')) return null;
  const r = src.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  const el = src.cloneNode(true);
  el.removeAttribute('data-task-id');
  el.removeAttribute('tabindex');
  el.removeAttribute('draggable');
  el.setAttribute('aria-hidden', 'true');
  el.classList.remove('is-entering', 'is-changed');
  el.classList.add('motion-ghost');
  el.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  el.querySelectorAll('button').forEach((b) => { b.tabIndex = -1; });

  const check = el.querySelector('.status-check');
  if (check) {
    check.className = 'status-check is-done';
    check.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-check"/></svg>';
  }
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  return { el, rect: r };
}

export function begin(id, from, to) {
  if (from === to) return;
  if (!pending || Date.now() - pending.t > 600) pending = { t: Date.now(), first: measure(), ghosts: new Map() };
  pending.t = Date.now();
  const dialogOpen = !!document.querySelector('.task-dialog-overlay:not([hidden])');
  if (to === 'done' && !dialogOpen && !reduced() && !pending.ghosts.has(id)) {
    const g = makeGhost(id);
    if (g) pending.ghosts.set(id, g);
  }
  if (to === 'done') pending.toDone = true;
}

export function cancel(id) {
  const f = flights.get(id);
  if (f) { f.anim.cancel(); f.el.remove(); flights.delete(id); }
  if (pending) pending.ghosts.delete(id);
}

function catchTab(delay) {
  const sp = tabSprite();
  if (!sp) return;
  sp.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
    { duration: 160, delay, easing: EASE });
}

function highlightTab() {
  const tab = document.querySelector('.tn[data-page="done"]');
  if (!tab) return;
  tab.classList.add('is-received');
  setTimeout(() => tab.classList.remove('is-received'), 700);
}

export function play() {
  const p = pending;
  pending = null;
  if (!p || Date.now() - p.t > 600) return;
  if (reduced()) { if (p.toDone && !document.querySelector('.task-dialog-overlay:not([hidden])')) highlightTab(); return; }

  const now = measure();
  const sprite = tabSprite();
  const target = sprite && sprite.getClientRects().length ? sprite.getBoundingClientRect() : null;

  p.ghosts.forEach((g, id) => {
    if (!target) return;
    while (flights.size >= CAP) cancel(flights.keys().next().value);
    const s = Math.max(0.08, Math.min(1, target.width / g.rect.width));
    const dx = target.left + target.width / 2 - g.rect.width * s / 2 - g.rect.left;
    const dy = target.top + target.height / 2 - g.rect.height * s / 2 - g.rect.top;
    document.body.appendChild(g.el);
    const anim = g.el.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
      { transform: 'translate(0,0) scale(1)', opacity: 1, offset: HOLD, easing: EASE },
      { transform: `translate(${dx}px,${dy}px) scale(${s})`, opacity: 0.25, offset: 1 },
    ], { duration: FLY_MS, fill: 'forwards' });
    flights.set(id, { el: g.el, anim });
    anim.onfinish = () => { g.el.remove(); if (flights.get(id)?.el === g.el) flights.delete(id); };
    catchTab(FLY_MS - 40);

    const real = [...document.querySelectorAll(ROWS)].find((el) => el.dataset.taskId === id && visible(el));
    if (real) real.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: FLY_MS - 120, fill: 'backwards' });
  });

  now.forEach((n, id) => {
    if (p.ghosts.has(id)) return;
    const o = p.first.get(id);
    if (!o) return;
    const dx = o.rect.left - n.rect.left;
    const dy = o.rect.top - n.rect.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    const el = [...document.querySelectorAll(ROWS)].find((e) => e.dataset.taskId === id && visible(e));
    if (el) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: GLIDE_MS, easing: EASE });
  });
}

let watching = false;

function finishFiniteAnimations() {
  // The jsdom capture harness has no document.getAnimations; that is the same as nothing in flight.
  if (typeof document.getAnimations !== 'function') return;
  document.getAnimations().forEach((anim) => {
    if (!anim || typeof anim.finish !== 'function') return;

    if (anim.effect?.getTiming?.().iterations === Infinity) return;
    anim.finish();
  });
}

export function init() {
  if (watching) return;
  watching = true;
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => {
    if (e.matches) finishFiniteAnimations();
  });
  const root = document.documentElement;
  if (!root) return;
  new MutationObserver(() => { if (reduced()) finishFiniteAnimations(); })
    .observe(root, { attributes: true, attributeFilter: ['data-motion'] });
}

const OVERLAY_MS = 180;
const owners = new WeakMap();

function presentationOpacity(el) {
  if (el.hidden) return 0;
  const value = Number.parseFloat(getComputedStyle(el).opacity);
  return Number.isFinite(value) ? value : 1;
}

function claim(el) {
  const previous = owners.get(el);
  if (previous?.anim) previous.anim.cancel();
  const record = { anim: null };
  owners.set(el, record);
  return record;
}

const owns = (el, record) => owners.get(el) === record;

function fade(el, from, to, ms) {
  return el.animate([{ opacity: from }, { opacity: to }],
    { duration: ms, easing: EASE, fill: 'forwards' });
}

function completeOpen(el, record) {
  if (!owns(el, record)) return;
  el.hidden = false;
  el.inert = false;
  el.classList.remove('is-closing');
}

function completeHide(el, record) {
  if (!owns(el, record)) return;
  el.hidden = true;
  el.inert = true;
  el.classList.remove('is-closing');
}

function focusOverlay(el) {
  if (el && typeof el.focus === 'function') el.focus();
}

export function openOverlay(el) {
  if (!el) return;
  const from = presentationOpacity(el);
  const record = claim(el);
  el.hidden = false;
  el.inert = false;
  el.classList.remove('is-closing');
  // No Web Animations API (e.g. the jsdom capture harness) means no fade to wait on:

  if (isReducedMotion() || typeof el.animate !== 'function') {
    completeOpen(el, record);
    focusOverlay(el);
    return;
  }
  const anim = fade(el, from, 1, OVERLAY_MS);
  record.anim = anim;
  anim.onfinish = () => completeOpen(el, record);
  focusOverlay(el);
}

export function hideOverlay(el, ms = OVERLAY_MS) {
  if (!el || el.hidden || el.classList.contains('is-closing')) return null;
  const from = presentationOpacity(el);
  const record = claim(el);
  el.inert = true;
  el.classList.add('is-closing');
  const returnFocus = el._returnFocus ?? null;
  el._returnFocus = null;
  if (isReducedMotion() || typeof el.animate !== 'function') {
    completeHide(el, record);
  } else {
    const anim = fade(el, from, 0, ms);
    record.anim = anim;
    anim.onfinish = () => completeHide(el, record);
  }
  if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus();
  return returnFocus;
}
