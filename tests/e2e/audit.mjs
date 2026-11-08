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
//   announce  every pinned announcement shows on desktop; the phone keeps its one-item collapse
//   delete    the archive's Delete arms ("Confirm?") before it deletes, and the Undo toast restores
//   theme     light and dark both render, from the stored choice
//
// Not in `node --test` on purpose (same reason as check.mjs): it needs a browser, so it must not
// fail a checkout that has none. No Edge found -> exit 0 with SKIP, like the goldens' missing harness.
//
// Usage: node tests/e2e/audit.mjs [--root <dir>] [--fixture <file>] [--edge <exe>] [--port 8110]

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq !== -1) args[a.slice(2, eq)] = a.slice(eq + 1);
  else args[a.slice(2)] = process.argv[++i];
}
const ROOT = path.resolve(args.root || path.join(HERE, '..', '..'));
const FIXTURE = path.resolve(args.fixture || path.join(HERE, 'fixture-board.json'));
const PORT = Number(args.port || 8110);
const EDGE = args.edge || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const WIDTHS = [320, 375, 640, 768, 1280];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the server: the worktree, the fixture as the shared board, and the two auth endpoints ---
function serve() {
  const fixture = fs.readFileSync(FIXTURE);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file;
    if (url.pathname === '/data/current.json') { res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' }); res.end(fixture); return; }
    if (url.pathname.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end('{}'); return; }
    file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
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

async function launchEdge() {
  if (!fs.existsSync(EDGE)) return null;
  const debugPort = PORT + 1;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-audit-'));
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile, '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        const cdp = await CDP.connect(page.webSocketDebuggerUrl);
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        return { cdp, kill: () => { try { proc.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Edge may still hold the profile */ } } };
      }
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  try { proc.kill(); } catch (e) {}
  return null;
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
  return { total: items.length, shown: shown.length, toggleHidden: !toggle || toggle.hidden, toggleText: toggle ? toggle.textContent.trim() : '' };
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
  await cdp.navigate('http://127.0.0.1:' + PORT + '/index.html');
  await sleep(250);
  const seed = {};
  if (opts.storage) Object.assign(seed, opts.storage);
  seed.class_tasks_tour_seen = '1';
  await cdp.evaluate('(() => { const p = ' + JSON.stringify(seed) + '; for (const k in p) localStorage.setItem(k, p[k]); return 1; })()');
  await cdp.navigate(url);
  await sleep(150);
  await cdp.evaluate('location.reload()');
  await settle(cdp);
}

async function click(cdp, selector) {
  return cdp.evaluate('(() => { const e = document.querySelector(' + JSON.stringify(selector) + '); if (!e) return false; e.click(); return true; })()');
}

async function main() {
  if (!fs.existsSync(EDGE)) { console.log('SKIP: Microsoft Edge not found at ' + EDGE + ' (pass --edge <exe>)'); return 0; }
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const draft = JSON.stringify({ tasks: fixture.tasks, announcements: fixture.announcements });
  const progress = {};
  fixture.tasks.slice(0, 3).forEach((t, i) => { progress[t.id] = { status: 'done', movedAt: Date.now() - (i + 1) * 3600e3 }; });
  const server = await serve();
  const edge = await launchEdge();
  if (!edge) { server.close(); console.log('SKIP: Edge did not answer the DevTools endpoint'); return 0; }
  const { cdp } = edge;
  try {
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

    // 4. list semantics and a title control on every row
    await boot(cdp, 1280, { storage: { class_tasks_view_class: 'list' } });
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

    // 6. pinned announcements: all on desktop, one on the phone
    for (const width of [1280, 375]) {
      await boot(cdp, width);
      const a = await cdp.evaluate(READ_ANNOUNCE);
      const ok = width > 719
        ? a.total > 1 && a.shown === a.total && a.toggleHidden
        : a.total > 1 && a.shown === 1 && !a.toggleHidden && /Show all/.test(a.toggleText);
      check('announce ' + width, ok, 'total ' + a.total + ' shown ' + a.shown + ' toggleHidden ' + a.toggleHidden + ' "' + a.toggleText + '"');
    }

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
    const deleted = await cdp.evaluate(`(() => {
      const row = document.querySelector('#past-list .done-row');
      const del = [...row.querySelectorAll('button')].find((b) => /Confirm\\?/.test(b.textContent));
      if (!del) return null;
      del.click();
      return { rows: document.querySelectorAll('#past-list .done-row').length, toast: !document.getElementById('toast').hidden, message: document.getElementById('toast-message').textContent, undo: !document.getElementById('toast-action').hidden };
    })()`);
    const gone = deleted && deleted.rows === before - 1 && deleted.toast && deleted.undo;
    await sleep(200);
    await click(cdp, '#toast-action');
    await sleep(300);
    const after = await cdp.evaluate(`document.querySelectorAll('#past-list .done-row').length`);
    check('delete arms + undo', !!armed && !!gone && after === before,
      'rows ' + before + ' -> armed ' + (clicked && clicked.text) + ' -> ' + (deleted && deleted.rows) + ' -> undo ' + after + ' (toast "' + (deleted && deleted.message) + '")');

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
    edge.kill();
    server.close();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log('audit: ' + passed + ' passed, ' + (results.length - passed) + ' failed');
  return results.every((r) => r.ok) ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((error) => { console.error('audit: ' + error.message); process.exit(1); });
