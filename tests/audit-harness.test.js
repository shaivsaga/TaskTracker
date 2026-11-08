/**
 * tests/audit-harness.test.js - boundary tests for the real-browser audit harness.
 *
 * These tests need no browser and no network: they start the audit's own static server on an
 * ephemeral loopback port, drive it with raw HTTP paths, and run the audit script as a child
 * process for the launch contract. Everything asserted is observable behaviour - a status code,
 * a body, an exit code - not the source spelling of a guard.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createAuditServer, listen, deriveProgress, resetOwnedStorage, clockScript,
  FIXTURE_INSTANT, OWNED_STORAGE_PREFIX,
} from './e2e/audit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIXTURE = path.join(ROOT, 'tests', 'e2e', 'fixture-board.json');
const AUDIT = path.join(ROOT, 'tests', 'e2e', 'audit.mjs');

async function withServer(root, fn) {
  const server = createAuditServer({ root, fixturePath: FIXTURE });
  await listen(server, 0);
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Raw request target: fetch/URL collapse dot segments before the request leaves the client, and the
// traversal boundary has to be exercised as a server sees it.
function get(base, rawPath) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: rawPath, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function runAudit(args) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [AUDIT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function fakeStorage(entries) {
  const map = new Map(entries);
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

test('safe requests are served from the audit root', async () => {
  await withServer(ROOT, async (base) => {
    const res = await get(base, '/index.html');
    assert.equal(res.status, 200);
    assert.match(res.body, /<!doctype html>/i);
  });
});

test('a same-prefix sibling directory cannot be traversed into', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-audit-boundary-'));
  const root = path.join(base, 'site');
  const sibling = path.join(base, 'site-evil');
  fs.mkdirSync(root);
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(root, 'ok.txt'), 'safe');
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'SIBLING-SECRET');
  try {
    await withServer(root, async (origin) => {
      assert.equal((await get(origin, '/ok.txt')).body, 'safe');
      const escaped = await get(origin, '/%2e%2e/site-evil/secret.txt');
      assert.equal(escaped.status, 404);
      assert.doesNotMatch(escaped.body, /SIBLING-SECRET/);
    });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('a malformed percent escape is a 400 and the server stays alive', async () => {
  await withServer(ROOT, async (base) => {
    assert.equal((await get(base, '/%E0%A4%A')).status, 400);
    const after = await get(base, '/index.html');
    assert.equal(after.status, 200);
    assert.match(after.body, /<!doctype html>/i);
  });
});

test('seeded progress timestamps derive from the frozen fixture instant', () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const progress = deriveProgress(fixture);
  const ids = fixture.tasks.slice(0, 3).map((t) => t.id);
  assert.deepEqual(Object.keys(progress), ids);
  ids.forEach((id, i) => {
    assert.deepEqual(progress[id], { status: 'done', movedAt: FIXTURE_INSTANT - (i + 1) * 3600e3 });
  });
});

test('isolation resets only this app\'s owned keys', () => {
  const storage = fakeStorage([
    ['class_tasks_progress', '{}'],
    ['class_tasks_admin', '1'],
    ['class_tasks_draft', '{}'],
    ['unrelated-app-key', 'keep'],
    ['theme', 'keep'],
  ]);
  const removed = resetOwnedStorage(storage);
  assert.deepEqual(removed.sort(), ['class_tasks_admin', 'class_tasks_draft', 'class_tasks_progress']);
  assert.equal(storage.getItem('class_tasks_admin'), null);
  assert.equal(storage.getItem('unrelated-app-key'), 'keep');
  assert.equal(storage.getItem('theme'), 'keep');
  assert.equal(OWNED_STORAGE_PREFIX, 'class_tasks_');
});

test('the frozen clock returns the fixture instant without breaking explicit dates', () => {
  const [now, constructed, explicit] = vm.runInNewContext(
    clockScript(FIXTURE_INSTANT) + '\n[Date.now(), new Date().getTime(), new Date(2020, 0, 1).getTime()]',
    {},
  );
  assert.equal(now, FIXTURE_INSTANT);
  assert.equal(constructed, FIXTURE_INSTANT);
  assert.equal(explicit, new Date(2020, 0, 1).getTime());
});

test('a missing browser is an optional local SKIP', async () => {
  const missing = path.join(os.tmpdir(), 'tt-audit-no-such-browser-' + process.pid + '.exe');
  const run = await runAudit(['--edge', missing, '--port', '8311']);
  assert.equal(run.code, 0);
  assert.match(run.stdout, /SKIP/);
});

test('a required missing browser fails nonzero', async () => {
  const missing = path.join(os.tmpdir(), 'tt-audit-no-such-browser-' + process.pid + '.exe');
  const run = await runAudit(['--edge', missing, '--require-browser', '--port', '8312']);
  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /no Chromium-family browser/i);
});

test('an installed browser that exits at launch fails nonzero', async () => {
  // The Node binary is a real executable that starts and immediately rejects Edge's flags, so this
  // exercises the failed-launch path without requiring Chromium or a display.
  const run = await runAudit(['--edge', process.execPath, '--port', '8313']);
  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /launch failed/i);
});
