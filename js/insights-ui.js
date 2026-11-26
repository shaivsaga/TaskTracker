import { dom } from './dom.js';
import { currentSection, keysForSection, plural, sectionKey } from './util.js';
import { openOverlay, hideOverlay } from './motion.js';
import { analyzeWorkload, explainTaskIndicator, summarizeActivityHistory } from './insights.js';
import {
  clearActivityHistory,
  createInsightsRuntimeState,
  flushPendingActivityCleanup,
  getInsightsStorageStatus,
  insightsKeysFor,
  readActivityHistory,
  readInsightsPrefs,
  recordActivityTransition,
  setActivityOptIn,
  setShowInsights,
} from './insights-store.js';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function isLiveControl(el) {
  if (!el || el.disabled || el.isConnected === false) return false;
  if (typeof el.closest === 'function' && el.closest('[hidden]')) return false;
  if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
  return true;
}

function getDeadlineSec(taskObj) {
  if (!taskObj || typeof taskObj !== 'object') return null;
  let ts = null;
  if (typeof taskObj.getDueTimestamp === 'function') ts = taskObj.getDueTimestamp();
  else if (typeof taskObj.getDeadline === 'function') ts = taskObj.getDeadline();
  if (ts instanceof Date && Number.isFinite(ts.getTime())) {
    return Math.floor(ts.getTime() / 1000);
  }
  return null;
}

function formatCheckInTime(tsSec) {
  if (!Number.isFinite(tsSec)) return 'Never';
  try {
    return new Date(tsSec * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch (e) {
    return new Date(tsSec * 1000).toISOString();
  }
}

export function createInsightsController() {
  let getTasksFn = () => [];
  let getProgressFn = () => ({});
  let getCatalogFn = () => [];
  let createSubjectTagFn = null;
  let renderClassTasksFn = null;
  let renderAllTasksFn = null;
  let openSettingsFn = null;
  let reloadProgressFromStorageFn = null;
  let clock = () => Date.now();
  let explicitStorage = undefined;
  let explicitSection = undefined;
  let runtimeState = null;
  let uiDom = dom;
  let doc = null;
  let win = null;

  let initialized = false;
  let boundDom = null;
  let sessionShowOverride = null;
  let actionNotice = null;
  let clearConfirmOpen = false;
  let currentWorkload = null;
  let currentPrefs = { v: 1, showInsights: true, activityOptIn: false };
  let listeners = [];

  const activeSection = () => (explicitSection !== undefined ? explicitSection : currentSection());

  function resolveStorageTarget() {
    if (explicitStorage !== undefined) {
      return {
        storage: explicitStorage,
        available: Boolean(explicitStorage),
        errorName: explicitStorage ? null : 'SecurityError',
      };
    }
    try {
      const targetWin = win || (typeof window !== 'undefined' ? window : null);
      const ls = targetWin && 'localStorage' in targetWin ? targetWin.localStorage : null;
      if (!ls) return { storage: null, available: false, errorName: 'StorageUnavailable' };
      return { storage: ls, available: true, errorName: null };
    } catch (e) {
      return { storage: null, available: false, errorName: e?.name || 'SecurityError' };
    }
  }

  function storeOpts(storageTarget = resolveStorageTarget()) {
    return {
      storage: storageTarget.storage,
      section: activeSection(),
      runtimeState: runtimeState || undefined,
      errorName: storageTarget.errorName,
    };
  }

  function readStatusSafe(storageTarget) {
    return getInsightsStorageStatus({
      section: activeSection(),
      runtimeState: runtimeState || undefined,
      storage: storageTarget?.storage,
    });
  }

  function effectiveShowValue(prefs) {
    return sessionShowOverride !== null ? sessionShowOverride : Boolean(prefs.showInsights);
  }

  function announce(message) {
    if (uiDom.actionFeedback && message) {
      uiDom.actionFeedback.textContent = message;
    }
  }

  function hasPendingCleanupState(st) {
    return Boolean(
      st.pendingActivityPurge
      || st.pendingOptOut
      || (Array.isArray(st.pendingDeletedIds) && st.pendingDeletedIds.length > 0),
    );
  }

  function syncMineButton() {
    const btn = uiDom.mineInsightsBtn;
    const dot = uiDom.mineInsightsDot;
    if (!btn) return;
    const show = effectiveShowValue(currentPrefs);
    const list = getTasksFn() || [];
    const visible = Boolean(show && list.length > 0);
    btn.hidden = !visible;
    if (dot) {
      const noticeList = currentWorkload && Array.isArray(currentWorkload.notices) ? currentWorkload.notices : [];
      const urgent = Boolean(currentWorkload && (currentWorkload.overdueCount > 0 || currentWorkload.dueSoonCount > 0));
      dot.hidden = noticeList.length === 0;
      if (dot.classList) dot.classList.toggle('is-urgent', urgent);
    }
  }

  function renderActivitySection(elFactory, opts, prefs, st, storageTarget) {
    const host = uiDom.insightsActivityContent;
    if (!host) return;
    host.textContent = '';

    if (!storageTarget.available) {
      host.appendChild(elFactory(
        'p',
        'insights-note',
        'Local activity history is unavailable while browser storage is blocked.',
      ));
      return;
    }

    if (st.activitySuspended || hasPendingCleanupState(st)) {
      host.appendChild(elFactory(
        'p',
        'insights-note',
        'Local activity history is paused while storage recovery or cleanup is pending.',
      ));
      return;
    }

    if (!prefs.activityOptIn) {
      host.appendChild(elFactory(
        'p',
        'insights-note',
        'Off by default. Turn on local activity history in Settings to count your status changes on this device.',
      ));
      return;
    }

    const act = readActivityHistory(opts);
    const afterSt = readStatusSafe(storageTarget);
    if (afterSt.activitySuspended || hasPendingCleanupState(afterSt)) {
      if (uiDom.insightsDegradedBanner) {
        uiDom.insightsDegradedBanner.textContent = afterSt.lastWarning
          || 'Could not read stored activity history; activity processing is suspended.';
        uiDom.insightsDegradedBanner.hidden = false;
      }
      host.appendChild(elFactory(
        'p',
        'insights-note',
        'Local activity history is paused while storage recovery or cleanup is pending.',
      ));
      return;
    }
    const nowSec = Math.floor(clock() / 1000);
    const summary = summarizeActivityHistory(act, nowSec);
    if (!summary.hasHistory) {
      host.appendChild(elFactory(
        'p',
        'insights-note',
        'Recording is on. Change any task status to start counting your check-ins on this device.',
      ));
      return;
    }

    const grid = elFactory('div', 'insights-stats');
    const items = [
      { label: 'Status changes', value: String(summary.transitionCount) },
      { label: 'Tasks updated', value: String(summary.trackedTasks) },
      { label: 'Currently done', value: String(summary.completedCount) },
      { label: 'Last check-in', value: formatCheckInTime(summary.lastCheckInSec) },
    ];
    for (const metric of items) {
      const box = elFactory('div', 'insights-stat');
      box.appendChild(elFactory('span', 'insights-stat-value', metric.value));
      box.appendChild(elFactory('span', 'insights-stat-label', metric.label));
      grid.appendChild(box);
    }
    host.appendChild(grid);

    if (summary.reopenCount > 0 || summary.recent7dTransitions > 0) {
      const parts = [];
      parts.push(`${plural(summary.recent7dTransitions, 'change')} in the last 7 days`);
      if (summary.reopenCount > 0) parts.push(`${plural(summary.reopenCount, 'reopen')}`);
      host.appendChild(elFactory('p', 'insights-note', `${parts.join(' · ')}.`));
    }
  }

  function renderOverlay() {
    if (!uiDom.insightsOverlay || !doc) return;
    const elFactory = (tag, cls, text) => {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    const storageTarget = resolveStorageTarget();
    const opts = storeOpts(storageTarget);
    const st = readStatusSafe(storageTarget);
    const workload = currentWorkload || analyzeWorkload(getTasksFn(), getProgressFn(), clock());
    const allTasks = Array.isArray(getTasksFn()) ? getTasksFn() : [];

    if (uiDom.insightsDegradedBanner) {
      const degradedMsg = hasPendingCleanupState(st) || st.activitySuspended || st.degraded
        ? (st.lastWarning || actionNotice?.text || 'Browser storage reported an error; local activity processing is paused.')
        : (!storageTarget.available
          ? 'Browser storage is unavailable on this device. Deterministic insights stay active, and activity history is disabled.'
          : '');
      uiDom.insightsDegradedBanner.textContent = degradedMsg;
      uiDom.insightsDegradedBanner.hidden = !degradedMsg;
    }

    if (uiDom.insightsWorkloadSummary) {
      if (allTasks.length === 0) {
        uiDom.insightsWorkloadSummary.textContent = 'No class tasks posted yet.';
      } else if (workload.openCount === 0) {
        uiDom.insightsWorkloadSummary.textContent = 'All caught up — no open class tasks right now.';
      } else {
        const parts = [`${plural(workload.openCount, 'open task')}`];
        if (workload.dueTodayCount > 0) parts.push(`${workload.dueTodayCount} due today`);
        if (workload.dueSoonCount > workload.dueTodayCount) parts.push(`${workload.dueSoonCount} due within 48h`);
        if (workload.overdueCount > 0) parts.push(`${workload.overdueCount} overdue`);
        uiDom.insightsWorkloadSummary.textContent = `${parts.join(', ')}.`;
      }
    }

    if (uiDom.insightsNoticesList) {
      uiDom.insightsNoticesList.textContent = '';
      if (allTasks.length > 0 && workload.openCount > 0) {
        if (workload.notices.length === 0) {
          uiDom.insightsNoticesList.hidden = false;
          uiDom.insightsNoticesList.appendChild(elFactory(
            'li',
            'insights-item is-calm',
            'No deadline clusters or urgent due-soon items in the next 48 hours.',
          ));
        } else {
          uiDom.insightsNoticesList.hidden = false;
          for (const notice of workload.notices) {
            const cls = notice.kind === 'overdue'
              ? 'insights-item is-overdue'
              : (notice.kind === 'due_soon_unstarted' ? 'insights-item is-due-soon' : 'insights-item');
            uiDom.insightsNoticesList.appendChild(elFactory('li', cls, notice.text));
          }
        }
      } else {
        uiDom.insightsNoticesList.hidden = true;
      }
    }

    if (uiDom.insightsSubjectsSection && uiDom.insightsSubjectsList) {
      uiDom.insightsSubjectsList.textContent = '';
      const subjectRows = Array.isArray(workload.subjectCounts) ? workload.subjectCounts : [];
      uiDom.insightsSubjectsSection.hidden = subjectRows.length === 0;
      const liveCat = typeof getCatalogFn === 'function' ? getCatalogFn() : [];
      for (const entry of subjectRows) {
        const row = elFactory('li', 'insights-subject-row');
        if (entry.subject && typeof createSubjectTagFn === 'function') {
          row.appendChild(createSubjectTagFn(entry.subject, liveCat));
        } else {
          row.appendChild(elFactory('span', 'subject-tag', entry.subject || 'No subject'));
        }
        const metaParts = [`${entry.openCount} open`];
        if (entry.overdueCount > 0) metaParts.push(`${entry.overdueCount} overdue`);
        if (entry.dueSoonCount > 0) metaParts.push(`${entry.dueSoonCount} due soon`);
        row.appendChild(elFactory('span', 'insights-subject-meta', metaParts.join(' · ')));
        uiDom.insightsSubjectsList.appendChild(row);
      }
    }

    renderActivitySection(elFactory, opts, currentPrefs, st, storageTarget);
  }

  function paintSegGroup(container, attrName, activeVal) {
    if (!container) return;
    container.querySelectorAll(`[${attrName}]`).forEach((btn) => {
      const match = btn.getAttribute(attrName) === activeVal;
      btn.classList?.toggle('is-active', match);
      btn.setAttribute?.('aria-pressed', String(match));
    });
  }

  function showClearConfirm(show, restoreFocus = true) {
    clearConfirmOpen = Boolean(show);
    if (uiDom.insightsClearConfirm) uiDom.insightsClearConfirm.hidden = !clearConfirmOpen;
    if (uiDom.insightsClearStart) uiDom.insightsClearStart.hidden = clearConfirmOpen;
    if (!restoreFocus) return;
    if (clearConfirmOpen && isLiveControl(uiDom.insightsClearCancel)) {
      uiDom.insightsClearCancel.focus();
    } else if (!clearConfirmOpen) {
      if (isLiveControl(uiDom.insightsClearStart)) {
        uiDom.insightsClearStart.focus();
      } else {
        const activeBtn = uiDom.insightsActivitySeg?.querySelector?.('[aria-pressed="true"]');
        if (isLiveControl(activeBtn)) activeBtn.focus();
      }
    }
  }

  function paintSettingsStatus(st, storageTarget) {
    const statusEl = uiDom.insightsSettingsStatus;
    if (!statusEl) return;

    let text = '';
    let isWarning = false;

    if (actionNotice && actionNotice.text) {
      text = actionNotice.text;
      isWarning = Boolean(actionNotice.isWarning);
    } else if (hasPendingCleanupState(st) || st.activitySuspended || st.degraded) {
      text = st.lastWarning || 'Browser storage is degraded; local activity processing is suspended.';
      isWarning = true;
    } else if (!storageTarget.available) {
      text = 'Browser storage is unavailable; local activity history is disabled while deterministic insights run in memory.';
      isWarning = true;
    }

    statusEl.hidden = !text;
    statusEl.textContent = text;
    statusEl.classList?.toggle('is-warning', isWarning);
    statusEl.setAttribute?.('role', isWarning ? 'alert' : 'status');
    statusEl.setAttribute?.('aria-live', isWarning ? 'assertive' : 'polite');
  }

  function syncSettings({ resetConfirm = false } = {}) {
    if (resetConfirm) {
      showClearConfirm(false, false);
      if (actionNotice && !actionNotice.isWarning) actionNotice = null;
    }

    const storageTarget = resolveStorageTarget();
    const opts = storeOpts(storageTarget);
    currentPrefs = readInsightsPrefs(opts);
    const st = readStatusSafe(storageTarget);
    const show = effectiveShowValue(currentPrefs);

    paintSegGroup(uiDom.insightsShowSeg, 'data-insights-show', show ? 'on' : 'off');
    paintSegGroup(uiDom.insightsActivitySeg, 'data-insights-activity', currentPrefs.activityOptIn ? 'on' : 'off');

    let hasHistoryData = false;
    if (storageTarget.available && currentPrefs.activityOptIn && !st.activitySuspended) {
      const act = readActivityHistory(opts);
      hasHistoryData = Boolean(act && isPlainObject(act.tasks) && Object.keys(act.tasks).length > 0);
    }
    const finalSt = readStatusSafe(storageTarget);
    const onBtn = uiDom.insightsActivitySeg?.querySelector?.('[data-insights-activity="on"]');
    const offBtn = uiDom.insightsActivitySeg?.querySelector?.('[data-insights-activity="off"]');
    const blockOptIn = !storageTarget.available || finalSt.activitySuspended || hasPendingCleanupState(finalSt);
    if (onBtn) onBtn.disabled = blockOptIn && !currentPrefs.activityOptIn;
    if (offBtn) offBtn.disabled = false;

    const canClear = hasHistoryData || Boolean(finalSt.pendingActivityPurge);
    if (uiDom.insightsClearStart) {
      uiDom.insightsClearStart.disabled = !canClear;
      if (!canClear && clearConfirmOpen) showClearConfirm(false, false);
    }

    paintSettingsStatus(finalSt, storageTarget);
  }

  function openInsights(openerEl = null) {
    if (!uiDom.insightsOverlay) return;
    refresh();
    if (!effectiveShowValue(currentPrefs)) return;
    renderOverlay();
    uiDom.insightsOverlay._returnFocus = openerEl || doc?.activeElement || uiDom.mineInsightsBtn || null;
    openOverlay(uiDom.insightsOverlay);
    if (isLiveControl(uiDom.insightsClose)) uiDom.insightsClose.focus();
  }

  function closeInsights(restoreFocus = true) {
    const ov = uiDom.insightsOverlay;
    if (!ov || ov.hidden || ov.classList?.contains('is-closing')) return;
    if (!restoreFocus) {
      ov._returnFocus = null;
      hideOverlay(ov);
      return;
    }
    const candidate = ov._returnFocus;
    if (!isLiveControl(candidate)) {
      if (isLiveControl(uiDom.mineInsightsBtn)) ov._returnFocus = uiDom.mineInsightsBtn;
      else if (isLiveControl(uiDom.settingsOpen)) ov._returnFocus = uiDom.settingsOpen;
      else ov._returnFocus = null;
    }
    const released = hideOverlay(ov);
    if (!released && isLiveControl(uiDom.settingsOpen)) {
      uiDom.settingsOpen.focus();
    }
  }

  function handleShowSegClick(e) {
    const btn = e.target?.closest?.('[data-insights-show]');
    if (!btn) return;
    const enabled = btn.getAttribute('data-insights-show') === 'on';
    const storageTarget = resolveStorageTarget();
    const res = setShowInsights(enabled, storeOpts(storageTarget));

    if (res.ok) {
      sessionShowOverride = null;
      currentPrefs = res.prefs;
      actionNotice = {
        text: enabled
          ? 'Insights enabled on your task list.'
          : 'Insights hidden on your task list. Any saved activity history was kept.',
        isWarning: false,
      };
    } else {
      sessionShowOverride = enabled;
      currentPrefs = res.prefs;
      actionNotice = {
        text: 'Could not save Show Insights preference to browser storage; applying for this session only.',
        isWarning: true,
      };
    }

    refresh();
    renderClassTasksFn?.();
    syncSettings();
    announce(enabled ? 'Insights shown' : 'Insights hidden');
  }

  function handleActivitySegClick(e) {
    const btn = e.target?.closest?.('[data-insights-activity]');
    if (!btn || btn.disabled) return;
    const enabled = btn.getAttribute('data-insights-activity') === 'on';
    const storageTarget = resolveStorageTarget();
    const res = setActivityOptIn(enabled, storeOpts(storageTarget));
    currentPrefs = res.prefs || readInsightsPrefs(storeOpts(storageTarget));

    if (!res.ok || res.durableConfirmed === false || res.degraded) {
      actionNotice = {
        text: res.warning || 'Browser storage failed to update activity history preference.',
        isWarning: true,
      };
    } else if (enabled) {
      actionNotice = {
        text: 'Local activity history turned on for this device.',
        isWarning: false,
      };
    } else {
      actionNotice = {
        text: 'Activity history turned off and deleted from this device.',
        isWarning: false,
      };
      showClearConfirm(false, false);
    }

    refresh();
    syncSettings();
    announce(actionNotice.text);
  }

  function handleClearConfirmClick() {
    const storageTarget = resolveStorageTarget();
    const beforePrefs = readInsightsPrefs(storeOpts(storageTarget));
    const res = clearActivityHistory(storeOpts(storageTarget));

    if (!res.ok || res.durableConfirmed === false || res.degraded) {
      actionNotice = {
        text: res.warning || 'Could not delete stored activity history; deletion could not be confirmed.',
        isWarning: true,
      };
      showClearConfirm(false, true);
    } else {
      currentPrefs = readInsightsPrefs(storeOpts(storageTarget));
      actionNotice = {
        text: beforePrefs.activityOptIn
          ? 'Activity history cleared. Recording preference was kept.'
          : 'Activity history cleared.',
        isWarning: false,
      };
      showClearConfirm(false, true);
    }

    refresh();
    syncSettings();
    announce(actionNotice.text);
  }

  function refresh() {
    try {
      const storageTarget = resolveStorageTarget();
      const opts = storeOpts(storageTarget);
      currentPrefs = readInsightsPrefs(opts);
      currentWorkload = analyzeWorkload(getTasksFn() || [], getProgressFn() || {}, clock());
      syncMineButton();
      if (!effectiveShowValue(currentPrefs) && uiDom.insightsOverlay && !uiDom.insightsOverlay.hidden) {
        closeInsights(true);
      } else if (uiDom.insightsOverlay && !uiDom.insightsOverlay.hidden) {
        renderOverlay();
      }
      if (uiDom.settingsOverlay && !uiDom.settingsOverlay.hidden) {
        syncSettings();
      }
      return currentWorkload;
    } catch (e) {
      return null;
    }
  }

  function getTaskCue(taskObj, existingPillText = '') {
    try {
      if (!effectiveShowValue(currentPrefs) || !currentWorkload) return null;
      return explainTaskIndicator(taskObj, currentWorkload, existingPillText);
    } catch (e) {
      return null;
    }
  }

  function recordTransition(taskObj, status) {
    try {
      if (!taskObj || typeof taskObj !== 'object' || taskObj.id === undefined || taskObj.id === null) return null;
      const storageTarget = resolveStorageTarget();
      const nowSec = Math.floor(clock() / 1000);
      const deadlineSec = getDeadlineSec(taskObj);
      const res = recordActivityTransition(taskObj.id, status, nowSec, {
        ...storeOpts(storageTarget),
        subject: typeof taskObj.subject === 'string' ? taskObj.subject : '',
        deadlineSec,
      });
      if (res && (res.degraded || res.suspended || res.warning)) {
        if (res.warning) actionNotice = { text: res.warning, isWarning: true };
        if (uiDom.insightsOverlay && !uiDom.insightsOverlay.hidden) renderOverlay();
        if (uiDom.settingsOverlay && !uiDom.settingsOverlay.hidden) syncSettings();
      }
      return res;
    } catch (e) {
      return null;
    }
  }

  function handleStorageDegraded(res) {
    try {
      if (res && res.warning) actionNotice = { text: res.warning, isWarning: true };
      if (uiDom.insightsOverlay && !uiDom.insightsOverlay.hidden) renderOverlay();
      if (uiDom.settingsOverlay && !uiDom.settingsOverlay.hidden) syncSettings();
    } catch (e) {}
  }

  function handleStorageEvent(e) {
    try {
      const sec = activeSection();
      const keys = insightsKeysFor(sec);
      const sectionKeys = keysForSection(sec);
      const changedKey = e && 'key' in e ? e.key : null;
      const progressChanged = changedKey === null || changedKey === sectionKeys.progress;
      const insightsChanged = changedKey === null || changedKey === keys.prefs || changedKey === keys.activity;
      if (!progressChanged && !insightsChanged) return;

      if (insightsChanged) {
        sessionShowOverride = null;
        const storageTarget = resolveStorageTarget();
        if (storageTarget.available) {
          flushPendingActivityCleanup(storeOpts(storageTarget));
        }
        const st = readStatusSafe(storageTarget);
        if (!st.degraded && !st.activitySuspended && !hasPendingCleanupState(st)) {
          actionNotice = null;
        }
      }

      if (progressChanged && typeof reloadProgressFromStorageFn === 'function') {
        reloadProgressFromStorageFn();
        return;
      }

      refresh();
      renderClassTasksFn?.();
    } catch (e2) {}
  }

  function on(target, type, fn) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn);
    listeners.push(() => target.removeEventListener(type, fn));
  }

  function dispose() {
    for (const off of listeners) off();
    listeners = [];
    boundDom = null;
    initialized = false;
  }

  function bindEvents() {
    if (boundDom === uiDom && initialized) return;
    dispose();
    boundDom = uiDom;
    initialized = true;

    on(uiDom.mineInsightsBtn, 'click', () => openInsights(uiDom.mineInsightsBtn));
    on(uiDom.insightsClose, 'click', () => closeInsights(true));
    on(uiDom.insightsOverlay, 'click', (e) => {
      if (e.target === uiDom.insightsOverlay) closeInsights(true);
    });
    on(uiDom.insightsOpenSettings, 'click', () => {
      closeInsights(false);
      openSettingsFn?.(isLiveControl(uiDom.mineInsightsBtn) ? uiDom.mineInsightsBtn : uiDom.settingsOpen);
    });
    on(doc, 'keydown', (e) => {
      if (e.key !== 'Escape') return;
      const ov = uiDom.insightsOverlay;
      if (!ov || ov.hidden || ov.classList?.contains('is-closing')) return;
      if (doc?.querySelector?.('.confirm-overlay:not([hidden]):not(.is-closing), #settings-overlay:not([hidden]):not(.is-closing)')) {
        return;
      }
      closeInsights(true);
    });
    on(uiDom.insightsShowSeg, 'click', handleShowSegClick);
    on(uiDom.insightsActivitySeg, 'click', handleActivitySegClick);
    on(uiDom.insightsClearStart, 'click', () => {
      if (!uiDom.insightsClearStart?.disabled) showClearConfirm(true, true);
    });
    on(uiDom.insightsClearCancel, 'click', () => showClearConfirm(false, true));
    on(uiDom.insightsClearConfirmBtn, 'click', handleClearConfirmClick);
    on(win, 'storage', handleStorageEvent);
  }

  function init(deps = {}) {
    getTasksFn = typeof deps.getTasks === 'function' ? deps.getTasks : () => [];
    getProgressFn = typeof deps.getProgress === 'function' ? deps.getProgress : () => ({});
    getCatalogFn = typeof deps.getCatalog === 'function' ? deps.getCatalog : () => [];
    createSubjectTagFn = typeof deps.createSubjectTag === 'function' ? deps.createSubjectTag : null;
    renderClassTasksFn = typeof deps.renderClassTasks === 'function' ? deps.renderClassTasks : null;
    renderAllTasksFn = typeof deps.renderAllTasks === 'function' ? deps.renderAllTasks : null;
    openSettingsFn = typeof deps.openSettings === 'function' ? deps.openSettings : null;
    reloadProgressFromStorageFn = typeof deps.reloadProgressFromStorage === 'function'
      ? deps.reloadProgressFromStorage
      : null;
    clock = typeof deps.now === 'function' ? deps.now : () => Date.now();
    explicitStorage = deps.storage;
    explicitSection = deps.section;
    runtimeState = deps.runtimeState || (deps.storage !== undefined ? createInsightsRuntimeState() : null);
    uiDom = deps.dom || dom;
    doc = deps.doc || (typeof document !== 'undefined' ? document : null);
    win = deps.win || (typeof window !== 'undefined' ? window : null);

    sessionShowOverride = null;
    actionNotice = null;
    clearConfirmOpen = false;
    currentWorkload = null;
    currentPrefs = { v: 1, showInsights: true, activityOptIn: false };

    bindEvents();
    refresh();
    return {
      sectionKeyForPrefs: sectionKey('class_tasks_insights_prefs', activeSection()),
    };
  }

  return {
    init,
    dispose,
    refresh,
    syncSettings: () => syncSettings({ resetConfirm: true }),
    syncButton: syncMineButton,
    getTaskCue,
    recordTransition,
    handleStorageDegraded,
    handleStorageEvent,
    openInsights,
    closeInsights,
    renderAll: () => renderAllTasksFn?.(),
  };
}

export const insightsUi = createInsightsController();
