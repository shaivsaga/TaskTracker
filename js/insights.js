import { currentSection, sectionKey } from './util.js';
import { filterDeletedActivity } from './recovery.js';

export const INSIGHTS_SCHEMA_VERSION = 1;
export const ACTIVITY_SCHEMA_VERSION = 1;
export const MAX_ACTIVITY_EVENTS_PER_TASK = 8;
export const MAX_ACTIVITY_TASKS = 400;

export const DEFAULT_INSIGHTS_PREFS = Object.freeze({
  v: INSIGHTS_SCHEMA_VERSION,
  showInsights: true,
  activityOptIn: false,
});

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const WINDOW_48H_MS = 48 * HOUR_MS;
const WINDOW_72H_MS = 72 * HOUR_MS;

const STATUS_TO_CODE = Object.freeze({
  not_started: 0,
  in_progress: 1,
  done: 2,
});

const defaultRuntimeBySection = new Map();

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isValidStatusCode = (c) => c === 0 || c === 1 || c === 2;

function normalizeSection(section) {
  const id = String(section ?? '').toLowerCase();
  return id && id !== 'a' ? id : '';
}

function normalizeNowMs(nowMs) {
  return Number.isFinite(nowMs) ? nowMs : Date.now();
}

function normalizeNowSec(nowSec) {
  return Number.isFinite(nowSec) ? Math.floor(nowSec) : Math.floor(Date.now() / 1000);
}

function localDayKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function localDayIndex(d) {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

function formatClusterDateLabel(d, refYear) {
  return d.toLocaleDateString(
    'en-US',
    d.getFullYear() === refYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

function parseYmdDate(raw) {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  const dt = new Date(y, mo, d);
  return dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d ? dt : null;
}

function parseTaskDeadline(task) {
  const rawDeadline = typeof task.getDeadline === 'function'
    ? task.getDeadline()
    : (task.endDate ?? task.dueDate ?? null);
  const deadlineDate = parseYmdDate(rawDeadline);
  if (!deadlineDate) return { deadlineDate: null, deadlineMs: null, hasDueTime: false };

  const validDueTime = typeof task.dueTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(task.dueTime);
  const rawTs = typeof task.getDueTimestamp === 'function' ? task.getDueTimestamp() : null;
  if (rawTs instanceof Date && !Number.isNaN(rawTs.getTime())) {
    return { deadlineDate, deadlineMs: rawTs.getTime(), hasDueTime: validDueTime };
  }

  const d = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());
  if (validDueTime) {
    const [h, m] = task.dueTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(23, 59, 59, 999);
  }
  return { deadlineDate, deadlineMs: d.getTime(), hasDueTime: validDueTime };
}

function isTaskPast(task, deadlineMs, resolvedNowMs) {
  if (typeof task.isPast === 'function') return Boolean(task.isPast(resolvedNowMs));
  if (typeof task.isClosed === 'function' && task.isClosed()) return true;
  if (typeof task.closedAt === 'number' && task.closedAt > 0) return true;
  return deadlineMs !== null && resolvedNowMs - deadlineMs > 7 * DAY_MS;
}

function taskStatusFor(task, progressMap) {
  if (isPlainObject(progressMap) && Object.hasOwn(progressMap, String(task.id))) {
    const entry = progressMap[String(task.id)];
    if (isPlainObject(entry) && typeof entry.status === 'string') return entry.status;
  }
  return typeof task.status === 'string' ? task.status : 'not_started';
}

export function insightsKeysFor(section = currentSection()) {
  const sec = normalizeSection(section);
  return {
    prefs: sectionKey('class_tasks_insights_prefs', sec),
    activity: sectionKey('class_tasks_activity', sec),
  };
}

function computeRolling48hClusters(upcoming) {
  const sorted = upcoming.slice().sort((a, b) => a.deadlineMs - b.deadlineMs || a.id.localeCompare(b.id));
  const countsById = new Map();
  const clusters = [];
  let r = 0;
  let bestEnd = -1;

  for (let l = 0; l < sorted.length; l++) {
    if (r < l) r = l;
    while (r + 1 < sorted.length && sorted[r + 1].deadlineMs - sorted[l].deadlineMs <= WINDOW_48H_MS) {
      r++;
    }
    const size = r - l + 1;
    if (size >= 1) {
      for (let k = l; k <= r; k++) {
        const id = sorted[k].id;
        countsById.set(id, Math.max(countsById.get(id) || 0, size));
      }
      if (size >= 2 && r > bestEnd) {
        bestEnd = r;
        const slice = sorted.slice(l, r + 1);
        clusters.push({
          kind: 'rolling_48h',
          count: size,
          taskIds: slice.map((item) => item.id),
          earliestMs: slice[0].deadlineMs,
          latestMs: slice[slice.length - 1].deadlineMs,
        });
      }
    }
  }
  return { clusters, countsById };
}

function sameIdSet(a, b) {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
}

export function analyzeWorkload(tasks, progress = null, nowMs) {
  const resolvedNowMs = normalizeNowMs(nowMs);
  const nowDate = new Date(resolvedNowMs);
  const nowDayIdx = localDayIndex(nowDate);
  const nowYear = nowDate.getFullYear();

  const items = [];
  const taskMetaById = {};
  const subjectMap = new Map();

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || typeof task !== 'object' || task.id === undefined || task.id === null) continue;
    const id = String(task.id);
    if (id === '' || id === '__proto__') continue;

    const status = taskStatusFor(task, progress);
    if (status === 'done') continue;

    const { deadlineDate, deadlineMs, hasDueTime } = parseTaskDeadline(task);
    if (isTaskPast(task, deadlineMs, resolvedNowMs)) continue;

    const subject = typeof task.subject === 'string' ? task.subject : '';
    let subj = subjectMap.get(subject);
    if (!subj) {
      subj = { subject, openCount: 0, overdueCount: 0, dueSoonCount: 0 };
      subjectMap.set(subject, subj);
    }
    subj.openCount++;

    if (!deadlineDate || deadlineMs === null) {
      items.push({
        id,
        subject,
        deadlineMs: null,
        hasDueTime: false,
        dayKey: null,
        dateLabel: null,
        dayDelta: null,
        overdue: false,
        dueToday: false,
        dueSoon: false,
        dueNext72h: false,
        notStarted: status === 'not_started',
      });
      taskMetaById[id] = {
        open: true,
        overdue: false,
        dueToday: false,
        dueSoon: false,
        dayKey: null,
        dateLabel: null,
        sameDayCount: 0,
        rolling48hCount: 0,
      };
      continue;
    }

    const dayKey = localDayKey(deadlineDate);
    const dayDelta = localDayIndex(deadlineDate) - nowDayIdx;
    const dateLabel = formatClusterDateLabel(deadlineDate, nowYear);
    const overdue = deadlineMs < resolvedNowMs;
    const dueToday = !overdue && dayDelta === 0;
    const msLeft = deadlineMs - resolvedNowMs;
    const dueSoon = !overdue && (msLeft <= WINDOW_48H_MS || (!hasDueTime && dayDelta <= 1));
    const dueNext72h = !overdue && (msLeft <= WINDOW_72H_MS || (!hasDueTime && dayDelta <= 2));

    if (overdue) subj.overdueCount++;
    if (dueSoon) subj.dueSoonCount++;

    items.push({
      id,
      subject,
      deadlineMs,
      hasDueTime,
      dayKey,
      dateLabel,
      dayDelta,
      overdue,
      dueToday,
      dueSoon,
      dueNext72h,
      notStarted: status === 'not_started',
    });

    taskMetaById[id] = {
      open: true,
      overdue,
      dueToday,
      dueSoon,
      dayKey,
      dateLabel,
      sameDayCount: 0,
      rolling48hCount: 0,
    };
  }

  const overdueIds = [];
  const dueTodayIds = [];
  const dueSoonIds = [];
  const notStartedSoonIds = [];
  const upcomingDated = [];
  const byDay = new Map();
  let undatedCount = 0;
  let dueNext72hCount = 0;

  for (const item of items) {
    if (item.deadlineMs === null) {
      undatedCount++;
      continue;
    }
    if (item.overdue) {
      overdueIds.push(item.id);
      continue;
    }
    upcomingDated.push(item);
    if (item.dueToday) dueTodayIds.push(item.id);
    if (item.dueSoon) {
      dueSoonIds.push(item.id);
      if (item.notStarted) notStartedSoonIds.push(item.id);
    }
    if (item.dueNext72h) dueNext72hCount++;

    let dayGroup = byDay.get(item.dayKey);
    if (!dayGroup) {
      dayGroup = {
        kind: 'same_day',
        dayKey: item.dayKey,
        dateLabel: item.dateLabel,
        dayDelta: item.dayDelta,
        count: 0,
        taskIds: [],
        earliestMs: item.deadlineMs,
        latestMs: item.deadlineMs,
      };
      byDay.set(item.dayKey, dayGroup);
    }
    dayGroup.count++;
    dayGroup.taskIds.push(item.id);
    dayGroup.earliestMs = Math.min(dayGroup.earliestMs, item.deadlineMs);
    dayGroup.latestMs = Math.max(dayGroup.latestMs, item.deadlineMs);
  }

  const sameDayClusters = [...byDay.values()]
    .filter((group) => group.count >= 2)
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));

  for (const group of byDay.values()) {
    for (const id of group.taskIds) {
      taskMetaById[id].sameDayCount = group.count;
    }
  }

  const { clusters: rolling48hClusters, countsById } = computeRolling48hClusters(upcomingDated);
  for (const [id, count] of countsById.entries()) {
    taskMetaById[id].rolling48hCount = count;
  }

  const subjectCounts = [...subjectMap.values()].sort((a, b) => {
    if (a.openCount !== b.openCount) return b.openCount - a.openCount;
    if (a.dueSoonCount !== b.dueSoonCount) return b.dueSoonCount - a.dueSoonCount;
    if (a.subject === '' && b.subject !== '') return 1;
    if (b.subject === '' && a.subject !== '') return -1;
    return a.subject.localeCompare(b.subject);
  });

  const notices = [];
  if (overdueIds.length > 0) {
    notices.push({
      kind: 'overdue',
      count: overdueIds.length,
      taskIds: overdueIds.slice(),
      text: `${overdueIds.length} ${overdueIds.length === 1 ? 'task is' : 'tasks are'} overdue`,
    });
  }
  for (const cluster of sameDayClusters) {
    notices.push({
      kind: 'same_day_cluster',
      dayKey: cluster.dayKey,
      count: cluster.count,
      taskIds: cluster.taskIds.slice(),
      text: `${cluster.count} tasks due ${cluster.dateLabel}`,
    });
  }
  for (const cluster of rolling48hClusters) {
    if (sameDayClusters.some((sc) => sameIdSet(sc.taskIds, cluster.taskIds))) continue;
    notices.push({
      kind: 'rolling_48h_cluster',
      count: cluster.count,
      taskIds: cluster.taskIds.slice(),
      text: `${cluster.count} tasks due within 48h`,
    });
  }
  if (notStartedSoonIds.length > 0) {
    notices.push({
      kind: 'due_soon_unstarted',
      count: notStartedSoonIds.length,
      taskIds: notStartedSoonIds.slice(),
      text: `${notStartedSoonIds.length} unstarted ${notStartedSoonIds.length === 1 ? 'task' : 'tasks'} due within 48h`,
    });
  }

  return {
    nowMs: resolvedNowMs,
    openCount: items.length,
    undatedCount,
    overdueCount: overdueIds.length,
    overdueIds,
    dueTodayCount: dueTodayIds.length,
    dueTodayIds,
    dueSoonCount: dueSoonIds.length,
    dueSoonIds,
    dueNext72hCount,
    notStartedSoonCount: notStartedSoonIds.length,
    notStartedSoonIds,
    sameDayClusters,
    rolling48hClusters,
    subjectCounts,
    taskMetaById,
    notices,
  };
}

export function explainTaskIndicator(task, workload, existingPillText = '') {
  if (!task || typeof task !== 'object' || task.id === undefined || task.id === null) return null;
  if (!isPlainObject(workload) || !isPlainObject(workload.taskMetaById)) return null;
  const id = String(task.id);
  if (!Object.hasOwn(workload.taskMetaById, id)) return null;

  const meta = workload.taskMetaById[id];
  if (!meta || !meta.open || meta.overdue || !meta.dayKey) return null;

  let candidate = null;
  if (meta.sameDayCount >= 2 && meta.dateLabel) {
    candidate = `${meta.sameDayCount} due ${meta.dateLabel}`;
  } else if (meta.rolling48hCount >= 2) {
    candidate = `${meta.rolling48hCount} due in 48h`;
  }
  if (!candidate) return null;

  const pillLower = typeof existingPillText === 'string' ? existingPillText.toLowerCase() : '';
  if (pillLower.includes(candidate.toLowerCase())) return null;
  return candidate;
}

export function summarizeActivityHistory(activity, nowSec) {
  const empty = {
    hasHistory: false,
    trackedTasks: 0,
    transitionCount: 0,
    completedCount: 0,
    inProgressCount: 0,
    reopenCount: 0,
    lastCheckInSec: null,
    recent7dTransitions: 0,
  };
  if (!isPlainObject(activity) || activity.v !== ACTIVITY_SCHEMA_VERSION || !isPlainObject(activity.tasks)) {
    return empty;
  }

  const resolvedNowSec = normalizeNowSec(nowSec);
  const cutoffSec = resolvedNowSec - 7 * 86400;

  let trackedTasks = 0;
  let transitionCount = 0;
  let completedCount = 0;
  let inProgressCount = 0;
  let reopenCount = 0;
  let lastCheckInSec = null;
  let recent7dTransitions = 0;

  for (const rec of Object.values(activity.tasks)) {
    if (!isPlainObject(rec)) continue;
    const events = Array.isArray(rec.e)
      ? rec.e.filter((ev) => Array.isArray(ev) && ev.length >= 2 && isValidStatusCode(ev[0]) && Number.isFinite(ev[1]))
      : [];
    if (!events.length) continue;

    trackedTasks++;
    transitionCount += events.length;

    let latestEvent = events[0];
    for (const [code, ts] of events) {
      if (ts >= latestEvent[1]) latestEvent = [code, ts];
      if (lastCheckInSec === null || ts > lastCheckInSec) lastCheckInSec = ts;
      if (ts >= cutoffSec && ts <= resolvedNowSec) recent7dTransitions++;
    }
    if (Number.isFinite(rec.lastSec) && (lastCheckInSec === null || rec.lastSec > lastCheckInSec)) {
      lastCheckInSec = rec.lastSec;
    }

    if (latestEvent[0] === 2) completedCount++;
    else if (latestEvent[0] === 1) inProgressCount++;

    if (Number.isInteger(rec.r) && rec.r > 0) reopenCount += rec.r;
  }

  return {
    hasHistory: trackedTasks > 0,
    trackedTasks,
    transitionCount,
    completedCount,
    inProgressCount,
    reopenCount,
    lastCheckInSec,
    recent7dTransitions,
  };
}

export function createInsightsRuntimeState() {
  return {
    degraded: false,
    lastError: null,
    activitySuspended: false,
    pendingActivityPurge: false,
    pendingOptOut: false,
    pendingDeletedIds: new Set(),
  };
}

function getRuntimeState(section, explicitRuntimeState) {
  if (explicitRuntimeState) return explicitRuntimeState;
  const sec = normalizeSection(section);
  let rt = defaultRuntimeBySection.get(sec);
  if (!rt) {
    rt = createInsightsRuntimeState();
    defaultRuntimeBySection.set(sec, rt);
  }
  return rt;
}

export function getInsightsStorageStatus({ section = currentSection(), runtimeState } = {}) {
  const rt = getRuntimeState(section, runtimeState);
  return {
    degraded: Boolean(rt.degraded),
    lastError: rt.lastError,
    activitySuspended: Boolean(rt.activitySuspended),
    pendingActivityPurge: Boolean(rt.pendingActivityPurge),
    pendingOptOut: Boolean(rt.pendingOptOut),
    pendingDeletedIds: [...rt.pendingDeletedIds],
  };
}

function resolveStorage(explicitStorage, explicitErrorName = null) {
  if (explicitStorage !== undefined) {
    return {
      storage: explicitStorage,
      errorName: explicitStorage ? explicitErrorName : (explicitErrorName || 'SecurityError'),
    };
  }
  try {
    const s = typeof window !== 'undefined' && 'localStorage' in window ? window.localStorage : null;
    return { storage: s, errorName: s ? explicitErrorName : (explicitErrorName || 'StorageUnavailable') };
  } catch (e) {
    return { storage: null, errorName: e?.name || 'SecurityError' };
  }
}

function errName(e, fallback = 'StorageError') {
  return (e && typeof e.name === 'string' && e.name) ? e.name : fallback;
}

function isQuotaError(e) {
  const name = errName(e, '');
  const msg = e && typeof e.message === 'string' ? e.message : '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(msg);
}

function storageGet(storage, key) {
  if (!storage) return { ok: false, value: null, errorName: 'SecurityError' };
  try {
    return { ok: true, value: storage.getItem(key), errorName: null };
  } catch (e) {
    return { ok: false, value: null, errorName: errName(e) };
  }
}

function storageSet(storage, key, raw) {
  if (!storage) return { ok: false, quota: false, errorName: 'SecurityError' };
  try {
    storage.setItem(key, raw);
    return { ok: true, quota: false, errorName: null };
  } catch (e) {
    return { ok: false, quota: isQuotaError(e), errorName: errName(e) };
  }
}

function storageRemove(storage, key) {
  if (!storage) return { ok: false, errorName: 'SecurityError' };
  try {
    storage.removeItem(key);
    return { ok: true, errorName: null };
  } catch (e) {
    return { ok: false, errorName: errName(e) };
  }
}

function markSuspended(rt, errorName) {
  rt.degraded = true;
  rt.activitySuspended = true;
  rt.lastError = errorName || 'StorageError';
}

function clearDegradedIfClean(rt) {
  if (!rt.pendingActivityPurge && !rt.pendingOptOut && rt.pendingDeletedIds.size === 0) {
    rt.activitySuspended = false;
    rt.degraded = false;
    rt.lastError = null;
  }
}

function parsePrefsRaw(raw) {
  if (typeof raw !== 'string' || raw === '') return { valid: false, prefs: { ...DEFAULT_INSIGHTS_PREFS } };
  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed) || parsed.v !== INSIGHTS_SCHEMA_VERSION) {
      return { valid: false, prefs: { ...DEFAULT_INSIGHTS_PREFS } };
    }
    if (typeof parsed.showInsights !== 'boolean' || typeof parsed.activityOptIn !== 'boolean') {
      return { valid: false, prefs: { ...DEFAULT_INSIGHTS_PREFS } };
    }
    return {
      valid: true,
      prefs: {
        v: INSIGHTS_SCHEMA_VERSION,
        showInsights: parsed.showInsights,
        activityOptIn: parsed.activityOptIn,
      },
    };
  } catch (e) {
    return { valid: false, prefs: { ...DEFAULT_INSIGHTS_PREFS } };
  }
}

function parseActivityRaw(raw) {
  if (typeof raw !== 'string' || raw === '') return { valid: false, missing: true, activity: null };
  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed) || parsed.v !== ACTIVITY_SCHEMA_VERSION || !isPlainObject(parsed.tasks)) {
      return { valid: false, missing: false, activity: null };
    }
    return { valid: true, missing: false, activity: parsed };
  } catch (e) {
    return { valid: false, missing: false, activity: null };
  }
}

export function pruneOldestActivity(activity, maxTasks = MAX_ACTIVITY_TASKS, pinnedId = null) {
  const source = isPlainObject(activity) && isPlainObject(activity.tasks) ? activity.tasks : {};
  const limit = Number.isInteger(maxTasks) && maxTasks >= 0 ? maxTasks : MAX_ACTIVITY_TASKS;
  const entries = Object.entries(source).filter(([, v]) => isPlainObject(v));
  if (entries.length <= limit) {
    return { v: ACTIVITY_SCHEMA_VERSION, tasks: Object.fromEntries(entries) };
  }
  const pin = pinnedId !== null && pinnedId !== undefined ? String(pinnedId) : null;
  entries.sort((a, b) => {
    if (pin !== null) {
      if (a[0] === pin && b[0] !== pin) return -1;
      if (b[0] === pin && a[0] !== pin) return 1;
    }
    const la = Number.isFinite(a[1].lastSec) ? a[1].lastSec : -Infinity;
    const lb = Number.isFinite(b[1].lastSec) ? b[1].lastSec : -Infinity;
    if (la !== lb) return lb - la;
    return a[0].localeCompare(b[0]);
  });
  return {
    v: ACTIVITY_SCHEMA_VERSION,
    tasks: Object.fromEntries(entries.slice(0, limit)),
  };
}

function flushIdDeletions(storage, activityKey, rt) {
  if (rt.pendingDeletedIds.size === 0) {
    return { ok: true, deleted: false, fallbackCleared: false, removed: [], errorName: null };
  }
  const pendingIds = [...rt.pendingDeletedIds];
  const readRes = storageGet(storage, activityKey);
  if (!readRes.ok) {
    const remRes = storageRemove(storage, activityKey);
    if (remRes.ok) {
      rt.pendingDeletedIds.clear();
      return { ok: true, deleted: true, fallbackCleared: true, removed: [], errorName: readRes.errorName };
    }
    return { ok: false, deleted: false, fallbackCleared: false, removed: [], errorName: remRes.errorName || readRes.errorName };
  }
  if (readRes.value === null) {
    rt.pendingDeletedIds.clear();
    return { ok: true, deleted: false, fallbackCleared: false, removed: [], errorName: null };
  }
  const parsed = parseActivityRaw(readRes.value);
  if (!parsed.valid) {
    const remRes = storageRemove(storage, activityKey);
    if (remRes.ok) {
      rt.pendingDeletedIds.clear();
      return { ok: true, deleted: true, fallbackCleared: true, removed: [], errorName: null };
    }
    return { ok: false, deleted: false, fallbackCleared: false, removed: [], errorName: remRes.errorName };
  }
  const filtered = filterDeletedActivity(parsed.activity, pendingIds);
  if (!filtered.removed.length) {
    rt.pendingDeletedIds.clear();
    return { ok: true, deleted: false, fallbackCleared: false, removed: [], errorName: null };
  }
  const writeRes = storageSet(storage, activityKey, JSON.stringify(filtered.activity));
  if (writeRes.ok) {
    rt.pendingDeletedIds.clear();
    return { ok: true, deleted: true, fallbackCleared: false, removed: filtered.removed, errorName: null };
  }
  const remRes = storageRemove(storage, activityKey);
  if (remRes.ok) {
    rt.pendingDeletedIds.clear();
    return { ok: true, deleted: true, fallbackCleared: true, removed: filtered.removed, errorName: writeRes.errorName };
  }
  return { ok: false, deleted: false, fallbackCleared: false, removed: [], errorName: remRes.errorName || writeRes.errorName };
}

export function flushPendingActivityCleanup({
  storage,
  section = currentSection(),
  runtimeState,
  errorName = null,
} = {}) {
  const sec = normalizeSection(section);
  const rt = getRuntimeState(sec, runtimeState);
  const keys = insightsKeysFor(sec);
  const resolved = resolveStorage(storage, errorName);

  if (!rt.pendingActivityPurge && !rt.pendingOptOut && rt.pendingDeletedIds.size === 0) {
    return {
      ok: true,
      cleaned: true,
      deleted: false,
      degraded: Boolean(rt.degraded),
      pendingCleanup: false,
    };
  }

  if (!resolved.storage) {
    markSuspended(rt, resolved.errorName);
    return {
      ok: false,
      cleaned: false,
      deleted: false,
      degraded: true,
      pendingCleanup: true,
    };
  }

  let deleted = false;
  let fallbackCleared = false;

  if (rt.pendingOptOut) {
    const prefsRead = storageGet(resolved.storage, keys.prefs);
    const current = prefsRead.ok ? parsePrefsRaw(prefsRead.value).prefs : { ...DEFAULT_INSIGHTS_PREFS };
    const nextPrefs = {
      v: INSIGHTS_SCHEMA_VERSION,
      showInsights: current.showInsights,
      activityOptIn: false,
    };
    const prefsWrite = storageSet(resolved.storage, keys.prefs, JSON.stringify(nextPrefs));
    if (!prefsWrite.ok) {
      markSuspended(rt, prefsWrite.errorName);
      return {
        ok: false,
        cleaned: false,
        deleted: false,
        degraded: true,
        pendingCleanup: true,
      };
    }
    rt.pendingOptOut = false;
  }

  if (rt.pendingActivityPurge) {
    const remRes = storageRemove(resolved.storage, keys.activity);
    if (!remRes.ok) {
      markSuspended(rt, remRes.errorName);
      return {
        ok: false,
        cleaned: false,
        deleted: false,
        degraded: true,
        pendingCleanup: true,
      };
    }
    rt.pendingActivityPurge = false;
    rt.pendingDeletedIds.clear();
    deleted = true;
  } else if (rt.pendingDeletedIds.size > 0) {
    const idFlush = flushIdDeletions(resolved.storage, keys.activity, rt);
    if (!idFlush.ok) {
      markSuspended(rt, idFlush.errorName);
      return {
        ok: false,
        cleaned: false,
        deleted: false,
        degraded: true,
        pendingCleanup: true,
      };
    }
    deleted = idFlush.deleted;
    fallbackCleared = idFlush.fallbackCleared;
  }

  clearDegradedIfClean(rt);
  if (fallbackCleared) {
    rt.degraded = true;
    rt.lastError = rt.lastError || 'ActivityFallbackCleared';
  }
  return {
    ok: true,
    cleaned: true,
    deleted,
    degraded: Boolean(rt.degraded),
    pendingCleanup: false,
  };
}

export function readInsightsPrefs({ storage, section = currentSection(), runtimeState, errorName = null } = {}) {
  const sec = normalizeSection(section);
  const rt = getRuntimeState(sec, runtimeState);
  const keys = insightsKeysFor(sec);
  const resolved = resolveStorage(storage, errorName);

  if (rt.pendingActivityPurge || rt.pendingOptOut || rt.pendingDeletedIds.size > 0) {
    flushPendingActivityCleanup({ storage: resolved.storage, section: sec, runtimeState: rt, errorName: resolved.errorName });
  }

  if (!resolved.storage) {
    markSuspended(rt, resolved.errorName);
    return { ...DEFAULT_INSIGHTS_PREFS };
  }

  const readRes = storageGet(resolved.storage, keys.prefs);
  if (!readRes.ok) {
    markSuspended(rt, readRes.errorName);
    return { ...DEFAULT_INSIGHTS_PREFS };
  }
  if (readRes.value === null) {
    return rt.pendingOptOut
      ? { ...DEFAULT_INSIGHTS_PREFS, activityOptIn: false }
      : { ...DEFAULT_INSIGHTS_PREFS };
  }
  const parsed = parsePrefsRaw(readRes.value);
  if (rt.pendingOptOut) parsed.prefs.activityOptIn = false;
  return parsed.prefs;
}

export function setShowInsights(enabled, { storage, section = currentSection(), runtimeState } = {}) {
  const sec = normalizeSection(section);
  const rt = getRuntimeState(sec, runtimeState);
  const keys = insightsKeysFor(sec);
  const resolved = resolveStorage(storage);

  const current = readInsightsPrefs({ storage: resolved.storage, section: sec, runtimeState: rt });
  const next = {
    v: INSIGHTS_SCHEMA_VERSION,
    showInsights: Boolean(enabled),
    activityOptIn: rt.pendingOptOut ? false : current.activityOptIn,
  };

  if (!resolved.storage) {
    rt.degraded = true;
    rt.lastError = resolved.errorName;
    return { ok: false, prefs: next, degraded: true };
  }
  const writeRes = storageSet(resolved.storage, keys.prefs, JSON.stringify(next));
  if (!writeRes.ok) {
    rt.degraded = true;
    rt.lastError = writeRes.errorName;
    return { ok: false, prefs: next, degraded: true };
  }
  if (!rt.activitySuspended && !rt.pendingActivityPurge && !rt.pendingOptOut && rt.pendingDeletedIds.size === 0) {
    rt.degraded = false;
    rt.lastError = null;
  }
  return { ok: true, prefs: next, degraded: Boolean(rt.degraded) };
}

export function setActivityOptIn(enabled, { storage, section = currentSection(), runtimeState } = {}) {
  const sec = normalizeSection(section);
  const rt = getRuntimeState(sec, runtimeState);
  const keys = insightsKeysFor(sec);
  const resolved = resolveStorage(storage);
  const current = readInsightsPrefs({ storage: resolved.storage, section: sec, runtimeState: rt });
  const optIn = Boolean(enabled);

  if (!optIn) {
    const next = {
      v: INSIGHTS_SCHEMA_VERSION,
      showInsights: current.showInsights,
      activityOptIn: false,
    };

    if (!resolved.storage) {
      rt.pendingOptOut = true;
      rt.pendingActivityPurge = true;
      markSuspended(rt, resolved.errorName);
      return { ok: false, prefs: next, deleted: false, degraded: true, pendingCleanup: true };
    }

    const remRes = storageRemove(resolved.storage, keys.activity);
    const writeRes = storageSet(resolved.storage, keys.prefs, JSON.stringify(next));

    if (!writeRes.ok) {
      rt.pendingOptOut = true;
    } else {
      rt.pendingOptOut = false;
    }

    if (!remRes.ok) {
      rt.pendingActivityPurge = true;
      markSuspended(rt, remRes.errorName);
      return {
        ok: false,
        prefs: next,
        deleted: false,
        degraded: true,
        pendingCleanup: true,
      };
    }

    rt.pendingActivityPurge = false;
    rt.pendingDeletedIds.clear();
    if (!writeRes.ok) {
      markSuspended(rt, writeRes.errorName);
      return {
        ok: false,
        prefs: next,
        deleted: true,
        degraded: true,
        pendingCleanup: true,
      };
    }

    clearDegradedIfClean(rt);
    return {
      ok: true,
      prefs: next,
      deleted: true,
      degraded: false,
      pendingCleanup: false,
    };
  }

  if (rt.pendingActivityPurge || rt.pendingOptOut || rt.pendingDeletedIds.size > 0) {
    const cleanup = flushPendingActivityCleanup({ storage: resolved.storage, section: sec, runtimeState: rt });
    if (!cleanup.ok) {
      return {
        ok: false,
        prefs: { ...current, activityOptIn: false },
        deleted: false,
        degraded: true,
        pendingCleanup: true,
      };
    }
  }

  const next = {
    v: INSIGHTS_SCHEMA_VERSION,
    showInsights: current.showInsights,
    activityOptIn: true,
  };
  if (!resolved.storage) {
    markSuspended(rt, resolved.errorName);
    return { ok: false, prefs: { ...current, activityOptIn: false }, deleted: false, degraded: true, pendingCleanup: false };
  }
  const writeRes = storageSet(resolved.storage, keys.prefs, JSON.stringify(next));
  if (!writeRes.ok) {
    markSuspended(rt, writeRes.errorName);
    return { ok: false, prefs: { ...current, activityOptIn: false }, deleted: false, degraded: true, pendingCleanup: false };
  }
  clearDegradedIfClean(rt);
  return { ok: true, prefs: next, deleted: false, degraded: false, pendingCleanup: false };
}

export function clearActivityHistory({ storage, section = currentSection(), runtimeState } = {}) {
  const sec = normalizeSection(section);
  const rt = getRuntimeState(sec, runtimeState);
  const keys = insightsKeysFor(sec);
  const resolved = resolveStorage(storage);

  if (!resolved.storage) {
    rt.pendingActivityPurge = true;
    markSuspended(rt, resolved.errorName);
    return { ok: false, deleted: false, degraded: true, pendingCleanup: true };
  }

  const remRes = storageRemove(resolved.storage, keys.activity);
  if (!remRes.ok) {
    rt.pendingActivityPurge = true;
    markSuspended(rt, remRes.errorName);
    return { ok: false, deleted: false, degraded: true, pendingCleanup: true };
  }

  rt.pendingActivityPurge = false;
  rt.pendingDeletedIds.clear();
  clearDegradedIfClean(rt);
  return { ok: true, deleted: true, degraded: false, pendingCleanup: false };
}

export function readActivityHistory({ storage, section = currentSection(), runtimeState } = {}) {
  const sec = normalizeSection(section);
  const rt = getRuntimeState(sec, runtimeState);
  const keys = insightsKeysFor(sec);
  const resolved = resolveStorage(storage);

  if (rt.pendingActivityPurge || rt.pendingOptOut || rt.pendingDeletedIds.size > 0) {
    const cleanup = flushPendingActivityCleanup({ storage: resolved.storage, section: sec, runtimeState: rt });
    if (!cleanup.ok) return null;
  }
  if (!resolved.storage) {
    markSuspended(rt, resolved.errorName);
    return null;
  }

  const readRes = storageGet(resolved.storage, keys.activity);
  if (!readRes.ok) {
    markSuspended(rt, readRes.errorName);
    return null;
  }
  if (readRes.value === null) return null;
  const parsed = parseActivityRaw(readRes.value);
  return parsed.valid ? parsed.activity : null;
}

export function recordActivityTransition(
  taskId,
  status,
  nowSec,
  { storage, section = currentSection(), runtimeState, subject = '', deadlineSec = null } = {},
) {
  const sec = normalizeSection(section);
  const rt = getRuntimeState(sec, runtimeState);
  const keys = insightsKeysFor(sec);
  const resolved = resolveStorage(storage);

  const id = typeof taskId === 'string' ? taskId : String(taskId ?? '');
  if (!id || id === '__proto__' || !Object.hasOwn(STATUS_TO_CODE, status)) {
    return { ok: false, written: false, reason: 'invalid_input', degraded: Boolean(rt.degraded) };
  }

  if (rt.pendingActivityPurge || rt.pendingOptOut || rt.pendingDeletedIds.size > 0) {
    const cleanup = flushPendingActivityCleanup({ storage: resolved.storage, section: sec, runtimeState: rt });
    if (!cleanup.ok) {
      return { ok: false, written: false, suspended: true, degraded: true, pendingCleanup: true };
    }
  }

  const prefs = readInsightsPrefs({ storage: resolved.storage, section: sec, runtimeState: rt });
  if (!prefs.activityOptIn) {
    return { ok: true, written: false, reason: 'opted_out', degraded: Boolean(rt.degraded) };
  }
  if (rt.activitySuspended || !resolved.storage) {
    if (!resolved.storage) markSuspended(rt, resolved.errorName);
    return { ok: false, written: false, suspended: true, degraded: true };
  }

  const readRes = storageGet(resolved.storage, keys.activity);
  if (!readRes.ok) {
    markSuspended(rt, readRes.errorName);
    return { ok: false, written: false, suspended: true, degraded: true };
  }

  const existing = readRes.value !== null ? parseActivityRaw(readRes.value) : { valid: true, activity: { v: ACTIVITY_SCHEMA_VERSION, tasks: {} } };
  const baseActivity = existing.valid && existing.activity
    ? { v: ACTIVITY_SCHEMA_VERSION, tasks: { ...existing.activity.tasks } }
    : { v: ACTIVITY_SCHEMA_VERSION, tasks: {} };

  const code = STATUS_TO_CODE[status];
  const resolvedNowSec = normalizeNowSec(nowSec);
  const prevRec = isPlainObject(baseActivity.tasks[id]) ? baseActivity.tasks[id] : null;
  const prevEvents = prevRec && Array.isArray(prevRec.e) ? prevRec.e.slice() : [];
  const prevLastCode = prevEvents.length ? prevEvents[prevEvents.length - 1][0] : null;
  const prevReopens = prevRec && Number.isInteger(prevRec.r) && prevRec.r >= 0 ? prevRec.r : 0;
  const nextReopens = prevLastCode === 2 && code !== 2 ? prevReopens + 1 : prevReopens;

  const events = prevEvents.concat([[code, resolvedNowSec]]).slice(-MAX_ACTIVITY_EVENTS_PER_TASK);
  const nextRec = {
    s: typeof subject === 'string' && subject ? subject : (prevRec && typeof prevRec.s === 'string' ? prevRec.s : ''),
    d: Number.isFinite(deadlineSec) ? Math.floor(deadlineSec) : (prevRec && Number.isFinite(prevRec.d) ? prevRec.d : null),
    r: nextReopens,
    e: events,
    lastSec: resolvedNowSec,
  };
  baseActivity.tasks[id] = nextRec;

  const trimmed = pruneOldestActivity(baseActivity, MAX_ACTIVITY_TASKS, id);
  const firstWrite = storageSet(resolved.storage, keys.activity, JSON.stringify(trimmed));
  if (firstWrite.ok) {
    rt.degraded = false;
    rt.lastError = null;
    rt.activitySuspended = false;
    return { ok: true, written: true, pruned: false, degraded: false };
  }

  if (firstWrite.quota) {
    const count = Object.keys(trimmed.tasks).length;
    const halfLimit = Math.max(1, Math.floor(count / 2));
    const shrunk = pruneOldestActivity(trimmed, halfLimit, id);
    const retryWrite = storageSet(resolved.storage, keys.activity, JSON.stringify(shrunk));
    if (retryWrite.ok) {
      rt.degraded = true;
      rt.lastError = firstWrite.errorName;
      rt.activitySuspended = false;
      return { ok: true, written: true, pruned: true, degraded: true };
    }
    markSuspended(rt, retryWrite.errorName);
    return { ok: false, written: false, pruned: true, suspended: true, degraded: true };
  }

  markSuspended(rt, firstWrite.errorName);
  return { ok: false, written: false, pruned: false, suspended: true, degraded: true };
}

export function pruneDeletedActivity(
  deletedIds,
  { storage, section = currentSection(), runtimeState, errorName = null } = {},
) {
  const sec = normalizeSection(section);
  const rt = getRuntimeState(sec, runtimeState);
  const keys = insightsKeysFor(sec);
  const resolved = resolveStorage(storage, errorName);

  const incoming = Array.isArray(deletedIds)
    ? deletedIds
      .map((entry) => (typeof entry === 'string' ? entry : (isPlainObject(entry) && typeof entry.id === 'string' ? entry.id : null)))
      .filter((id) => typeof id === 'string' && id !== '')
    : [];

  for (const id of incoming) rt.pendingDeletedIds.add(id);

  if (rt.pendingActivityPurge || rt.pendingOptOut) {
    const flushed = flushPendingActivityCleanup({
      storage: resolved.storage,
      section: sec,
      runtimeState: rt,
      errorName: resolved.errorName,
    });
    if (!flushed.ok) {
      return {
        ok: false,
        removed: [],
        deleted: false,
        degraded: true,
        pendingCleanup: true,
      };
    }
  }

  if (rt.pendingDeletedIds.size === 0) {
    return {
      ok: true,
      removed: [],
      deleted: false,
      degraded: Boolean(rt.degraded),
      pendingCleanup: false,
    };
  }

  if (!resolved.storage) {
    markSuspended(rt, resolved.errorName);
    return {
      ok: false,
      removed: [],
      deleted: false,
      degraded: true,
      pendingCleanup: true,
    };
  }

  const out = flushIdDeletions(resolved.storage, keys.activity, rt);
  if (!out.ok) {
    markSuspended(rt, out.errorName);
    return {
      ok: false,
      removed: [],
      deleted: false,
      degraded: true,
      pendingCleanup: true,
    };
  }

  if (out.fallbackCleared) {
    rt.degraded = true;
    rt.lastError = out.errorName || 'StorageError';
    rt.activitySuspended = false;
    return {
      ok: true,
      removed: out.removed,
      deleted: true,
      fallbackCleared: true,
      degraded: true,
      pendingCleanup: false,
    };
  }

  clearDegradedIfClean(rt);
  return {
    ok: true,
    removed: out.removed,
    deleted: out.deleted,
    degraded: Boolean(rt.degraded),
    pendingCleanup: false,
  };
}
