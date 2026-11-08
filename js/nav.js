// js/nav.js - navigation and routing (app.js split, slice 2.4).
//
// Moved verbatim out of app.js: the "Navigation" region (setPage, the nav-item click listeners,
// NAV_PAGES and the hashchange deep-link handler). Slice 3.1e deleted the sidebar, so the
// "Sidebar collapse" block (SIDEBAR_KEY, setSidebarCollapsed, its #sidebar-toggle listener and the
// initial collapsed state) and the phone-drawer block (setSidebarOpen, #sidebar-scrim,
// #sidebar-close, the document Escape handler, the media-query change listener and the inert/focus
// management) are gone, together with the call at the end of setPage. The nav tiles are now the
// mockup's header tiles (header.tb > nav.nav > a.tn.nav-item).
//
// setPage is a hub function: app.js and the publish, quick-add, settings and tour init deps already
// received it as a bare name, so it stays exported and every one of those call sites reads
// nav.setPage. NAV_PAGES is exported because app.js's bootstrap deep-link call reads the page list.
// SIDEBAR_KEY stays exported because the pinned inline boot script in index.html and js/settings.js's
// reset keep-set still name the localStorage key class_tasks_sidebar; the data-sidebar attribute that
// script sets is now read by nothing. (An inline classic script cannot import a module, so it never
// read this export either.)
//
// The page name comes from the tile's own title/aria-label, not from a text node: the mockup tiles
// carry a clipped .lbl (the short phone label) and no desktop text label, and the router has to keep
// writing the names the old sidebar labels held (Class tasks, Admin, Completed tasks, Past tasks,
// Calendar).
//
// Deliberately not moved: the #nav-badge write. It lives in updateOverview(), the overview-stats
// renderer (#sum-open, #sum-progress, #sum-today, #sum-overdue, the blank-page flag) called by
// renderAllTasks - since slice 2.6 it is in js/tasks.js, not part of this region, so the badge
// keeps exactly one writer.
//
// D6: this module never imports logic.js and never reads a bare global. `state` and `dom` are module
// imports; pageFromHash (logic.js) and setPreview (a hoisted function declaration in app.js) arrive
// through init(deps) - app.js keeps the single ./logic.js?v=5 import. The localStorage key and value
// shape are untouched: class_tasks_sidebar still stores '1'/'0', and the router still writes
// history.replaceState/pushState with #<page>.
//
// init() runs at the exact spot the moved statements used to occupy, so the registration order the
// Escape chain depends on does not change (nav items, then hashchange). NAV_PAGES is built in init(),
// never at module-evaluation time.
//
// Importing this module touches nothing: no DOM read, no listener, no state read and no timer at
// evaluation time, so
//   node --input-type=module -e "await import('./js/nav.js')"
// is clean under plain Node (docs/p6-architecture-findings.md 4-5, DECISIONS.md D6).

import { state } from './state.js';
import { dom } from './dom.js';

let pageFromHash = null;     // app.js: logic.js's pageFromHash, used by the hashchange handler
let setPreview = null;       // app.js: the nav click and hashchange handlers leave the admin preview

// --- Navigation ---
export const SIDEBAR_KEY = 'class_tasks_sidebar';   // frozen: the inline boot script and RESET_KEEP read it

// The tile's page name. It has to come from title/aria-label: the .lbl span is the clipped phone
// label (aria-hidden), so it is not the app's page name on desktop.
const navName = (item) => item.getAttribute('title') || item.getAttribute('aria-label') || item.dataset.page;

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

  dom.breadcrumbCurrent.textContent = navName(activeItem);
  document.title = `${navName(activeItem)} — TaskTracker`;

  if (updateHash && window.location.hash !== `#${activePageName}`) {
    if (updateHash === 'push') history.pushState(null, '', `#${activePageName}`);
    else history.replaceState(null, '', `#${activePageName}`);
  }
}

// app.js's own bootstrap deep-link call reads this page list too (the setPage call at the bottom
// of app.js, inside its init()). It is built in init() from dom.navItems.
export let NAV_PAGES = null;

// Called once by app.js, at the spot the moved statements used to occupy, after cacheDom(). Both
// deps are available when it runs: pageFromHash is the logic.js import, setPreview is hoisted.
export function init(deps) {
  pageFromHash = deps.pageFromHash;
  setPreview = deps.setPreview;
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
}
