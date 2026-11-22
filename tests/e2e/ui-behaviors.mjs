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
      dateLabel: date.getAttribute('aria-label') || '',
      sunkMatch: getComputedStyle(doc).backgroundColor === getComputedStyle(subj).backgroundColor,
    };
  })()`);
  check(
    'student / shortcut and read-only dialog contract',
    slashFocused && roDialog.readonly && roDialog.footerHidden && roDialog.titleTabIndex === '-1'
      && roDialog.statusLabel.startsWith('Status:') && roDialog.dateLabel.startsWith('Due:') && roDialog.sunkMatch,
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
    return {
      count: rows.length,
      noStatusCheck: rows.every((r) => !r.querySelector('.status-check')),
    };
  })()`);
  check(
    'done static check and past omits status-check',
    doneRows.count > 0 && doneRows.staticChecks && pastRows.count > 0 && pastRows.noStatusCheck,
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
}
