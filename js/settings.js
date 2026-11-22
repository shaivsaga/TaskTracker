// js/settings.js - the settings panel and the theme (app.js split, slice 2.4).
//
// Moved verbatim out of app.js: the theme block that sat next to the new-task button (applyTheme,
// the toggle's initial aria-label and its click listener) and the "Settings and reset" region
// (RESET_PHRASE, RESET_KEEP, showResetConfirm, openSettings, closeSettings, resetLocalData,
// logoutAdmin and every listener of the panel, including its document-level Escape handler).
// closeSettings stays exported because app.js still calls it from two places: the tutorial closes
// Settings before it starts (js/tour.js receives it through its own init deps) and the transfer
// panel closes Settings before it opens. Nothing else in either block is read from outside.
//
// One init() registers both blocks, and app.js calls it at the settings region's old position.
// That is the only place it can go: `$` is declared below the theme block in app.js, so passing it
// there would throw while app.js is still evaluating. The theme toggle's click handler is the only
// listener on #theme-toggle, so registering it later competes with nothing; every other listener
// keeps the exact registration order it had in app.js (settings-open, logout, login, close,
// overlay, reset start/cancel/input/submit, then the document-level Escape), which is the order
// the Escape chain relies on (docs/p6-architecture-findings.md 5).
//
// D6: this module never imports logic.js and never reads a bare global. `$`, hideAnimated,
// adminHint, signIn, showToast, JSON_POST, ADMIN_KEY and SIGNED_OUT_KEY arrive
// through init(deps) - all of them are declared above the call site in app.js, so they can be
// passed by value. `state`, `dom` and `KEYS` are module imports, not globals. The
// localStorage keys and value shapes are untouched: class_tasks_theme stays 'light'/'dark', the
// reset keeps exactly class_tasks_theme, the literal class_tasks_sidebar key, ADMIN_KEY,
// SIGNED_OUT_KEY and KEYS.cache, and the login/logout handlers still write ADMIN_KEY and
// SIGNED_OUT_KEY. The sidebar key is a literal here because its export in js/nav.js was removed
// with the inline sidebar boot script; keeping it in the keep-set preserves stored values.
//
// Importing this module touches nothing: no DOM read, no listener, no state read and no timer at
// evaluation time, so
//   node --input-type=module -e "await import('./js/settings.js')"
// is clean under plain Node (docs/p6-architecture-findings.md 4-5, DECISIONS.md D6).

import { state } from './state.js';
import { dom } from './dom.js';
import { KEYS, currentSection, sectionKey, keysForSection } from './util.js';
import { openOverlay, hideOverlay } from './motion.js';

let $ = null;                 // app.js's querySelector shorthand, used by the panel's rows
let adminHint = null;         // app.js: openSettings offers the sign-in row only when a hint is stored
let signIn = null;            // app.js: the sign-in row's Basic Auth login
let showToast = null;         // app.js: the logout, login and reset failure messages
let JSON_POST = null;         // app.js: the logout request's POST options
let ADMIN_KEY = null;         // app.js: the admin flag key the reset keeps and the login row writes
let SIGNED_OUT_KEY = null;    // app.js: the deliberate-logout key the reset keeps and logout writes

// Theme. The saved choice is 'light', 'dark' or nothing (= System). The head script in index.html
// sets the first paint; after that the top-bar toggle and Settings > Appearance both go through here.
const THEME_COLOR = { light: '#F4EFE2', dark: '#0F1226' };
const systemQuery = typeof window !== 'undefined' && window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
function savedChoice() {
  try { const v = localStorage.getItem('class_tasks_theme'); return v === 'light' || v === 'dark' ? v : 'system'; } catch (e) { return 'system'; }
}
function applyChoice(choice) {
  const theme = choice !== 'system' ? choice : (systemQuery && systemQuery.matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  document.getElementById('meta-theme-color')?.setAttribute('content', THEME_COLOR[theme]);
  dom.themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  return theme;
}
function paintThemeChoice() {
  const choice = savedChoice();
  document.querySelectorAll('#theme-seg [data-theme-choice]').forEach((b) => {
    const on = b.dataset.themeChoice === choice;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
function setChoice(choice) {
  try { choice === 'system' ? localStorage.removeItem('class_tasks_theme') : localStorage.setItem('class_tasks_theme', choice); } catch (e) {}
  applyChoice(choice);
  paintThemeChoice();
}

// --- Settings and reset ---
const RESET_PHRASE = 'RESET';
const DEVICE_KEEP = [
  'class_tasks_theme',
  'class_tasks_sidebar',
  'class_tasks_view_class',
  'class_tasks_view_admin',
  'class_tasks_tour_seen',
];

function storageKeys(storage) {
  if (typeof storage.key === 'function' && typeof storage.length === 'number') {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k !== null) keys.push(k);
    }
    return keys;
  }
  return Object.keys(storage);
}

export function mountSectionBadges(doc = document, section = currentSection()) {
  if (!section) return;
  const label = `SECTION ${section.toUpperCase()}`;
  const makeBadge = () => {
    const badge = doc.createElement('span');
    badge.className = 'section-badge';
    badge.dataset.sectionBadge = section;
    badge.textContent = label;
    return badge;
  };
  doc.querySelectorAll('.tb .brand, .brand-m').forEach((el) => {
    if (el.querySelector('[data-section-badge]')) return;
    el.appendChild(makeBadge());
    if (el.getAttribute('aria-label') === 'TaskTracker home') {
      el.setAttribute('aria-label', `TaskTracker ${label} home`);
    }
  });
  const release = doc.querySelector('#admin-bar .admin-release');
  if (release && !release.querySelector('[data-section-badge]')) {
    const applyBtn = release.querySelector('#btn-apply');
    if (applyBtn) release.insertBefore(makeBadge(), applyBtn);
    else release.appendChild(makeBadge());
  }
}

function showResetConfirm(show, focus = true) {
  dom.resetForm.hidden = !show;
  dom.resetStart.hidden = show;
  dom.resetInput.value = '';
  dom.resetSubmit.disabled = true;
  if (focus) (show ? dom.resetInput : dom.resetStart).focus();
}

function openSettings() {
  showResetConfirm(false, false);
  paintThemeChoice();
  $('#settings-logout-row').hidden = !state.isAdmin;
  $('#settings-login-row').hidden = state.isAdmin || !adminHint();
  openOverlay(dom.settingsOverlay);
  $('#settings-close').focus();
  document.getElementById('reset-admin-note').hidden = !state.isAdmin;
}

export function closeSettings() {
  hideOverlay(dom.settingsOverlay);
  dom.settingsOpen.focus();
}

export function resetSectionStorage({
  storage = localStorage,
  section = currentSection(),
  adminKey = ADMIN_KEY || sectionKey('class_tasks_admin', section),
  signedOutKey = SIGNED_OUT_KEY || sectionKey('class_tasks_signed_out', section),
  cacheKey = keysForSection(section).cache,
} = {}) {
  const prefix = sectionKey('class_tasks_', section);
  const keep = new Set([...DEVICE_KEEP, adminKey, signedOutKey, cacheKey].filter(Boolean));
  try {
    storageKeys(storage)
      .filter((k) => k.startsWith(prefix) && !keep.has(k))
      .forEach((k) => storage.removeItem(k));
    return true;
  } catch (e) { return false; }
}

export function resetLocalData() {
  return resetSectionStorage();
}

// Phase 4: client-only logout. Clears the admin flag and reloads into the student view. The draft stays in localStorage.
async function logoutAdmin() {
  const btn = $('#settings-logout');
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    const res = await fetch('api/logout.php', JSON_POST);
    if (!res.ok) throw new Error();
  } catch (e) {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    showToast('Could not log out. Check your connection and try again.');
    return;
  }
  try { localStorage.setItem(SIGNED_OUT_KEY, '1'); } catch (e) {}
  state.isAdmin = false;
  state.previewing = false;
  const params = new URLSearchParams(location.search);
  params.delete('admin');
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + '#class-tasks');
  location.reload();
}

// Called once by app.js, at the spot the moved listeners used to occupy, after cacheDom(). Every
// dep is declared above that call site in app.js, so passing them by value is safe. The two blocks
// register in their original source order: the theme toggle first, then the settings panel.
export function init(deps) {
  $ = deps.$;                                 // the panel's rows
  adminHint = deps.adminHint;                 // openSettings decides whether to offer sign-in
  signIn = deps.signIn;                       // the sign-in row
  showToast = deps.showToast;                 // logout, login and reset failure messages
  JSON_POST = deps.JSON_POST;                 // the logout request's POST options
  ADMIN_KEY = deps.ADMIN_KEY;                 // the reset's keep-set, and the login row writes it
  SIGNED_OUT_KEY = deps.SIGNED_OUT_KEY;       // the reset's keep-set, and logout writes it
applyChoice(savedChoice());
dom.themeToggle.addEventListener('click', () => {
  setChoice(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
$('#theme-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme-choice]');
  if (b) setChoice(b.dataset.themeChoice);
});
if (systemQuery) systemQuery.addEventListener('change', () => { if (savedChoice() === 'system') applyChoice('system'); });
dom.settingsOpen.addEventListener('click', openSettings);

$('#settings-logout').addEventListener('click', logoutAdmin);
$('#settings-login').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.classList.add('is-loading');
  if (await signIn()) {
    try { localStorage.setItem(ADMIN_KEY, '1'); localStorage.removeItem(SIGNED_OUT_KEY); } catch (e2) {}
    location.reload();
    return;
  }
  btn.disabled = false;
  btn.classList.remove('is-loading');
  showToast('Sign in failed or was cancelled.');
});
$('#settings-close').addEventListener('click', closeSettings);
dom.settingsOverlay.addEventListener('click', (e) => { if (e.target === dom.settingsOverlay) closeSettings(); });
dom.resetStart.addEventListener('click', () => showResetConfirm(true));
$('#settings-reset-cancel').addEventListener('click', () => showResetConfirm(false));
dom.resetInput.addEventListener('input', () => { dom.resetSubmit.disabled = dom.resetInput.value.trim() !== RESET_PHRASE; });
dom.resetForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (dom.resetInput.value.trim() !== RESET_PHRASE) return;
  dom.resetSubmit.disabled = true;
  dom.resetSubmit.classList.add('is-loading');
  if (resetLocalData()) { location.reload(); return; }
  dom.resetSubmit.classList.remove('is-loading');
  dom.resetSubmit.disabled = false;
  showToast('Could not reset. Browser storage is unavailable.');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dom.settingsOverlay.hidden && !dom.settingsOverlay.classList.contains('is-closing')) closeSettings();
});
}
