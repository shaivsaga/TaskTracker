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

  for (const width of [320, 375, 390, 1280]) {
    for (const theme of ['light', 'dark']) {
      await boot(cdp, width, { storage: { class_tasks_theme: theme } });
      const metadata = await cdp.evaluate(`(() => {
        const rows = [...document.querySelectorAll('#class-task-list .task-row')]
          .filter((row) => row.querySelector('.subject-tag') && row.querySelector('.task-row-due.is-overdue'));
        return rows.map((row) => {
          const badge = row.querySelector('.subject-tag');
          const due = row.querySelector('.task-row-due');
          const badgeBox = badge.getBoundingClientRect();
          const dueBox = due.getBoundingClientRect();
          const rowBox = row.getBoundingClientRect();
          const style = getComputedStyle(row);
          const rightEdge = rowBox.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
          const bottomEdge = rowBox.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
          const leftEdge = row.children[1].getBoundingClientRect().left;
          return {
            code: badge.textContent,
            badgeFits: badge.scrollWidth <= badge.clientWidth + 1,
            dueFits: due.scrollWidth <= due.clientWidth + 1,
            inside: dueBox.right <= rowBox.right && dueBox.left >= badgeBox.right,
            emptyTrackHidden: getComputedStyle(row.lastElementChild).display === 'none',
            phonePlacement: innerWidth >= 720 || (
              Math.abs(dueBox.right - rightEdge) <= 1
              && Math.abs(dueBox.bottom - bottomEdge) <= 1
              && Math.abs(badgeBox.left - leftEdge) <= 1
              && Math.abs(badgeBox.bottom - dueBox.bottom) <= 1
              && getComputedStyle(due).textAlign === 'left'
            ),
          };
        });
      })()`);
      const hasLongCodes = ['FINMATH101', 'THEOLOGY'].every((code) => metadata.some((row) => row.code === code));
      check('task row metadata ' + width + ' ' + theme, hasLongCodes && metadata.every(
        (row) => row.badgeFits && row.dueFits && row.inside && row.emptyTrackHidden && row.phonePlacement,
      ), JSON.stringify(metadata.filter((row) => !row.badgeFits || !row.dueFits || !row.inside || !row.emptyTrackHidden || !row.phonePlacement)));
    }
  }

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

  // 5. Admin task list/board precedes collapsed Recycle bin and Subjects panels, and toggles expand cleanly.
  await boot(cdp, 1280, { admin: true, hash: 'my-tasks', storage: { class_tasks_draft: draft } });
  const adminPanels = await cdp.evaluate(`(() => {
    const view = document.querySelector('[aria-label="Draft task list"]:not([hidden]), [aria-label="Draft task board"]:not([hidden])');
    const binPanel = document.getElementById('bin-panel');
    const subPanel = document.getElementById('subject-panel');
    const binToggle = document.getElementById('bin-toggle');
    const subToggle = document.getElementById('subject-toggle');
    const binBody = document.getElementById('bin-body');
    const subBody = document.getElementById('subject-body');
    const before = {
      orderOk: view.getBoundingClientRect().top < binPanel.getBoundingClientRect().top
        && view.getBoundingClientRect().top < subPanel.getBoundingClientRect().top,
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

  // 10. PR 1: Task scannability indicators (notes + file count, ignoring empty HTML), phone privacy cue, and copy clarity.
  const richDraft = JSON.parse(draft);
  richDraft.tasks = richDraft.tasks.map((t) => {
    if (t.id === 'fx011') {
      return {
        ...t,
        files: [
          { id: '0123456789abcdef0123456789abcdef.pdf', name: 'rubric.pdf', size: 1200 },
          { id: '0123456789abcdef0123456789abcdef.jpg', name: 'guide.jpg', size: 2400 },
        ],
      };
    }
    if (t.id === 'fx012') {
      return { ...t, notes: '<div><br></div><p>&nbsp; &#160;</p>', files: [] };
    }
    return t;
  });
  await boot(cdp, 1280, { admin: true, hash: 'my-tasks', storage: { class_tasks_draft: JSON.stringify(richDraft) } });
  await waitUntil(cdp, `!document.getElementById('task-list')?.hidden`);
  const listInd = await cdp.evaluate(`(() => {
    const r1 = document.querySelector('#task-list .task-row[data-task-id="fx011"]');
    const r2 = document.querySelector('#task-list .task-row[data-task-id="fx012"]');
    return {
      hasRows: !!r1 && !!r2,
      fx011Sr: [...(r1?.querySelectorAll('.task-indicators .sr-only') || [])].map((el) => el.textContent.trim()),
      fx012Count: r2?.querySelectorAll('.task-indicators').length ?? -1,
    };
  })()`);
  await click(cdp, '#page-my-tasks .view-tab[data-view="board"]');
  await waitUntil(cdp, `!document.querySelector('#page-my-tasks .kanban-board')?.hidden`);
  const boardInd = await cdp.evaluate(`(() => {
    const c1 = document.querySelector('#page-my-tasks .kanban-board .task-card[data-task-id="fx011"]');
    const c2 = document.querySelector('#page-my-tasks .kanban-board .task-card[data-task-id="fx012"]');
    return {
      hasCards: !!c1 && !!c2,
      fx011Sr: [...(c1?.querySelectorAll('.task-indicators .sr-only') || [])].map((el) => el.textContent.trim()),
      fx011Text: c1?.querySelector('.task-indicators')?.textContent.replace(/\\s+/g, ' ').trim() || '',
      fx012Count: c2?.querySelectorAll('.task-indicators').length ?? -1,
    };
  })()`);
  await boot(cdp, 320, { hash: 'class-tasks' });
  const phone320Pr1 = await cdp.evaluate(`(() => {
    const note = document.getElementById('phone-privacy-note');
    const rNote = document.querySelector('#class-task-list .task-row[data-task-id="fx011"]');
    const rFiles = document.querySelector('#class-task-list .task-row[data-task-id="fx021"]');
    const rEmpty = document.querySelector('#class-task-list .task-row[data-task-id="fx012"]');
    const firstRow = document.querySelector('#class-task-list .task-row');
    const tb = document.querySelector('.tb').getBoundingClientRect();
    const rr = firstRow.getBoundingClientRect();
    return {
      privacyVisible: !!note && getComputedStyle(note).display !== 'none',
      rHasNote: !!(rNote?.querySelector('.task-indicators .sr-only')?.textContent.includes('Has notes')),
      rFilesSr: [...(rFiles?.querySelectorAll('.task-indicators .sr-only') || [])].map((el) => el.textContent.trim()),
      rEmpty: rEmpty?.querySelectorAll('.task-indicators').length === 0,
      foldClearance: Math.round(tb.top - rr.bottom),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  })()`);
  await boot(cdp, 390, { hash: 'class-tasks' });
  const phone390Pr1 = await cdp.evaluate(`(() => ({
    privacyVisible: getComputedStyle(document.getElementById('phone-privacy-note')).display !== 'none',
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  }))()`);
  await boot(cdp, 1280, { hash: 'settings' });
  const settingsCopy = await cdp.evaluate(`(() => {
    const replay = document.querySelector('#settings-replay')?.closest('.settings-row')?.querySelector('.settings-title')?.textContent?.trim() || '';
    const resetDesc = document.querySelector('#settings-reset-start')?.closest('.settings-row')?.querySelector('.settings-desc')?.textContent || '';
    const privacyDesktop = getComputedStyle(document.getElementById('phone-privacy-note')).display === 'none';
    const calEmpty = document.getElementById('cal-empty')?.textContent?.trim() || '';
    return { replayText: replay, resetDesc, privacyDesktop, calEmpty };
  })()`);
  check(
    'PR 1 indicators, empty-HTML filtering, 320/390 privacy cue, and copy clarity',
    boardInd.hasCards && boardInd.fx011Sr.includes('Has notes') && boardInd.fx011Sr.includes('2 attached files')
      && boardInd.fx012Count === 0
      && listInd.hasRows && listInd.fx011Sr.includes('Has notes') && listInd.fx011Sr.includes('2 attached files')
      && listInd.fx012Count === 0
      && phone320Pr1.privacyVisible && phone320Pr1.rHasNote
      && phone320Pr1.rFilesSr.includes('2 attached files') && phone320Pr1.rEmpty
      && phone320Pr1.foldClearance >= 12 && !phone320Pr1.overflowX
      && phone390Pr1.privacyVisible && !phone390Pr1.overflowX
      && settingsCopy.replayText === 'Replay tour' && !/also clears the live class/i.test(settingsCopy.resetDesc)
      && !/add a task/i.test(settingsCopy.calEmpty)
      && settingsCopy.privacyDesktop,
    JSON.stringify({ boardInd, listInd, phone320Pr1, phone390Pr1, settingsCopy }),
  );

  // 11. PR 2: Recycle Bin modal permanent delete (no id jargon) & Transfer draft opt-in / 700 KB limit.
  await boot(cdp, 1280, { hash: 'settings' });
  await click(cdp, '#settings-transfer');
  await waitUntil(cdp, `!document.getElementById('transfer-overlay')?.hidden`);
  const studentTransferHidden = await cdp.evaluate(`document.getElementById('transfer-admin-box')?.hidden === true`);

  await boot(cdp, 1280, { admin: true, hash: 'my-tasks', storage: { class_tasks_draft: draft } });
  await cdp.evaluate(`(() => {
    window.__pr2Stub = { origFetch: window.fetch.bind(window), transfers: [] };
    window.fetch = async (url, init) => {
      const s = String(url);
      if (s.includes('view=admin') || (init?.body && String(init.body).includes('bin-permanent-delete'))) {
        return new Response(JSON.stringify({
          binSummaries: [{ binId: 'bin1', taskId: 'fx999', title: 'Archived lab sheet', everPublished: true, source: 'publish-remove' }],
          retiredDraftIds: [],
          adminRevision: 1,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (s.endsWith('transfer.php') && init?.method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        if (body.payload) window.__pr2Stub.transfers.push(body.payload);
        return new Response(JSON.stringify({ token: '0123456789abcdef0123456789abcdef', expiresIn: 600 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return window.__pr2Stub.origFetch(url, init);
    };
  })()`);
  await click(cdp, '#bin-toggle');
  await click(cdp, '#bin-refresh');
  await waitUntil(cdp, `!!document.querySelector('#bin-list [data-bin-action="delete"]')`);
  await click(cdp, '#bin-list [data-bin-action="delete"]');
  await waitUntil(cdp, `!!document.querySelector('.confirm-overlay') && !document.querySelector('.confirm-overlay').hidden`);
  const binModal = await cdp.evaluate(`(() => {
    const msg = document.getElementById('confirm-message')?.textContent || '';
    const ok = document.querySelector('[data-confirm="ok"]');
    return {
      title: document.getElementById('confirm-title')?.textContent?.trim(),
      hasDanger: !!ok?.classList.contains('danger-button') && ok.classList.contains('is-solid'),
      noJargon: !/never reused|\\bid\\b/i.test(msg),
    };
  })()`);
  await pressKey(cdp, 'Escape', 'Escape', 27);
  await waitUntil(cdp, `document.querySelector('.confirm-overlay')?.hidden === true`);

  await click(cdp, '#settings-open');
  await waitUntil(cdp, `!document.getElementById('settings-overlay')?.hidden`);
  await click(cdp, '#settings-transfer');
  await waitUntil(cdp, `!document.getElementById('transfer-overlay')?.hidden`);
  const defaultChecked = await cdp.evaluate(`document.getElementById('transfer-include-draft')?.checked === false`);
  await waitUntil(cdp, `(window.__pr2Stub?.transfers?.length || 0) >= 1`);
  await click(cdp, '#transfer-include-draft');
  await waitUntil(cdp, `(window.__pr2Stub?.transfers?.length || 0) >= 2`);
  const transferSent = await cdp.evaluate(`(() => ({
    firstHasDraft: Boolean(window.__pr2Stub.transfers[0]?.draft),
    secondHasDraft: Boolean(window.__pr2Stub.transfers[1]?.draft),
  }))()`);

  const bigDraft = JSON.parse(draft);
  bigDraft.tasks[0].notes = 'A'.repeat(710000);
  await boot(cdp, 1280, { admin: true, hash: 'settings', storage: { class_tasks_draft: JSON.stringify(bigDraft) } });
  await click(cdp, '#settings-transfer');
  await waitUntil(cdp, `!document.getElementById('transfer-overlay')?.hidden && !document.getElementById('transfer-admin-box')?.hidden`);
  await click(cdp, '#transfer-include-draft');
  await waitUntil(cdp, `document.getElementById('transfer-error')?.hidden === false`);
  const bigErr = await cdp.evaluate(`({
    hidden: document.getElementById('transfer-error')?.hidden,
    text: document.getElementById('transfer-error')?.textContent || '',
    linkHidden: document.getElementById('transfer-link-row')?.hidden,
  })`);
  check(
    'PR 2 modal bin delete confirm and transfer draft opt-in / size limit',
    studentTransferHidden && binModal.title === 'Delete permanently?' && binModal.hasDanger && binModal.noJargon
      && defaultChecked && !transferSent.firstHasDraft && transferSent.secondHasDraft
      && bigErr.hidden === false && /too large/i.test(bigErr.text) && bigErr.linkHidden === true,
    JSON.stringify({ studentTransferHidden, binModal, defaultChecked, transferSent, bigErr }),
  );

  // 12. PR 3: Calendar subject filter + reset, phone Month completed-only mark, desktop +N more popover, and simplified Subject Editor tray.
  const calDraft = JSON.parse(draft);
  calDraft.tasks = calDraft.tasks.map((t) => (t.id === 'fx013' ? { ...t, dueDate: '2026-11-03', dueTime: '14:00' } : t));
  await boot(cdp, 1280, { admin: true, hash: 'my-tasks', storage: { class_tasks_draft: JSON.stringify(calDraft) } });
  await click(cdp, '#btn-preview');
  await waitUntil(cdp, `!document.getElementById('preview-banner')?.hidden`);
  await click(cdp, '.nav-item[data-page="calendar"]');
  await waitUntil(cdp, `document.querySelectorAll('#cal-grid .cal-chip').length > 0`);
  const beforeCalChips = await cdp.evaluate(`document.querySelectorAll('#cal-grid .cal-chip').length`);
  await cdp.evaluate(`(() => {
    const sel = document.getElementById('cal-subject-filter');
    sel.value = 'GENSCI';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitUntil(cdp, `document.getElementById('cal-filter-reset')?.hidden === false`);
  const calFiltered = await cdp.evaluate(`(() => {
    const subs = [...document.querySelectorAll('#cal-grid .cal-chip .cal-sub')].map((el) => el.textContent.trim());
    return { count: subs.length, allGensci: subs.length > 0 && subs.every((s) => s === 'GENSCI') };
  })()`);
  await click(cdp, '#cal-filter-reset');
  await waitUntil(cdp, `document.getElementById('cal-filter-reset')?.hidden === true && document.querySelectorAll('#cal-grid .cal-chip').length === ${beforeCalChips}`);
  const calResetFocus = await cdp.evaluate(`document.activeElement?.id`);

  await click(cdp, '#cal-grid [data-date="2026-11-03"] .cal-more');
  await waitUntil(cdp, `document.getElementById('cal-day-popover')?.hidden === false`);
  const popOpen = await cdp.evaluate(`(() => {
    const pop = document.getElementById('cal-day-popover');
    const chips = [...pop.querySelectorAll('.cal-chip')];
    const timeShown = chips.some((c) => {
      const t = c.querySelector('.cal-time');
      return t && getComputedStyle(t).display !== 'none';
    });
    return {
      modeStillMonth: document.getElementById('cal-grid')?.dataset.mode === 'month',
      chipCount: chips.length,
      timeShown,
    };
  })()`);
  await pressKey(cdp, 'Escape', 'Escape', 27);
  await waitUntil(cdp, `document.getElementById('cal-day-popover')?.hidden === true`);
  const popEscFocus = await cdp.evaluate(`document.activeElement?.closest('[data-date]')?.dataset.date === '2026-11-03' && document.activeElement?.classList.contains('cal-more')`);
  await click(cdp, '#cal-grid [data-date="2026-11-03"] .cal-more');
  await waitUntil(cdp, `document.getElementById('cal-day-popover')?.hidden === false`);
  await click(cdp, '#cal-day-popover .cal-chip');
  await waitUntil(cdp, `document.getElementById('task-dialog-overlay')?.hidden === false`);
  const popOpensDialog = await cdp.evaluate(`document.getElementById('cal-day-popover')?.hidden === true && document.getElementById('task-dialog-overlay')?.hidden === false`);

  const allDoneNov3 = {
    fx005: { status: 'done', movedAt: 1000 },
    fx006: { status: 'done', movedAt: 1000 },
    fx007: { status: 'done', movedAt: 1000 },
  };
  await boot(cdp, 390, { hash: 'calendar', storage: { class_tasks_progress: JSON.stringify(allDoneNov3) } });
  await waitUntil(cdp, `!!document.querySelector('#cal-grid [data-date="2026-11-03"] .cal-done-mark')`);
  const doneCell390 = await cdp.evaluate(`(() => {
    const cell = document.querySelector('#cal-grid [data-date="2026-11-03"]');
    return {
      dots: cell.querySelectorAll('.cal-dot').length,
      doneMarks: cell.querySelectorAll('.cal-done-mark').length,
    };
  })()`);

  await boot(cdp, 320, { admin: true, hash: 'my-tasks', storage: { class_tasks_draft: draft } });
  await click(cdp, '#subject-toggle');
  await waitUntil(cdp, `document.querySelectorAll('.subject-row').length > 0`);
  const subjInitial = await cdp.evaluate(`({
    rows: document.querySelectorAll('.subject-row').length,
    openTrays: document.querySelectorAll('.subject-colour-tray:not([hidden])').length,
  })`);
  await click(cdp, '.subject-row button[data-act="palette"]');
  await waitUntil(cdp, `document.querySelectorAll('.subject-colour-tray:not([hidden])').length === 1`);
  const subjExpanded = await cdp.evaluate(`(() => {
    const tray = document.querySelector('.subject-colour-tray:not([hidden])');
    const hex = tray.querySelector('input[type="text"]');
    hex.focus();
    return {
      openTrays: document.querySelectorAll('.subject-colour-tray:not([hidden])').length,
      swatches: tray.querySelectorAll('.subject-swatch').length,
      hasPicker: !!tray.querySelector('input[type="color"]'),
      hasHex: !!hex,
      overflow320: document.documentElement.scrollWidth > window.innerWidth,
    };
  })()`);
  await pressKey(cdp, 'Escape', 'Escape', 27);
  await waitUntil(cdp, `document.querySelectorAll('.subject-colour-tray:not([hidden])').length === 0`);
  const subjEscFocus = await cdp.evaluate(`document.activeElement?.dataset.act === 'palette'`);

  check(
    'PR 3 calendar filter, done indicator, +N more popover, and simplified subject colour tray',
    calFiltered.allGensci && calFiltered.count < beforeCalChips && calResetFocus === 'cal-subject-filter'
      && popOpen.modeStillMonth && popOpen.chipCount >= 4 && popOpen.timeShown
      && popEscFocus && popOpensDialog
      && doneCell390.dots === 0 && doneCell390.doneMarks === 1
      && subjInitial.rows > 0 && subjInitial.openTrays === 0
      && subjExpanded.openTrays === 1 && subjExpanded.swatches === 10 && subjExpanded.hasPicker && subjExpanded.hasHex
      && !subjExpanded.overflow320 && subjEscFocus,
    JSON.stringify({ beforeCalChips, calFiltered, calResetFocus, popOpen, popEscFocus, popOpensDialog, doneCell390, subjInitial, subjExpanded, subjEscFocus }),
  );

  // 13. PR 4: Live-vs-draft isolation, persistent Preview banner, Admin List default + urgency buckets,
  // Quick Add edge-only parsing / "Keep in title", and named #publish-diff + stale_base rebase refresh.
  const isoDraft = JSON.parse(draft);
  isoDraft.tasks.unshift({ id: 'draft-only-1', title: 'SECRET DRAFT TASK', subject: 'GENMATH', dueDate: '2026-11-10', notes: '' });
  isoDraft.tasks = isoDraft.tasks.map((t) => (t.id === 'fx011' ? { ...t, title: 'Draft edited schema task' } : t));
  isoDraft.tasks = isoDraft.tasks.filter((t) => t.id !== 'fx012');
  isoDraft.announcements = [{ id: 'draft-ann', text: 'UNPUBLISHED ANNOUNCEMENT', createdAt: Date.now() }];
  isoDraft.subjects = [
    { code: 'GENSCI', name: 'GENSCI', color: '#70d1fe', active: true },
    { code: 'GENMATH', name: 'Draft Math Renamed', color: '#fba6f7', active: true },
    { code: 'PKLP', name: 'PKLP', color: '#ff9f6b', active: true },
    { code: 'EFFCOM', name: 'EFFCOM', color: '#8fe3a8', active: true },
    { code: 'MABKOM', name: 'MABKOM', color: '#d8c7a0', active: true },
    { code: 'PERDEV', name: 'PERDEV', color: '#7ff0e0', active: true },
    { code: 'PE', name: 'PE', color: '#f7cd54', active: true },
    { code: 'THEOLOGY', name: 'THEOLOGY', color: '#c3c7d6', active: true },
    { code: 'CP104', name: 'CP104', color: '#58affc', active: true },
    { code: 'FINMATH101', name: 'FINMATH101', color: '#c9a6e0', active: true },
  ];

  await boot(cdp, 1280, {
    admin: true,
    hash: 'my-tasks',
    storage: { class_tasks_draft: JSON.stringify(isoDraft), class_tasks_progress: JSON.stringify({ 'draft-only-1': { status: 'done', movedAt: 1000 } }) },
  });
  const adminDefault = await cdp.evaluate(`({
    view: document.getElementById('page-my-tasks')?.dataset.view,
    listVisible: document.getElementById('task-list')?.hidden === false,
    boardHidden: document.querySelector('#page-my-tasks .kanban-board')?.hidden === true,
    noSumProgress: !document.getElementById('sum-progress'),
    buckets: document.querySelectorAll('#task-list .list-bucket').length,
  })`);
  await cdp.evaluate(`(() => {
    const sel = document.getElementById('admin-subject-filter');
    sel.value = 'GENMATH';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const adminFiltered = await cdp.evaluate(`({
    hasDraftTask: !!document.querySelector('#task-list .task-row[data-task-id="draft-only-1"]'),
    otherCount: [...document.querySelectorAll('#task-list .task-row')].filter((r) => !r.querySelector('.subject-tag')?.textContent.includes('Draft Math Renamed')).length,
  })`);

  // Switch to Class Tasks, Calendar, Done, Past WITHOUT Preview: zero draft leakage!
  await click(cdp, '.nav-item[data-page="class-tasks"]');
  await waitUntil(cdp, `!!document.querySelector('#page-class-tasks:not([hidden])')`);
  const liveClass = await cdp.evaluate(`({
    hasDraftTask: !!document.querySelector('#class-task-list [data-task-id="draft-only-1"]'),
    hasDraftAnn: (document.getElementById('announce-list-public')?.textContent || '').includes('UNPUBLISHED ANNOUNCEMENT'),
    hasLiveFx012: !!document.querySelector('#class-task-list [data-task-id="fx012"]'),
    hasRenamedSubject: (document.getElementById('class-task-list')?.textContent || '').includes('Draft Math Renamed'),
    previewHidden: document.getElementById('preview-banner')?.hidden === true,
  })`);
  await click(cdp, '.nav-item[data-page="calendar"]');
  await waitUntil(cdp, `!!document.querySelector('#page-calendar:not([hidden])')`);
  const liveCalLeak = await cdp.evaluate(`(document.getElementById('cal-grid')?.textContent || '').includes('SECRET DRAFT TASK')`);
  await click(cdp, '.nav-item[data-page="done"]');
  await waitUntil(cdp, `!!document.querySelector('#page-done:not([hidden])')`);
  const liveDoneLeak = await cdp.evaluate(`!!document.querySelector('#done-list [data-task-id="draft-only-1"]')`);
  await click(cdp, '.nav-item[data-page="past"]');
  await waitUntil(cdp, `!!document.querySelector('#page-past:not([hidden])')`);
  const pastAdminBanner = await cdp.evaluate(`document.getElementById('past-draft-banner')?.hidden === false`);

  // Enter Preview -> #preview-banner persists across Class Tasks, Calendar, Done, Past; Draft data IS visible!
  await click(cdp, '.nav-item[data-page="my-tasks"]');
  await waitUntil(cdp, `!!document.querySelector('#page-my-tasks:not([hidden])')`);
  await click(cdp, '#btn-preview');
  await waitUntil(cdp, `!!document.querySelector('#page-class-tasks:not([hidden])') && !document.getElementById('preview-banner')?.hidden`);
  const prevClass = await cdp.evaluate(`({
    bannerShown: !document.getElementById('preview-banner')?.hidden,
    hasDraftTask: !!document.querySelector('#class-task-list [data-task-id="draft-only-1"]'),
    hasDraftAnn: (document.getElementById('announce-list-public')?.textContent || '').includes('UNPUBLISHED ANNOUNCEMENT'),
  })`);
  await click(cdp, '.nav-item[data-page="calendar"]');
  await waitUntil(cdp, `!!document.querySelector('#page-calendar:not([hidden])')`);
  const prevCalBanner = await cdp.evaluate(`!document.getElementById('preview-banner')?.hidden && (document.getElementById('cal-grid')?.textContent || '').includes('SECRET DRAFT TASK')`);
  await click(cdp, '.nav-item[data-page="done"]');
  await waitUntil(cdp, `!!document.querySelector('#page-done:not([hidden])')`);
  const prevDoneBanner = await cdp.evaluate(`!document.getElementById('preview-banner')?.hidden && !!document.querySelector('#done-list [data-task-id="draft-only-1"]')`);
  await click(cdp, '.nav-item[data-page="past"]');
  await waitUntil(cdp, `!!document.querySelector('#page-past:not([hidden])')`);
  const prevPastBanner = await cdp.evaluate(`!document.getElementById('preview-banner')?.hidden && document.getElementById('past-draft-banner')?.hidden === true`);
  await click(cdp, '.nav-item[data-page="my-tasks"]');
  await waitUntil(cdp, `!!document.querySelector('#page-my-tasks:not([hidden])')`);
  const exitedOnAdmin = await cdp.evaluate(`document.getElementById('preview-banner')?.hidden === true`);

  // Publish Diff & Stale Base Rebase Refresh
  await cdp.evaluate(`(() => {
    window.__pr4OrigFetch = window.fetch.bind(window);
    const newer = JSON.parse(${JSON.stringify(draft)});
    newer.revision = 9;
    window.fetch = async (url, init) => {
      const s = String(url);
      if (s.includes('api/publish.php') && init?.method === 'POST') {
        return new Response(JSON.stringify({ code: 'stale_base', error: 'Board changed', current: newer }), {
          status: 409, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (s.includes('data/current.json')) {
        return new Response(JSON.stringify({ ...newer, tasks: [...newer.tasks, { id: 'remote-new', title: 'Remote Task', subject: 'PE' }] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return window.__pr4OrigFetch(url, init);
    };
  })()`);
  await click(cdp, '#btn-apply');
  await waitUntil(cdp, `!document.getElementById('publish-overlay')?.hidden`);
  const diffInitial = await cdp.evaluate(`document.getElementById('publish-diff')?.textContent || ''`);
  await click(cdp, '#publish-submit');
  await waitUntil(cdp, `document.getElementById('publish-conflict')?.hidden === false`);
  await click(cdp, '#publish-rebase');
  await waitUntil(cdp, `document.getElementById('publish-conflict')?.hidden === true && (document.getElementById('publish-diff')?.textContent || '').includes('Remote Task')`);
  const diffRebased = await cdp.evaluate(`document.getElementById('publish-diff')?.textContent || ''`);
  await pressKey(cdp, 'Escape', 'Escape', 27);
  await waitUntil(cdp, `document.getElementById('publish-overlay')?.hidden === true`);

  // Quick Add edge-only + Keep in title button
  await click(cdp, '#new-task-btn');
  await waitUntil(cdp, `document.getElementById('quick-overlay')?.hidden === false`);
  await cdp.evaluate(`(() => {
    const inp = document.getElementById('quick-input');
    inp.value = 'GENMATH Report ip friday';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const qaParsed = await cdp.evaluate(`({
    title: document.querySelector('#quick-preview .quick-title')?.textContent?.trim(),
    hasKeepBtn: !!document.getElementById('quick-keep-literal'),
  })`);
  await click(cdp, '#quick-keep-literal');
  const qaKept = await cdp.evaluate(`({
    title: document.querySelector('#quick-preview .quick-title')?.textContent?.trim(),
    btnLabel: document.getElementById('quick-keep-literal')?.textContent?.trim(),
  })`);
  await pressKey(cdp, 'Escape', 'Escape', 27);

  check(
    'PR 4 draft isolation, persistent preview, admin list/filter, publish diff + rebase, and quick-add literal',
    adminDefault.view === 'list' && adminDefault.listVisible && adminDefault.boardHidden
      && adminDefault.noSumProgress && adminDefault.buckets >= 2 && adminDefault.buckets <= 4
      && adminFiltered.hasDraftTask && adminFiltered.otherCount === 0
      && !liveClass.hasDraftTask && !liveClass.hasDraftAnn && liveClass.hasLiveFx012 && !liveClass.hasRenamedSubject && liveClass.previewHidden
      && !liveCalLeak && !liveDoneLeak && pastAdminBanner
      && prevClass.bannerShown && prevClass.hasDraftTask && prevClass.hasDraftAnn
      && prevCalBanner && prevDoneBanner && prevPastBanner && exitedOnAdmin
      && diffInitial.includes('SECRET DRAFT TASK') && diffInitial.includes('Draft edited schema task')
      && diffRebased.includes('Remote Task')
      && qaParsed.title === 'Report ip' && qaParsed.hasKeepBtn
      && qaKept.title === 'GENMATH Report ip friday' && qaKept.btnLabel === 'Parse keywords',
    JSON.stringify({ adminDefault, adminFiltered, liveClass, liveCalLeak, liveDoneLeak, pastAdminBanner, prevClass, prevCalBanner, prevDoneBanner, prevPastBanner, exitedOnAdmin, qaParsed, qaKept }),
  );

  // 14. PR 5 desktop left-alignment, tablet wordmark, filter reset/empty, Home/End, ARIA dialog, Quick Add a11y, Settings shortcuts, dynamic tour subject.
  await boot(cdp, 960, { admin: true, hash: 'my-tasks' });
  const tablet960 = await cdp.evaluate(`({
    brandDisplay: getComputedStyle(document.querySelector('.tb .brand b')).display,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  })`);

  await boot(cdp, 1280, {});
  const listGeom = await cdp.evaluate(`(() => {
    const sel = document.getElementById('class-status-filter');
    sel.value = 'not_started';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      crumbLeft: Math.round(document.getElementById('breadcrumb-current').getBoundingClientRect().left),
      pageLeft: Math.round(document.getElementById('page-class-tasks').getBoundingClientRect().left),
    };
  })()`);
  await click(cdp, '#page-class-tasks [data-view="board"]');
  await waitUntil(cdp, `document.getElementById('page-class-tasks').dataset.view === 'board'`);
  const boardGeom = await cdp.evaluate(`(() => {
    const su = document.getElementById('class-subject-filter');
    su.value = 'GENSCI';
    su.dispatchEvent(new Event('change', { bubbles: true }));
    const emptyMsgs = [...document.querySelectorAll('#class-board .column-empty:not([hidden])')].map((el) => el.textContent.trim());
    return {
      crumbLeft: Math.round(document.getElementById('breadcrumb-current').getBoundingClientRect().left),
      pageLeft: Math.round(document.getElementById('page-class-tasks').getBoundingClientRect().left),
      clearedStatus: document.getElementById('class-status-filter').value === '',
      emptyMsgs,
    };
  })()`);

  // Status popover Home/End
  await click(cdp, '#class-board .task-card .status-check');
  const popOpened = await waitUntil(cdp, `!!document.querySelector('.status-popover[aria-label="Status"]:not([hidden])')`);
  await pressKey(cdp, 'End', 'End', 35);
  const endStatus = await cdp.evaluate(`document.activeElement?.dataset?.status || ''`);
  await pressKey(cdp, 'Home', 'Home', 36);
  const homeStatus = await cdp.evaluate(`document.activeElement?.dataset?.status || ''`);
  await pressKey(cdp, 'Escape', 'Escape', 27);

  // Dialog ARIA + read-only empty-notes suppression when files exist + Settings shortcuts + Quick Add a11y + Tour dynamic subject
  const pr5Draft = JSON.parse(draft);
  pr5Draft.subjects = [{ code: 'BIO101', name: 'BIO101', color: '#8fe3a8', active: true }];
  pr5Draft.tasks = [
    {
      id: 'pr5-ro-files',
      title: 'File Only Task',
      subject: 'BIO101',
      status: 'not_started',
      dueDate: '2026-11-12',
      notes: '',
      files: [{ id: '0123456789abcdef0123456789abcdef.pdf', name: 'rubric.pdf', size: 1024 }],
      createdAt: Date.now(),
    },
    ...(pr5Draft.tasks || []),
  ];
  await boot(cdp, 1280, {
    admin: true,
    hash: 'my-tasks',
    storage: { class_tasks_draft: JSON.stringify(pr5Draft), class_tasks_tour_seen: '1' },
  });

  // Editable task with files + empty notes keeps notes field visible; Settings shows shortcuts; Quick Add lacks aria-live on #quick-preview
  await click(cdp, '#task-list [data-task-id="pr5-ro-files"] .task-row-title');
  await waitUntil(cdp, `document.getElementById('task-dialog-overlay')?.hidden === false`);
  const adminDlg = await cdp.evaluate(`({
    notesHidden: document.getElementById('dialog-notes-field')?.hidden,
    noLabelledBy: ['dialog-status-btn', 'dialog-subject-btn', 'dialog-date-btn'].every((id) => !document.getElementById(id)?.hasAttribute('aria-labelledby')),
    labelsOk: (document.getElementById('dialog-status-btn')?.getAttribute('aria-label') || '').startsWith('Status:')
      && (document.getElementById('dialog-subject-btn')?.getAttribute('aria-label') || '').startsWith('Subject:')
      && (document.getElementById('dialog-date-btn')?.getAttribute('aria-label') || '').startsWith('Due:'),
  })`);
  await pressKey(cdp, 'Escape', 'Escape', 27);
  await waitUntil(cdp, `document.getElementById('task-dialog-overlay')?.hidden === true`);

  // Preview mode opens pr5-ro-files as read-only -> empty notes + file hides #dialog-notes-field
  await click(cdp, '#btn-preview');
  await waitUntil(cdp, `!!document.querySelector('#page-class-tasks:not([hidden])') && !!document.querySelector('#class-task-list [data-task-id="pr5-ro-files"]')`);
  await click(cdp, '#class-task-list [data-task-id="pr5-ro-files"] .task-row-title');
  await waitUntil(cdp, `document.getElementById('task-dialog-overlay')?.hidden === false`);
  const roFilesDlg = await cdp.evaluate(`({
    readonly: document.querySelector('#task-dialog-overlay .task-dialog')?.classList.contains('is-readonly'),
    notesHidden: document.getElementById('dialog-notes-field')?.hidden,
    filesHidden: document.getElementById('dialog-files-field')?.hidden,
  })`);
  await pressKey(cdp, 'Escape', 'Escape', 27);
  await waitUntil(cdp, `document.getElementById('task-dialog-overlay')?.hidden === true`);
  await click(cdp, '#preview-exit');
  await waitUntil(cdp, `!!document.querySelector('#page-my-tasks:not([hidden])')`);

  // Quick Add aria-live check + debounced actionFeedback
  const quickPreviewHasLive = await cdp.evaluate(`document.getElementById('quick-preview')?.hasAttribute('aria-live')`);
  await click(cdp, '#new-task-btn');
  await waitUntil(cdp, `document.getElementById('quick-overlay')?.hidden === false`);
  await cdp.evaluate(`(() => {
    const inp = document.getElementById('quick-input');
    inp.value = 'BIO101 Draft notes tomorrow';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitUntil(cdp, `(document.getElementById('action-feedback')?.textContent || '').includes('Draft notes')`);
  const quickFeedback = await cdp.evaluate(`document.getElementById('action-feedback')?.textContent || ''`);
  await pressKey(cdp, 'Escape', 'Escape', 27);
  await waitUntil(cdp, `document.getElementById('quick-overlay')?.hidden === true`);

  // Settings keyboard shortcuts + Tour dynamic subject
  await click(cdp, '#settings-open');
  await waitUntil(cdp, `document.getElementById('settings-overlay')?.hidden === false`);
  const shortcutsVisible = await cdp.evaluate(`(() => {
    const row = document.getElementById('settings-shortcuts-row');
    return !!row && row.getClientRects().length > 0 && row.textContent.includes('Keyboard shortcuts') && row.textContent.includes('/');
  })()`);
  await click(cdp, '#settings-replay');
  await waitUntil(cdp, `document.getElementById('tour-overlay')?.hidden === false`);
  await click(cdp, '#tour-next');
  await click(cdp, '#tour-next');
  const tourSample = await cdp.evaluate(`({
    tag: document.querySelector('#tour-sample .subject-tag')?.textContent?.trim(),
    title: document.querySelector('#tour-sample .task-card-title')?.textContent?.trim(),
  })`);
  await click(cdp, '#tour-skip');
  await waitUntil(cdp, `document.getElementById('tour-overlay')?.hidden === true`);

  check(
    'PR 5 alignment, tablet wordmark, status reset/filter msg, Home/End, ARIA dialog, Quick Add a11y, shortcuts, dynamic tour',
    tablet960.brandDisplay === 'block' && tablet960.scrollW <= tablet960.clientW
      && Math.abs(listGeom.crumbLeft - boardGeom.crumbLeft) <= 1 && Math.abs(listGeom.pageLeft - boardGeom.pageLeft) <= 1
      && boardGeom.clearedStatus && boardGeom.emptyMsgs.includes('No tasks match these filters.')
      && endStatus === 'done' && homeStatus === 'not_started' && popOpened
      && adminDlg.notesHidden === false && adminDlg.noLabelledBy && adminDlg.labelsOk
      && roFilesDlg.readonly && roFilesDlg.notesHidden === true && roFilesDlg.filesHidden === false
      && quickPreviewHasLive === false && quickFeedback.includes('Draft notes')
      && shortcutsVisible && tourSample.tag === 'BIO101' && tourSample.title === 'Sample: BIO101 worksheet',
    JSON.stringify({ tablet960, listGeom, boardGeom, popOpened, endStatus, homeStatus, adminDlg, roFilesDlg, quickPreviewHasLive, quickFeedback, shortcutsVisible, tourSample }),
  );

  // 15. PR 1 (P1 #1): #mine surfaces overdue count alongside Next and orders Overdue this week before Due today & tomorrow.
  const trustCheck = {};
  for (const width of [390, 1280]) {
    await boot(cdp, width, { hash: 'class-tasks' });
    await waitUntil(cdp, `document.querySelectorAll('#class-task-list .list-bucket').length >= 2`);
    trustCheck['w' + width] = await cdp.evaluate(`(() => {
      const nextText = document.getElementById('mine-next')?.textContent?.trim() || '';
      const buckets = [...document.querySelectorAll('#class-task-list .list-bucket')].map((el) => el.textContent.trim());
      return {
        nextText,
        buckets,
        hasOverdueAndNext: /^\\d+ overdue · Next: /.test(nextText),
        overdueFirst: buckets[0] === 'Overdue this week' && buckets[1] === 'Due today & tomorrow',
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      };
    })()`);
  }
  await boot(cdp, 320, { hash: 'class-tasks' });
  await waitUntil(cdp, `!!document.querySelector('#class-task-list .task-row')`);
  const fold320P1 = await cdp.evaluate(`(() => {
    const rr = document.querySelector('#class-task-list .task-row').getBoundingClientRect();
    const tb = document.querySelector('.tb').getBoundingClientRect();
    return {
      foldClearance: Math.round(tb.top - rr.bottom),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  })()`);
  check(
    'P1 #1 overdue hero summary visibility and Overdue-first bucket order',
    trustCheck.w390.hasOverdueAndNext && trustCheck.w390.overdueFirst && !trustCheck.w390.overflowX
      && trustCheck.w1280.hasOverdueAndNext && trustCheck.w1280.overdueFirst && !trustCheck.w1280.overflowX
      && fold320P1.foldClearance >= 12 && !fold320P1.overflowX,
    JSON.stringify({ trustCheck, fold320P1 }),
  );
}
