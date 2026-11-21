// js/store.js - the Board, admin draft, and deletion-authority store.
//
// Owns the one Board fetch (data/current.json with no-cache revalidation), server-proved
// deletion authority (monotonic revision + grow-only deleted ids), authenticated admin actions
// with stale-base retry, coalesced admin state reads, and ADR-0007 archive-first draft
// replacement. Pure factory createBoardStore() accepts injectable fetch/storage adapters so
// Node tests exercise the same module interface with in-memory adapters.
//
// D6: no logic.js import, no DOM access, nothing runs at evaluation time.

import { state } from './state.js';
import { readJSON, writeJSON, KEYS, API } from './util.js';
import { validateSubjects, subjectFor, retiredSubject } from './subjects.js';
import { filterDeletedProgress, nextAuthority, prepareRecoveredDraft } from './recovery.js';

export const newOperationId = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID().replace(/-/g, '')
  : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''));

// Returns a clean { tasks, announcements, ... } or null when the payload is not a usable board.
export function normalizeBoard(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.tasks)) return null;
  if (data.announcements != null && !Array.isArray(data.announcements)) return null;
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  return {
    ...data,
    tasks: data.tasks.filter(isObj),
    announcements: (data.announcements || []).filter((a) => isObj(a) && typeof a.text === 'string' && Number.isFinite(a.createdAt)),
  };
}

function subjectSnapshotFor(stateObj, code) {
  if (!code) return [];
  const def = subjectFor(stateObj.draftSubjects, code) || subjectFor(stateObj.catalog, code) || retiredSubject(code);
  return [{ code: def.code, name: def.name, color: def.color, active: def.active }];
}

export function createBoardStore({
  fetchFn = (...args) => globalThis.fetch(...args),
  read = readJSON,
  write = writeJSON,
  stateObj = state,
  keys = KEYS,
  api = API,
  makeId = newOperationId,
} = {}) {
  let inflightAdmin = null;

  function acceptAuthority(board) {
    const next = nextAuthority(
      { revision: stateObj.verifiedRevision, deletedIds: stateObj.verifiedDeletedIds },
      board,
    );
    if (!next) return false;
    stateObj.verifiedRevision = next.revision;
    stateObj.verifiedDeletedIds = next.deletedIds;
    return true;
  }

  function applyDeletionAuthority({ onPersistError } = {}) {
    const before = stateObj.progress;
    const filtered = filterDeletedProgress(before, stateObj.verifiedDeletedIds);
    if (!filtered.removed.length) return { ok: true, removed: [] };
    stateObj.progress = filtered.progress;
    if (!write(keys.progress, stateObj.progress)) {
      stateObj.progress = before;
      onPersistError?.();
      return { ok: false, removed: [] };
    }
    return { ok: true, removed: filtered.removed };
  }

  function adoptAuthoritativeBoard(board, opts) {
    if (!acceptAuthority(board)) return false;
    applyDeletionAuthority(opts);
    return true;
  }

  function mustRecoverAsNewId(id) {
    return stateObj.verifiedDeletedIds.includes(String(id));
  }

  // The single Board fetch seam: stable URL + cache: 'no-cache' lets nginx answer 304 via ETag.
  async function fetchBoard({ fallbackToCache = true, onPersistError } = {}) {
    let board = null;
    let authoritative = false;
    let offline = false;
    try {
      const res = await fetchFn(api.current, { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
      let data;
      if (res.status === 404) data = { tasks: [], announcements: [] };
      else if (res.ok) data = await res.json();
      else throw new Error(String(res.status));
      board = normalizeBoard(data);
      if (!board) throw new Error('Invalid board data');
      authoritative = res.ok && acceptAuthority(board);
      write(keys.cache, board);
      stateObj.liveBoard = board;
    } catch (e) {
      offline = true;
      board = fallbackToCache ? normalizeBoard(read(keys.cache, null)) : null;
      if (fallbackToCache) stateObj.liveBoard = null;
    }
    let cleaned = false;
    if (authoritative) {
      const applied = applyDeletionAuthority({ onPersistError });
      cleaned = applied.ok;
    }
    return { board, authoritative, offline, cleaned };
  }

  // Coalesces simultaneous ?view=admin loads (bin + subjects presets) into one request.
  async function fetchAdminState({ force = false } = {}) {
    if (!force && inflightAdmin) return inflightAdmin;
    const req = (async () => {
      try {
        const res = await fetchFn(`${api.versions}?view=admin`, { cache: 'no-store' });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) return { ok: false, status: res.status, data: null };
        if (typeof data.adminRevision === 'number') stateObj.adminRevision = data.adminRevision;
        return { ok: true, status: res.status, data };
      } catch (e) {
        return { ok: false, status: 0, data: null };
      } finally {
        if (inflightAdmin === req) inflightAdmin = null;
      }
    })();
    if (!force) inflightAdmin = req;
    return req;
  }

  async function adminPost(payload) {
    const res = await fetchFn(api.versions, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    if (typeof data?.adminRevision === 'number') stateObj.adminRevision = data.adminRevision;
    return { ok: res.ok, status: res.status, code: data && data.code, data };
  }

  async function adminAction(action, fields = {}) {
    const operationId = makeId();
    const send = (base) => adminPost({ action, operationId, baseAdminRevision: base, ...fields });
    let out = await send(stateObj.adminRevision);
    if (!out.ok && out.code === 'stale_admin_base') {
      await fetchAdminState({ force: true });
      out = await send(stateObj.adminRevision);
    }
    return out;
  }

  async function archiveTask(task) {
    const definition = task && typeof task.toJSON === 'function' ? task.toJSON() : task;
    try {
      const out = await adminAction('bin-archive', {
        task: definition,
        subjects: subjectSnapshotFor(stateObj, task && task.subject),
      });
      return out.ok ? { ok: true, binId: out.data && out.data.binId } : { ok: false, status: out.status, code: out.code };
    } catch (e) {
      return { ok: false, reason: 'offline' };
    }
  }

  // Enforces ADR-0007 on every draft replacement (history, checkpoints, discard, transfer, Undo):
  // archive displaced draft-only tasks first, then rewrite permanently deleted ids as labelled copies.
  async function replaceDraft(snap, hooks) {
    const { myTasks, Task, syncCatalog, applyProgress, saveTasks, renderAllTasks, renderAnnouncements, showToast } = hooks;
    const incoming = Array.isArray(snap && snap.tasks) ? snap.tasks : [];
    const keep = new Set(incoming.map((t) => String(t && t.id)));
    const publishedIds = new Set(stateObj.publishedTasks.map((t) => String(t.id)));
    const onlyHere = myTasks.filter((t) => !keep.has(String(t.id)) && !publishedIds.has(String(t.id)));

    for (const task of onlyHere) {
      const archived = await archiveTask(task);
      if (!archived || !archived.ok) {
        showToast?.('Could not save a draft-only task to the recycle bin, so the draft was left unchanged.');
        return { ok: false, reason: 'archive_failed', recovered: [] };
      }
    }

    const prepared = prepareRecoveredDraft(
      { tasks: incoming },
      stateObj.verifiedDeletedIds,
      makeId,
    );
    myTasks.length = 0;
    prepared.content.tasks.forEach((o) => myTasks.push(Task.fromJSON(o)));
    if (prepared.recovered.length) {
      showToast?.(prepared.recovered.length === 1
        ? 'Restored one task as a new copy: its old id was permanently deleted.'
        : `Restored ${prepared.recovered.length} tasks as new copies: their old ids were permanently deleted.`);
    }
    stateObj.announcements = snap && Array.isArray(snap.announcements)
      ? JSON.parse(JSON.stringify(snap.announcements))
      : [];
    if (snap && Array.isArray(snap.subjects) && snap.subjects.length) {
      const checked = validateSubjects(snap.subjects);
      if (!checked.error) {
        stateObj.draftSubjects = checked.subjects;
        syncCatalog?.(checked.subjects);
      }
    }
    applyProgress?.(myTasks);
    const saved = saveTasks ? saveTasks() : true;
    renderAllTasks?.();
    renderAnnouncements?.();
    return { ok: true, saved, recovered: prepared.recovered };
  }

  return {
    acceptAuthority,
    applyDeletionAuthority,
    adoptAuthoritativeBoard,
    mustRecoverAsNewId,
    fetchBoard,
    fetchAdminState,
    adminAction,
    archiveTask,
    replaceDraft,
  };
}

export const store = createBoardStore();
