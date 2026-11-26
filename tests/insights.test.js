import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Task, makeDate } from '../logic.js';
import { keysForSection } from '../js/util.js';
import {
  INSIGHTS_SCHEMA_VERSION,
  ACTIVITY_SCHEMA_VERSION,
  MAX_ACTIVITY_EVENTS_PER_TASK,
  MAX_ACTIVITY_TASKS,
  DEFAULT_INSIGHTS_PREFS,
  insightsKeysFor,
  analyzeWorkload,
  explainTaskIndicator,
  summarizeActivityHistory,
  createInsightsRuntimeState,
  getInsightsStorageStatus,
  pruneOldestActivity,
  flushPendingActivityCleanup,
  readInsightsPrefs,
  setShowInsights,
  setActivityOptIn,
  clearActivityHistory,
  readActivityHistory,
  recordActivityTransition,
  pruneDeletedActivity,
} from '../js/insights.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeTask(opts = {}) {
  return new Task({
    id: opts.id ?? 't1',
    title: opts.title ?? 'Assignment',
    dueDate: opts.dueDate,
    endDate: opts.endDate,
    dueTime: opts.dueTime,
    status: opts.status ?? 'not_started',
    closedAt: opts.closedAt ?? 0,
    subject: opts.subject ?? '',
  });
}

function makeFaultStorage(seed = {}, faults = {}) {
  const map = new Map(Object.entries(seed));
  const ops = [];
  const makeErr = (kind) => {
    if (kind === 'quota') return Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' });
    return Object.assign(new Error('Storage blocked'), { name: 'SecurityError' });
  };
  return {
    ops,
    raw: map,
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    has: (k) => map.has(k),
    getItem(k) {
      ops.push(['get', k]);
      if (faults.failGet?.(k, ops)) throw makeErr(faults.getErr || 'security');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      ops.push(['set', k, String(v).length]);
      if (faults.failSet?.(k, String(v), ops)) throw makeErr(faults.setErr || 'quota');
      map.set(k, String(v));
    },
    removeItem(k) {
      ops.push(['remove', k]);
      if (faults.failRemove?.(k, ops)) throw makeErr(faults.removeErr || 'security');
      map.delete(k);
    },
  };
}

test('insightsKeysFor derives section-scoped prefs and activity keys without altering keysForSection', () => {
  assert.deepEqual(insightsKeysFor(''), {
    prefs: 'class_tasks_insights_prefs',
    activity: 'class_tasks_activity',
  });
  assert.deepEqual(insightsKeysFor('a'), insightsKeysFor(''));
  assert.deepEqual(insightsKeysFor('b'), {
    prefs: 'b_class_tasks_insights_prefs',
    activity: 'b_class_tasks_activity',
  });
  assert.deepEqual(insightsKeysFor('Sec_2'), {
    prefs: 'sec_2_class_tasks_insights_prefs',
    activity: 'sec_2_class_tasks_activity',
  });
  assert.deepEqual(Object.keys(keysForSection('b')), ['draft', 'progress', 'checkpoints', 'cache', 'legacy']);
});

test('analyzeWorkload excludes done, closed, expired, and malformed tasks with injectable clock', () => {
  const nowMs = new Date(2026, 11, 1, 14, 0, 0).getTime(); // Dec 1 2026 14:00 local
  const tasks = [
    null,
    { id: '' },
    { id: '__proto__' },
    makeTask({ id: 'done-task', dueDate: makeDate(2026, 11, 2), status: 'done', subject: 'MATH' }),
    makeTask({ id: 'done-via-progress', dueDate: makeDate(2026, 11, 2), status: 'not_started', subject: 'MATH' }),
    makeTask({ id: 'closed-task', dueDate: makeDate(2026, 11, 2), closedAt: 1700000000, subject: 'MATH' }),
    makeTask({ id: 'expired-task', dueDate: makeDate(2026, 10, 1), subject: 'MATH' }),
    makeTask({ id: 'overdue-timed', dueDate: makeDate(2026, 11, 1), dueTime: '13:00', status: 'in_progress', subject: 'CS' }),
    makeTask({ id: 'today-late', dueDate: makeDate(2026, 11, 1), dueTime: '20:00', status: 'not_started', subject: 'CS' }),
    makeTask({ id: 'undated', status: 'not_started', subject: '' }),
  ];
  const progress = {
    'done-via-progress': { status: 'done', movedAt: 10 },
    'today-late': { status: 'in_progress', movedAt: 20 },
  };

  const w = analyzeWorkload(tasks, progress, nowMs);
  assert.equal(w.nowMs, nowMs);
  assert.equal(w.openCount, 3);
  assert.equal(w.undatedCount, 1);
  assert.deepEqual(w.overdueIds, ['overdue-timed']);
  assert.deepEqual(w.dueTodayIds, ['today-late']);
  assert.deepEqual(w.dueSoonIds, ['today-late']);
  assert.equal(w.notStartedSoonCount, 0, 'today-late is in_progress via progress override');
  assert.deepEqual(w.subjectCounts, [
    { subject: 'CS', openCount: 2, overdueCount: 1, dueSoonCount: 1 },
    { subject: '', openCount: 1, overdueCount: 0, dueSoonCount: 0 },
  ]);
  assert.equal(explainTaskIndicator(tasks[3], w), null);
  assert.equal(explainTaskIndicator(tasks[7], w), null);
  assert.equal(explainTaskIndicator(tasks[9], w), null);
});

test('analyzeWorkload uses range endDate, builds same-day and bounded 48h clusters without chaining', () => {
  const nowMs = new Date(2026, 11, 1, 9, 0, 0).getTime(); // Dec 1 2026 09:00 local
  const tasks = [
    // Range Nov 29 -> Dec 4 uses endDate (Dec 4), NOT dueDate (Nov 29)
    makeTask({ id: 'r1', dueDate: makeDate(2026, 10, 29), endDate: makeDate(2026, 11, 4), subject: 'BIO' }),
    makeTask({ id: 'd4', dueDate: makeDate(2026, 11, 4), subject: 'CHEM' }),
    // Separate 48h pair: Dec 8 10:00 and Dec 10 08:00 (46h apart <= 48h)
    makeTask({ id: 'w1', dueDate: makeDate(2026, 11, 8), dueTime: '10:00', subject: 'PHYS' }),
    makeTask({ id: 'w2', dueDate: makeDate(2026, 11, 10), dueTime: '08:00', subject: 'PHYS' }),
    // Third task Dec 12 06:00 (46h after w2, 92h after w1): pairs with w2 but MUST NOT chain w1+w2+w3!
    makeTask({ id: 'w3', dueDate: makeDate(2026, 11, 12), dueTime: '06:00', subject: 'PHYS' }),
    // Isolated task far out
    makeTask({ id: 'solo', dueDate: makeDate(2026, 11, 20), subject: 'ART' }),
  ];

  const w = analyzeWorkload(tasks, {}, nowMs);
  assert.equal(w.overdueCount, 0);
  assert.equal(w.sameDayClusters.length, 1);
  assert.equal(w.sameDayClusters[0].dayKey, '2026-12-04');
  assert.equal(w.sameDayClusters[0].dateLabel, 'Dec 4');
  assert.deepEqual(w.sameDayClusters[0].taskIds, ['r1', 'd4']);

  assert.equal(w.taskMetaById.w1.rolling48hCount, 2);
  assert.equal(w.taskMetaById.w2.rolling48hCount, 2);
  assert.equal(w.taskMetaById.w3.rolling48hCount, 2);
  assert.equal(w.taskMetaById.solo.rolling48hCount, 1);

  assert.equal(explainTaskIndicator(tasks[0], w), '2 due Dec 4');
  assert.equal(explainTaskIndicator(tasks[1], w), '2 due Dec 4');
  assert.equal(explainTaskIndicator(tasks[2], w), '2 due in 48h');
  assert.equal(explainTaskIndicator(tasks[5], w), null, 'standalone task returns null');

  const rollNotices = w.notices.filter((n) => n.kind === 'rolling_48h_cluster');
  assert.equal(rollNotices.length, 2, 'rolling windows excluding duplicate same-day cluster');
});

test('explainTaskIndicator returns null for standalone tasks and satisfies semantic non-duplication against Task.getDueLabel', () => {
  const realToday = new Date();
  const baseMs = new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate(), 10, 0, 0).getTime();
  const targetPlus5 = new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate() + 5);
  const targetPlus6 = new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate() + 6);
  const targetTomorrow = new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate() + 1);

  const soloTomorrow = makeTask({ id: 'solo-tmr', dueDate: targetTomorrow });
  const clusterA = makeTask({ id: 'c1', dueDate: targetPlus5 });
  const clusterB = makeTask({ id: 'c2', dueDate: targetPlus5 });
  const nearC = makeTask({ id: 'c3', dueDate: targetPlus6 });

  const wSolo = analyzeWorkload([soloTomorrow], null, baseMs);
  assert.equal(explainTaskIndicator(soloTomorrow, wSolo, soloTomorrow.getDueLabel()), null);

  const wCluster = analyzeWorkload([clusterA, clusterB], null, baseMs);
  const cueSameDay = explainTaskIndicator(clusterA, wCluster, clusterA.getDueLabel());
  assert.match(cueSameDay, /^2 due [A-Z][a-z]{2} \d+/);
  // Semantic non-duplication: cross-task multiplicity cue differs semantically from single-task deadline pill
  assert.equal(/^\d+ due /.test(clusterA.getDueLabel()), false);
  assert.equal(explainTaskIndicator(clusterA, wCluster, cueSameDay), null, 'suppresses exact duplicate text');

  const wRolling = analyzeWorkload([clusterA, nearC], null, baseMs);
  const cue48h = explainTaskIndicator(clusterA, wRolling, clusterA.getDueLabel());
  assert.equal(cue48h, '2 due in 48h');
  assert.equal(/due in 48h/i.test(clusterA.getDueLabel()), false);
});

test('multi-timezone and DST boundaries remain calendar-accurate across UTC, NY DST, Manila, and Honolulu', () => {
  for (const tz of ['UTC', 'America/New_York', 'Asia/Manila', 'Pacific/Honolulu']) {
    const script = `
      import { Task, makeDate } from './logic.js';
      import { analyzeWorkload, explainTaskIndicator } from './js/insights.js';

      // Spring-forward day in US/NY: 2026-03-08 (23h local day)
      const springNow = new Date(2026, 2, 8, 12, 0, 0).getTime();
      const tSpringToday = new Task({ id: 's0', dueDate: makeDate(2026, 2, 8) });
      const tSpringTmr = new Task({ id: 's1', dueDate: makeDate(2026, 2, 9) });
      const wSpring = analyzeWorkload([tSpringToday, tSpringTmr], null, springNow);

      // Fall-back day in US/NY: 2026-11-01 (25h local day)
      const fallNow = new Date(2026, 10, 1, 0, 30, 0).getTime();
      const tFallToday = new Task({ id: 'f0', dueDate: makeDate(2026, 10, 1) });
      const tFallTmr1 = new Task({ id: 'f1', dueDate: makeDate(2026, 10, 2) });
      const tFallTmr2 = new Task({ id: 'f2', dueDate: makeDate(2026, 10, 2), dueTime: '18:00' });
      const wFall = analyzeWorkload([tFallToday, tFallTmr1, tFallTmr2], null, fallNow);

      // Next-year boundary cluster label includes year
      const nyNow = new Date(2026, 11, 31, 10, 0, 0).getTime();
      const nyA = new Task({ id: 'ny1', dueDate: makeDate(2027, 0, 5) });
      const nyB = new Task({ id: 'ny2', dueDate: makeDate(2027, 0, 5) });
      const wNy = analyzeWorkload([nyA, nyB], null, nyNow);

      console.log(JSON.stringify({
        springOverdue: wSpring.overdueCount,
        springDueToday: wSpring.dueTodayIds,
        springDueSoon: wSpring.dueSoonIds,
        fallDueToday: wFall.dueTodayIds,
        fallDueSoon: wFall.dueSoonIds,
        fallCluster: wFall.sameDayClusters[0]?.dayKey,
        fallCue: explainTaskIndicator(tFallTmr1, wFall),
        nyCue: explainTaskIndicator(nyA, wNy),
      }));
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, TZ: tz },
    });
    const res = JSON.parse(out.trim());
    assert.equal(res.springOverdue, 0, `${tz}: spring overdue`);
    assert.deepEqual(res.springDueToday, ['s0'], `${tz}: spring dueToday`);
    assert.deepEqual(res.springDueSoon, ['s0', 's1'], `${tz}: spring dueSoon`);
    assert.deepEqual(res.fallDueToday, ['f0'], `${tz}: fall dueToday`);
    assert.deepEqual(res.fallDueSoon, ['f0', 'f1', 'f2'], `${tz}: fall 25h-day undated tomorrow still dueSoon`);
    assert.equal(res.fallCluster, '2026-11-02', `${tz}: fall cluster dayKey`);
    assert.equal(res.fallCue, '2 due Nov 2', `${tz}: fall cluster label`);
    assert.equal(res.nyCue, '2 due Jan 5, 2027', `${tz}: next-year cluster includes year`);
  }
});

test('summarizeActivityHistory reports accurate factual counts and handles corrupt or unsupported versions', () => {
  const nowSec = 1795600000;
  assert.deepEqual(summarizeActivityHistory(null, nowSec), {
    hasHistory: false,
    trackedTasks: 0,
    transitionCount: 0,
    completedCount: 0,
    inProgressCount: 0,
    reopenCount: 0,
    lastCheckInSec: null,
    recent7dTransitions: 0,
  });
  assert.equal(summarizeActivityHistory({ v: 99, tasks: { a: { e: [[2, nowSec]] } } }, nowSec).hasHistory, false);

  const summary = summarizeActivityHistory({
    v: ACTIVITY_SCHEMA_VERSION,
    tasks: {
      t1: { s: 'CS', d: nowSec + 86400, r: 1, e: [[1, nowSec - 800000], [2, nowSec - 100]], lastSec: nowSec - 100 },
      t2: { s: 'MATH', d: null, r: 0, e: [[1, nowSec - 500]], lastSec: nowSec - 500 },
      junk: 'not-an-object',
    },
  }, nowSec);

  assert.deepEqual(summary, {
    hasHistory: true,
    trackedTasks: 2,
    transitionCount: 3,
    completedCount: 1,
    inProgressCount: 1,
    reopenCount: 1,
    lastCheckInSec: nowSec - 100,
    recent7dTransitions: 2,
  });
});

test('privacy consent lifecycle, 0-byte opt-out, immediate deletion, clear-history consent preservation, and section isolation', () => {
  const storage = makeFaultStorage();
  const rtA = createInsightsRuntimeState();
  const rtB = createInsightsRuntimeState();

  assert.deepEqual(readInsightsPrefs({ storage, section: '', runtimeState: rtA }), DEFAULT_INSIGHTS_PREFS);
  assert.equal(readActivityHistory({ storage, section: '', runtimeState: rtA }), null);

  // Opted-out recording writes 0 bytes
  const opsBefore = storage.ops.length;
  const skipped = recordActivityTransition('t1', 'in_progress', 1000, { storage, section: '', runtimeState: rtA });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.written, false);
  assert.equal(storage.ops.slice(opsBefore).some((o) => o[0] === 'set'), false);
  assert.equal(storage.has('class_tasks_activity'), false);

  // Opt in & record transitions + reopenings + caps
  assert.equal(setActivityOptIn(true, { storage, section: '', runtimeState: rtA }).prefs.activityOptIn, true);
  assert.equal(storage.has('class_tasks_activity'), false, 'opting in writes prefs only until transition');
  recordActivityTransition('t1', 'in_progress', 1000, { storage, section: '', runtimeState: rtA, subject: 'CS' });
  recordActivityTransition('t1', 'done', 1100, { storage, section: '', runtimeState: rtA });
  recordActivityTransition('t1', 'in_progress', 1200, { storage, section: '', runtimeState: rtA });
  let act = readActivityHistory({ storage, section: '', runtimeState: rtA });
  assert.equal(act.v, ACTIVITY_SCHEMA_VERSION);
  assert.equal(act.tasks.t1.r, 1);
  assert.equal(act.tasks.t1.s, 'CS');
  assert.equal(act.tasks.t1.e.length, 3);

  // Section B isolation
  setActivityOptIn(true, { storage, section: 'b', runtimeState: rtB });
  recordActivityTransition('b1', 'done', 2000, { storage, section: 'b', runtimeState: rtB });
  assert.equal(storage.has('b_class_tasks_activity'), true);

  // setShowInsights preserves stored activity and opt-in
  const hideRes = setShowInsights(false, { storage, section: '', runtimeState: rtA });
  assert.deepEqual(hideRes.prefs, { v: INSIGHTS_SCHEMA_VERSION, showInsights: false, activityOptIn: true });
  assert.equal(storage.has('class_tasks_activity'), true);

  // clearActivityHistory deletes activity while preserving activityOptIn: true and showInsights
  const cleared = clearActivityHistory({ storage, section: '', runtimeState: rtA });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.deleted, true);
  assert.equal(storage.has('class_tasks_activity'), false);
  assert.deepEqual(readInsightsPrefs({ storage, section: '', runtimeState: rtA }), {
    v: INSIGHTS_SCHEMA_VERSION,
    showInsights: false,
    activityOptIn: true,
  });
  assert.equal(storage.has('b_class_tasks_activity'), true, 'Section B unaffected');

  // Re-record works because activityOptIn remained true, then turning opt-in off immediately deletes activity
  recordActivityTransition('t2', 'done', 3000, { storage, section: '', runtimeState: rtA });
  assert.equal(storage.has('class_tasks_activity'), true);
  const optOut = setActivityOptIn(false, { storage, section: '', runtimeState: rtA });
  assert.equal(optOut.ok, true);
  assert.equal(optOut.deleted, true);
  assert.equal(optOut.prefs.activityOptIn, false);
  assert.equal(storage.has('class_tasks_activity'), false);
  assert.equal(storage.has('b_class_tasks_activity'), true);
});

test('event cap (8) and task cap (400) prune oldest entries deterministically', () => {
  const storage = makeFaultStorage();
  const rt = createInsightsRuntimeState();
  setActivityOptIn(true, { storage, section: '', runtimeState: rt });
  for (let i = 0; i < MAX_ACTIVITY_EVENTS_PER_TASK + 4; i++) {
    recordActivityTransition('t-cap', i % 2 === 0 ? 'in_progress' : 'done', 100 + i, { storage, runtimeState: rt });
  }
  const act = readActivityHistory({ storage, runtimeState: rt });
  assert.equal(act.tasks['t-cap'].e.length, MAX_ACTIVITY_EVENTS_PER_TASK);
  assert.equal(act.tasks['t-cap'].e[0][1], 104);

  const big = { v: 1, tasks: {} };
  for (let i = 0; i < MAX_ACTIVITY_TASKS + 25; i++) {
    big.tasks[`k${i}`] = { s: '', d: null, r: 0, e: [[1, i]], lastSec: i };
  }
  const pruned = pruneOldestActivity(big, MAX_ACTIVITY_TASKS);
  assert.equal(Object.keys(pruned.tasks).length, MAX_ACTIVITY_TASKS);
  assert.equal('k0' in pruned.tasks, false);
  assert.equal(`k${MAX_ACTIVITY_TASKS + 24}` in pruned.tasks, true);
});

test('storage fault matrix: SecurityError, QuotaExceededError 50%-prune retry & exhaustion, corrupt JSON, unknown v, and dual failure recovery', () => {
  // 1. Corrupt JSON & unknown schema version
  const corruptStore = makeFaultStorage({
    class_tasks_insights_prefs: '{not-json',
    class_tasks_activity: JSON.stringify({ v: 99, tasks: { old: { e: [[2, 10]] } } }),
  });
  const rtCorrupt = createInsightsRuntimeState();
  assert.deepEqual(readInsightsPrefs({ storage: corruptStore, runtimeState: rtCorrupt }), DEFAULT_INSIGHTS_PREFS);
  assert.equal(readActivityHistory({ storage: corruptStore, runtimeState: rtCorrupt }), null);

  // 2. QuotaExceededError: prune 50% and retry once without touching class_tasks_progress
  const initialTasks = {};
  for (let i = 1; i <= 10; i++) initialTasks[`old-${i}`] = { s: '', d: null, r: 0, e: [[1, i]], lastSec: i };
  let writes = 0;
  const quotaStore = makeFaultStorage(
    {
      class_tasks_progress: JSON.stringify({ p1: { status: 'done', movedAt: 5 } }),
      class_tasks_insights_prefs: JSON.stringify({ v: 1, showInsights: true, activityOptIn: true }),
      class_tasks_activity: JSON.stringify({ v: 1, tasks: initialTasks }),
    },
    {
      failSet: (k) => k === 'class_tasks_activity' && ++writes === 1,
      setErr: 'quota',
    },
  );
  const rtQuota = createInsightsRuntimeState();
  const qRes = recordActivityTransition('new-task', 'done', 50, { storage: quotaStore, runtimeState: rtQuota });
  assert.equal(qRes.ok, true);
  assert.equal(qRes.written, true);
  assert.equal(qRes.pruned, true);
  const afterQuota = readActivityHistory({ storage: quotaStore, runtimeState: rtQuota });
  assert.equal(Object.keys(afterQuota.tasks).length, 5, 'pruned oldest half');
  assert.equal('new-task' in afterQuota.tasks, true);
  assert.equal(quotaStore.getItem('class_tasks_progress'), '{"p1":{"status":"done","movedAt":5}}');

  // Exhausted quota: retry also fails -> suspend cleanly
  const hardQuota = makeFaultStorage(
    {
      class_tasks_progress: JSON.stringify({ p1: { status: 'done', movedAt: 5 } }),
      class_tasks_insights_prefs: JSON.stringify({ v: 1, showInsights: true, activityOptIn: true }),
      class_tasks_activity: JSON.stringify({ v: 1, tasks: initialTasks }),
    },
    { failSet: (k) => k === 'class_tasks_activity', setErr: 'quota' },
  );
  const rtHard = createInsightsRuntimeState();
  const hardOut = recordActivityTransition('new-task', 'done', 50, { storage: hardQuota, runtimeState: rtHard });
  assert.equal(hardOut.ok, false);
  assert.equal(hardOut.suspended, true);
  assert.equal(hardOut.degraded, true);
  assert.equal(hardQuota.getItem('class_tasks_progress'), '{"p1":{"status":"done","movedAt":5}}');

  // 3. Dual write + delete failure: suspend, report degraded without claiming success, retry cleanup on recovery
  let blocked = true;
  const flakyStore = makeFaultStorage(
    {
      class_tasks_insights_prefs: JSON.stringify({ v: 1, showInsights: true, activityOptIn: true }),
      class_tasks_activity: JSON.stringify({ v: 1, tasks: { gone: { s: '', d: null, r: 0, e: [[1, 10]], lastSec: 10 }, keep: { s: '', d: null, r: 0, e: [[1, 20]], lastSec: 20 } } }),
    },
    {
      failGet: (k) => blocked && k === 'class_tasks_activity',
      failSet: (k) => blocked && k.startsWith('class_tasks_'),
      failRemove: (k) => blocked && k === 'class_tasks_activity',
    },
  );
  const rtFlaky = createInsightsRuntimeState();

  const failedOptOut = setActivityOptIn(false, { storage: flakyStore, runtimeState: rtFlaky });
  assert.equal(failedOptOut.ok, false);
  assert.equal(failedOptOut.deleted, false, 'never claim deletion succeeded');
  assert.equal(failedOptOut.degraded, true);
  assert.equal(failedOptOut.pendingCleanup, true);
  assert.equal(getInsightsStorageStatus({ runtimeState: rtFlaky }).activitySuspended, true);

  // Writes must remain suspended while blocked
  const blockedWrite = recordActivityTransition('x', 'done', 99, { storage: flakyStore, runtimeState: rtFlaky });
  assert.equal(blockedWrite.ok, false);
  assert.equal(blockedWrite.written, false);

  // Storage recovers: pending opt-out + purge automatically executes
  blocked = false;
  const recoveredPrefs = readInsightsPrefs({ storage: flakyStore, runtimeState: rtFlaky });
  assert.equal(recoveredPrefs.activityOptIn, false);
  assert.equal(flakyStore.has('class_tasks_activity'), false, 'stale activity purged on recovery');
  assert.equal(getInsightsStorageStatus({ runtimeState: rtFlaky }).degraded, false);
  assert.equal(getInsightsStorageStatus({ runtimeState: rtFlaky }).activitySuspended, false);

  // 4. Dual failure on pruneDeletedActivity also queues & recovers without losing IDs
  blocked = true;
  flakyStore.raw.set('class_tasks_activity', JSON.stringify({
    v: 1,
    tasks: {
      dead1: { s: '', d: null, r: 0, e: [[2, 10]], lastSec: 10 },
      live1: { s: '', d: null, r: 0, e: [[1, 20]], lastSec: 20 },
    },
  }));
  const failedPrune = pruneDeletedActivity(['dead1'], { storage: flakyStore, runtimeState: rtFlaky });
  assert.equal(failedPrune.ok, false);
  assert.equal(failedPrune.deleted, false);
  assert.equal(failedPrune.degraded, true);
  assert.equal(failedPrune.pendingCleanup, true);
  assert.deepEqual(getInsightsStorageStatus({ runtimeState: rtFlaky }).pendingDeletedIds, ['dead1']);

  blocked = false;
  const recoveredPrune = flushPendingActivityCleanup({ storage: flakyStore, runtimeState: rtFlaky });
  assert.equal(recoveredPrune.ok, true);
  assert.equal(recoveredPrune.deleted, true);
  assert.equal(recoveredPrune.pendingCleanup, false);
  const remaining = readActivityHistory({ storage: flakyStore, runtimeState: rtFlaky });
  assert.deepEqual(Object.keys(remaining.tasks), ['live1']);
});

test('js/insights.js keeps PR 4 predictor, shadow evaluation, and experimental toggle completely out of PR 2', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'insights.js'), 'utf8');
  for (const forbidden of [
    /hybrid_burst/i,
    /EmpiricalBayes/i,
    /shadowEval/i,
    /\bbrier\b/i,
    /adaptiveBeta/i,
    /\blogistic\b/i,
    /\btStat\b/,
    /experimentalToggle/i,
  ]) {
    assert.equal(forbidden.test(src), false, `PR 2 js/insights.js must not contain ${forbidden}`);
  }
});
