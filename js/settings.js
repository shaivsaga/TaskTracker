import { state } from './state.js';
import { dom } from './dom.js';
import { KEYS, currentSection, sectionKey, keysForSection } from './util.js';
import { openOverlay, hideOverlay } from './motion.js';

let $ = null;
let adminHint = null;
let signIn = null;
let showToast = null;
let JSON_POST = null;
let ADMIN_KEY = null;
let SIGNED_OUT_KEY = null;

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
  insightsPrefsKey = sectionKey('class_tasks_insights_prefs', section),
} = {}) {
  const prefix = sectionKey('class_tasks_', section);
  const keep = new Set([...DEVICE_KEEP, adminKey, signedOutKey, cacheKey, insightsPrefsKey].filter(Boolean));
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

export function init(deps) {
  $ = deps.$;
  adminHint = deps.adminHint;
  signIn = deps.signIn;
  showToast = deps.showToast;
  JSON_POST = deps.JSON_POST;
  ADMIN_KEY = deps.ADMIN_KEY;
  SIGNED_OUT_KEY = deps.SIGNED_OUT_KEY;
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
