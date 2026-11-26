#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuditServer, listen, FIXTURE_INSTANT } from '../../../../tests/e2e/audit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const FIXTURE_SRC = path.join(ROOT, 'tests', 'e2e', 'fixture-board.json');
const FEATURES = ['class-board', 'status-and-done', 'calendar', 'past-archive', 'task-dialog-and-theme', 'multi-section'];
const KEYS = { Enter: '\uE007', Escape: '\uE00C' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function findExe(candidates) {
  for (const c of candidates) {
    if (!c) continue;
    if (c.includes('/')) {
      if (fs.existsSync(c)) return c;
      continue;
    }
    try {
      const p = execFileSync('which', [c], { encoding: 'utf8' }).trim();
      if (p) return p;
    } catch {}
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function shiftIsoDate(iso, deltaDays) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function buildShiftedFixture() {
  const raw = JSON.parse(fs.readFileSync(FIXTURE_SRC, 'utf8'));
  const now = new Date();
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const fixUtc = new Date(FIXTURE_INSTANT);
  const fixLocal = new Date(fixUtc.getUTCFullYear(), fixUtc.getUTCMonth(), fixUtc.getUTCDate()).getTime();
  const deltaDays = Math.round((todayLocal - fixLocal) / 864e5);
  const deltaMs = deltaDays * 864e5;

  const shifted = {
    ...raw,
    tasks: (raw.tasks || []).map((t) => ({
      ...t,
      ...(t.dueDate ? { dueDate: shiftIsoDate(t.dueDate, deltaDays) } : {}),
      ...(t.endDate ? { endDate: shiftIsoDate(t.endDate, deltaDays) } : {}),
      ...(typeof t.closedAt === 'number' ? { closedAt: t.closedAt + deltaMs } : {}),
    })),
    announcements: (raw.announcements || []).map((a) => ({
      ...a,
      ...(typeof a.createdAt === 'number' ? { createdAt: a.createdAt + deltaMs } : {}),
    })),
  };

  const tmpPath = path.join(os.tmpdir(), `verify-tt-fixture-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(shifted));
  return tmpPath;
}

const PUBLIC_TOP_FILES = new Set([
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/logic.js',
  '/attachments.js',
  '/qr-draw.js',
  '/qrcode.js',
  '/favicon.ico',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/data/current.json',
]);

const PUBLIC_API_ROUTES = new Set([
  '/api/login.php',
  '/api/logout.php',
  '/api/publish.php',
  '/api/upload.php',
  '/api/versions.php',
]);

export function isAllowedPublicPath(urlPath) {
  const clean = String(urlPath || '/').split('?')[0].split('#')[0];
  if (PUBLIC_TOP_FILES.has(clean)) return true;
  if (PUBLIC_API_ROUTES.has(clean)) return true;
  if (/^\/js\/[A-Za-z0-9._-]+\.js$/.test(clean)) return true;
  if (/^\/assets\/(?:sprites-(?:light|dark)\.svg|fonts\/[A-Za-z0-9._-]+\.(?:woff2?|ttf|otf))$/.test(clean)) return true;
  return false;
}

async function withServer(explicitUrl, fn) {
  if (explicitUrl) return fn(String(explicitUrl).replace(/\/$/, ''));
  const fixturePath = buildShiftedFixture();
  const port = await freePort();
  const auditServer = createAuditServer({ root: ROOT, fixturePath });
  const server = http.createServer((req, res) => {
    const rawUrl = req.url || '/';
    const secMatch = /^\/s\/[a-z0-9][a-z0-9_-]{0,31}\/[a-f0-9]{32}(\/.*)?$/i.exec(rawUrl);
    if (secMatch) {
      const rest = secMatch[1] || '/index.html';
      if (rest.startsWith('/transfer.php?t=')) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ payload: { v: 1, section: 'a', progress: { fx001: { status: 'done', movedAt: 1700000000000 } } } }));
        return;
      }
      req.url = rest === '/' ? '/index.html' : rest;
    }
    if (!isAllowedPublicPath(req.url)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    auditServer.emit('request', req, res);
  });
  await listen(server, port);
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
    try { fs.unlinkSync(fixturePath); } catch {}
  }
}

const BASE_TMP = fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
const GD_STATE_FILE = path.join(BASE_TMP, 'verify-tasktracker-geckodriver.json');

async function wdReq(base, method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`WebDriver ${method} ${p} -> ${res.status}: ${json?.value?.message || text}`);
  return json.value;
}

async function gdReady(base) {
  try {
    const res = await fetch(`${base}/status`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const json = await res.json();
    return json?.value?.ready === true;
  } catch {
    return false;
  }
}

async function withGeckodriver(explicitUrl, fn) {
  if (explicitUrl) {
    const base = String(explicitUrl).replace(/\/$/, '');
    if (!(await gdReady(base))) throw new Error(`geckodriver is not ready at ${base}`);
    const ctx = { base, reused: true, teardownNote: null };
    await fn(ctx);
    return ctx;
  }

  try {
    const saved = JSON.parse(fs.readFileSync(GD_STATE_FILE, 'utf8'));
    if (saved?.url && (await gdReady(saved.url))) {
      const ctx = { base: saved.url, reused: true, teardownNote: null };
      await fn(ctx);
      return ctx;
    }
    try { fs.unlinkSync(GD_STATE_FILE); } catch {}
  } catch {}

  const gecko = findExe([process.env.GECKODRIVER, '/snap/bin/geckodriver', '/usr/bin/geckodriver', 'geckodriver']);
  if (!gecko) throw new Error('geckodriver not found');
  const port = await freePort();
  const wsPort = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(gecko, ['--port', String(port), '--websocket-port', String(wsPort)], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (c) => { stderr += c.toString(); });

  const ctx = { base, reused: false, teardownNote: null };
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (proc.exitCode !== null) throw new Error(`geckodriver exited early (${proc.exitCode}): ${stderr}`);
      if (await gdReady(base)) { ready = true; break; }
      await sleep(200);
    }
    if (!ready) throw new Error(`geckodriver did not respond on port ${port}: ${stderr}`);
    await fn(ctx);
    return ctx;
  } finally {
    if (proc.exitCode === null) {
      let sigErr = null;
      try {
        proc.kill('SIGTERM');
      } catch (err) {
        sigErr = err;
      }
      if (!sigErr) {
        await Promise.race([
          new Promise((r) => proc.once('exit', r)),
          sleep(3000).then(() => {
            if (proc.exitCode === null) {
              try { proc.kill('SIGKILL'); } catch {}
            }
          }),
        ]);
        try {
          const cur = JSON.parse(fs.readFileSync(GD_STATE_FILE, 'utf8'));
          if (cur?.pid === proc.pid) fs.unlinkSync(GD_STATE_FILE);
        } catch {}
      } else if (sigErr.code === 'EACCES') {
        const tmpState = `${GD_STATE_FILE}.${process.pid}.tmp`;
        try {
          fs.writeFileSync(tmpState, JSON.stringify({ pid: proc.pid, port, url: base }));
          fs.renameSync(tmpState, GD_STATE_FILE);
        } catch {
          try { fs.unlinkSync(tmpState); } catch {}
        }
        proc.stderr?.destroy();
        proc.unref();
        ctx.teardownNote = 'geckodriver signal blocked by snap AppArmor (EACCES); Firefox sessions closed cleanly and idle daemon recorded for reuse';
      } else {
        throw sigErr;
      }
    }
  }
}

async function withSession(base, { zoom = 1.0 }, fn) {
  const wd = (method, p, body) => wdReq(base, method, p, body);
  const useBidi = Number(zoom) === 1;
  let sid = null;
  let ws = null;
  try {
    const session = await wd('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          ...(useBidi ? { webSocketUrl: true } : {}),
          'moz:firefoxOptions': {
            args: ['-headless'],
            prefs: { 'layout.css.devPixelsPerPx': String(zoom) },
          },
        },
      },
    });
    sid = session.sessionId;

    let bidi = null;
    let ctxId = null;
    if (useBidi) {
      const wsUrl = session.capabilities?.webSocketUrl;
      if (!wsUrl) throw new Error('Firefox session did not expose WebDriver BiDi webSocketUrl');

      ws = new WebSocket(wsUrl);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('BiDi WebSocket open timed out')), 10000);
        ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error(e.message || 'BiDi WebSocket failed')); }, { once: true });
      });

      let bidiId = 1;
      bidi = (method, params = {}) => new Promise((resolve, reject) => {
        const id = bidiId++;
        const onMsg = (ev) => {
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg.id !== id) return;
          clearTimeout(timer);
          ws.removeEventListener('message', onMsg);
          if (msg.error) reject(new Error(`BiDi ${method}: ${msg.message || msg.error}`));
          else resolve(msg.result);
        };
        const timer = setTimeout(() => {
          ws.removeEventListener('message', onMsg);
          reject(new Error(`BiDi ${method} timed out`));
        }, 10000);
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id, method, params }));
      });
      const tree = await bidi('browsingContext.getTree', {});
      ctxId = tree.contexts[0].context;
    }

    const exec = (fnOrBody, ...args) => {
      const script = typeof fnOrBody === 'function'
        ? `return (${fnOrBody}).apply(null, arguments);`
        : fnOrBody;
      return wd('POST', `/session/${sid}/execute/sync`, { script, args });
    };

    const waitFor = async (fnOrBody, args = [], timeoutMs = 6000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const val = await exec(fnOrBody, ...args);
        if (val) return val;
        await sleep(100);
      }
      throw new Error('waitFor timed out');
    };

    const driver = {
      async open(u) {
        await wd('POST', `/session/${sid}/url`, { url: u });
        await waitFor(() => document.readyState === 'complete');
        await exec(() => {
          if (window.__ttErrHooked) return;
          window.__ttErrHooked = true;
          window.__ttErrors = [];
          window.addEventListener('error', (e) => window.__ttErrors.push(e.message || 'window error'));
          window.addEventListener('unhandledrejection', (e) => window.__ttErrors.push(String(e.reason || 'unhandledrejection')));
          const orig = console.error.bind(console);
          console.error = (...a) => { window.__ttErrors.push(a.map(String).join(' ')); orig(...a); };
        });
      },
      async collectErrors() {
        try { return (await exec(() => window.__ttErrors || [])) || []; } catch { return []; }
      },
      async resize(w, h) {
        if (w < 500 && bidi) {
          await bidi('browsingContext.setViewport', { context: ctxId, viewport: { width: w, height: h } });
        } else {
          if (bidi) await bidi('browsingContext.setViewport', { context: ctxId, viewport: null });
          await wd('POST', `/session/${sid}/window/rect`, { width: w, height: h });
          if (useBidi) {
            const box = await exec(() => ({ iw: window.innerWidth, ih: window.innerHeight }));
            const dw = w - box.iw;
            const dh = h - box.ih;
            if (dw !== 0 || dh !== 0) {
              await wd('POST', `/session/${sid}/window/rect`, { width: w + dw, height: h + dh });
            }
          }
        }
        return exec(() => ({ iw: window.innerWidth, ih: window.innerHeight }));
      },
      exec,
      waitFor,
      async find(css) {
        const el = await wd('POST', `/session/${sid}/element`, { using: 'css selector', value: css });
        return Object.values(el)[0];
      },
      async click(css) {
        const id = await driver.find(css);
        await wd('POST', `/session/${sid}/element/${id}/click`, {});
      },
      async type(css, text) {
        const id = await driver.find(css);
        await wd('POST', `/session/${sid}/element/${id}/value`, { text: String(text) });
      },
      async pressKey(k) {
        const v = KEYS[k] || k;
        await wd('POST', `/session/${sid}/actions`, {
          actions: [{
            type: 'key',
            id: 'keyboard',
            actions: [{ type: 'keyDown', value: v }, { type: 'keyUp', value: v }],
          }],
        });
      },
      async shot(filePath) {
        const b64 = await wd('GET', `/session/${sid}/screenshot`);
        fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
      },
      async resetStorage(extra = {}) {
        await exec((pairs) => {
          Object.keys(localStorage).filter((k) => /^(?:[a-z0-9][a-z0-9_-]{0,31}_)?class_tasks_/.test(k)).forEach((k) => localStorage.removeItem(k));
          for (const [k, v] of Object.entries(pairs)) localStorage.setItem(k, String(v));
        }, extra);
      },
    };

    return await fn(driver);
  } finally {
    if (ws) {
      try { ws.close(); } catch {}
    }
    if (sid) {
      try { await wd('DELETE', `/session/${sid}`); } catch {}
    }
  }
}

async function runDoctor() {
  const required = ['index.html', 'styles.css', 'app.js', 'tests/e2e/fixture-board.json'];
  const missing = required.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  const gecko = findExe([process.env.GECKODRIVER, '/snap/bin/geckodriver', '/usr/bin/geckodriver', 'geckodriver']);
  const ff = findExe(['firefox', '/usr/bin/firefox']);
  const php = findExe(['/opt/lampp/bin/php', 'php']);
  const version = (bin, flag) => {
    if (!bin) return null;
    try { return execFileSync(bin, [flag], { encoding: 'utf8' }).trim().split('\n')[0]; } catch { return null; }
  };

  let probe = { ok: false };
  try {
    await withServer(null, async (baseUrl) => {
      const rootRes = await fetch(baseUrl + '/index.html');
      const curRes = await fetch(baseUrl + '/data/current.json');
      const secRes = await fetch(baseUrl + '/data/secret.json');
      const curJson = await curRes.json();
      probe = {
        ok: rootRes.status === 200 && curRes.status === 200 && secRes.status === 404 && Array.isArray(curJson.tasks),
        rootStatus: rootRes.status,
        currentStatus: curRes.status,
        secretStatus: secRes.status,
        fixtureTasks: curJson.tasks.length,
      };
    });
  } catch (e) {
    probe = { ok: false, error: e.message };
  }

  const out = {
    ok: missing.length === 0 && !!gecko && !!ff && probe.ok,
    root: ROOT,
    missing,
    node: process.version,
    firefox: { bin: ff, version: version(ff, '--version') },
    geckodriver: { bin: gecko, version: version(gecko, '--version') },
    php: { bin: php, version: version(php, '-v') },
    ephemeralServerProbe: probe,
    dataDirPresent: fs.existsSync(path.join(ROOT, 'data')),
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

async function runFeature(feature, baseUrl, outDir, gdBase, ctx) {
  const { check, artifacts, errors } = ctx;
  const recordErrors = async (d, label) => {
    const errs = await d.collectErrors();
    errs.forEach((m) => errors.push(`${feature}:${label}: ${m}`));
  };

  if (feature === 'class-board') {
    await withSession(gdBase,{ zoom: 1.0 }, async (d) => {
      await d.resize(1280, 800);
      await d.open(baseUrl + '/index.html');
      await d.resetStorage();
      await d.open(baseUrl + '/index.html');
      await d.waitFor(() => document.querySelectorAll('#class-task-list .task-row').length > 0);

      const initial = await d.exec(() => ({
        cueVisible: !document.getElementById('tour-cue').hidden,
        tourHidden: document.getElementById('tour-overlay').hidden,
        buckets: document.querySelectorAll('#class-task-list .list-bucket').length,
        mineVisible: !document.getElementById('mine').hidden,
        mineCount: Number(document.getElementById('mine-n').textContent || '0'),
        rows: document.querySelectorAll('#class-task-list .task-row').length,
      }));
      check(feature, 'opt-in-cue', initial.cueVisible && initial.tourHidden,
        `cueVisible=${initial.cueVisible} tourHidden=${initial.tourHidden}`);
      check(feature, 'urgency-buckets-and-mine', initial.buckets >= 2 && initial.mineVisible && initial.mineCount > 0,
        `buckets=${initial.buckets} mineCount=${initial.mineCount} rows=${initial.rows}`);

      await d.click('#class-task-list .task-row .task-row-title');
      await d.waitFor(() => !document.getElementById('task-dialog-overlay').hidden);
      const afterFirstClick = await d.exec(() => ({
        dialogOpen: !document.getElementById('task-dialog-overlay').hidden,
        tourHidden: document.getElementById('tour-overlay').hidden,
      }));
      check(feature, 'first-click-no-tour-hijack', afterFirstClick.dialogOpen && afterFirstClick.tourHidden,
        `dialogOpen=${afterFirstClick.dialogOpen} tourHidden=${afterFirstClick.tourHidden}`);
      await d.pressKey('Escape');
      await d.waitFor(() => document.getElementById('task-dialog-overlay').hidden);

      await d.click('#tour-cue-dismiss');
      await d.waitFor(() => document.getElementById('tour-cue').hidden);
      const dismissed = await d.exec(() => localStorage.getItem('class_tasks_tour_seen') === '1');
      check(feature, 'dismiss-cue-persists', dismissed, `tourSeen=${dismissed}`);

      const listPng = path.join(outDir, 'class-board-list.png');
      await d.shot(listPng);
      artifacts.push(listPng);

      await d.pressKey('/');
      const focusedSearch = await d.exec(() => document.activeElement && document.activeElement.id);
      check(feature, 'slash-focuses-search', focusedSearch === 'class-task-search', `activeId=${focusedSearch}`);

      await d.click('#class-subject-filter');
      await d.click('#class-subject-filter option[value="GENSCI"]');
      await sleep(150);
      const filteredList = await d.exec(() => ({
        subject: document.getElementById('class-subject-filter').value,
        rows: document.querySelectorAll('#class-task-list .task-row').length,
      }));
      await d.click('#page-class-tasks .view-tab[data-view="board"]');
      await sleep(200);
      const boardState = await d.exec(() => ({
        view: document.getElementById('page-class-tasks').dataset.view,
        cards: document.querySelectorAll('#class-board .task-card').length,
        statusFilterDisplay: getComputedStyle(document.getElementById('class-status-filter')).display,
        subjectFilterDisplay: getComputedStyle(document.getElementById('class-subject-filter')).display,
      }));
      check(feature, 'subject-filter-persists-on-board',
        filteredList.subject === 'GENSCI' && filteredList.rows > 0 && boardState.view === 'board'
        && boardState.cards === filteredList.rows && boardState.statusFilterDisplay === 'none' && boardState.subjectFilterDisplay !== 'none',
        `listRows=${filteredList.rows} boardCards=${boardState.cards} statusDisp=${boardState.statusFilterDisplay}`);

      const boardPng = path.join(outDir, 'class-board-filtered.png');
      await d.shot(boardPng);
      artifacts.push(boardPng);
      await recordErrors(d, 'desktop');
    });
    return;
  }

  if (feature === 'status-and-done') {
    await withSession(gdBase,{ zoom: 1.0 }, async (d) => {
      await d.resize(1280, 800);
      await d.open(baseUrl + '/index.html');
      await d.resetStorage({ class_tasks_tour_seen: '1' });
      await d.open(baseUrl + '/index.html');
      await d.waitFor(() => document.querySelectorAll('#class-task-list .task-row').length > 0);

      const targetId = await d.exec(() => document.querySelector('#class-task-list .task-row').dataset.taskId);
      await d.click(`#class-task-list .task-row[data-task-id="${targetId}"] .status-check`);
      await d.waitFor(() => {
        const p = document.querySelector('.status-popover[aria-label="Status"]');
        return p && !p.hidden;
      });
      const popPng = path.join(outDir, 'status-popover.png');
      await d.shot(popPng);
      artifacts.push(popPng);

      await d.exec(() => {
        const opts = [...document.querySelectorAll('.status-popover[aria-label="Status"] .status-option')];
        const doneOpt = opts.find((o) => /Done/.test(o.textContent));
        if (doneOpt) doneOpt.click();
      });
      await d.waitFor((id) => {
        const p = JSON.parse(localStorage.getItem('class_tasks_progress') || '{}');
        return p[id] && p[id].status === 'done';
      }, [targetId]);
      const afterDone = await d.exec((id) => {
        const p = JSON.parse(localStorage.getItem('class_tasks_progress') || '{}');
        const toast = document.getElementById('toast');
        return {
          status: p[id] && p[id].status,
          toastVisible: toast && !toast.hidden,
          toastText: document.getElementById('toast-message')?.textContent || '',
        };
      }, targetId);
      check(feature, 'popover-marks-done', afterDone.status === 'done' && afterDone.toastVisible,
        `task=${targetId} status=${afterDone.status} toast="${afterDone.toastText}"`);

      await d.click('nav a[href="#done"]');
      await d.waitFor((id) => !!document.querySelector(`#done-list .done-row[data-task-id="${id}"]`), [targetId]);
      await d.open(baseUrl + '/index.html#done');
      await d.waitFor((id) => !!document.querySelector(`#done-list .done-row[data-task-id="${id}"]`), [targetId]);

      const doneRow = await d.exec((id) => {
        const row = document.querySelector(`#done-list .done-row[data-task-id="${id}"]`);
        const icon = row.querySelector('.status-check.is-done.is-static');
        const btns = [...row.querySelectorAll('button.text-button')];
        return {
          persisted: !!row,
          staticIconTag: icon ? icon.tagName : null,
          reopenCount: btns.length,
          reopenText: btns[0] ? btns[0].textContent.trim() : null,
        };
      }, targetId);
      check(feature, 'done-persists-and-single-reopen',
        doneRow.persisted && doneRow.staticIconTag === 'SPAN' && doneRow.reopenCount === 1 && doneRow.reopenText === 'Mark not done',
        JSON.stringify(doneRow));

      const donePng = path.join(outDir, 'done-reopen.png');
      await d.shot(donePng);
      artifacts.push(donePng);

      await d.click(`#done-list .done-row[data-task-id="${targetId}"] button.text-button`);
      const armed = await d.exec((id) => {
        const b = document.querySelector(`#done-list .done-row[data-task-id="${id}"] button.text-button`);
        return b ? { text: b.textContent.trim(), armed: b.dataset.armed } : null;
      }, targetId);
      await d.click(`#done-list .done-row[data-task-id="${targetId}"] button.text-button`);
      await d.waitFor((id) => !document.querySelector(`#done-list .done-row[data-task-id="${id}"]`), [targetId]);
      const reopened = await d.exec((id) => {
        const p = JSON.parse(localStorage.getItem('class_tasks_progress') || '{}');
        return { rowGone: !document.querySelector(`#done-list .done-row[data-task-id="${id}"]`), status: p[id]?.status };
      }, targetId);
      check(feature, 'reopen-arms-then-restores',
        armed?.text === 'Confirm?' && armed?.armed === '1' && reopened.rowGone && reopened.status === 'not_started',
        `armed=${JSON.stringify(armed)} reopened=${JSON.stringify(reopened)}`);
      await recordErrors(d, 'desktop');
    });
    return;
  }

  if (feature === 'calendar') {
    await withSession(gdBase,{ zoom: 0.9 }, async (d) => {
      await d.resize(1280, 800);
      await d.open(baseUrl + '/index.html#calendar');
      await d.resetStorage({ class_tasks_tour_seen: '1', class_tasks_theme: 'light' });
      await d.open(baseUrl + '/index.html#calendar');
      await d.waitFor(() => document.querySelectorAll('.cal-day').length >= 28);

      const lightCal = await d.exec(() => {
        const day = document.querySelector('.cal-day');
        const cs = getComputedStyle(day);
        return {
          days: document.querySelectorAll('.cal-day').length,
          gap: getComputedStyle(document.querySelector('.cal')).gap,
          borderRight: parseFloat(cs.borderRightWidth),
          borderBottom: parseFloat(cs.borderBottomWidth),
          theme: document.documentElement.dataset.theme || 'light',
        };
      });
      check(feature, 'desktop-90-light-borders',
        lightCal.days >= 28 && lightCal.gap === '0px' && lightCal.borderRight > 0 && lightCal.borderBottom > 0,
        JSON.stringify(lightCal));
      const lightPng = path.join(outDir, 'calendar-light-90.png');
      await d.shot(lightPng);
      artifacts.push(lightPng);

      await d.click('#theme-toggle');
      await sleep(150);
      const darkCal = await d.exec(() => {
        const day = document.querySelector('.cal-day');
        const cs = getComputedStyle(day);
        return {
          theme: document.documentElement.dataset.theme,
          borderRight: parseFloat(cs.borderRightWidth),
          borderBottom: parseFloat(cs.borderBottomWidth),
        };
      });
      check(feature, 'desktop-90-dark-borders',
        darkCal.theme === 'dark' && darkCal.borderRight > 0 && darkCal.borderBottom > 0,
        JSON.stringify(darkCal));
      const darkPng = path.join(outDir, 'calendar-dark-90.png');
      await d.shot(darkPng);
      artifacts.push(darkPng);
      await recordErrors(d, 'desktop90');
    });

    await withSession(gdBase,{ zoom: 1.0 }, async (d) => {
      const vp = await d.resize(390, 844);
      await d.open(baseUrl + '/index.html#calendar');
      await d.resetStorage({ class_tasks_tour_seen: '1' });
      await d.open(baseUrl + '/index.html#calendar');
      await d.waitFor(() => document.querySelectorAll('.cal-day.is-tappable').length >= 28);

      const picked = await d.exec(() => {
        const cell = [...document.querySelectorAll('.cal-day.is-tappable')].find((c) => c.querySelector('.cal-dot'));
        if (!cell) return null;
        cell.click();
        return cell.dataset.date || 'clicked';
      });
      await sleep(150);
      const agenda = await d.exec(() => ({
        title: document.querySelector('#cal-agenda .cal-agenda-title')?.textContent || '',
        chips: document.querySelectorAll('#cal-agenda .cal-chip').length,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      }));
      check(feature, 'phone-dot-tap-updates-agenda', vp.iw === 390 && !!picked && agenda.title.length > 0 && agenda.chips > 0 && !agenda.overflowX,
        `vp=${vp.iw}x${vp.ih} picked=${picked} agenda=${JSON.stringify(agenda)}`);
      const phonePng = path.join(outDir, 'calendar-phone.png');
      await d.shot(phonePng);
      artifacts.push(phonePng);
      await recordErrors(d, 'phone');
    });
    return;
  }

  if (feature === 'past-archive') {
    await withSession(gdBase,{ zoom: 1.0 }, async (d) => {
      await d.resize(1280, 800);
      await d.open(baseUrl + '/index.html#past');
      await d.resetStorage({ class_tasks_tour_seen: '1' });
      await d.open(baseUrl + '/index.html#past');
      await d.waitFor(() => document.querySelectorAll('#past-list .past-row').length > 0);

      const desktop = await d.exec(() => {
        const rows = [...document.querySelectorAll('#past-list .past-row')];
        return {
          count: rows.length,
          allHaveFourChildren: rows.every((r) => r.children.length === 4),
          zeroChecks: rows.every((r) => r.querySelectorAll('.status-check').length === 0),
          labels: rows.map((r) => r.querySelector('.task-row-due')?.textContent.trim()),
          overflowX: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      const validLabels = desktop.labels.every((l) => l === 'No due date' || /^[A-Z][a-z]{2}\s+\d{1,2}(?:\s*[–-]\s*(?:[A-Z][a-z]{2}\s+)?\d{1,2})?$/.test(l));
      check(feature, 'desktop-past-labels-and-structure',
        desktop.count > 0 && desktop.allHaveFourChildren && desktop.zeroChecks && validLabels && !desktop.overflowX,
        JSON.stringify(desktop));
      const dPng = path.join(outDir, 'past-desktop.png');
      await d.shot(dPng);
      artifacts.push(dPng);

      const vp = await d.resize(320, 568);
      await sleep(150);
      const phone = await d.exec(() => ({
        iw: window.innerWidth,
        sw: document.documentElement.scrollWidth,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      }));
      check(feature, 'phone-320-no-overflow', vp.iw === 320 && !phone.overflowX, `vp=${vp.iw}x${vp.ih} sw=${phone.sw}`);
      const pPng = path.join(outDir, 'past-phone-320.png');
      await d.shot(pPng);
      artifacts.push(pPng);
      await recordErrors(d, 'desktop+320');
    });
    return;
  }

  if (feature === 'task-dialog-and-theme') {
    await withSession(gdBase,{ zoom: 1.0 }, async (d) => {
      await d.resize(1280, 800);
      await d.open(baseUrl + '/index.html');
      await d.resetStorage({ class_tasks_tour_seen: '1' });
      await d.open(baseUrl + '/index.html');
      await d.waitFor(() => document.querySelectorAll('#class-task-list .task-row').length > 0);

      const expectedTitle = await d.exec(() => {
        const btn = document.querySelector('#class-task-list .task-row .task-row-title');
        btn.focus();
        return btn.textContent.trim();
      });
      await d.pressKey('Enter');
      await d.waitFor(() => !document.getElementById('task-dialog-overlay').hidden);

      const dlg = await d.exec(() => {
        const card = document.querySelector('#task-dialog-overlay .task-dialog');
        const footer = card.querySelector('.dialog-footer');
        return {
          readonly: card.classList.contains('is-readonly'),
          ariaLabel: card.getAttribute('aria-label'),
          footerDisplay: getComputedStyle(footer).display,
        };
      });
      check(feature, 'readonly-dialog-name-and-footer',
        dlg.readonly && dlg.ariaLabel === expectedTitle && dlg.footerDisplay === 'none',
        `expected="${expectedTitle}" got=${JSON.stringify(dlg)}`);
      const dlgPng = path.join(outDir, 'task-dialog-readonly.png');
      await d.shot(dlgPng);
      artifacts.push(dlgPng);

      await d.pressKey('Escape');
      await d.waitFor(() => document.getElementById('task-dialog-overlay').hidden);
      const afterEsc = await d.exec(() => ({
        hidden: document.getElementById('task-dialog-overlay').hidden,
        activeTag: document.activeElement ? document.activeElement.tagName : null,
      }));
      check(feature, 'escape-restores-focus', afterEsc.hidden && afterEsc.activeTag !== 'BODY', JSON.stringify(afterEsc));

      const beforeTheme = await d.exec(() => ({
        theme: document.documentElement.dataset.theme || 'light',
        bg: getComputedStyle(document.body).backgroundColor,
      }));
      await d.click('#theme-toggle');
      await sleep(150);
      const afterTheme = await d.exec(() => ({
        theme: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.body).backgroundColor,
        saved: localStorage.getItem('class_tasks_theme'),
      }));
      await d.open(baseUrl + '/index.html');
      await d.waitFor(() => document.querySelectorAll('#class-task-list .task-row').length > 0);
      const persistedTheme = await d.exec(() => document.documentElement.dataset.theme);
      check(feature, 'theme-toggle-and-persists',
        afterTheme.theme !== beforeTheme.theme && afterTheme.bg !== beforeTheme.bg
        && afterTheme.saved === afterTheme.theme && persistedTheme === afterTheme.theme,
        `before=${JSON.stringify(beforeTheme)} after=${JSON.stringify(afterTheme)} reload=${persistedTheme}`);
      const themePng = path.join(outDir, 'theme-switched.png');
      await d.shot(themePng);
      artifacts.push(themePng);
      await recordErrors(d, 'desktop');
    });
    return;
  }

  if (feature === 'multi-section') {
    const secBPath = '/s/b/0123456789abcdef0123456789abcdef';
    await withSession(gdBase, { zoom: 1.0 }, async (d) => {
      await d.resize(1280, 800);
      await d.open(baseUrl + '/index.html');
      await d.resetStorage({ class_tasks_tour_seen: '1' });
      await d.open(baseUrl + '/index.html');
      await d.waitFor(() => document.querySelectorAll('#class-task-list .task-row').length > 0);

      const secA = await d.exec(() => ({
        badges: document.querySelectorAll('[data-section-badge]').length,
        brandAria: document.querySelector('.tb .brand')?.getAttribute('aria-label') || '',
      }));
      check(feature, 'section-a-no-badge', secA.badges === 0 && secA.brandAria === 'TaskTracker home', JSON.stringify(secA));

      await d.open(baseUrl + secBPath + '/index.html');
      await d.waitFor(() => document.querySelectorAll('#class-task-list .task-row').length > 0);
      const secBDesk = await d.exec(() => ({
        badgeText: document.querySelector('.tb .brand [data-section-badge="b"]')?.textContent.trim() || '',
        brandAria: document.querySelector('.tb .brand')?.getAttribute('aria-label') || '',
      }));
      const deskPng = path.join(outDir, 'section-b-desktop.png');
      await d.shot(deskPng);
      artifacts.push(deskPng);

      const vp = await d.resize(390, 844);
      await sleep(150);
      const secBPhone = await d.exec(() => ({
        badgeText: document.querySelector('.brand-m [data-section-badge="b"]')?.textContent.trim() || '',
        brandAria: document.querySelector('.brand-m')?.getAttribute('aria-label') || '',
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      }));
      const phonePng = path.join(outDir, 'section-b-phone.png');
      await d.shot(phonePng);
      artifacts.push(phonePng);
      check(feature, 'section-b-badge-desktop-and-phone',
        secBDesk.badgeText === 'SECTION B' && secBDesk.brandAria === 'TaskTracker SECTION B home'
        && vp.iw === 390 && secBPhone.badgeText === 'SECTION B' && secBPhone.brandAria === 'TaskTracker SECTION B home' && !secBPhone.overflowX,
        `desktop=${JSON.stringify(secBDesk)} phone=${JSON.stringify(secBPhone)}`);

      await d.resize(1280, 800);
      await d.resetStorage({
        class_tasks_tour_seen: '1',
        class_tasks_theme: 'dark',
        class_tasks_progress: JSON.stringify({ fx002: { status: 'in_progress', movedAt: 1700000000000 } }),
      });
      await d.open(baseUrl + secBPath + '/index.html');
      await d.waitFor(() => document.querySelectorAll('#class-task-list .task-row').length > 0);

      const targetId = await d.exec(() => document.querySelector('#class-task-list .task-row').dataset.taskId);
      await d.click(`#class-task-list .task-row[data-task-id="${targetId}"] .status-check`);
      await d.waitFor(() => {
        const p = document.querySelector('.status-popover[aria-label="Status"]');
        return p && !p.hidden;
      });
      await d.exec(() => {
        const opts = [...document.querySelectorAll('.status-popover[aria-label="Status"] .status-option')];
        const doneOpt = opts.find((o) => /Done/.test(o.textContent));
        if (doneOpt) doneOpt.click();
      });
      await d.waitFor((id) => {
        const p = JSON.parse(localStorage.getItem('b_class_tasks_progress') || '{}');
        return p[id]?.status === 'done';
      }, [targetId]);
      await d.open(baseUrl + secBPath + '/index.html');
      await d.waitFor(() => document.querySelectorAll('#class-task-list .task-row').length > 0);

      const beforeReset = await d.exec((id) => ({
        bDone: JSON.parse(localStorage.getItem('b_class_tasks_progress') || '{}')[id]?.status || null,
        aProg: JSON.parse(localStorage.getItem('class_tasks_progress') || '{}').fx002?.status || null,
      }), targetId);

      await d.click('#settings-open');
      await d.waitFor(() => !document.getElementById('settings-overlay').hidden);
      await d.click('#settings-reset-start');
      await d.waitFor(() => !document.getElementById('settings-reset-form').hidden);
      await d.type('#settings-reset-input', 'RESET');
      await d.waitFor(() => !document.getElementById('settings-reset-submit').disabled);
      await d.click('#settings-reset-submit');
      await d.waitFor(() => localStorage.getItem('b_class_tasks_progress') === null);
      await d.waitFor(() => document.readyState === 'complete' && document.querySelectorAll('#class-task-list .task-row').length > 0);

      const afterReset = await d.exec(() => ({
        bProg: localStorage.getItem('b_class_tasks_progress'),
        aProg: JSON.parse(localStorage.getItem('class_tasks_progress') || '{}').fx002?.status || null,
        theme: localStorage.getItem('class_tasks_theme'),
      }));
      check(feature, 'section-b-storage-isolation-and-reset',
        beforeReset.bDone === 'done' && beforeReset.aProg === 'in_progress'
        && afterReset.bProg === null && afterReset.aProg === 'in_progress' && afterReset.theme === 'dark',
        `before=${JSON.stringify(beforeReset)} after=${JSON.stringify(afterReset)}`);

      await d.click('#theme-toggle');
      await sleep(150);
      const toggledTheme = await d.exec(() => ({
        theme: document.documentElement.dataset.theme,
        saved: localStorage.getItem('class_tasks_theme'),
      }));
      await d.open(baseUrl + '/index.html');
      await d.waitFor(() => document.querySelectorAll('#class-task-list .task-row').length > 0);
      const themeOnA = await d.exec(() => document.documentElement.dataset.theme);
      check(feature, 'section-b-theme-device-wide',
        toggledTheme.theme === 'light' && toggledTheme.saved === 'light' && themeOnA === 'light',
        `toggled=${JSON.stringify(toggledTheme)} onA=${themeOnA}`);

      await d.open(baseUrl + secBPath + '/index.html');
      await d.waitFor(() => document.querySelectorAll('#class-task-list .task-row').length > 0);
      const seedB = JSON.stringify({ fx003: { status: 'in_progress', movedAt: 1700000000000 } });
      await d.exec((s) => localStorage.setItem('b_class_tasks_progress', s), seedB);
      await d.open(baseUrl + secBPath + '/index.html?transfer=abcdef0123456789abcdef0123456789');
      await d.waitFor(() => {
        const t = document.getElementById('toast');
        return t && !t.hidden && /Section B/.test(document.getElementById('toast-message')?.textContent || '');
      });
      const xfer = await d.exec(() => ({
        toast: document.getElementById('toast-message')?.textContent || '',
        bProg: localStorage.getItem('b_class_tasks_progress'),
      }));
      check(feature, 'section-b-rejects-cross-section-transfer',
        /Section A/.test(xfer.toast) && /Section B/.test(xfer.toast) && xfer.bProg === seedB,
        JSON.stringify(xfer));

      await recordErrors(d, 'multi-section');
    });
    return;
  }
}

async function runDrive(target, args) {
  const targets = target === 'all' ? FEATURES : [target];
  for (const t of targets) {
    if (!FEATURES.includes(t)) {
      console.error(`Unknown feature "${t}". Valid: all, ${FEATURES.join(', ')}`);
      process.exit(2);
    }
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const outDir = path.resolve(args.out || path.join(BASE_TMP, `verify-tasktracker-${stamp}-${process.pid}`));
  fs.mkdirSync(outDir, { recursive: true });

  const checks = [];
  const artifacts = [];
  const errors = [];
  const check = (feature, id, ok, detail) => {
    checks.push({ feature, id, ok: !!ok, detail: String(detail || '') });
    console.log(`${ok ? 'PASS' : 'FAIL'} [${feature}] ${id}: ${detail}`);
  };

  let gdInfo = null;
  await withServer(args.url || null, async (baseUrl) => {
    gdInfo = await withGeckodriver(args['geckodriver-url'] || null, async (gd) => {
      for (const f of targets) {
        await runFeature(f, baseUrl, outDir, gd.base, { check, artifacts, errors });
      }
    });
  });

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  const report = {
    runId: path.basename(outDir),
    timestamp: new Date().toISOString(),
    target,
    outDir,
    geckodriver: gdInfo,
    passed,
    failed,
    consoleErrors: errors,
    artifacts,
    checks,
  };
  const reportPath = path.join(outDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (gdInfo?.teardownNote) console.log(`Note: ${gdInfo.teardownNote}`);
  console.log(`Summary: ${passed} passed, ${failed} failed, ${errors.length} console errors`);
  console.log(`Evidence: ${outDir}`);
  process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'doctor') {
    runDoctor().catch((e) => { console.error(e); process.exit(1); });
  } else if (cmd === 'drive') {
    runDrive(args._[1] || 'all', args).catch((e) => { console.error(e); process.exit(1); });
  } else {
    console.error('Usage: node verify.mjs <doctor|drive <feature|all>> [--out <dir>] [--url <baseUrl>] [--geckodriver-url <url>]');
    process.exit(2);
  }
}
