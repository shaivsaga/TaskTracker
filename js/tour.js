// js/tour.js - the first-time tutorial (app.js split, slice 2.3).
//
// Moved verbatim out of app.js: TOUR_KEY, tourVisible, TOUR_STEPS, tourSeen, tourTarget,
// renderTourSample, placeTour, showTourStep, startTour, endTour and the region's listeners.
// tourSeen and startTour stay exported because app.js's init() still auto-opens the tour on a
// first visit; nothing else in the region is read from outside the module.
//
// D6: this module never imports logic.js and never reads a bare global. `$` (app.js's
// document.querySelector shorthand), the STATUS_LABELS map from logic.js, STATUS_ORDER,
// createSubjectTag, setPreview, setPage, hideAnimated and closeSettings arrive
// through init(deps), which app.js calls at the spot the moved listeners used to occupy.
//
// tourIndex/tourTimer/tourSampleStatus stay in js/state.js (slice 2.1) and are read and written
// through `state` here. The first-run flag keeps its storage key (class_tasks_tour_seen) and its
// value ('1').
//
// Importing this module touches nothing: no DOM read, no listener, no state read and no timer at
// evaluation time, so
//   node --input-type=module -e "await import('./js/tour.js')"
// is clean under plain Node (docs/p6-architecture-findings.md 4, DECISIONS.md D6).

import { state } from './state.js';
import { dom } from './dom.js';

let $ = null;                 // app.js's querySelector shorthand, used by the steps and the overlay
let STATUS_LABELS = null;     // logic.js
let STATUS_ORDER = null;      // app.js: the three statuses the sample picker offers
let createSubjectTag = null;  // app.js: the sample card's subject chip
let setPreview = null;        // app.js: startTour leaves admin preview
let setPage = null;           // app.js: startTour switches to the class tasks page
let hideAnimated = null;      // app.js: endTour hides the overlay
let closeSettings = null;     // app.js: the Settings replay button closes Settings first
// --- Phase 5: first-time tutorial. Sample content lives only inside the overlay: never in progress, the draft or the board. ---
const TOUR_KEY = 'class_tasks_tour_seen';
const tourVisible = (el) => (el && el.getClientRects().length ? el : null);
const TOUR_STEPS = [
  { title: 'Welcome to TaskTracker', body: 'A quick tour of how the class board works. It takes under a minute and you can skip it at any time.' },
  { title: 'Tasks from your class', body: 'Tasks posted for the class appear here, as a list or a board. Tap a task to open its notes and links.',
    phoneBody: 'Tasks posted for the class appear here as a list, soonest due first. Tap a task to open its notes and links.',
    target: () => tourVisible($('#class-board:not([hidden])')) || tourVisible($('#class-task-list:not([hidden])')) },
  { title: 'Track your own progress', body: 'Tap the box on a task and pick not started, in progress or done. Try it on this sample. Nothing here is saved.', sample: true },
  { title: 'Search', body: 'Search by title, subject code or words inside the notes.',
    target: () => tourVisible($('#page-class-tasks .search')) },
  { title: 'List or board', body: 'Switch between a simple list and a three-column board. The app remembers your choice.',
    phoneBody: 'On a phone, tasks stay in one simple list. On a bigger screen you can switch to a three-column board.',
    target: () => tourVisible($('#page-class-tasks .view-tabs')) },
  { title: 'You are set', body: 'Your progress is saved in this browser only. Calendar, Done and Past are in the navigation bar. You can replay this tour from Settings.' },
];

export function tourSeen() { try { return localStorage.getItem(TOUR_KEY) === '1'; } catch (e) { return true; } }
const tourTarget = () => { const s = TOUR_STEPS[state.tourIndex]; return s && s.target ? s.target() : null; };
// A step may carry its own phone copy; phones get a single list and no Board/List switch.
const tourIsPhone = () => window.matchMedia('(max-width: 719px)').matches;
const tourBody = (step) => (step.phoneBody && tourIsPhone() ? step.phoneBody : step.body);

function renderTourSample() {
  const s = state.tourSampleStatus;
  const card = document.createElement('article');
  card.className = 'task-card tour-sample-card';
  card.dataset.status = s;
  const head = document.createElement('div');
  head.className = 'task-card-header';
  const check = document.createElement('button');
  check.type = 'button';
  check.className = `status-check is-${s.replace(/_/g, '-')}`;
  check.setAttribute('aria-label', `Sample task status: ${STATUS_LABELS[s]}. Press to change.`);
  check.innerHTML = s === 'done' ? '<svg class="i" aria-hidden="true"><use href="#i-check"/></svg>'
    : s === 'in_progress' ? '<svg class="i" aria-hidden="true"><use href="#i-minus"/></svg>' : '';
  let menu = null;
  const onOutside = (e) => {
    if (menu && !menu.contains(e.target) && !check.contains(e.target)) closeMenu(false);
  };
  const closeMenu = (refocus) => {
    if (!menu) return;
    menu.remove();
    menu = null;
    check.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutside, true);
    if (refocus) check.focus();
  };
  check.setAttribute('aria-haspopup', 'listbox');
  check.setAttribute('aria-expanded', 'false');
  check.addEventListener('click', () => {
    if (menu) { closeMenu(true); return; }
    menu = document.createElement('div');
    menu.className = 'status-dropdown';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Status');
    STATUS_ORDER.forEach((st) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'status-option' + (st === s ? ' is-active' : '');
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', String(st === s));
      opt.innerHTML = `<span class="status-dot dot-${st.replace(/_/g, '-')}"></span> ${STATUS_LABELS[st]}`;
      opt.addEventListener('click', () => {
        closeMenu(false);
        state.tourSampleStatus = st;
        renderTourSample();
        dom.tourSample.querySelector('.status-check').focus();
      });
      menu.appendChild(opt);
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeMenu(true); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const opts = [...menu.children];
        const i = opts.indexOf(document.activeElement);
        opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length].focus();
      }
    });
    head.appendChild(menu);
    check.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onOutside, true);
    (menu.querySelector('.is-active') || menu.firstChild).focus();
  });
  const title = document.createElement('h3');
  title.className = 'task-card-title';
  title.textContent = 'Sample: GENMATH worksheet';
  head.append(check, title);
  const foot = document.createElement('div');
  foot.className = 'task-card-footer';
  const dueBadge = document.createElement('span');
  dueBadge.className = 'due-badge';
  dueBadge.textContent = STATUS_LABELS[s];
  foot.append(createSubjectTag('GENMATH'), dueBadge);
  card.append(head, foot);
  dom.tourSample.replaceChildren(card);
}

function placeTour(el) {
  dom.tourOverlay.classList.toggle('is-centered', !el);
  const vw = window.innerWidth, vh = window.innerHeight, gap = 16;
  const cw = dom.tourCard.offsetWidth, ch = dom.tourCard.offsetHeight;
  let x, y;
  if (!el) {
    x = (vw - cw) / 2;
    y = (vh - ch) / 2;
  } else {
    const r = el.getBoundingClientRect();
    const top = Math.max(8, r.top - 8), bottom = Math.min(vh - 8, r.bottom + 8);
    const left = Math.max(8, r.left - 8), right = Math.min(vw - 8, r.right + 8);
    dom.tourSpot.style.top = `${top}px`;
    dom.tourSpot.style.left = `${left}px`;
    dom.tourSpot.style.width = `${Math.max(0, right - left)}px`;
    dom.tourSpot.style.height = `${Math.max(0, bottom - top)}px`;
    if (vh - bottom >= ch + gap) y = bottom + gap;
    else if (top >= ch + gap) y = top - ch - gap;
    else y = vh - ch - gap;
    x = Math.max(gap, Math.min(left, vw - cw - gap));
  }
  dom.tourCard.style.left = `${Math.max(gap, x)}px`;
  dom.tourCard.style.top = `${Math.max(gap, y)}px`;
}

function showTourStep(i) {
  state.tourIndex = i;
  const step = TOUR_STEPS[i];
  const last = i === TOUR_STEPS.length - 1;
  $('#tour-step').textContent = `Step ${i + 1} of ${TOUR_STEPS.length}`;
  $('#tour-title').textContent = step.title;
  $('#tour-body').textContent = tourBody(step);
  dom.tourSample.hidden = !step.sample;
  if (step.sample) { state.tourSampleStatus = 'not_started'; renderTourSample(); }
  $('#tour-back').hidden = i === 0;
  $('#tour-skip').hidden = last;
  $('#tour-next').textContent = last ? 'Done' : 'Next';
  const el = tourTarget();
  if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  placeTour(el);
  $('#tour-next').focus();
}

export function startTour() {
  if (!dom.tourOverlay.hidden) return;
  if (state.previewing) setPreview(false);
  setPage('class-tasks');
  dom.tourOverlay._returnFocus = document.activeElement;
  dom.tourOverlay.classList.remove('is-closing');
  dom.tourOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
  showTourStep(0);
  // Layout can shift while the board loads, so keep the spotlight on its target.
  clearInterval(state.tourTimer);
  state.tourTimer = setInterval(() => { if (state.tourIndex >= 0) placeTour(tourTarget()); }, 400);
}

function endTour() {
  if (dom.tourOverlay.hidden || dom.tourOverlay.classList.contains('is-closing')) return;
  try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) {}
  clearInterval(state.tourTimer);
  state.tourTimer = null;
  state.tourIndex = -1;
  document.body.style.overflow = '';
  hideAnimated(dom.tourOverlay);
}

// Called once by app.js, at the spot the listeners below used to occupy, after cacheDom(). The
// module keeps every dep in a module-local binding; `$` is safe to pass by value because it is
// declared above that call site in app.js.
export function init(deps) {
  $ = deps.$;
  STATUS_LABELS = deps.STATUS_LABELS;
  STATUS_ORDER = deps.STATUS_ORDER;
  createSubjectTag = deps.createSubjectTag;
  setPreview = deps.setPreview;
  setPage = deps.setPage;
  hideAnimated = deps.hideAnimated;
  closeSettings = deps.closeSettings;
$('#tour-next').addEventListener('click', () => {
  if (state.tourIndex >= TOUR_STEPS.length - 1) endTour(); else showTourStep(state.tourIndex + 1);
});
$('#tour-back').addEventListener('click', () => { if (state.tourIndex > 0) showTourStep(state.tourIndex - 1); });
$('#tour-skip').addEventListener('click', endTour);
$('#settings-replay').addEventListener('click', () => { closeSettings(); startTour(); });
window.addEventListener('resize', () => { if (state.tourIndex >= 0) placeTour(tourTarget()); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dom.tourOverlay.hidden && !dom.tourOverlay.classList.contains('is-closing')) endTour();
});
}
