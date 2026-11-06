// js/nav.js - navigation and routing (app.js split, slice 2.4).
//
// Moved verbatim out of app.js: the "Sidebar collapse" block (SIDEBAR_KEY, setSidebarCollapsed,
// its #sidebar-toggle listener and the initial collapsed state), the "Navigation" region (setPage,
// the nav-item click listeners, NAV_PAGES and the hashchange deep-link handler) and the phone
// sidebar block (.mobile-menu, #sidebar-scrim, #sidebar-close, setSidebarOpen, its Escape handler
// and the phone media query). The statements keep their original order, line starts and
// indentation; the only edits are the five the completeness proof lists - the export keyword on
// SIDEBAR_KEY, setPage and setSidebarOpen, and NAV_PAGES/phoneQuery becoming module-scope
// `export let` bindings that init() assigns (their `const` declarations cannot stay in the
// statement block, which has to run inside init()).
//
// setPage and setSidebarOpen are hub functions: app.js and three init(deps) call sites already
// received them as bare names, so both are exported and every one of those call sites now reads
// nav.setPage / nav.setSidebarOpen. js/quick-add.js stores the function at its own init, which runs
// above this module's init call in app.js - the exports are hoisted function declarations, so the
// reference is valid there and is only called later, once init() has run.
// NAV_PAGES is exported because app.js's bootstrap deep-link call reads the page list; phoneQuery
// and SIDEBAR_KEY are exported because js/settings.js takes them through its own init deps
// (closeSettings restores focus on the phone; the reset keep-set holds the sidebar key).
//
// Deliberately not moved: the #nav-badge write. It lives in updateOverview(), the overview-stats
// renderer (#sum-open, #sum-progress, #sum-today, #sum-overdue, the blank-page flag) called by
// renderAllTasks - since slice 2.6 it is in js/tasks.js, not part of this region, so the badge
// keeps exactly one writer.
//
// D6: this module never imports logic.js and never reads a bare global. `state` and `dom` are module
// imports; pageFromHash (logic.js) and setPreview (a hoisted function declaration in app.js) arrive
// through init(deps) - app.js keeps the single ./logic.js?v=5 import. The localStorage keys and
// value shapes are untouched: class_tasks_sidebar still stores '1'/'0', and the router still writes
// history.replaceState/pushState with #<page>.
//
// init() runs at the exact spot the moved statements used to occupy, so the registration order the
// Escape chain depends on does not change (sidebar toggle and its initial state, nav items,
// hashchange, phone menu, scrim, close, document Escape, media query, initial closed state).
// NAV_PAGES and phoneQuery are built in init(), never at module-evaluation time.
//
// Importing this module touches nothing: no DOM read, no listener, no state read and no timer at
// evaluation time, so
//   node --input-type=module -e "await import('./js/nav.js')"
// is clean under plain Node (docs/p6-architecture-findings.md 4-5, DECISIONS.md D6).

import { state } from './state.js';
import { dom } from './dom.js';

let pageFromHash = null;     // app.js: logic.js's pageFromHash, used by the hashchange handler
let setPreview = null;       // app.js: the nav click and hashchange handlers leave the admin preview

// --- Sidebar collapse ---
export const SIDEBAR_KEY = 'class_tasks_sidebar';
function setSidebarCollapsed(collapsed, save = true) {
  document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'open';
  dom.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  dom.sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  dom.navItems.forEach((item) => {
    if (collapsed) item.title = item.querySelector('span:not(.nav-badge)').textContent;
    else item.removeAttribute('title');
  });
  if (save) { try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch (e) {} }
}

// --- Navigation ---
export function setPage(pageName, updateHash = true) {
  const activeItem = dom.navItems.find((item) => item.dataset.page === (pageName === 'my-tasks' && !state.isAdmin ? 'class-tasks' : pageName)) || dom.navItems[0];
  const activePageName = activeItem.dataset.page;
  const activePage = dom.pages.find((page) => page.dataset.pageView === activePageName);

  dom.navItems.forEach((item) => {
    const isActive = item === activeItem;
    item.classList.toggle('is-active', isActive);
    item.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  dom.pages.forEach((page) => {
    page.hidden = page !== activePage;
  });

  dom.breadcrumbCurrent.textContent = activeItem.querySelector('span:not(.nav-badge)').textContent;
  document.title = `${activeItem.querySelector('span:not(.nav-badge)').textContent} — TaskTracker`;

  if (updateHash && window.location.hash !== `#${activePageName}`) {
    if (updateHash === 'push') history.pushState(null, '', `#${activePageName}`);
    else history.replaceState(null, '', `#${activePageName}`);
  }

  setSidebarOpen(false, false);
}

// app.js's own bootstrap deep-link call reads this page list too (the setPage call at the bottom
// of app.js, inside its init()). It is built in init() from dom.navItems.
export let NAV_PAGES = null;

   // --- Phone sidebar: scrim, Escape, focus ---
export let phoneQuery = null;   // app.js and js/settings.js: the matchMedia('(max-width: 720px)') query
export function setSidebarOpen(open, restoreFocus = true) {
     const phone = phoneQuery.matches;
     const on = open && phone;
     dom.sidebar.classList.toggle('is-open', on);
     dom.sidebarScrim.hidden = !on;
     dom.sidebar.inert = phone && !on;
     dom.mainContent.inert = on;
     dom.mobileMenu.setAttribute('aria-expanded', String(on));
     document.body.style.overflow = on ? 'hidden' : '';
     if (on) (dom.sidebar.querySelector('.nav-item.is-active') || dom.sidebar.querySelector('.nav-item')).focus();
     else if (restoreFocus && phone) dom.mobileMenu.focus();
   }

// Called once by app.js, at the spot the moved statements used to occupy, after cacheDom(). Both
// deps are available when it runs: pageFromHash is the logic.js import, setPreview is hoisted.
export function init(deps) {
  pageFromHash = deps.pageFromHash;
  setPreview = deps.setPreview;
dom.sidebarToggle.addEventListener('click', () => {
  setSidebarCollapsed(document.documentElement.dataset.sidebar !== 'collapsed');
});
setSidebarCollapsed(document.documentElement.dataset.sidebar === 'collapsed', false);
dom.navItems.forEach((item) => {
  item.addEventListener('click', (event) => {
    event.preventDefault();
    if (state.previewing) setPreview(false);
    setPage(item.dataset.page, 'push');
  });
});
// Deep links: follow hash edits, pasted links, and Back/Forward navigation.
NAV_PAGES = dom.navItems.map((item) => item.dataset.page);
window.addEventListener('hashchange', () => {
  if (state.previewing) setPreview(false);
  setPage(pageFromHash(window.location.hash, NAV_PAGES, state.isAdmin), false);
});
   phoneQuery = matchMedia('(max-width: 720px)');
   dom.mobileMenu.addEventListener('click', () => setSidebarOpen(!dom.sidebar.classList.contains('is-open')));
     dom.sidebarScrim.addEventListener('click', () => setSidebarOpen(false));
  document.querySelector('#sidebar-close').addEventListener('click', () => setSidebarOpen(false));
   document.addEventListener('keydown', (e) => {
     if (e.key === 'Escape' && dom.sidebar.classList.contains('is-open')) setSidebarOpen(false);
   });
   phoneQuery.addEventListener('change', () => setSidebarOpen(false, false));
   setSidebarOpen(false, false);
}
