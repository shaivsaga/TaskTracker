export const ACTIVITY_SCHEMA_VERSION = 1;

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const WINDOW_48H_MS = 48 * HOUR_MS;
const WINDOW_72H_MS = 72 * HOUR_MS;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isValidStatusCode = (c) => c === 0 || c === 1 || c === 2;

function requireFiniteNumber(value, message) {
  if (!Number.isFinite(value)) throw new TypeError(message);
  return value;
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

function formatClusterDateRange(startDate, endDate, refYear) {
  if (localDayKey(startDate) === localDayKey(endDate)) {
    return formatClusterDateLabel(startDate, refYear);
  }
  const sy = startDate.getFullYear();
  const ey = endDate.getFullYear();
  if (sy !== ey) {
    const f = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${startDate.toLocaleDateString('en-US', f)}–${endDate.toLocaleDateString('en-US', f)}`;
  }
  const fShort = { month: 'short', day: 'numeric' };
  const yearSuffix = sy === refYear ? '' : `, ${sy}`;
  if (startDate.getMonth() === endDate.getMonth()) {
    return `${startDate.toLocaleDateString('en-US', fShort)}–${endDate.getDate()}${yearSuffix}`;
  }
  return `${startDate.toLocaleDateString('en-US', fShort)}–${endDate.toLocaleDateString('en-US', fShort)}${yearSuffix}`;
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

function pickBetterRollingMeta(prev, next) {
  if (!prev) return next;
  if (next.count !== prev.count) return next.count > prev.count ? next : prev;
  if (next.within48hOfNow !== prev.within48hOfNow) return next.within48hOfNow ? next : prev;
  return prev;
}

function computeRolling48hClusters(upcoming, resolvedNowMs, refYear) {
  const sorted = upcoming.slice().sort((a, b) => a.deadlineMs - b.deadlineMs || a.id.localeCompare(b.id));
  const rollingById = new Map();
  const clusters = [];
  let r = 0;
  let bestEnd = -1;

  for (let l = 0; l < sorted.length; l++) {
    if (r < l) r = l;
    while (r + 1 < sorted.length && sorted[r + 1].deadlineMs - sorted[l].deadlineMs <= WINDOW_48H_MS) {
      r++;
    }
    const size = r - l + 1;
    const first = sorted[l];
    const last = sorted[r];
    const within48hOfNow = size >= 2 && (last.deadlineMs - resolvedNowMs <= WINDOW_48H_MS);
    const dateRangeLabel = size >= 2
      ? formatClusterDateRange(first.deadlineDate, last.deadlineDate, refYear)
      : null;

    for (let k = l; k <= r; k++) {
      const id = sorted[k].id;
      const candidate = { count: size, within48hOfNow, dateRangeLabel };
      rollingById.set(id, pickBetterRollingMeta(rollingById.get(id), candidate));
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
        within48hOfNow,
        dateRangeLabel,
      });
    }
  }
  return { clusters, rollingById };
}

function sameIdSet(a, b) {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
}

export function analyzeWorkload(tasks, progress = null, nowMs) {
  const resolvedNowMs = requireFiniteNumber(nowMs, 'analyzeWorkload requires a finite nowMs timestamp');
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
        deadlineDate: null,
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
        rolling48hWithinNow: false,
        rolling48hRangeLabel: null,
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
      deadlineDate,
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
      rolling48hWithinNow: false,
      rolling48hRangeLabel: null,
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

  const { clusters: rolling48hClusters, rollingById } = computeRolling48hClusters(upcomingDated, resolvedNowMs, nowYear);
  for (const [id, info] of rollingById.entries()) {
    taskMetaById[id].rolling48hCount = info.count;
    taskMetaById[id].rolling48hWithinNow = info.within48hOfNow;
    taskMetaById[id].rolling48hRangeLabel = info.dateRangeLabel;
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
      text: cluster.within48hOfNow
        ? `${cluster.count} tasks due within 48h`
        : `${cluster.count} tasks due ${cluster.dateRangeLabel}`,
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
    if (meta.rolling48hWithinNow) candidate = `${meta.rolling48hCount} due in 48h`;
    else if (meta.rolling48hRangeLabel) candidate = `${meta.rolling48hCount} due ${meta.rolling48hRangeLabel}`;
  }
  if (!candidate) return null;

  const pillLower = typeof existingPillText === 'string' ? existingPillText.toLowerCase() : '';
  if (pillLower.includes(candidate.toLowerCase())) return null;
  return candidate;
}

export function summarizeActivityHistory(activity, nowSec) {
  const resolvedNowSec = Math.floor(requireFiniteNumber(nowSec, 'summarizeActivityHistory requires a finite nowSec timestamp'));
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
