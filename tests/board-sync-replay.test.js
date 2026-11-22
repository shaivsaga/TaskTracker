import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { nextAuthority, prepareRecoveredDraft } from '../js/recovery.js';
import { createBoardStore } from '../js/store.js';
import { createPublishIntent } from '../js/publish.js';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

function findPhp() {
  for (const cand of [process.env.PHP_BIN, '/opt/lampp/bin/php', '/usr/bin/php', 'php'].filter(Boolean)) {
    const probe = spawnSync(cand, ['-v'], { stdio: 'ignore' });
    if (probe.status === 0) return cand;
  }
  return null;
}

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-sync-replay-'));
  fs.cpSync(path.join(ROOT, 'api'), path.join(dir, 'api'), { recursive: true });
  const boardPhpPath = path.join(dir, 'api', '_board.php');
  const boardPhp = fs.readFileSync(boardPhpPath, 'utf8').replace(
    /function tt_fault\(\$name\)\s*\{\s*return false;\s*\}/,
    `function tt_fault($name) {
      $f = tt_data_dir() . '/.fault';
      if (!is_file($f)) return false;
      $wanted = trim((string)@file_get_contents($f));
      if ($wanted !== $name) return false;
      @unlink($f);
      return true;
    }`,
  );
  fs.writeFileSync(boardPhpPath, boardPhp);

  const token = randomBytes(32).toString('hex');
  fs.mkdirSync(path.join(dir, 'data', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data', 'admin'), { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(
    path.join(dir, 'data', 'sessions', createHash('sha256').update(token).digest('hex') + '.json'),
    JSON.stringify({ created: now, lastSeen: now, expires: now + 3600 }),
  );
  fs.writeFileSync(
    path.join(dir, 'data', 'current.json'),
    JSON.stringify({
      schemaVersion: 2,
      revision: 1,
      operationId: '0'.repeat(32),
      publishedAt: now - 10,
      tasks: [
        { id: 't1', title: 'Task 1', subject: 'CS' },
        { id: 't2', title: 'Task 2', subject: 'CS' },
      ],
      announcements: [],
      subjects: [{ code: 'CS', name: 'Computer Science', color: '#58affc', active: true }],
      deletedTasks: [],
    }),
  );
  return { dir, token };
}

async function startPhp(dir) {
  const exe = findPhp();
  const port = 25000 + Math.floor(Math.random() * 20000);
  const proc = spawn(exe, ['-S', `127.0.0.1:${port}`, '-t', dir], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    const up = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => resolve(false));
    });
    if (up) return { proc, baseUrl: `http://127.0.0.1:${port}` };
    await new Promise((r) => setTimeout(r, 50));
  }
  proc.kill();
  throw new Error('PHP built-in server did not start');
}

function makeCookieFetch(baseUrl, cookie) {
  return (rel, init = {}) => {
    const headers = { ...(init.headers || {}) };
    if (cookie) headers.Cookie = `tt_admin=${cookie}`;
    return globalThis.fetch(`${baseUrl}/${rel.replace(/^\//, '')}`, { ...init, headers });
  };
}

test('TLC trace 1 (js/recovery.js:nextAuthority): refuses any board that drops a previously known deletion marker', () => {
  const accepted1 = nextAuthority(
    { revision: 1, deletedIds: [] },
    { revision: 2, deletedTasks: [{ id: 't1', deletedAt: 100 }] },
  );
  assert.deepEqual(accepted1, { revision: 2, deletedIds: ['t1'] });

  const regressed = nextAuthority(
    accepted1,
    { revision: 3, deletedTasks: [] },
  );
  assert.equal(regressed, null, 'a board missing previously proven deletion marker t1 must be refused');
});

test('TLC trace 2 & 3 (real PHP + js/store.js + js/publish.js): post-rename crash retry replays idempotently, stale admin gets 409, and deleted id cannot resurrect', async (t) => {
  const phpExe = findPhp();
  if (!phpExe) {
    if (process.env.REQUIRE_PHP === '1') assert.fail('PHP executable required when REQUIRE_PHP=1');
    t.skip('PHP binary not available in this environment');
    return;
  }
  const { dir, token } = makeSandbox();
  const { proc, baseUrl } = await startPhp(dir);
  try {
    const adminFetch = makeCookieFetch(baseUrl, token);
    const studentFetch = makeCookieFetch(baseUrl, null);
    const mem = new Map();
    const stuState = {
      publishedTasks: [], publishedAnnouncements: [], progress: { t1: { status: 'done', movedAt: 10 }, t2: { status: 'done', movedAt: 10 } },
      liveBoard: null, announcements: [], verifiedRevision: 0, verifiedDeletedIds: [], adminRevision: 0, catalog: [], draftSubjects: [],
    };
    const stuStore = createBoardStore({
      fetchFn: studentFetch,
      read: (k, fb) => (mem.has(k) ? mem.get(k) : fb),
      write: (k, v) => { mem.set(k, structuredClone(v)); return true; },
      stateObj: stuState,
    });

    // Step 1: Student loads initial revision 1
    const load1 = await stuStore.fetchBoard();
    assert.equal(load1.authoritative, true);
    assert.equal(stuState.verifiedRevision, 1);

    // Step 2 (TLC Trace 2): Admin 1 publishes removal of t1 with a real post-current-rename crash
    fs.writeFileSync(path.join(dir, 'data', '.fault'), 'post-current-rename');
    const intent = createPublishIntent();
    const subjects = [{ code: 'CS', name: 'Computer Science', color: '#58affc', active: true }];
    const draftPayload = {
      schemaVersion: 2,
      baseRevision: 1,
      tasks: [{ id: 't2', title: 'Task 2', subject: 'CS' }],
      announcements: [],
      subjects,
      note: 'Drop t1',
    };
    const intentKey = JSON.stringify(draftPayload);
    const opId1 = intent.operationIdFor(intentKey);

    const crashRes = await adminFetch('api/publish.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draftPayload, operationId: opId1 }),
    });
    const crashBody = await crashRes.json();
    assert.equal(crashRes.status, 500);
    assert.equal(crashBody.code, 'committed_recovery_pending');

    // Retrying with the same intent holds the same operationId -> server recovers pending.json and replays receipt cleanly
    const opIdRetry = intent.operationIdFor(intentKey);
    assert.equal(opIdRetry, opId1, 'retry of identical draft intent must reuse operationId');
    const retryRes = await adminFetch('api/publish.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draftPayload, operationId: opIdRetry }),
    });
    const retryBody = await retryRes.json();
    assert.equal(retryRes.status, 200);
    assert.equal(retryBody.replayed, true);
    assert.equal(retryBody.current.revision, 2);
    // Changing an unused subject changes intentKey so a new operationId is allocated instead of triggering 409 operation_conflict
    const changedSubjectsKey = JSON.stringify({
      ...draftPayload,
      subjects: [...subjects, { code: 'MATH', name: 'Math', color: '#ff8800', active: true }],
    });
    assert.notEqual(intent.operationIdFor(changedSubjectsKey), opId1, 'edited subjects must allocate a fresh operationId');
    intent.clear();

    // Step 3 (TLC Trace 3): Stale Admin 2 still at baseRevision 1 is refused with 409 stale_base
    const staleRes = await adminFetch('api/publish.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 2,
        operationId: 'b'.repeat(32),
        baseRevision: 1,
        tasks: [{ id: 't1', title: 'Stale overwrite', subject: 'CS' }],
        announcements: [],
        subjects,
        note: 'Stale',
      }),
    });
    const staleBody = await staleRes.json();
    assert.equal(staleRes.status, 409);
    assert.equal(staleBody.code, 'stale_base');
    assert.equal(staleBody.latestRevision, 2);

    // Step 4: Admin permanently deletes archived t1 -> server adds deletion marker at revision 3
    const adminStateRes = await adminFetch('api/versions.php?view=admin');
    const adminState = await adminStateRes.json();
    const binItem = adminState.binSummaries.find((b) => b.taskId === 't1');
    assert.ok(binItem, 't1 was archived into recycle bin on publish removal');

    const delRes = await adminFetch('api/versions.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'bin-permanent-delete',
        operationId: 'c'.repeat(32),
        baseAdminRevision: adminState.adminRevision,
        baseRevision: 2,
        binId: binItem.binId,
        confirm: 'DELETE PERMANENTLY',
      }),
    });
    assert.equal(delRes.status, 200);

    // Step 5: Student fetches authoritative board -> t1 progress erased, t2 preserved; resurrection forbidden
    const load3 = await stuStore.fetchBoard();
    assert.equal(load3.authoritative, true);
    assert.equal(stuState.verifiedRevision, 3);
    assert.deepEqual(stuState.verifiedDeletedIds, ['t1']);
    assert.deepEqual(Object.keys(stuState.progress), ['t2']);

    const resurrectRes = await adminFetch('api/publish.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 2,
        operationId: 'd'.repeat(32),
        baseRevision: 3,
        tasks: [{ id: 't1', title: 'Resurrected', subject: 'CS' }, { id: 't2', title: 'Task 2', subject: 'CS' }],
        announcements: [],
        subjects,
        note: 'Bad resurrect',
      }),
    });
    const resurrectBody = await resurrectRes.json();
    assert.equal(resurrectRes.status, 422);
    assert.equal(resurrectBody.code, 'forbidden_identity');

    // prepareRecoveredDraft rewrites t1 to a fresh labelled copy so recovery succeeds cleanly
    const recovered = prepareRecoveredDraft(
      { tasks: [{ id: 't1', title: 'Old t1' }] },
      stuState.verifiedDeletedIds,
      () => 't1-copy',
    );
    assert.equal(recovered.content.tasks[0].id, 't1-copy');
  } finally {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
