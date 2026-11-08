// js/motion.js - the "task completed" sequence. A leaf module: it imports nothing and only reads the DOM.
//
// Flow: setStatus() calls begin() BEFORE the state changes (so the old layout can be measured);
// renderAllTasks() calls play() AFTER it has re-rendered.
//   - Every visible row/card that moved glides from its old spot to its new one (FLIP, transform only).
//   - A list row that was just marked done leaves a ghost: a copy that is stamped (checkbox filled), holds
//     for a beat, then folds into the Done tab, which takes a two-step "catch".
//   - Board cards do not fly: the Done column is already on screen, so the card slides there.
// Everything animates transform and opacity only. Reduced motion: no movement at all, the Done tab takes
// a short static highlight instead. Undo cancels the ghost and lets the rows glide back.

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';   // fast arrival, soft stop
const FLY_MS = 380;                             // whole completion, tap to catch
const HOLD = 0.18;                              // share of FLY_MS the stamped ghost sits still
const GLIDE_MS = 180;                           // gap closing
const CAP = 6;                                  // simultaneous ghosts

const ROWS = '.task-row[data-task-id], .task-card[data-task-id]';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  || document.documentElement.dataset.motion === 'reduce';
const visible = (el) => el.getClientRects().length > 0 && !el.closest('.motion-ghost');
const tabSprite = () => document.querySelector('.tn[data-page="done"] .sp');

let pending = null;
const flights = new Map();   // task id -> { el, anim }

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
  if (!src || src.classList.contains('task-card')) return null;      // board: the card slides, no flight
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
  // Show the stamped state from the first frame: the checkbox is already filled.
  const check = el.querySelector('.status-check');
  if (check) {
    check.className = 'status-check is-done';
    check.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-check"/></svg>';
  }
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  return { el, rect: r };
}

// Call before the status changes. from/to are status strings.
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
    { duration: 160, delay, easing: 'steps(2)' });
}

function highlightTab() {
  const tab = document.querySelector('.tn[data-page="done"]');
  if (!tab) return;
  tab.classList.add('is-received');
  setTimeout(() => tab.classList.remove('is-received'), 700);
}

// Call after renderAllTasks() has rebuilt the lists.
export function play() {
  const p = pending;
  pending = null;
  if (!p || Date.now() - p.t > 600) return;
  if (reduced()) { if (p.toDone && !document.querySelector('.task-dialog-overlay:not([hidden])')) highlightTab(); return; }

  const now = measure();
  const sprite = tabSprite();
  const target = sprite && sprite.getClientRects().length ? sprite.getBoundingClientRect() : null;

  // 1. Ghosts: stamp, hold, fold into the Done tab.
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
    // The real row is already in its new place; let it arrive once the ghost has gone.
    const real = [...document.querySelectorAll(ROWS)].find((el) => el.dataset.taskId === id && visible(el));
    if (real) real.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: FLY_MS - 120, fill: 'backwards' });
  });

  // 2. Everything else that moved glides into its new place.
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

// --- Arrivals: pages and lists come in once, capped, never on every re-render -----------------------------
// body[data-enter] switches the CSS entrance on for ~0.7s. It is set when a page is shown and on the first
// board paint, so ticking a task (which rebuilds the list) never replays it.
let enterTimer = null;
export function enter() {
  if (reduced()) return;
  document.body.dataset.enter = '1';
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => { delete document.body.dataset.enter; }, 700);
}
let watching = false;
export function init() {
  if (watching) return;
  watching = true;
  const host = document.querySelector('.page-container');
  if (!host) return;
  new MutationObserver((list) => {
    if (list.some((r) => r.target.classList?.contains('page') && !r.target.hidden)) enter();
  }).observe(host, { attributes: true, attributeFilter: ['hidden'], subtree: true });
}
