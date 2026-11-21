/**
 * tests/store.test.js - Board fetch, deletion authority, admin actions, and ADR-0007 draft replacement.
 *
 * Uses an in-memory adapter for fetch and storage, exercising js/store.js's public interface
 * directly in plain Node without a browser.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBoardStore, normalizeBoard } from '../js/store.js';

function makeEnv({ fetchFn, writeOk = true } = {}) {
  const mem = new Map();
  const stateObj = {
    publishedTasks: [],
    publishedAnnouncements: [],
    progress: {},
    liveBoard: null,
    announcements: [],
    verifiedRevision: 0,
    verifiedDeletedIds: [],
    adminRevision: 0,
    catalog: [],
    draftSubjects: [],
  };
  let seq = 0;
  const store = createBoardStore({
    fetchFn: fetchFn || (async () => ({ ok: false, status: 500, json: async () => null })),
    read: (k, fb) => (mem.has(k) ? mem.get(k) : fb),
    write: (k, v) => { if (!writeOk) return false; mem.set(k, structuredClone(v)); return true; },
    stateObj,
    makeId: () => `op-${++seq}`,
  });
  return { store, stateObj, mem };
}

test('fetchBoard adopts authoritative revision, erases deleted progress, and caches board', async () => {
  let seenInit = null;
  const { store, stateObj, mem } = makeEnv({
    fetchFn: async (url, init) => {
      seenInit = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          schemaVersion: 2,
          revision: 4,
          tasks: [{ id: 't1', title: 'Live' }],
          announcements: [],
          deletedTasks: [{ id: 'gone', deletedAt: 100 }],
        }),
      };
    },
  });
  stateObj.progress = { t1: { status: 'done', movedAt: 10 }, gone: { status: 'done', movedAt: 20 } };

  const out = await store.fetchBoard();
  assert.equal(out.authoritative, true);
  assert.equal(out.offline, false);
  assert.equal(seenInit.url, 'data/current.json');
  assert.equal(seenInit.init.cache, 'no-cache');
  assert.equal(stateObj.verifiedRevision, 4);
  assert.deepEqual(stateObj.verifiedDeletedIds, ['gone']);
  assert.deepEqual(Object.keys(stateObj.progress), ['t1']);
  assert.equal(mem.get('class_tasks_published_cache').revision, 4);
});

test('fetchBoard treats 404 and offline fallback as non-authoritative so progress is never erased', async () => {
  const { store, stateObj } = makeEnv({
    fetchFn: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  });
  stateObj.progress = { t1: { status: 'done', movedAt: 10 } };
  const out404 = await store.fetchBoard();
  assert.equal(out404.authoritative, false);
  assert.equal(out404.offline, false);
  assert.deepEqual(stateObj.progress, { t1: { status: 'done', movedAt: 10 } });

  const env2 = makeEnv({ fetchFn: async () => { throw new Error('offline'); } });
  env2.mem.set('class_tasks_published_cache', { tasks: [{ id: 'c1', title: 'Cached' }], announcements: [] });
  const outOff = await env2.store.fetchBoard();
  assert.equal(outOff.offline, true);
  assert.equal(outOff.authoritative, false);
  assert.equal(outOff.board.tasks[0].id, 'c1');
  assert.equal(env2.stateObj.liveBoard, null);
});

test('applyDeletionAuthority rolls back in-memory progress when storage write fails', () => {
  let warned = 0;
  const { store, stateObj } = makeEnv({ writeOk: false });
  stateObj.progress = { gone: { status: 'done', movedAt: 1 } };
  stateObj.verifiedDeletedIds = ['gone'];
  const res = store.applyDeletionAuthority({ onPersistError: () => warned++ });
  assert.equal(res.ok, false);
  assert.equal(warned, 1);
  assert.deepEqual(stateObj.progress, { gone: { status: 'done', movedAt: 1 } });
});

test('adminAction retries stale_admin_base once with the same operationId and refreshed revision', async () => {
  const calls = [];
  const { store, stateObj } = makeEnv({
    fetchFn: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      if (url.includes('?view=admin')) return { ok: true, status: 200, json: async () => ({ adminRevision: 7 }) };
      const body = JSON.parse(init.body);
      if (body.baseAdminRevision < 7) return { ok: false, status: 409, json: async () => ({ code: 'stale_admin_base' }) };
      return { ok: true, status: 200, json: async () => ({ adminRevision: 8, ok: true }) };
    },
  });
  stateObj.adminRevision = 2;

  const out = await store.adminAction('preset-save', { preset: { name: 'Term 1' } });
  assert.equal(out.ok, true);
  assert.equal(stateObj.adminRevision, 8);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.operationId, calls[2].body.operationId, 'retry keeps identical operationId');
  assert.equal(calls[0].body.baseAdminRevision, 2);
  assert.equal(calls[2].body.baseAdminRevision, 7);
});

test('fetchAdminState coalesces simultaneous ?view=admin reads into one request', async () => {
  let count = 0;
  const { store, stateObj } = makeEnv({
    fetchFn: async () => {
      count++;
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, status: 200, json: async () => ({ adminRevision: 3, binSummaries: [], presets: [] }) };
    },
  });
  const [a, b] = await Promise.all([store.fetchAdminState(), store.fetchAdminState()]);
  assert.equal(count, 1);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(stateObj.adminRevision, 3);
});

test('replaceDraft archives displaced draft-only tasks first and aborts cleanly on archive failure', async () => {
  const archived = [];
  let failArchive = true;
  const { store, stateObj } = makeEnv({
    fetchFn: async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === 'bin-archive') {
        if (failArchive) return { ok: false, status: 503, json: async () => ({ code: 'unavailable' }) };
        archived.push(body.task.id);
        return { ok: true, status: 200, json: async () => ({ binId: 'b1', adminRevision: 2 }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  const FakeTask = { fromJSON: (o) => ({ ...o, toJSON: () => ({ ...o }) }) };
  const myTasks = [FakeTask.fromJSON({ id: 'draft-only', title: 'Unsaved work', subject: '' })];
  stateObj.verifiedDeletedIds = ['perm-del'];

  const failed = await store.replaceDraft(
    { tasks: [{ id: 'perm-del', title: 'Old deleted' }], announcements: [] },
    { myTasks, Task: FakeTask },
  );
  assert.equal(failed.ok, false);
  assert.deepEqual(myTasks.map((t) => t.id), ['draft-only'], 'failed archive leaves draft intact');

  failArchive = false;
  const ok = await store.replaceDraft(
    { tasks: [{ id: 'perm-del', title: 'Old deleted', closedAt: 99, changedAt: 55 }], announcements: [] },
    { myTasks, Task: FakeTask },
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(archived, ['draft-only']);
  assert.equal(ok.recovered.length, 1);
  assert.notEqual(myTasks[0].id, 'perm-del');
  assert.match(myTasks[0].title, /^\[Recovered copy\] Old deleted$/);
  assert.equal(myTasks[0].closedAt, undefined);
  assert.equal(myTasks[0].changedAt, undefined);
});

test('normalizeBoard rejects non-board values and filters invalid announcements', () => {
  assert.equal(normalizeBoard(null), null);
  assert.equal(normalizeBoard([]), null);
  assert.equal(normalizeBoard({ tasks: 'nope' }), null);
  const b = normalizeBoard({
    tasks: [{ id: '1' }, 'junk'],
    announcements: [{ text: 'Hi', createdAt: 100 }, { text: 'Bad', createdAt: NaN }],
  });
  assert.equal(b.tasks.length, 1);
  assert.equal(b.announcements.length, 1);
});
