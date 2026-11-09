// tests/e2e/class-filters.mjs - behavioural coverage for the class List filters.
// The audit's main() owns the browser, server and fixture; this module gets those helpers so every
// scenario runs the real app through the same isolated boot(), never an app-function copy.

const READ = `(() => {
  const rows = [...document.querySelectorAll('#class-task-list .task-row')];
  const list = document.getElementById('class-task-list');
  const board = document.getElementById('class-board');
  const subject = document.getElementById('class-subject-filter');
  const status = document.getElementById('class-status-filter');
  const search = document.getElementById('class-task-search');
  const active = document.activeElement;
  const empty = list && list.querySelector('.list-empty');
  const toast = document.getElementById('toast');
  const text = (id) => (document.getElementById(id) || {}).textContent || '';
  return {
    rows: rows.length, rowIds: rows.map((r) => r.dataset.taskId), board: board.querySelectorAll('.task-card').length,
    subject: subject.value, status: status.value, search: search.value, subjectOptions: subject.options.length,
    empty: empty ? empty.textContent.trim() : '',
    clear: !!(empty && [...empty.querySelectorAll('button')].some((b) => /Clear filters/.test(b.textContent))),
    activeId: active.id, activeCls: typeof active.className === 'string' ? active.className : '',
    activeTask: active.closest('[data-task-id]') ? active.closest('[data-task-id]').dataset.taskId : null,
    toast: !toast.hidden, toastText: text('toast-message'), feedback: text('action-feedback'),
    listVisible: list.getClientRects().length > 0, boardVisible: board.getClientRects().length > 0,
    filtersDisplay: getComputedStyle(document.querySelector('.class-filters')).display,
    view: document.getElementById('page-class-tasks').dataset.view,
    dialogOpen: !document.getElementById('task-dialog-overlay').hidden,
    progress: localStorage.getItem('class_tasks_progress'),
  };
})()`;

const ADMIN_LAYOUT = `(() => {
  const page = document.getElementById('page-my-tasks');
  const tabs = page.querySelector('.view-tabs');
  const board = page.querySelector('.kanban-board');
  const list = document.getElementById('task-list');
  return { view: page.dataset.view, tabs: getComputedStyle(tabs).display, board: getComputedStyle(board).display,
    list: getComputedStyle(list).display, boardVisible: board.getClientRects().length > 0,
    listVisible: list.getClientRects().length > 0, saved: localStorage.getItem('class_tasks_view_admin') };
})()`;

const tick = (sleep) => sleep(120);
const clone = (value) => JSON.parse(JSON.stringify(value));

async function waitFor(cdp, sleep, expression, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if (await cdp.evaluate(expression)) return true;
    await sleep(100);
  }
  return false;
}
const read = (cdp) => cdp.evaluate(READ);

async function setValue(cdp, sleep, id, value, eventName) {
  await cdp.evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return false;
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event(${JSON.stringify(eventName)}, { bubbles: true }));
    return el.value;
  })()`);
  await tick(sleep);
}

async function focus(cdp, selector) {
  return cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    return document.activeElement === el;
  })()`);
}

// Replace only data/current.json, then run the app's real visibility-change reload path.
async function overrideBoard(cdp, board) {
  const reply = board === null ? `Promise.reject(new Error('offline'))`
    : `Promise.resolve(new Response(${JSON.stringify(JSON.stringify(board))}, { status: 200, headers: { 'Content-Type': 'application/json' } }))`;
  return cdp.evaluate(`(() => {
    window.__auditRealFetch = window.__auditRealFetch || window.fetch;
    const real = window.__auditRealFetch;
    window.fetch = (url, opts) => String(url).split('?')[0].endsWith('data/current.json') ? ${reply} : real(url, opts);
    localStorage.removeItem('class_tasks_seen');
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`);
}

const restoreFetch = (cdp) => cdp.evaluate(`(() => {
  if (window.__auditRealFetch) { window.fetch = window.__auditRealFetch; delete window.__auditRealFetch; }
  return true;
})()`);

export async function runClassFilterChecks({ cdp, boot, check, click, sleep, pressKey, pressEnter, fixture, FIXTURE_INSTANT }) {
  const stamp = FIXTURE_INSTANT - 3600e3;
  const done = JSON.stringify({ fx003: { status: 'done', movedAt: stamp } });
  const doing = JSON.stringify({ fx003: { status: 'in_progress', movedAt: stamp } });
  const asList = { class_tasks_view_class: 'list' };
  const draft = JSON.stringify({ tasks: fixture.tasks, announcements: fixture.announcements });
  const fx = (id) => clone(fixture.tasks.find((t) => t.id === id));
  const undated = { id: 'audit-undated', title: 'Undated no-subject task', notes: '', subject: '' };

  // Subject, status, AND, Clear and the reload reset.
  await boot(cdp, 1280, { storage: { ...asList, class_tasks_progress: done } });
  let r = await read(cdp);
  check('class filters baseline', r.rows === 20 && r.board === 20 && r.subjectOptions === 11,
    'rows ' + r.rows + ' board ' + r.board + ' subject options ' + r.subjectOptions);
  await setValue(cdp, sleep, 'class-subject-filter', 'GENSCI', 'change');
  r = await read(cdp);
  check('class subject filter', r.rows === 3 && r.board === 20 && r.subjectOptions === 11,
    'rows ' + r.rows + ' board ' + r.board + ' subject options ' + r.subjectOptions);
  await setValue(cdp, sleep, 'class-status-filter', 'done', 'change');
  r = await read(cdp);
  check('class options under status', r.subjectOptions === 11, 'subject options ' + r.subjectOptions + ' status "' + r.status + '"');
  await setValue(cdp, sleep, 'class-status-filter', 'not_started', 'change');
  await setValue(cdp, sleep, 'class-task-search', 'Noli', 'input');
  r = await read(cdp);
  check('class filters no matches', r.rows === 0 && r.empty === 'No tasks match these filters. Clear filters' && r.clear,
    'rows ' + r.rows + ' empty "' + r.empty + '" clear ' + r.clear);
  await click(cdp, '#class-task-list .list-empty button');
  await tick(sleep);
  r = await read(cdp);
  check('class clear resets all', r.rows === 20 && r.subject === '' && r.status === '' && r.search === '' && r.activeId === 'class-task-search',
    'rows ' + r.rows + ' subject "' + r.subject + '" status "' + r.status + '" focus ' + r.activeId);
  await setValue(cdp, sleep, 'class-subject-filter', 'GENSCI', 'change');
  await setValue(cdp, sleep, 'class-status-filter', 'done', 'change');
  const beforeReload = (await read(cdp)).progress;
  await cdp.evaluate('location.reload()');
  const reloaded = await waitFor(cdp, sleep, 'document.readyState === "complete" && document.querySelectorAll("#class-task-list .task-row").length === 20');
  r = await read(cdp);
  check('class filters reset on reload', reloaded && r.subject === '' && r.status === '' && r.search === '' && r.progress === beforeReload,
    'rows ' + r.rows + ' subject "' + r.subject + '" status "' + r.status + '" progress unchanged ' + (r.progress === beforeReload));

  // Desktop Board hides and ignores the selects; search still filters it, and List keeps the values.
  await boot(cdp, 1280, { storage: { class_tasks_view_class: 'board', class_tasks_progress: done } });
  r = await read(cdp);
  check('class board hides filters', r.filtersDisplay === 'none' && r.boardVisible && !r.listVisible,
    'filters ' + r.filtersDisplay + ' board ' + r.boardVisible + ' list ' + r.listVisible);
  await setValue(cdp, sleep, 'class-subject-filter', 'GENSCI', 'change');
  await setValue(cdp, sleep, 'class-status-filter', 'not_started', 'change');
  r = await read(cdp);
  check('class board ignores filters', r.board === 20, 'board ' + r.board + ' subject "' + r.subject + '" status "' + r.status + '"');
  await setValue(cdp, sleep, 'class-task-search', 'statistical', 'input');
  r = await read(cdp);
  check('class board still searches', r.board === 1, 'board cards ' + r.board + ' for "statistical"');
  await setValue(cdp, sleep, 'class-task-search', '', 'input');
  await click(cdp, '#page-class-tasks .view-tab[data-view="list"]');
  await tick(sleep);
  r = await read(cdp);
  check('class list keeps values', r.view === 'list' && r.rows === 3 && r.subject === 'GENSCI' && r.status === 'not_started',
    'rows ' + r.rows + ' subject "' + r.subject + '" status "' + r.status + '"');

  // Regular In progress -> Done leaves the filtered list; focus, live feedback and Undo recover it.
  await boot(cdp, 1280, { storage: { ...asList, class_tasks_progress: doing } });
  await setValue(cdp, sleep, 'class-status-filter', 'in_progress', 'change');
  await focus(cdp, '#class-task-list .task-row[data-task-id="fx003"] .status-check');
  await pressEnter(cdp);
  await pressKey(cdp, 'ArrowDown', 'ArrowDown', 40);
  await pressEnter(cdp);
  await sleep(200);
  r = await read(cdp);
  check('class regular removal', r.rows === 0 && r.activeId === 'class-status-filter' && r.toast
    && /Marked done/.test(r.toastText) && /Hidden by the Status filter/.test(r.toastText) && /Hidden by the Status filter/.test(r.feedback),
    'rows ' + r.rows + ' focus ' + r.activeId + ' toast "' + r.toastText + '" live "' + r.feedback + '"');
  await click(cdp, '#toast-action');
  await sleep(250);
  r = await read(cdp);
  check('class regular undo', r.rows === 1 && r.rowIds[0] === 'fx003' && r.status === 'in_progress'
    && r.activeTask === 'fx003' && JSON.parse(r.progress || '{}').fx003?.status === 'in_progress',
    'rows ' + r.rows + ' focus task ' + r.activeTask + ' status ' + r.status);

  // Confirmed Done -> Not started has the same filtered-removal feedback and Undo path.
  await boot(cdp, 1280, { storage: { ...asList, class_tasks_progress: done } });
  await setValue(cdp, sleep, 'class-status-filter', 'done', 'change');
  await focus(cdp, '#class-task-list .task-row[data-task-id="fx003"] .status-check');
  await pressEnter(cdp);
  await pressKey(cdp, 'ArrowUp', 'ArrowUp', 38);
  await pressKey(cdp, 'ArrowUp', 'ArrowUp', 38);
  await pressEnter(cdp);
  await pressKey(cdp, 'Tab', 'Tab', 9);
  await pressEnter(cdp);
  await sleep(300);
  r = await read(cdp);
  check('class confirmed removal', r.rows === 0 && r.activeId === 'class-status-filter' && r.toast
    && /Marked not started/.test(r.toastText) && /Hidden by the Status filter/.test(r.toastText),
    'rows ' + r.rows + ' focus ' + r.activeId + ' toast "' + r.toastText + '"');
  await click(cdp, '#toast-action');
  await sleep(250);
  r = await read(cdp);
  check('class confirmed undo', r.rows === 1 && r.rowIds[0] === 'fx003' && r.status === 'done'
    && r.activeTask === 'fx003' && JSON.parse(r.progress || '{}').fx003?.status === 'done',
    'rows ' + r.rows + ' focus task ' + r.activeTask + ' status ' + r.status);

  // A dialog stays in front while its task is filtered out; closing returns to Status.
  await boot(cdp, 1280, { storage: { ...asList, class_tasks_progress: doing } });
  await setValue(cdp, sleep, 'class-status-filter', 'in_progress', 'change');
  await click(cdp, '#class-task-list .task-row[data-task-id="fx003"] .task-row-title');
  await sleep(200);
  await click(cdp, '#dialog-status-btn');
  await pressKey(cdp, 'ArrowDown', 'ArrowDown', 40);
  await pressEnter(cdp);
  await sleep(200);
  r = await read(cdp);
  check('class dialog keeps focus', r.dialogOpen && r.activeId === 'dialog-status-btn' && r.rows === 0,
    'dialog ' + r.dialogOpen + ' focus ' + r.activeId + ' rows ' + r.rows);
  await pressKey(cdp, 'Escape', 'Escape', 27);
  await sleep(300);
  r = await read(cdp);
  check('class dialog close focus', !r.dialogOpen && r.activeId === 'class-status-filter', 'dialog ' + r.dialogOpen + ' focus ' + r.activeId);

  // Tab reaches the selects in order; ArrowDown selects and applies a status.
  await boot(cdp, 1280, { storage: { ...asList, class_tasks_progress: done } });
  await focus(cdp, '#class-task-search');
  await pressKey(cdp, 'Tab', 'Tab', 9);
  const tabSubject = (await read(cdp)).activeId === 'class-subject-filter';
  await pressKey(cdp, 'Tab', 'Tab', 9);
  const tabStatus = (await read(cdp)).activeId === 'class-status-filter';
  await pressKey(cdp, 'ArrowDown', 'ArrowDown', 40);
  r = await read(cdp);
  check('class keyboard filters', tabSubject && tabStatus && r.status === 'not_started' && r.rows === 19,
    'tab ' + tabSubject + '/' + tabStatus + ' status "' + r.status + '" rows ' + r.rows);

  // Phones show the class filters even when the saved view is Board; admin is list-only but keeps Board saved.
  await boot(cdp, 375, { storage: { class_tasks_view_class: 'board', class_tasks_progress: done } });
  r = await read(cdp);
  check('class mobile filters saved board', r.view === 'board' && r.filtersDisplay !== 'none' && !r.boardVisible && r.listVisible,
    'view ' + r.view + ' filters ' + r.filtersDisplay + ' board ' + r.boardVisible + ' list ' + r.listVisible);
  await boot(cdp, 375, { admin: true, hash: 'my-tasks', storage: { class_tasks_view_admin: 'board', class_tasks_draft: draft } });
  const mobileAdmin = await cdp.evaluate(ADMIN_LAYOUT);
  check('class mobile admin list only', mobileAdmin.view === 'board' && mobileAdmin.tabs === 'none'
    && mobileAdmin.board === 'none' && mobileAdmin.list !== 'none' && mobileAdmin.saved === 'board',
    'tabs ' + mobileAdmin.tabs + ' board ' + mobileAdmin.board + ' list ' + mobileAdmin.list + ' saved ' + mobileAdmin.saved);
  await cdp.setMetrics(1280, 900);
  await sleep(300);
  const desktopAdmin = await cdp.evaluate(ADMIN_LAYOUT);
  check('class desktop resize restores board', desktopAdmin.view === 'board' && desktopAdmin.boardVisible && !desktopAdmin.listVisible
    && desktopAdmin.tabs !== 'none' && desktopAdmin.saved === 'board',
    'view ' + desktopAdmin.view + ' board ' + desktopAdmin.boardVisible + ' list ' + desktopAdmin.listVisible + ' saved ' + desktopAdmin.saved);

  // Empty public announcements disappear without removing the admin composer.
  for (const width of [375, 1280]) {
    await boot(cdp, width, { admin: true, storage: { class_tasks_draft: JSON.stringify({ tasks: fixture.tasks, announcements: [] }) } });
    const hidden = await cdp.evaluate(`(() => { const box = document.getElementById('announce-public');
      return getComputedStyle(box).display === 'none' && box.getClientRects().length === 0; })()`);
    await click(cdp, '.nav-item[data-page="my-tasks"]');
    await sleep(200);
    const composer = await cdp.evaluate(`(() => { const section = document.getElementById('announce-admin');
      const add = document.getElementById('announce-add-btn');
      return { section: section.getClientRects().length > 0, add: add.getClientRects().length > 0 }; })()`);
    check('class empty announcements ' + width, hidden && composer.section && composer.add,
      'public hidden ' + hidden + ' admin section ' + composer.section + ' add ' + composer.add);
  }

  // Current, no-subject, empty and offline boards arrive through the real visibility-change load path.
  await boot(cdp, 1280, { storage: { ...asList, class_tasks_progress: doing } });
  try {
    await overrideBoard(cdp, { tasks: [fx('fx003'), fx('fx004'), undated], announcements: [] });
    const loaded = await waitFor(cdp, sleep, 'document.querySelectorAll("#class-task-list .task-row").length === 3');
    r = await read(cdp);
    check('class no-subject all only', loaded && r.rows === 3 && r.rowIds.includes('audit-undated') && r.subjectOptions === 3,
      'rows ' + r.rows + ' ids ' + r.rowIds.join(',') + ' subject options ' + r.subjectOptions);
    await setValue(cdp, sleep, 'class-subject-filter', 'PKLP', 'change');
    r = await read(cdp);
    check('class no-subject filtered out', r.rows === 1 && r.rowIds[0] === 'fx003', 'rows ' + r.rows + ' ids ' + r.rowIds.join(','));
    await setValue(cdp, sleep, 'class-subject-filter', 'PERDEV', 'change');
    r = await read(cdp);
    const beforeOffline = r.progress;
    await overrideBoard(cdp, { tasks: [fx('fx003'), undated], announcements: [] });
    const refreshed = await waitFor(cdp, sleep, 'document.getElementById("class-subject-filter").value === "" && document.querySelectorAll("#class-task-list .task-row").length === 2');
    r = await read(cdp);
    check('class missing subject resets all', refreshed && r.subject === '' && r.rows === 2 && r.rowIds.includes('fx003'),
      'subject "' + r.subject + '" rows ' + r.rows + ' ids ' + r.rowIds.join(','));
    await overrideBoard(cdp, null);
    const offline = await waitFor(cdp, sleep, '!document.getElementById("sync-note").hidden');
    r = await read(cdp);
    check('class offline cached board', offline && r.rows === 2 && r.rowIds.includes('fx003') && r.progress === beforeOffline,
      'note shown ' + offline + ' rows ' + r.rows + ' progress unchanged ' + (r.progress === beforeOffline));
    await overrideBoard(cdp, { tasks: [], announcements: [] });
    const emptyLoaded = await waitFor(cdp, sleep, 'document.querySelectorAll("#class-task-list .task-row").length === 0');
    r = await read(cdp);
    check('class genuinely empty board', emptyLoaded && r.empty === 'No tasks yet.' && !r.clear && r.board === 0,
      'empty "' + r.empty + '" clear ' + r.clear + ' board ' + r.board);
  } finally {
    await restoreFetch(cdp);
  }
}
