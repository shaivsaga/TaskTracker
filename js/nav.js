import { state } from './state.js';
import { dom } from './dom.js';

let pageFromHash = null;
let setPreview = null;

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

  document.dispatchEvent(new CustomEvent('app:page-shown', { detail: { page: activePageName } }));

  dom.breadcrumbCurrent.textContent = navName(activeItem);
  document.title = `${navName(activeItem)} — TaskTracker`;

  if (updateHash && window.location.hash !== `#${activePageName}`) {
    if (updateHash === 'push') history.pushState(null, '', `#${activePageName}`);
    else history.replaceState(null, '', `#${activePageName}`);
  }
}

export let NAV_PAGES = null;

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

  NAV_PAGES = dom.navItems.map((item) => item.dataset.page);
  window.addEventListener('hashchange', () => {
    if (state.previewing) setPreview(false);
    setPage(pageFromHash(window.location.hash, NAV_PAGES, state.isAdmin), false);
  });
}
