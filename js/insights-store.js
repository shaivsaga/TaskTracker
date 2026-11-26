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

const STATUS_TO_CODE = Object.freeze({
  not_started: 0,
  in_progress: 1,
  done: 2,
});

const defaultRuntimeBySection = new Map();

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const hasPendingCleanup = (rt) => Boolean(rt.pendingActivityPurge || rt.pendingOptOut || rt.pendingDeletedIds.size > 0);

function normalizeSection(section) {
  const id = String(section ?? '').toLowerCase();
  return id && id !== 'a' ? id : '';
}

export function insightsKeysFor(section = currentSection()) {
  const sec = normalizeSection(section);
  return {
    prefs: sectionKey('class_tasks_insights_prefs', sec),
    activity: sectionKey('class_tasks_activity', sec),
  };
}

export function createInsightsRuntimeState() {
  return {
    degraded: false,
    lastError: null,
    lastWarning: null,
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
    lastWarning: rt.lastWarning,
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

function contextFor({ storage, section = currentSection(), runtimeState, errorName = null } = {}) {
  const sec = normalizeSection(section);
  const rt = getRuntimeState(sec, runtimeState);
  const keys = insightsKeysFor(sec);
  const resolved = resolveStorage(storage, errorName);
  return { sec, rt, keys, storage: resolved.storage, errorName: resolved.errorName };
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

function markSuspended(rt, errorName, warning = 'Browser storage is unavailable; activity processing is suspended.') {
  rt.degraded = true;
  rt.activitySuspended = true;
  rt.lastError = errorName || 'StorageError';
  rt.lastWarning = warning;
}

function failPending(rt, errorName, warning, extra = {}) {
  markSuspended(rt, errorName, warning);
  return {
    ok: false,
    deleted: false,
    durableConfirmed: false,
    degraded: true,
    pendingCleanup: true,
    suspended: true,
    warning: rt.lastWarning,
    ...extra,
  };
}

function clearDegradedIfClean(rt) {
  if (!hasPendingCleanup(rt)) {
    rt.activitySuspended = false;
    rt.degraded = false;
    rt.lastError = null;
    rt.lastWarning = null;
  }
}

function parsePrefsRaw(raw) {
  if (typeof raw !== 'string' || raw === '') {
    return { valid: false, missing: true, prefs: { ...DEFAULT_INSIGHTS_PREFS } };
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      !isPlainObject(parsed)
      || parsed.v !== INSIGHTS_SCHEMA_VERSION
      || typeof parsed.showInsights !== 'boolean'
      || typeof parsed.activityOptIn !== 'boolean'
    ) {
      return { valid: false, missing: false, prefs: { ...DEFAULT_INSIGHTS_PREFS } };
    }
    return {
      valid: true,
      missing: false,
      prefs: {
        v: INSIGHTS_SCHEMA_VERSION,
        showInsights: parsed.showInsights,
        activityOptIn: parsed.activityOptIn,
      },
    };
  } catch (e) {
    return { valid: false, missing: false, prefs: { ...DEFAULT_INSIGHTS_PREFS } };
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

function reconcileOrphanActivity(ctx) {
  const actRead = storageGet(ctx.storage, ctx.keys.activity);
  if (actRead.ok && actRead.value === null) {
    return { ok: true, deleted: false, orphaned: false };
  }
  const rem = storageRemove(ctx.storage, ctx.keys.activity);
  if (rem.ok) {
    ctx.rt.pendingActivityPurge = false;
    ctx.rt.pendingDeletedIds.clear();
    return { ok: true, deleted: actRead.ok ? actRead.value !== null : true, orphaned: true };
  }
  ctx.rt.pendingActivityPurge = true;
  markSuspended(
    ctx.rt,
    rem.errorName || actRead.errorName,
    'Could not remove orphaned activity history while browser storage is inaccessible; activity processing is suspended.',
  );
  return { ok: false, deleted: false, orphaned: true, errorName: rem.errorName || actRead.errorName };
}

function readValidatedConsent(ctx) {
  if (!ctx.storage) {
    markSuspended(ctx.rt, ctx.errorName, 'Browser storage is unavailable; activity processing is suspended.');
    return { ok: false, optedIn: false, prefs: { ...DEFAULT_INSIGHTS_PREFS } };
  }
  const prefsRead = storageGet(ctx.storage, ctx.keys.prefs);
  if (!prefsRead.ok) {
    markSuspended(ctx.rt, prefsRead.errorName, 'Could not read insights preferences; activity processing is suspended.');
    return { ok: false, optedIn: false, prefs: { ...DEFAULT_INSIGHTS_PREFS } };
  }

  const parsed = prefsRead.value === null
    ? { valid: false, missing: true, prefs: { ...DEFAULT_INSIGHTS_PREFS } }
    : parsePrefsRaw(prefsRead.value);

  if (ctx.rt.pendingOptOut) parsed.prefs.activityOptIn = false;

  const optedIn = parsed.valid && parsed.prefs.activityOptIn === true && !ctx.rt.pendingOptOut;
  if (!optedIn) {
    const rec = reconcileOrphanActivity(ctx);
    if (!rec.ok) return { ok: false, optedIn: false, prefs: parsed.prefs };
  }
  return { ok: true, optedIn, prefs: parsed.prefs };
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

function flushCleanupCtx(ctx) {
  const { rt, keys, storage } = ctx;

  if (!hasPendingCleanup(rt)) {
    return {
      ok: true,
      cleaned: true,
      deleted: false,
      durableConfirmed: true,
      degraded: Boolean(rt.degraded),
      pendingCleanup: false,
    };
  }
  if (!storage) {
    return failPending(
      rt,
      ctx.errorName,
      'Browser storage is unavailable; pending consent withdrawal or deletion could not be confirmed.',
      { cleaned: false },
    );
  }

  let deleted = false;
  let fallbackCleared = false;

  if (rt.pendingOptOut) {
    const prefsRead = storageGet(storage, keys.prefs);
    const current = prefsRead.ok ? parsePrefsRaw(prefsRead.value).prefs : { ...DEFAULT_INSIGHTS_PREFS };
    const nextPrefs = {
      v: INSIGHTS_SCHEMA_VERSION,
      showInsights: current.showInsights,
      activityOptIn: false,
    };
    const prefsWrite = storageSet(storage, keys.prefs, JSON.stringify(nextPrefs));
    if (!prefsWrite.ok) {
      return failPending(
        rt,
        prefsWrite.errorName,
        'Could not persist pending opt-out preference; durable consent withdrawal could not be confirmed.',
        { cleaned: false },
      );
    }
    rt.pendingOptOut = false;
  }

  if (rt.pendingActivityPurge) {
    const remRes = storageRemove(storage, keys.activity);
    if (!remRes.ok) {
      return failPending(
        rt,
        remRes.errorName,
        'Could not purge pending activity history; deletion could not be confirmed.',
        { cleaned: false },
      );
    }
    rt.pendingActivityPurge = false;
    rt.pendingDeletedIds.clear();
    deleted = true;
  } else if (rt.pendingDeletedIds.size > 0) {
    const idFlush = flushIdDeletions(storage, keys.activity, rt);
    if (!idFlush.ok) {
      return failPending(
        rt,
        idFlush.errorName,
        'Could not remove deleted task activity while browser storage is inaccessible; deletion could not be confirmed.',
        { cleaned: false },
      );
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
    durableConfirmed: true,
    degraded: Boolean(rt.degraded),
    pendingCleanup: false,
  };
}

export function flushPendingActivityCleanup(opts = {}) {
  return flushCleanupCtx(contextFor(opts));
}

export function readInsightsPrefs(opts = {}) {
  const ctx = contextFor(opts);
  if (hasPendingCleanup(ctx.rt)) flushCleanupCtx(ctx);
  return readValidatedConsent(ctx).prefs;
}

export function setShowInsights(enabled, opts = {}) {
  const ctx = contextFor(opts);
  if (hasPendingCleanup(ctx.rt)) flushCleanupCtx(ctx);
  const current = readValidatedConsent(ctx).prefs;
  const next = {
    v: INSIGHTS_SCHEMA_VERSION,
    showInsights: Boolean(enabled),
    activityOptIn: ctx.rt.pendingOptOut ? false : current.activityOptIn,
  };
  if (!ctx.storage) {
    ctx.rt.degraded = true;
    ctx.rt.lastError = ctx.errorName;
    return { ok: false, prefs: next, degraded: true };
  }
  const writeRes = storageSet(ctx.storage, ctx.keys.prefs, JSON.stringify(next));
  if (!writeRes.ok) {
    ctx.rt.degraded = true;
    ctx.rt.lastError = writeRes.errorName;
    return { ok: false, prefs: next, degraded: true };
  }
  clearDegradedIfClean(ctx.rt);
  return { ok: true, prefs: next, degraded: Boolean(ctx.rt.degraded) };
}

export function setActivityOptIn(enabled, opts = {}) {
  const ctx = contextFor(opts);
  const { rt, keys, storage } = ctx;
  const current = readValidatedConsent(ctx).prefs;
  const optIn = Boolean(enabled);

  if (!optIn) {
    const next = {
      v: INSIGHTS_SCHEMA_VERSION,
      showInsights: current.showInsights,
      activityOptIn: false,
    };

    if (!storage) {
      rt.pendingOptOut = true;
      rt.pendingActivityPurge = true;
      return failPending(
        rt,
        ctx.errorName,
        'Browser storage is unavailable; activity processing is suspended, and neither opt-out preference nor activity deletion could be confirmed.',
        { prefs: next, consentPersisted: false },
      );
    }

    const remRes = storageRemove(storage, keys.activity);
    const writeRes = storageSet(storage, keys.prefs, JSON.stringify(next));
    rt.pendingActivityPurge = !remRes.ok;
    rt.pendingOptOut = !writeRes.ok;
    if (remRes.ok) rt.pendingDeletedIds.clear();

    if (!remRes.ok || !writeRes.ok) {
      const warning = !remRes.ok && !writeRes.ok
        ? 'Browser storage failed both preference persistence and activity deletion; activity processing is suspended, and neither durable consent withdrawal nor deletion could be confirmed.'
        : (!remRes.ok
          ? 'Opt-out preference saved, but stored activity deletion could not be confirmed; activity processing is suspended.'
          : 'Stored activity was deleted, but durable consent withdrawal could not be confirmed across reloads (opt-out preference persistence failed); activity processing is suspended.');
      return failPending(rt, remRes.ok ? writeRes.errorName : remRes.errorName, warning, {
        prefs: next,
        deleted: remRes.ok,
        consentPersisted: writeRes.ok,
        durableConfirmed: false,
      });
    }

    clearDegradedIfClean(rt);
    return {
      ok: true,
      prefs: next,
      deleted: true,
      consentPersisted: true,
      durableConfirmed: true,
      degraded: false,
      pendingCleanup: false,
      suspended: false,
      warning: null,
    };
  }

  if (hasPendingCleanup(rt)) {
    const cleanup = flushCleanupCtx(ctx);
    if (!cleanup.ok) {
      return {
        ...cleanup,
        prefs: { ...current, activityOptIn: false },
      };
    }
  }

  const next = {
    v: INSIGHTS_SCHEMA_VERSION,
    showInsights: current.showInsights,
    activityOptIn: true,
  };
  if (!storage) {
    markSuspended(rt, ctx.errorName, 'Browser storage is unavailable; cannot opt in to local activity history.');
    return {
      ok: false,
      prefs: { ...current, activityOptIn: false },
      deleted: false,
      durableConfirmed: false,
      degraded: true,
      pendingCleanup: false,
      suspended: true,
      warning: rt.lastWarning,
    };
  }
  const writeRes = storageSet(storage, keys.prefs, JSON.stringify(next));
  if (!writeRes.ok) {
    markSuspended(rt, writeRes.errorName, 'Could not persist activity opt-in preference to browser storage.');
    return {
      ok: false,
      prefs: { ...current, activityOptIn: false },
      deleted: false,
      durableConfirmed: false,
      degraded: true,
      pendingCleanup: false,
      suspended: true,
      warning: rt.lastWarning,
    };
  }
  clearDegradedIfClean(rt);
  return {
    ok: true,
    prefs: next,
    deleted: false,
    durableConfirmed: true,
    degraded: false,
    pendingCleanup: false,
    suspended: false,
    warning: null,
  };
}

export function clearActivityHistory(opts = {}) {
  const ctx = contextFor(opts);
  const { rt, keys, storage } = ctx;

  if (!storage) {
    rt.pendingActivityPurge = true;
    return failPending(
      rt,
      ctx.errorName,
      'Browser storage is unavailable; deletion of activity history could not be confirmed.',
    );
  }
  const remRes = storageRemove(storage, keys.activity);
  if (!remRes.ok) {
    rt.pendingActivityPurge = true;
    return failPending(
      rt,
      remRes.errorName,
      'Could not delete stored activity history; activity processing is suspended and deletion could not be confirmed.',
    );
  }
  rt.pendingActivityPurge = false;
  rt.pendingDeletedIds.clear();
  clearDegradedIfClean(rt);
  return {
    ok: true,
    deleted: true,
    durableConfirmed: true,
    degraded: false,
    pendingCleanup: false,
    suspended: false,
    warning: null,
  };
}

export function readActivityHistory(opts = {}) {
  const ctx = contextFor(opts);
  if (hasPendingCleanup(ctx.rt)) {
    const cleanup = flushCleanupCtx(ctx);
    if (!cleanup.ok) return null;
  }

  const consent = readValidatedConsent(ctx);
  if (!consent.ok || !consent.optedIn || ctx.rt.activitySuspended) return null;

  const readRes = storageGet(ctx.storage, ctx.keys.activity);
  if (!readRes.ok) {
    markSuspended(ctx.rt, readRes.errorName, 'Could not read stored activity history; activity processing is suspended.');
    return null;
  }
  if (readRes.value === null) return null;
  const parsed = parseActivityRaw(readRes.value);
  return parsed.valid ? parsed.activity : null;
}

export function recordActivityTransition(taskId, status, nowSec, opts = {}) {
  const ctx = contextFor(opts);
  const { rt, keys, storage } = ctx;
  const { subject = '', deadlineSec = null } = opts;

  const id = typeof taskId === 'string' ? taskId : String(taskId ?? '');
  if (!id || id === '__proto__' || !Object.hasOwn(STATUS_TO_CODE, status) || !Number.isFinite(nowSec)) {
    return { ok: false, written: false, reason: 'invalid_input', degraded: Boolean(rt.degraded) };
  }

  if (hasPendingCleanup(rt)) {
    const cleanup = flushCleanupCtx(ctx);
    if (!cleanup.ok) {
      return {
        ok: false,
        written: false,
        suspended: true,
        degraded: true,
        pendingCleanup: true,
        durableConfirmed: false,
        warning: rt.lastWarning,
      };
    }
  }

  const consent = readValidatedConsent(ctx);
  if (!consent.ok) {
    return { ok: false, written: false, suspended: true, degraded: true, durableConfirmed: false, warning: rt.lastWarning };
  }
  if (!consent.optedIn) {
    return { ok: true, written: false, reason: 'opted_out', degraded: Boolean(rt.degraded) };
  }
  if (rt.activitySuspended) {
    return { ok: false, written: false, suspended: true, degraded: true, warning: rt.lastWarning };
  }

  const readRes = storageGet(storage, keys.activity);
  if (!readRes.ok) {
    markSuspended(rt, readRes.errorName, 'Could not read stored activity history; writes are suspended.');
    return { ok: false, written: false, suspended: true, degraded: true, warning: rt.lastWarning };
  }

  const existing = readRes.value !== null
    ? parseActivityRaw(readRes.value)
    : { valid: true, activity: { v: ACTIVITY_SCHEMA_VERSION, tasks: {} } };
  const baseActivity = existing.valid && existing.activity
    ? { v: ACTIVITY_SCHEMA_VERSION, tasks: { ...existing.activity.tasks } }
    : { v: ACTIVITY_SCHEMA_VERSION, tasks: {} };

  const code = STATUS_TO_CODE[status];
  const resolvedNowSec = Math.floor(nowSec);
  const prevRec = isPlainObject(baseActivity.tasks[id]) ? baseActivity.tasks[id] : null;
  const prevEvents = prevRec && Array.isArray(prevRec.e) ? prevRec.e.slice() : [];
  const prevLastCode = prevEvents.length ? prevEvents[prevEvents.length - 1][0] : null;
  const prevReopens = prevRec && Number.isInteger(prevRec.r) && prevRec.r >= 0 ? prevRec.r : 0;

  baseActivity.tasks[id] = {
    s: typeof subject === 'string' && subject ? subject : (prevRec && typeof prevRec.s === 'string' ? prevRec.s : ''),
    d: Number.isFinite(deadlineSec) ? Math.floor(deadlineSec) : (prevRec && Number.isFinite(prevRec.d) ? prevRec.d : null),
    r: prevLastCode === 2 && code !== 2 ? prevReopens + 1 : prevReopens,
    e: prevEvents.concat([[code, resolvedNowSec]]).slice(-MAX_ACTIVITY_EVENTS_PER_TASK),
    lastSec: resolvedNowSec,
  };

  const trimmed = pruneOldestActivity(baseActivity, MAX_ACTIVITY_TASKS, id);
  const firstWrite = storageSet(storage, keys.activity, JSON.stringify(trimmed));
  if (firstWrite.ok) {
    clearDegradedIfClean(rt);
    return { ok: true, written: true, pruned: false, degraded: false };
  }

  if (firstWrite.quota) {
    const halfLimit = Math.max(1, Math.floor(Object.keys(trimmed.tasks).length / 2));
    const shrunk = pruneOldestActivity(trimmed, halfLimit, id);
    const retryWrite = storageSet(storage, keys.activity, JSON.stringify(shrunk));
    if (retryWrite.ok) {
      rt.degraded = true;
      rt.lastError = firstWrite.errorName;
      rt.activitySuspended = false;
      return { ok: true, written: true, pruned: true, degraded: true };
    }
    markSuspended(rt, retryWrite.errorName, 'Storage quota exhausted after pruning; activity logging is suspended.');
    return { ok: false, written: false, pruned: true, suspended: true, degraded: true, warning: rt.lastWarning };
  }

  markSuspended(rt, firstWrite.errorName, 'Browser storage rejected activity write; activity logging is suspended.');
  return { ok: false, written: false, pruned: false, suspended: true, degraded: true, warning: rt.lastWarning };
}

export function pruneDeletedActivity(deletedIds, opts = {}) {
  const ctx = contextFor(opts);
  const { rt, keys, storage } = ctx;

  const incoming = Array.isArray(deletedIds)
    ? deletedIds
      .map((entry) => (typeof entry === 'string' ? entry : (isPlainObject(entry) && typeof entry.id === 'string' ? entry.id : null)))
      .filter((id) => typeof id === 'string' && id !== '')
    : [];

  for (const id of incoming) rt.pendingDeletedIds.add(id);

  if (rt.pendingActivityPurge || rt.pendingOptOut) {
    const flushed = flushCleanupCtx(ctx);
    if (!flushed.ok) return { ...flushed, removed: [] };
  }

  if (rt.pendingDeletedIds.size === 0) {
    return {
      ok: true,
      removed: [],
      deleted: false,
      durableConfirmed: true,
      degraded: Boolean(rt.degraded),
      pendingCleanup: false,
    };
  }

  if (!storage) {
    return failPending(
      rt,
      ctx.errorName,
      'Browser storage is unavailable; deletion of deleted-task activity could not be confirmed.',
      { removed: [] },
    );
  }

  const out = flushIdDeletions(storage, keys.activity, rt);
  if (!out.ok) {
    return failPending(
      rt,
      out.errorName,
      'Could not remove activity entries for deleted tasks; deletion could not be confirmed.',
      { removed: [] },
    );
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
      durableConfirmed: true,
      degraded: true,
      pendingCleanup: false,
    };
  }

  clearDegradedIfClean(rt);
  return {
    ok: true,
    removed: out.removed,
    deleted: out.deleted,
    durableConfirmed: true,
    degraded: Boolean(rt.degraded),
    pendingCleanup: false,
  };
}
