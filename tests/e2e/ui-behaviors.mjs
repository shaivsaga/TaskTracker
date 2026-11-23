export async function runUiBehaviorChecks({ cdp, boot, check, click, pressKey, waitUntil, progress, draft }) {
  // 1. First-visit tour is opt-in (never hijacks task clicks) and skips desktop-only steps on phones.
  await boot(cdp, 1280, { storage: { class_tasks_tour_seen: '' } });
  await waitUntil(cdp, `document.getElementById('tour-cue')?.hidden === false && !!document.querySelector('#class-task-list .task-row-title')`);
  const tourFirst = await cdp.evaluate(`(() => {
    const cue = document.getElementById('tour-cue');
    const ov = document.getElementById('tour-overlay');
    const title = document.querySelector('#class-task-list .task-row-title');
    if (title) title.click();
    return {
      cueVisible: !!cue && !cue.hidden,
      tourHidden: !ov || ov.hidden,
      dialogOpened: !document.getElementById('task-dialog-overlay').hidden,
    };
  })()`);
  await boot(cdp, 375, { storage: { class_tasks_tour_seen: '' } });
  await waitUntil(cdp, `document.getElementById('tour-cue')?.hidden === false`);
  await click(cdp, '#tour-cue-start');
  await waitUntil(cdp, `document.getElementById('tour-overlay')?.hidden === false`);
  const phoneTourStep = await cdp.evaluate(`document.getElementById('tour-step').textContent.trim()`);
  check(
    'opt-in tour cue no hijack and phone skips desktop step',
    tourFirst.cueVisible && tourFirst.tourHidden && tourFirst.dialogOpened && /of 5$/.test(phoneTourStep),
    JSON.stringify({ ...tourFirst, phoneTourStep }),
  );

  // 2. Class page header order, #mine vertical alignment, default List view, buckets, and Board filter visibility.
  await boot(cdp, 1280, { storage: { class_tasks_progress: JSON.stringify(progress) } });
  const classLayout = await cdp.evaluate(`(() => {
    const copy = document.querySelector('#page-class-tasks .page-supporting-copy');
    const mine = document.getElementById('mine');
    const actions = document.querySelector('#page-class-tasks .page-actions');
    const n = document.getElementById('mine-n');
    const t = document.querySelector('#mine .mine-t');
    const listBtn = document.querySelector('#page-class-tasks [data-view="list"]');
    const buckets = document.querySelectorAll('#class-task-list .list-bucket').length;
    const nr = n.getBoundingClientRect(), tr = t.getBoundingClientRect();
    const cyDiff = Math.abs((nr.top + nr.height / 2) - (tr.top + tr.height / 2));
    return {
      orderOk: !!(copy.compareDocumentPosition(mine) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!(mine.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING)
        && copy.getBoundingClientRect().top < mine.getBoundingClientRect().top,
      cyDiff: Math.round(cyDiff * 10) / 10,
      listDefault: listBtn && listBtn.getAttribute('aria-pressed') === 'true',
      buckets,
    };
  })()`);
  await click(cdp, '#page-class-tasks [data-view="board"]');
  const boardFilters = await cdp.evaluate(`(() => {
    const st = document.getElementById('class-status-filter');
    const su = document.getElementById('class-subject-filter');
    return {
      statusHidden: getComputedStyle(st).display === 'none',
      subjectVisible: getComputedStyle(su).display !== 'none',
    };
  })()`);
  check(
    'class header, mine alignment, buckets, and board subject filter',
    classLayout.orderOk && classLayout.cyDiff <= 4 && classLayout.listDefault && classLayout.buckets > 0
      && boardFilters.statusHidden && boardFilters.subjectVisible,
    JSON.stringify({ ...classLayout, ...boardFilters }),
  );

  // 3. Student '/' shortcut and read-only dialog contract (footer hidden, tabindex=-1, sunk surface, aria-labels).
  await boot(cdp, 1280, {});
  await pressKey(cdp, '/', 'Slash', 191);
  const slashFocused = await cdp.evaluate(`document.activeElement && document.activeElement.id === 'class-task-search'`);
  await click(cdp, '#class-task-list .task-row-title');
  const roDialog = await cdp.evaluate(`(() => {
    const dlg = document.querySelector('.task-dialog');
    const footer = document.querySelector('.task-dialog .dialog-footer');
    const title = document.getElementById('dialog-title-input');
    const status = document.getElementById('dialog-status-btn');
    const date = document.getElementById('dialog-date-btn');
    const doc = document.getElementById('dialog-doc');
    const subj = document.getElementById('dialog-subject-btn');
    return {
      readonly: dlg.classList.contains('is-readonly'),
      footerHidden: getComputedStyle(footer).display === 'none',
      titleTabIndex: title.getAttribute('tabindex'),
      statusLabel: status.getAttribute('aria-label') || '',
      statusHasPopup: status.getAttribute('aria-haspopup'),
      statusExpanded: status.getAttribute('aria-expanded'),
      statusCaret: !!status.querySelector('.status-caret'),
      dateLabel: date.getAttribute('aria-label') || '',
      docRole: doc.getAttribute('role'),
      docMultiline: doc.getAttribute('aria-multiline'),
      subjBorder: getComputedStyle(subj).borderTopColor,
      sunkMatch: getComputedStyle(doc).backgroundColor === getComputedStyle(subj).backgroundColor,
    };
  })()`);
  check(
    'student / shortcut and read-only dialog contract',
    slashFocused && roDialog.readonly && roDialog.footerHidden && roDialog.titleTabIndex === '-1'
      && roDialog.statusLabel.startsWith('Status:') && roDialog.statusHasPopup === 'listbox'
      && roDialog.statusExpanded === 'false' && roDialog.statusCaret && roDialog.dateLabel.startsWith('Due:')
      && roDialog.docRole === null && roDialog.docMultiline === null
      && roDialog.subjBorder === 'rgba(0, 0, 0, 0)' && roDialog.sunkMatch,
    JSON.stringify({ slashFocused, ...roDialog }),
  );

  // 4. Done rows use static non-button checkmark; Past rows omit status-check completely.
  await boot(cdp, 1280, { hash: 'done', storage: { class_tasks_progress: JSON.stringify(progress) } });
  const doneRows = await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#done-list .done-row')];
    return {
      count: rows.length,
      staticChecks: rows.every((r) => !!r.querySelector('.status-check.is-done.is-static') && !r.querySelector('button.status-check')),
    };
  })()`);
  await boot(cdp, 1280, { hash: 'past' });
  const pastRows = await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#past-list .done-row')];
    const first = rows[0];
    const cols = first ? getComputedStyle(first).gridTemplateColumns.trim().split(/\\s+/).length : 0;
    return {
      count: rows.length,
      noStatusCheck: rows.every((r) => !r.querySelector('.status-check')),
      studentCols: cols,
    };
  })()`);
  check(
    'done static check and past omits status-check and empty actions track',
    doneRows.count > 0 && doneRows.staticChecks && pastRows.count > 0 && pastRows.noStatusCheck && pastRows.studentCols === 3,
    JSON.stringify({ doneRows, pastRows }),
  );

  // 5. Admin task board precedes collapsed Recycle bin and Subjects panels, and toggles expand cleanly.
  await boot(cdp, 1280, { admin: true, hash: 'my-tasks', storage: { class_tasks_draft: draft } });
  const adminPanels = await cdp.evaluate(`(() => {
    const board = document.querySelector('[aria-label="Personal task board"]');
    const binPanel = document.getElementById('bin-panel');
    const subPanel = document.getElementById('subject-panel');
    const binToggle = document.getElementById('bin-toggle');
    const subToggle = document.getElementById('subject-toggle');
    const binBody = document.getElementById('bin-body');
    const subBody = document.getElementById('subject-body');
    const before = {
      orderOk: board.getBoundingClientRect().top < binPanel.getBoundingClientRect().top
        && board.getBoundingClientRect().top < subPanel.getBoundingClientRect().top,
      binCollapsed: binToggle.getAttribute('aria-expanded') === 'false' && binBody.hidden,
      subCollapsed: subToggle.getAttribute('aria-expanded') === 'false' && subBody.hidden,
    };
    binToggle.click();
    subToggle.click();
    return {
      ...before,
      binExpanded: binToggle.getAttribute('aria-expanded') === 'true' && !binBody.hidden,
      subExpanded: subToggle.getAttribute('aria-expanded') === 'true' && !subBody.hidden,
    };
  })()`);
  check(
    'admin board precedes collapsed bin and subjects panels',
    adminPanels.orderOk && adminPanels.binCollapsed && adminPanels.subCollapsed
      && adminPanels.binExpanded && adminPanels.subExpanded,
    JSON.stringify(adminPanels),
  );

  // 6. Admin History single-item Delete arms before deleting, and phone quick-add chips meet 44px floor.
  await boot(cdp, 1280, { admin: true, hash: 'my-tasks', storage: { class_tasks_draft: draft } });
  await click(cdp, '#btn-save');
  await click(cdp, '#btn-history');
  await waitUntil(cdp, `document.getElementById('history-overlay')?.hidden === false && document.querySelectorAll('#history-list .history-item').length > 0`);
  const historyArm = await cdp.evaluate(`(() => {
    const before = document.querySelectorAll('#history-list .history-item').length;
    const del = [...document.querySelectorAll('#history-list .history-item button')].find((b) => b.textContent.trim() === 'Delete');
    if (!del) return { ok: false, before };
    del.click();
    return {
      ok: del.textContent.trim() === 'Confirm?' && document.querySelectorAll('#history-list .history-item').length === before,
      text: del.textContent.trim(),
      before,
      after: document.querySelectorAll('#history-list .history-item').length,
    };
  })()`);
  check('history delete arms before deleting', !!historyArm.ok, JSON.stringify(historyArm));

  await boot(cdp, 375, { admin: true, hash: 'my-tasks', storage: { class_tasks_draft: draft } });
  await click(cdp, '#new-task-btn');
  const phoneTargets = await cdp.evaluate(`(() => {
    const chips = [...document.querySelectorAll('#quick-overlay .quick-chip-btn')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => Math.round(el.getBoundingClientRect().height));
    return { count: chips.length, minHeight: chips.length ? Math.min(...chips) : 0 };
  })()`);
  check(
    'phone 44px quick-add chip floor',
    phoneTargets.count > 0 && phoneTargets.minHeight >= 44,
    JSON.stringify(phoneTargets),
  );

  // 7. 320px Admin Discard matches Publish width with zero arming jump, and History Clear arms with solid danger fill.
  const dirtyDraft = JSON.stringify({
    tasks: [
      ...JSON.parse(draft).tasks,
      { id: 'draft-extra-1', title: 'Unsaved task', subject: 'GENSCI', dueDate: '2026-11-12', dueTime: '', endDate: '', note: '', attachments: [], closedAt: null },
    ],
    announcements: JSON.parse(draft).announcements || [],
  });
  await boot(cdp, 320, { admin: true, hash: 'my-tasks', storage: { class_tasks_draft: dirtyDraft, class_tasks_theme: 'light' } });
  const adminBarCheck = await cdp.evaluate(`(() => {
    const bar = document.getElementById('admin-bar');
    const applyW = Math.round(document.getElementById('btn-apply').getBoundingClientRect().width);
    const disc = document.getElementById('btn-discard');
    const discW = Math.round(disc.getBoundingClientRect().width);
    const hBefore = Math.round(bar.getBoundingClientRect().height);
    disc.click();
    const hAfter = Math.round(bar.getBoundingClientRect().height);
    return { applyW, discW, widthDelta: Math.abs(applyW - discW), jumpPx: hAfter - hBefore, armed: disc.dataset.armed || null };
  })()`);
  await click(cdp, '#btn-history');
  await waitUntil(cdp, `document.getElementById('history-overlay')?.hidden === false`);
  const historyClearCheck = await cdp.evaluate(`(() => {
    const btn = document.getElementById('history-clear');
    btn.click();
    const cs = getComputedStyle(btn);
    return { isDanger: btn.classList.contains('is-danger'), armed: btn.dataset.armed || null, bg: cs.backgroundColor };
  })()`);
  check(
    '320px admin discard full-width no-jump and history clear danger arm',
    adminBarCheck.widthDelta <= 1 && adminBarCheck.jumpPx === 0 && adminBarCheck.armed === '1'
      && historyClearCheck.isDanger && historyClearCheck.armed === '1' && historyClearCheck.bg === 'rgb(179, 38, 30)',
    JSON.stringify({ adminBarCheck, historyClearCheck }),
  );

  // 8. First-visit 320x568 Phone Fold clearance with #tour-cue below tasks, plus 44px toolbar height parity and keyboard focus.
  await boot(cdp, 320, { storage: { class_tasks_tour_seen: '' } });
  await waitUntil(cdp, `document.getElementById('tour-cue')?.hidden === false && !!document.querySelector('#class-task-list .task-row')`);
  const fold320 = await cdp.evaluate(`(() => {
    const row = document.querySelector('#class-task-list .task-row');
    const tb = document.querySelector('.tb');
    const cue = document.getElementById('tour-cue');
    const list = document.getElementById('class-task-list');
    const rr = row.getBoundingClientRect();
    const tr = tb.getBoundingClientRect();
    return {
      rowBottom: Math.round(rr.bottom),
      tbTop: Math.round(tr.top),
      clearance: Math.round(tr.top - rr.bottom),
      cueAfterList: !!(list.compareDocumentPosition(cue) & Node.DOCUMENT_POSITION_FOLLOWING),
      cueVisible: !cue.hidden,
    };
  })()`);
  await boot(cdp, 1280, { storage: { class_tasks_tour_seen: '' } });
  await waitUntil(cdp, `document.getElementById('tour-cue')?.hidden === false && !!document.querySelector('#class-task-list .task-row')`);
  const toolbarAndFold = await cdp.evaluate(`(() => {
    const h = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().height);
    const tab = document.querySelector('#page-class-tasks .view-tab[data-view="board"]');
    tab.focus();
    const focused = document.activeElement === tab;
    const afterH = (() => {
      const r = tab.getBoundingClientRect();
      const cs = getComputedStyle(tab, '::after');
      const top = parseFloat(cs.top) || 0;
      const bottom = parseFloat(cs.bottom) || 0;
      return Math.round(r.height - top - bottom);
    })();
    const row = document.querySelector('#class-task-list .task-row').getBoundingClientRect();
    return {
      searchH: h('#page-class-tasks .search'),
      subjH: h('#class-subject-filter'),
      statH: h('#class-status-filter'),
      tabsH: h('#page-class-tasks .view-tabs'),
      afterH,
      focused,
      desktopRowBottom: Math.round(row.bottom),
    };
  })()`);
  check(
    'first-visit fold clearance and 44px toolbar alignment',
    fold320.cueVisible && fold320.cueAfterList && fold320.clearance >= 12
      && toolbarAndFold.searchH === 44 && toolbarAndFold.subjH === 44 && toolbarAndFold.statH === 44
      && toolbarAndFold.tabsH === 44 && toolbarAndFold.afterH >= 44 && toolbarAndFold.focused
      && toolbarAndFold.desktopRowBottom < 800,
    JSON.stringify({ fold320, toolbarAndFold }),
  );

  // 9. Calendar subject code readability (including FINMATH101), desktop month time suppression, and admin dialog textbox restore.
  await boot(cdp, 1280, { hash: 'calendar' });
  await waitUntil(cdp, `document.querySelectorAll('#cal-grid .cal-chip').length > 0`);
  const calDesktop = await cdp.evaluate(`(() => {
    const chips = [...document.querySelectorAll('#cal-grid .cal-chip')];
    const withSub = chips.filter((c) => (c.querySelector('.cal-sub')?.textContent || '').trim().length > 0);
    const timeVisible = chips.some((c) => {
      const t = c.querySelector('.cal-time');
      return t && getComputedStyle(t).display !== 'none';
    });
    const tabsH = Math.round(document.querySelector('#page-calendar .view-tabs').getBoundingClientRect().height);
    const todayH = Math.round(document.getElementById('cal-today').getBoundingClientRect().height);
    return { total: chips.length, withSub: withSub.length, timeVisible, tabsH, todayH };
  })()`);
  await boot(cdp, 1280, { admin: true, hash: 'my-tasks', storage: { class_tasks_draft: draft } });
  await click(cdp, '#page-my-tasks .task-card-title button, #page-my-tasks .task-row-title');
  await waitUntil(cdp, `!document.getElementById('task-dialog-overlay').hidden`);
  const adminDoc = await cdp.evaluate(`(() => {
    const doc = document.getElementById('dialog-doc');
    return { role: doc.getAttribute('role'), multiline: doc.getAttribute('aria-multiline'), editable: doc.contentEditable };
  })()`);
  check(
    'calendar subject codes, desktop month alignment, and admin dialog textbox restore',
    calDesktop.total > 0 && calDesktop.withSub === calDesktop.total && !calDesktop.timeVisible
      && calDesktop.tabsH === 44 && calDesktop.todayH === 44
      && adminDoc.role === 'textbox' && adminDoc.multiline === 'true' && adminDoc.editable === 'true',
    JSON.stringify({ calDesktop, adminDoc }),
  );
}
