// tests/e2e/audit.mjs - the browser audit gate, in the repository.
//
// The Phase 3 run kept its real-browser judges outside the repo (tmp\visual\probe.ps1, tmp\oracle\*)
// and drove them by hand. This file is the reproducible part of that battery: Node builtins only,
// the repo's own fixture, a static server it starts itself, and Microsoft Edge over the DevTools
// protocol (Node 22+'s global WebSocket, so still no dependency and no build step). It checks the
// things the committed judges cannot see because they apply no CSS and no layout:
//
//   overflow  no element crosses the viewport edge at 320/375/640/768/1280 (640 is 200% zoom of 1280)
//   fold      the first task row is on the first phone screen, above the tab bar
//   names     every focusable element has an accessible name, and none is a bare div/span/article
//   lists     task lists are role=list, rows are role=listitem, and each row has a title control
//   keys      Enter on the row's title control opens the task dialog, Escape closes it
//   focus     closing the dialog or a reopen confirm lands on a live, visible control, never <body>
//   announce  every pinned announcement shows on desktop; the phone keeps its one-item collapse,
//             including a short multi-line item that was measured while its page was hidden
//   done      a cold #done deep link paints the completed rows already in localStorage
//   delete    the archive's Delete arms ("Confirm?") before it deletes, and the Undo toast restores
//   theme     light and dark both render, from the stored choice
//
// Isolation is part of the gate: before every scenario the run deletes only this app's own
// `class_tasks_*` keys on the test origin (never `localStorage.clear()`), so a student scenario can
// never inherit the admin flag from the previous admin scenario, and it asserts the requested mode.
// The browser clock is frozen to FIXTURE_INSTANT so seeded progress timestamps are deterministic.
//
// Browser semantics: a missing browser is an optional local SKIP (exit 0) unless --require-browser
// is passed, in which case it is a failure. A browser that exists but cannot launch always fails:
// an installed-but-broken Chromium must never turn the CI gate green.
//
// Not in `node --test` on purpose (same reason as check.mjs): it needs a browser; tests/audit-harness.test.js
// imports the exported helpers and exercises the server/launch boundaries without one.
//
// Usage: node tests/e2e/audit.mjs [--root <dir>] [--fixture <file>] [--edge <exe>] [--port 8110]
//                                [--require-browser]

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runClassFilterChecks } from './class-filters.mjs';
import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOOLEAN_ARGS = new Set(['require-browser']);
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq !== -1) args[a.slice(2, eq)] = a.slice(eq + 1);
  else if (BOOLEAN_ARGS.has(a.slice(2))) args[a.slice(2)] = true;
  else args[a.slice(2)] = process.argv[++i];
}
const ROOT = path.resolve(args.root || path.join(HERE, '..', '..'));
const FIXTURE = path.resolve(args.fixture || path.join(HERE, 'fixture-board.json'));
let PORT = Number(args.port || 8110);
// Optional: run every scenario against a REAL PHP endpoint set in a throwaway docroot, instead of the
// fixture stub. `--require-browser --php C:/xampp/php/php.exe` is the functional gate; without it the
// run stays a geometry/a11y gate whose `/api/*` answers `200 {}`.
const PHP_EXE = args.php ? String(args.php) : null;
let ADMIN_COOKIE = null;
const REQUIRE_BROWSER = !!args['require-browser'] || process.env.AUDIT_REQUIRE_BROWSER === '1';
const WIDTHS = [320, 375, 640, 720, 768, 1280];

// The fixture's dates cluster around this day. Freezing the browser clock here keeps the seeded
// progress ordering and the calendar's "today" identical on every machine and every run.
export const FIXTURE_INSTANT = Date.UTC(2026, 10, 8, 12, 0, 0);
export const OWNED_STORAGE_PREFIX = 'class_tasks_';

const DEFAULT_BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/opt/google/chrome/chrome',
  'google-chrome',
  'chromium',
  'chromium-browser',
  'msedge',
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the server: the worktree, the fixture as the shared board, and explicit API stubs ---
// `/api/*` answers 200 {} purely so the app's session probe resolves; it is a fixture stub, not a
// real login. The requested admin/student mode is asserted per scenario instead (boot()).
// Containment uses a path.relative boundary, not a string prefix: `root` and `root-evil` share a
// prefix, so startsWith(root) would happily serve the sibling directory. Malformed escapes are a
// 400 and must leave the server alive for the rest of the run.
function contained(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

export function createAuditServer({ root = ROOT, fixturePath = FIXTURE } = {}) {
  const servedRoot = fs.realpathSync(path.resolve(root));
  const fixture = fs.readFileSync(fixturePath);
  return http.createServer((req, res) => {
    const fail = (code, body) => { res.writeHead(code, { 'Content-Type': MIME['.txt'] }); res.end(body); };
    // Read the origin-form path ourselves: WHATWG URL collapses dot segments (including %2e) before
    // we could reject them, so containment must see the raw request target.
    const rawPath = String(req.url || '').split('?')[0].split('#')[0];
    if (!rawPath.startsWith('/')) { fail(400, 'bad request'); return; }
    let decoded;
    try { decoded = decodeURIComponent(rawPath); } catch (e) { fail(400, 'bad request'); return; }
    if (decoded === '/data/current.json') { res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' }); res.end(fixture); return; }
    // Mirrors the deployed nginx rule: only current.json is public under data/. The harness serves
    // the app, so it must not hand out history, sessions, the private bin or pending state either -
    // otherwise a passing browser run would prove nothing about those paths.
    if (decoded === '/data' || decoded.startsWith('/data/')) { fail(404, 'not found'); return; }
    if (decoded.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end('{}'); return; }
    const file = path.resolve(servedRoot, '.' + decoded);
    if (!contained(servedRoot, file)) { fail(404, 'not found'); return; }
    let real;
    try { real = fs.realpathSync(file); } catch (e) { fail(404, 'not found'); return; }
    if (!contained(servedRoot, real) || fs.statSync(real).isDirectory()) { fail(404, 'not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(real)] || 'application/octet-stream' });
    fs.createReadStream(real).pipe(res);
  });
}

export function listen(server, port = PORT) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server); });
  });
}

// Timestamps seeded into class_tasks_progress come from the same frozen instant the browser sees.
export function deriveProgress(fixture, instant = FIXTURE_INSTANT) {
  const progress = {};
  fixture.tasks.slice(0, 3).forEach((t, i) => { progress[t.id] = { status: 'done', movedAt: instant - (i + 1) * 3600e3 }; });
  return progress;
}

// Remove only the keys this app owns on the test origin. A fake Storage is enough for the test.
export function resetOwnedStorage(storage, prefix = OWNED_STORAGE_PREFIX) {
  const owned = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.indexOf(prefix) === 0) owned.push(key);
  }
  owned.forEach((key) => storage.removeItem(key));
  return owned;
}

// A new-document script: Date.now()/new Date() return the fixture instant, explicit arguments work.
export function clockScript(instant = FIXTURE_INSTANT) {
  return `(() => {
    const FIXED = ${Number(instant)};
    const RealDate = Date;
    function FrozenDate(...args) { return args.length ? new RealDate(...args) : new RealDate(FIXED); }
    FrozenDate.prototype = RealDate.prototype;
    FrozenDate.now = () => FIXED;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.defineProperty(globalThis, 'Date', { value: FrozenDate, writable: true, configurable: true });
  })();`;
}

// --- DevTools protocol, built-ins only ---
class CDP {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); this.errors = []; ws.onmessage = (m) => this.onMessage(m); }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = (e) => reject(new Error('websocket: ' + (e.message || 'failed')));
    });
  }
  onMessage(m) {
    const msg = JSON.parse(m.data);
    if (msg.id) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') this.errors.push(msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') this.errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
  async setMetrics(width, height, dpr) {
    // Chromium keeps the old override's `mobile` flag when the new one changes it, so the viewport
    // silently stays at the previous width (1280 -> 320 measured 1280). Clear first.
    await this.send('Emulation.clearDeviceMetricsOverride');
    return this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr || 1, mobile: width <= 480, screenWidth: width, screenHeight: height });
  }
  navigate(url) { return this.send('Page.navigate', { url }); }
}

// Close the CDP socket and our own process before removing the profile: on Windows a live Edge
// still holds files under --user-data-dir, and rmSync would silently leave the profile behind.
function disposeProfile(proc, profile) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; resolve(); };
    if (proc.exitCode !== null && proc.exitCode !== undefined) { done(); }
    else if (proc.signalCode) { done(); }
    else {
      try { proc.once('exit', done); } catch (e) { done(); }
      try { proc.kill(); } catch (e) { done(); }
      setTimeout(done, 2000);
    }
  }).then(async () => {
    for (let i = 0; i < 10; i++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); return; } catch (e) { await sleep(200); }
    }
  });
}

async function tryLaunch(command) {
  const debugPort = PORT + 1;
  let profile;
  try { profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-audit-')); } catch (e) { return { status: 'failed', message: 'profile: ' + e.message }; }
  let proc;
  try {
    proc = spawn(command, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile, '--window-size=1280,900', 'about:blank',
    ], { stdio: 'ignore' });
  } catch (e) {
    await disposeProfile({ once() {}, kill() {} }, profile);
    return { status: 'missing', message: command + ': ' + e.message };
  }
  let launchError = null;
  let exited = null;
  proc.once('error', (e) => { launchError = e; });
  proc.once('exit', (code, signal) => { exited = { code, signal }; });
  for (let i = 0; i < 200; i++) {
    if (launchError || exited) break;
    try {
      const list = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        const cdp = await CDP.connect(page.webSocketDebuggerUrl);
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: clockScript() });
        return {
          status: 'ok',
          cdp,
          command,
          close: async () => {
            try { cdp.ws.close(); } catch (e) {}
            await disposeProfile(proc, profile);
          },
        };
      }
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  if (launchError && launchError.code === 'ENOENT') {
    await disposeProfile(proc, profile);
    return { status: 'missing', message: command + ': not installed' };
  }
  if (launchError) {
    await disposeProfile(proc, profile);
    return { status: 'failed', message: command + ': ' + launchError.message };
  }
  const why = exited ? 'exited ' + (exited.code !== null ? 'with code ' + exited.code : 'on ' + exited.signal) : 'no DevTools endpoint after 30s';
  await disposeProfile(proc, profile);
  return { status: 'failed', message: command + ': ' + why };
}

// Try each installed Chromium-family candidate. ENOENT means "not here" (optional locally);
// a process that starts and then dies is a broken installed browser and must fail, never SKIP.
export async function launchBrowser() {
  const explicit = args.edge || process.env.AUDIT_BROWSER;
  const candidates = explicit ? [explicit] : DEFAULT_BROWSERS;
  let missing = null;
  for (const command of candidates) {
    if (path.isAbsolute(command) && !fs.existsSync(command)) continue;
    const result = await tryLaunch(command);
    if (result.status === 'ok') return result;
    if (result.status === 'failed') return result;
    missing = result.message;
  }
  return { status: 'missing', message: missing || 'no Chromium-family browser found' };
}

// --- page-side readers, sent as expressions ---
const READ_OVERFLOW = `(() => {
  const de = document.documentElement;
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    const over = Math.round(Math.max(r.right - de.clientWidth, -r.left));
    if (over > 1) bad.push(over + 'px ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''));
  }
  return { client: de.clientWidth, scroll: de.scrollWidth, bad: bad.slice(0, 8) };
})()`;

const READ_FOCUSABLES = `(() => {
  const name = (el) => {
    const label = (el.getAttribute('aria-label') || '').trim();
    if (label) return label;
    const refs = (el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
    if (refs.length) {
      const t = refs.map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
      if (t) return t;
    }
    if (el.tagName === 'INPUT') {
      if (el.labels && el.labels.length) return (el.labels[0].textContent || '').trim();
      if (el.value && /^(submit|button|reset)$/i.test(el.type)) return el.value.trim();
      return '';
    }
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) return text;
    return (el.getAttribute('title') || '').trim();
  };
  const out = [];
  for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')) {
    if (el.disabled || el.closest('[hidden]')) continue;
    if (el.tabIndex < 0) continue;
    if (!el.getClientRects().length) continue;
    const bare = /^(DIV|SPAN|ARTICLE|SECTION|LI|P)$/.test(el.tagName);
    out.push({ tag: el.tagName.toLowerCase(), name: name(el).slice(0, 60), bare: bare && !el.getAttribute('role') });
  }
  return out;
})()`;

const READ_LISTS = `(() => {
  const lists = ['class-task-list', 'task-list', 'done-list', 'past-list'].map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, state: 'missing' };
    const rows = el.querySelectorAll('.task-row');
    return {
      id, role: el.getAttribute('role'), rows: rows.length,
      rowsOk: [...rows].every((r) => r.getAttribute('role') === 'listitem'),
      titled: [...rows].every((r) => {
        const t = r.querySelector('button.task-row-title');
        const visible = (r.querySelector('.task-row-title') || {}).textContent || '';
        return !!t && t.textContent.trim().length > 0 && (visible.trim() === t.textContent.trim());
      }),
    };
  });
  return lists;
})()`;

const READ_ANNOUNCE = `(() => {
  const items = [...document.querySelectorAll('#announce-list-public .announce-item')];
  const shown = items.filter((i) => i.getClientRects().length > 0);
  const toggle = document.getElementById('announce-toggle');
  const first = items[0] && items[0].querySelector('.announce-text');
  return {
    total: items.length, shown: shown.length,
    toggleHidden: !toggle || toggle.hidden, toggleText: toggle ? toggle.textContent.trim() : '',
    text: first ? first.textContent.replace(/\\s+/g, ' ').trim() : '',
    clientHeight: first ? first.clientHeight : 0,
    scrollHeight: first ? first.scrollHeight : 0,
    clipped: !!first && first.scrollHeight > first.clientHeight + 1,
  };
})()`;

// The app owns only class_tasks_* keys on the test origin. Delete exactly those, never the whole
// localStorage: a student scenario must not inherit the admin flag a previous scenario set, and the
// audit must not touch anything else that happens to live on this origin.
const RESET_OWNED_STORAGE = `(() => {
  const owned = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.indexOf(${JSON.stringify(OWNED_STORAGE_PREFIX)}) === 0) owned.push(key);
  }
  owned.forEach((key) => localStorage.removeItem(key));
  return owned;
})()`;

const READ_MODE = `(() => {
  const nav = document.getElementById('nav-admin');
  return !!nav && !nav.hidden;
})()`;

// Where focus actually landed. A body/root answer is the regression these checks exist for: the row a
// dialog returns to is not a tab stop, and a hidden popover option is not "returned" anywhere.
const READ_ACTIVE = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { body: true };
  const scope = el.closest('[data-task-id]');
  const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
  return {
    tag: el.tagName.toLowerCase(),
    cls: typeof el.className === 'string' ? el.className.trim() : '',
    name: name.slice(0, 60),
    visible: el.getClientRects().length > 0,
    hiddenAncestor: !!el.closest('[hidden]'),
    popover: !!el.closest('.status-popover'),
    taskId: scope ? scope.dataset.taskId : null,
  };
})()`;

// --- assertions ---
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name.padEnd(34) + (detail || ''));
}

async function settle(cdp, ms = 900) {
  for (let i = 0; i < 40; i++) {
    const ready = await cdp.evaluate(`document.readyState === 'complete' && !!document.querySelector('.task-row, .task-card')`);
    if (ready) break;
    await sleep(100);
  }
  await sleep(ms);
}

async function boot(cdp, width, opts = {}) {
  const url = 'http://127.0.0.1:' + PORT + '/index.html' + (opts.admin ? '?admin=1' : '') + (opts.hash ? '#' + opts.hash : '');
  await cdp.setMetrics(width, opts.height || (width <= 480 ? 640 : 900));
  await setSessionCookie(cdp, !!opts.admin);
  await cdp.navigate('http://127.0.0.1:' + PORT + '/index.html');
  await sleep(250);
  // Isolation: every scenario starts from this app's keys only, so a student boot cannot inherit
  // the admin flag (class_tasks_admin) or a previous draft/progress.
  await cdp.evaluate(RESET_OWNED_STORAGE);
  const seed = {};
  if (opts.storage) Object.assign(seed, opts.storage);
  seed.class_tasks_tour_seen = '1';
  await cdp.evaluate('(() => { const p = ' + JSON.stringify(seed) + '; for (const k in p) localStorage.setItem(k, p[k]); return 1; })()');
  await cdp.navigate(url);
  await sleep(150);
  await cdp.evaluate('location.reload()');
  await settle(cdp);
  let mode = null;
  for (let i = 0; i < 30; i++) {
    mode = await cdp.evaluate(READ_MODE);
    if (mode === !!opts.admin) break;
    await sleep(100);
  }
  if (mode !== !!opts.admin) {
    throw new Error('requested ' + (opts.admin ? 'admin' : 'student') + ' mode but the page rendered ' + (mode ? 'admin' : 'student'));
  }
}

async function click(cdp, selector) {
  return cdp.evaluate('(() => { const e = document.querySelector(' + JSON.stringify(selector) + '); if (!e) return false; e.click(); return true; })()');
}

async function pressEnter(cdp) {
  for (const type of ['keyDown', 'char', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'char' ? '\r' : undefined });
  }
  await sleep(250);
}

async function pressKey(cdp, key, code, windowsVirtualKeyCode) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  await sleep(250);
}

// The focused control must be a real, visible, named replacement - never the body, a hidden page or
// the closed status popover.
const focusOk = (a, taskId) => !a.body && a.visible && !a.hiddenAncestor && !a.popover
  && a.name.length > 0 && (taskId === undefined || a.taskId === taskId);

// --- optional real-PHP origin -----------------------------------------------------------------
// A copy of the app plus a synthetic data/ directory, served by PHP's built-in server. Nothing here
// touches the repository's own data/: the board, the session and every write live in a temp dir that
// is deleted afterwards. Only the session file and the schema-2 board are seeded.
const PHP_APP_FILES = ['index.html', 'styles.css', 'app.js', 'logic.js', 'attachments.js', 'qr-draw.js', 'qrcode.js', 'transfer.php', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png'];
const PHP_APP_DIRS = ['js', 'assets', 'api'];

function phpSandbox(fixture) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-audit-php-'));
  for (const f of PHP_APP_FILES) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(root, f));
  }
  for (const d of PHP_APP_DIRS) {
    const src = path.join(ROOT, d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(root, d), { recursive: true });
  }
  const token = randomBytes(32).toString('hex');
  fs.mkdirSync(path.join(root, 'data', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'admin'), { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(path.join(root, 'data', 'sessions', createHash('sha256').update(token).digest('hex') + '.json'),
    JSON.stringify({ created: now, lastSeen: now, expires: now + 3600 }));
  fs.writeFileSync(path.join(root, 'data', 'current.json'), JSON.stringify({
    schemaVersion: 2,
    revision: 1,
    operationId: '0'.repeat(32),
    publishedAt: Math.floor(FIXTURE_INSTANT / 1000),
    tasks: fixture.tasks,
    announcements: fixture.announcements,
    subjects: Array.isArray(fixture.subjects) ? fixture.subjects : [],
    deletedTasks: [],
  }));
  return { root, token };
}

async function startPhpServer(exe, sandbox) {
  const log = fs.openSync(path.join(sandbox.root, 'server.log'), 'a');
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 30000);
    const proc = spawn(exe, ['-S', '127.0.0.1:' + port, '-t', sandbox.root], { stdio: ['ignore', log, log] });
    for (let i = 0; i < 100; i++) {
      const up = await new Promise((resolve) => {
        const sock = net.connect(port, '127.0.0.1');
        sock.once('connect', () => { sock.destroy(); resolve(true); });
        sock.once('error', () => resolve(false));
      });
      if (up) return { proc, port };
      await sleep(100);
    }
    try { proc.kill(); } catch (e) {}
  }
  throw new Error('PHP built-in server did not start');
}

// The admin cookie is the only session this run has; a student scenario deletes it, so the two modes
// can never leak into each other.
async function setSessionCookie(cdp, admin) {
  if (!PHP_EXE) return;
  await cdp.send('Network.enable');
  if (admin) {
    await cdp.send('Network.setCookie', { name: 'tt_admin', value: ADMIN_COOKIE, domain: '127.0.0.1', path: '/', httpOnly: true });
  } else {
    await cdp.send('Network.deleteCookies', { name: 'tt_admin', domain: '127.0.0.1', path: '/' });
  }
}

async function main() {
  // Launch before the server: a missing/broken browser is decided without opening a port, and the
  // exit code is part of the contract (optional local SKIP vs required/failed CI failure).
  const browser = await launchBrowser();
  if (browser.status === 'missing') {
    if (REQUIRE_BROWSER) {
      console.error('FAIL: no Chromium-family browser found (' + browser.message + ') and --require-browser was set');
      return 1;
    }
    console.log('SKIP: ' + browser.message + ' (optional locally; pass --require-browser to make it mandatory)');
    return 0;
  }
  if (browser.status === 'failed') {
    console.error('FAIL: browser launch failed: ' + browser.message);
    return 1;
  }
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const draft = JSON.stringify({ tasks: fixture.tasks, announcements: fixture.announcements });
  const progress = deriveProgress(fixture);
  let php = null;
  if (PHP_EXE) {
    const sandbox = phpSandbox(fixture);
    php = await startPhpServer(PHP_EXE, sandbox);
    ADMIN_COOKIE = sandbox.token;
    PORT = php.port;
    php.root = sandbox.root;
    console.log('origin: real PHP sandbox on 127.0.0.1:' + PORT);
  }
  const server = php ? null : await listen(createAuditServer());
  const { cdp } = browser;
  try {
    // 0. the harness itself: the browser clock is frozen (the injection lands on the next document,
    // so load one before reading it).
    await cdp.navigate('http://127.0.0.1:' + PORT + '/index.html');
    await sleep(300);
    const frozenNow = await cdp.evaluate('Date.now()');
    check('clock frozen', frozenNow === FIXTURE_INSTANT, 'Date.now() ' + frozenNow);
    // 1. every deep-linkable route at every width: nothing may cross the viewport edge
    for (const width of WIDTHS) {
      const seed = { class_tasks_view_class: 'list', class_tasks_view_admin: 'board', class_tasks_progress: JSON.stringify(progress), class_tasks_draft: draft };
      for (const theme of width <= 375 ? ['light', 'dark'] : ['light']) {
        await boot(cdp, width, { admin: true, storage: { ...seed, class_tasks_theme: theme } });
        for (const route of ['class-tasks', 'done', 'past', 'calendar', 'my-tasks']) {
          await cdp.evaluate("location.hash = '#" + route + "'");
          await sleep(250);
          const o = await cdp.evaluate(READ_OVERFLOW);
          check('overflow ' + width + ' ' + route + ' ' + theme, o.scroll - o.client <= 1 && o.bad.length === 0,
            'client ' + o.client + ' / scroll ' + o.scroll + (o.bad.length ? ' :: ' + o.bad.join(' | ') : ''));
        }
        // the two overlays that carry their own fixed width
        await cdp.evaluate("location.hash = '#class-tasks'");
        await sleep(200);
        await click(cdp, '#class-task-list .task-row');
        await sleep(400);
        let o = await cdp.evaluate(READ_OVERFLOW);
        check('overflow ' + width + ' dialog ' + theme, o.scroll - o.client <= 1 && o.bad.length === 0,
          'client ' + o.client + ' / scroll ' + o.scroll + (o.bad.length ? ' :: ' + o.bad.join(' | ') : ''));
        await cdp.evaluate("document.getElementById('dialog-close').click()");
        await sleep(300);
        await click(cdp, '#settings-open');
        await sleep(400);
        o = await cdp.evaluate(READ_OVERFLOW);
        check('overflow ' + width + ' settings ' + theme, o.scroll - o.client <= 1 && o.bad.length === 0,
          'client ' + o.client + ' / scroll ' + o.scroll + (o.bad.length ? ' :: ' + o.bad.join(' | ') : ''));
        await cdp.evaluate("document.getElementById('settings-close').click()");
        await sleep(200);
      }
      if (width > 480) continue;
      const fold = await cdp.evaluate(`(() => {
        const row = document.querySelector('#class-task-list .task-row');
        if (!row) return { ok: false, why: 'no row' };
        const r = row.getBoundingClientRect();
        return { ok: r.top < innerHeight - 60 && r.height > 20, top: Math.round(r.top), height: Math.round(r.height), vh: innerHeight };
      })()`);
      check('fold ' + width, fold.ok, 'first row top ' + fold.top + ' of ' + fold.vh + ' (' + fold.height + 'px tall)');
    }

    // 2. the task name must stay readable at the narrow widths: the archive once collapsed it to 60px
    for (const width of [320, 375]) {
      await boot(cdp, width, { admin: true, storage: { class_tasks_draft: draft, class_tasks_progress: JSON.stringify(progress) } });
      const t = [];
      for (const [hash, sel] of [['class-tasks', '#class-task-list .task-row-title'], ['past', '#past-list .task-row-title'], ['done', '#done-list .task-row-title']]) {
        await cdp.evaluate("location.hash = '#" + hash + "'");
        await sleep(300);
        const box = await cdp.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), scroll: el.scrollHeight };
        })()`);
        if (box && box.w > 0) t.push([hash, box.w, box.h]);
      }
      const bad = t.filter(([, w, h]) => w < 120 || h > 48);
      const vw = await cdp.evaluate('innerWidth');
      check('titles ' + width, t.length >= 2 && bad.length === 0 && vw === width,
        'innerWidth ' + vw + ' :: ' + t.map(([h, w, hh]) => h + '=' + w + 'x' + hh).join(' '));
    }

    // 3. focusables: named, and never a bare container
    for (const width of [375, 1280]) {
      await boot(cdp, width, { storage: { class_tasks_view_class: 'list' } });
      const focusables = await cdp.evaluate(READ_FOCUSABLES);
      const unnamed = focusables.filter((f) => !f.name);
      const bare = focusables.filter((f) => f.bare);
      check('names ' + width, unnamed.length === 0 && bare.length === 0,
        focusables.length + ' focusable; unnamed ' + unnamed.length + (unnamed.length ? ' :: ' + unnamed.map((f) => f.tag).join(',') : '')
        + '; bare ' + bare.length + (bare.length ? ' :: ' + bare.map((f) => f.tag).join(',') : ''));
    }

    // 4. list semantics and a title control on every row. Isolation means a student boot has neither
    // the admin draft (task-list) nor seeded progress (done-list), so this scenario asks for admin and
    // supplies both - each present list must actually hold rows.
    await boot(cdp, 1280, {
      admin: true,
      storage: { class_tasks_view_class: 'list', class_tasks_view_admin: 'list', class_tasks_draft: draft, class_tasks_progress: JSON.stringify(progress) },
    });
    for (const list of await cdp.evaluate(READ_LISTS)) {
      if (list.state === 'missing') continue;
      check('list ' + list.id, list.role === 'list' && list.rowsOk && list.titled && list.rows > 0,
        'role=' + list.role + ' rows=' + list.rows + ' listitem=' + list.rowsOk + ' title-button=' + list.titled);
    }

    // 5. keyboard: Enter on the title control opens the dialog, Escape closes it
    const dialogOpen = `!document.getElementById('task-dialog-overlay').hidden`;
    for (const view of ['board', 'list']) {
      await boot(cdp, 1280, { storage: { class_tasks_view_class: view } });
      const focused = await cdp.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(view === 'board' ? '.task-card .task-card-title button' : '#class-task-list .task-row button.task-row-title')});
        if (!el) return false;
        el.focus();
        return document.activeElement === el;
      })()`);
      let opened = false;
      if (focused) {
        for (const type of ['keyDown', 'char', 'keyUp']) {
          await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'char' ? '\r' : undefined });
        }
        await sleep(400);
        opened = await cdp.evaluate(dialogOpen);
        if (opened) {
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await sleep(400);
        }
      }
      const closed = opened ? !(await cdp.evaluate(dialogOpen)) : false;
      check('keys ' + view, focused && opened && closed, 'focus=' + focused + ' enter-opens=' + opened + ' escape-closes=' + closed);
    }

    // 5b. closing the dialog rerenders the page, so the opener is gone. Focus must land on that
    // task's live replacement title control, not the old row (which is not a tab stop) or <body>.
    for (const view of ['board', 'list']) {
      await boot(cdp, 1280, { admin: true, storage: { class_tasks_draft: draft, class_tasks_view_class: view } });
      const opener = view === 'board' ? '.task-card .task-card-title button' : '#class-task-list .task-row button.task-row-title';
      const started = await cdp.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(opener)});
        if (!el) return null;
        el.focus();
        const scope = el.closest('[data-task-id]');
        return { taskId: scope ? scope.dataset.taskId : null, focused: document.activeElement === el };
      })()`);
      await pressEnter(cdp);
      const opened = await cdp.evaluate(dialogOpen);
      await pressKey(cdp, 'Escape', 'Escape', 27);
      const active = await cdp.evaluate(READ_ACTIVE);
      const replacement = /task-title-open|task-row-title|status-check/.test(active.cls);
      check('focus return ' + view, !!started && started.focused && opened && focusOk(active, started.taskId) && replacement,
        'task ' + (started && started.taskId) + ' opened ' + opened + ' -> ' + active.tag + '.' + active.cls + ' "' + active.name + '"');
    }

    // 5c. completed-task reopen from the Done row: the first Enter arms, the second reopens. The
    // task leaves Done, so there is no row left to focus: focus must still land on a visible control.
    const reopenBase = { admin: true, storage: { class_tasks_draft: draft, class_tasks_progress: JSON.stringify(progress) } };
    await boot(cdp, 1280, { ...reopenBase, hash: 'done' });
    const beforeDone = await cdp.evaluate(`document.querySelectorAll('#done-list .done-row').length`);
    const rowStart = await cdp.evaluate(`(() => {
      const row = document.querySelector('#done-list .done-row');
      const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Mark not done');
      if (!btn) return null;
      btn.focus();
      return { taskId: row.dataset.taskId, focused: document.activeElement === btn };
    })()`);
    await pressEnter(cdp);
    const reopenArmed = await cdp.evaluate(`document.activeElement.textContent.trim()`);
    await pressEnter(cdp);
    const accepted = await cdp.evaluate(READ_ACTIVE);
    const leftDone = await cdp.evaluate(`(() => {
      const id = ${JSON.stringify((rowStart && rowStart.taskId) || '')};
      return { rows: document.querySelectorAll('#done-list .done-row').length, still: !!document.querySelector('#done-list [data-task-id="' + id + '"]') };
    })()`);
    check('reopen done row', !!rowStart && rowStart.focused && reopenArmed === 'Confirm?'
      && leftDone.rows === beforeDone - 1 && !leftDone.still && focusOk(accepted),
      'armed "' + reopenArmed + '", rows ' + beforeDone + ' -> ' + leftDone.rows + '; focus ' + accepted.tag + '.' + accepted.cls + ' "' + accepted.name + '"');

    // 5d. reopen from the status popover: closeStatusPopover() hides the option before the confirm
    // opens, so the old code captured a hidden option and focused it on Cancel and after Reopen.
    await boot(cdp, 1280, {
      admin: true, hash: 'my-tasks',
      storage: { class_tasks_draft: draft, class_tasks_progress: JSON.stringify(progress), class_tasks_view_admin: 'board' },
    });
    const doneCard = await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('#page-my-tasks .task-card')].find((c) => c.dataset.status === 'done');
      if (!card) return null;
      const check = card.querySelector('.status-check');
      check.focus();
      return { taskId: card.dataset.taskId, focused: document.activeElement === check };
    })()`);
    await pressEnter(cdp);
    const popoverOpen = await cdp.evaluate(`!!document.querySelector('.status-popover:not([hidden])')`);
    await pressKey(cdp, 'ArrowUp', 'ArrowUp', 38);
    await pressKey(cdp, 'ArrowUp', 'ArrowUp', 38);
    await pressEnter(cdp);
    const popConfirm = await cdp.evaluate(`!document.querySelector('.confirm-overlay').hidden`);
    await pressKey(cdp, 'Escape', 'Escape', 27);
    const popCancelled = await cdp.evaluate(READ_ACTIVE);
    const stillDone = await cdp.evaluate(`(() => {
      const card = document.querySelector('#page-my-tasks .task-card[data-task-id="' + ${JSON.stringify((doneCard && doneCard.taskId) || '')} + '"]');
      return card ? card.dataset.status : null;
    })()`);
    check('reopen popover cancel', !!doneCard && doneCard.focused && popoverOpen && popConfirm && stillDone === 'done'
      && focusOk(popCancelled, doneCard.taskId) && /status-check/.test(popCancelled.cls),
      'task ' + (doneCard && doneCard.taskId) + ' still ' + stillDone + ' -> ' + popCancelled.tag + '.' + popCancelled.cls + ' "' + popCancelled.name + '"');
    await pressEnter(cdp);
    await pressKey(cdp, 'ArrowUp', 'ArrowUp', 38);
    await pressKey(cdp, 'ArrowUp', 'ArrowUp', 38);
    await pressEnter(cdp);
    const popConfirmAgain = await cdp.evaluate(`!document.querySelector('.confirm-overlay').hidden`);
    await pressKey(cdp, 'Tab', 'Tab', 9);
    const popReopenFocused = await cdp.evaluate(`document.activeElement.textContent.trim()`);
    await pressEnter(cdp);
    const popAccepted = await cdp.evaluate(READ_ACTIVE);
    const newStatus = await cdp.evaluate(`(() => {
      const card = document.querySelector('#page-my-tasks .task-card[data-task-id="' + ${JSON.stringify((doneCard && doneCard.taskId) || '')} + '"]');
      return card ? card.dataset.status : null;
    })()`);
    check('reopen popover accept', !!doneCard && popConfirmAgain && popReopenFocused === 'Reopen'
      && newStatus === 'not_started' && focusOk(popAccepted, doneCard.taskId) && /task-title-open|task-row-title|status-check/.test(popAccepted.cls),
      'task ' + (doneCard && doneCard.taskId) + ' -> ' + newStatus + '; focus ' + popAccepted.tag + '.' + popAccepted.cls + ' "' + popAccepted.name + '"');

    // 5e. subject dropdown keyboard: Enter/ArrowDown opens and focuses the selected option,
    // Home/End/ArrowDown navigate, Escape closes the dropdown without closing the task dialog,
    // and Enter selects an option and returns focus to #dialog-subject-btn.
    await click(cdp, '#page-my-tasks .task-card .task-title-open');
    await sleep(250);
    await cdp.evaluate(`document.getElementById('dialog-subject-btn').focus()`);
    await pressEnter(cdp);
    const subjOpened = await cdp.evaluate(`(() => {
      const dd = document.getElementById('dialog-subject-dropdown');
      const a = document.activeElement;
      return { open: !dd.hidden, inside: dd.contains(a), ariaSelected: a && a.getAttribute('aria-selected') };
    })()`);
    await pressKey(cdp, 'Escape', 'Escape', 27);
    const subjEscClosed = await cdp.evaluate(`(() => ({
      ddHidden: document.getElementById('dialog-subject-dropdown').hidden,
      dlgOpen: !document.getElementById('task-dialog-overlay').hidden,
      activeId: document.activeElement && document.activeElement.id,
    }))()`);
    await pressKey(cdp, 'ArrowDown', 'ArrowDown', 40);
    await pressKey(cdp, 'Home', 'Home', 36);
    await pressKey(cdp, 'ArrowDown', 'ArrowDown', 40);
    const pickedSubjCode = await cdp.evaluate(`document.activeElement && document.activeElement.dataset.subject`);
    await pressEnter(cdp);
    const subjPicked = await cdp.evaluate(`(() => ({
      ddHidden: document.getElementById('dialog-subject-dropdown').hidden,
      activeId: document.activeElement && document.activeElement.id,
      btnText: document.getElementById('dialog-subject-btn').textContent.trim(),
    }))()`);
    await pressKey(cdp, 'Escape', 'Escape', 27);
    check('subject dropdown keyboard', subjOpened.open && subjOpened.inside && subjOpened.ariaSelected === 'true'
      && subjEscClosed.ddHidden && subjEscClosed.dlgOpen && subjEscClosed.activeId === 'dialog-subject-btn'
      && !!pickedSubjCode && subjPicked.ddHidden && subjPicked.activeId === 'dialog-subject-btn' && subjPicked.btnText === pickedSubjCode,
      'open=' + subjOpened.open + ' inside=' + subjOpened.inside + ' esc=' + subjEscClosed.activeId + ' picked=' + pickedSubjCode + '/' + subjPicked.btnText);

    // 6. pinned announcements: all on desktop, one on the phone
    for (const width of [1280, 375]) {
      await boot(cdp, width);
      const a = await cdp.evaluate(READ_ANNOUNCE);
      const ok = width > 719
        ? a.total > 1 && a.shown === a.total && a.toggleHidden
        : a.total > 1 && a.shown === 1 && !a.toggleHidden
          // The collapsed label must name the rows it still hides, not the total ("Show 2 more").
          && a.toggleText.includes(String(a.total - a.shown));
      check('announce ' + width, ok, 'total ' + a.total + ' shown ' + a.shown + ' toggleHidden ' + a.toggleHidden + ' "' + a.toggleText + '"');
    }

    // 6b. One<br>Two<br>Three inside a single phone item: 11 characters, three laid-out lines. Booting
    // on Calendar measures it while hidden (the old length heuristic said "not clipped"), then the
    // pushState reveal to Class tasks must remeasure and offer the toggle. It toggles both ways and
    // survives a route revisit.
    const shortAnnouncement = { id: 'an-short', text: 'OneTwoThree', html: 'One<br>Two<br>Three', createdAt: FIXTURE_INSTANT };
    const shortDraft = JSON.stringify({ tasks: fixture.tasks, announcements: [shortAnnouncement] });
    await boot(cdp, 375, { admin: true, hash: 'calendar', storage: { class_tasks_draft: shortDraft } });
    const hiddenPage = await cdp.evaluate(READ_ANNOUNCE);
    await click(cdp, '.nav-item[data-page="class-tasks"]');
    await sleep(500);
    const revealed = await cdp.evaluate(READ_ANNOUNCE);
    check('announce short multiline', revealed.total === 1 && revealed.shown === 1 && revealed.clipped
      && !revealed.toggleHidden && /Show more/.test(revealed.toggleText),
      'hidden-page text "' + hiddenPage.text + '" (' + hiddenPage.text.length + ' chars); shown ' + revealed.shown
      + ' clipped ' + revealed.clipped + ' ' + revealed.clientHeight + '/' + revealed.scrollHeight + ' toggleHidden ' + revealed.toggleHidden);
    await click(cdp, '#announce-toggle');
    await sleep(250);
    const expanded = await cdp.evaluate(READ_ANNOUNCE);
    const expandedOk = expanded.toggleText === 'Show less' && expanded.clipped === false;
    await click(cdp, '#announce-toggle');
    await sleep(250);
    const recollapsed = await cdp.evaluate(READ_ANNOUNCE);
    await click(cdp, '.nav-item[data-page="calendar"]');
    await sleep(200);
    await click(cdp, '.nav-item[data-page="class-tasks"]');
    await sleep(500);
    const revisited = await cdp.evaluate(READ_ANNOUNCE);
    check('announce collapse revisit', expandedOk && recollapsed.clipped && !recollapsed.toggleHidden
      && revisited.clipped && !revisited.toggleHidden && /Show more/.test(revisited.toggleText),
      'expanded "' + expanded.toggleText + '" clipped ' + expanded.clipped + '; recollapsed ' + recollapsed.clipped
      + '; revisit ' + revisited.clipped + ' hidden ' + revisited.toggleHidden);

    // 6c. cold #done deep link: progress already in localStorage must paint on the first load, not
    // only after an in-app Done click 5s later.
    await boot(cdp, 1280, { hash: 'done', storage: { class_tasks_progress: JSON.stringify(progress) } });
    const coldDone = await cdp.evaluate(`(() => ({
      rows: document.querySelectorAll('#done-list .done-row').length,
      empty: !!document.querySelector('#done-list .list-empty'),
    }))()`);
    await click(cdp, '.nav-item[data-page="class-tasks"]');
    await sleep(200);
    await click(cdp, '.nav-item[data-page="done"]');
    await sleep(400);
    const inAppDone = await cdp.evaluate(`document.querySelectorAll('#done-list .done-row').length`);
    check('cold done deep link', coldDone.rows > 0 && coldDone.rows === inAppDone && !coldDone.empty,
      'cold rows ' + coldDone.rows + ' (empty ' + coldDone.empty + '), in-app ' + inAppDone);

    // 7. archive Delete arms before it deletes, and Undo restores
    await boot(cdp, 1280, { admin: true, hash: 'past', storage: { class_tasks_draft: draft } });
    const before = await cdp.evaluate(`document.querySelectorAll('#past-list .done-row').length`);
    const clicked = await cdp.evaluate(`(() => {
      const row = document.querySelector('#past-list .done-row');
      const del = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete');
      if (!del) return null;
      del.click();
      return { text: del.textContent.trim(), rows: document.querySelectorAll('#past-list .done-row').length };
    })()`);
    const armed = clicked && clicked.text === 'Confirm?' && clicked.rows === before;
    // Deletion archives first, so the row disappears one network turn later: poll for the effect
    // instead of sampling synchronously.
    await cdp.evaluate(`(() => {
      const row = document.querySelector('#past-list .done-row');
      const del = [...row.querySelectorAll('button')].find((b) => /Confirm\\?/.test(b.textContent));
      if (del) del.click();
      return true;
    })()`);
    let deleted = null;
    for (let i = 0; i < 40; i++) {
      deleted = await cdp.evaluate(`(() => ({
        rows: document.querySelectorAll('#past-list .done-row').length,
        toast: !document.getElementById('toast').hidden,
        message: document.getElementById('toast-message').textContent,
        undo: !document.getElementById('toast-action').hidden,
      }))()`);
      if (deleted.rows === before - 1 && deleted.toast) break;
      await sleep(50);
    }
    const gone = deleted && deleted.rows === before - 1 && deleted.toast && deleted.undo;
    await sleep(200);
    await click(cdp, '#toast-action');
    await sleep(300);
    const after = await cdp.evaluate(`document.querySelectorAll('#past-list .done-row').length`);
    check('delete arms + undo', !!armed && !!gone && after === before,
      'rows ' + before + ' -> armed ' + (clicked && clicked.text) + ' -> ' + (deleted && deleted.rows) + ' -> undo ' + after + ' (toast "' + (deleted && deleted.message) + '")');

    // 7b. class List/Board filters and their status transitions, through the same isolated boot
    await runClassFilterChecks({ cdp, boot, check, click, sleep, pressKey, pressEnter, fixture, FIXTURE_INSTANT });

    // 8. both themes render from the stored choice
    const bg = {};
    for (const theme of ['light', 'dark']) {
      await boot(cdp, 1280, { storage: { class_tasks_theme: theme } });
      bg[theme] = await cdp.evaluate(`(() => ({ theme: document.documentElement.dataset.theme || '', bg: getComputedStyle(document.body).backgroundColor }))()`);
    }
    check('themes', bg.light.theme === 'light' && bg.dark.theme === 'dark' && bg.light.bg !== bg.dark.bg,
      'light ' + bg.light.bg + ' / dark ' + bg.dark.bg);

    check('console clean', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (php) {
      try { php.proc.kill(); } catch (e) {}
      fs.rmSync(php.root, { recursive: true, force: true });
    }
  }
  const passed = results.filter((r) => r.ok).length;
  console.log('audit: ' + passed + ' passed, ' + (results.length - passed) + ' failed');
  return results.every((r) => r.ok) ? 0 : 1;
}

const RUN_DIRECTLY = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (RUN_DIRECTLY) {
  main().then((code) => process.exit(code)).catch((error) => { console.error('audit: ' + error.message); process.exit(1); });
}
