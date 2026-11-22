import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTION_PATH_RE, currentSection, sectionKey, keysForSection } from '../js/util.js';
import { resetSectionStorage, mountSectionBadges } from '../js/settings.js';
import { buildTransferPayload, transferSectionError, validateTransfer, checkIncomingTransfer } from '../js/transfer.js';
import { state } from '../js/state.js';
import { Task, taskIdOk } from '../logic.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_HEX = '0123456789abcdef0123456789abcdef';
const STATUS_ORDER = ['not_started', 'in_progress', 'done'];

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
    keys: () => [...map.keys()],
  };
}

function runMigrateProbe(pathname, seed) {
  const script = `
    const map = new Map(Object.entries(${JSON.stringify(seed)}));
    globalThis.location = { pathname: ${JSON.stringify(pathname)} };
    globalThis.localStorage = {
      get length() { return map.size; },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    };
    const { migrateLegacy } = await import('./js/tasks.js');
    const { KEYS } = await import('./js/util.js');
    const { state } = await import('./js/state.js');
    const { Task } = await import('./logic.js');
    state.progress = {};
    migrateLegacy({ fromJSON: (o) => new Task(o) });
    console.log(JSON.stringify({
      legacyKey: KEYS.legacy,
      stored: Object.fromEntries(map),
      progress: state.progress,
    }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(out.trim());
}

test('currentSection parses root, Section A, valid non-root sections, and rejects malformed paths', () => {
  assert.equal(currentSection(), '');
  assert.equal(currentSection(''), '');
  assert.equal(currentSection('/'), '');
  assert.equal(currentSection('/index.html'), '');
  assert.equal(currentSection(`/s/b/${TOKEN_HEX}/`), 'b');
  assert.equal(currentSection(`/s/b/${TOKEN_HEX}`), 'b');
  assert.equal(currentSection(`/s/b/${TOKEN_HEX}/index.html`), 'b');
  assert.equal(currentSection(`/s/B/${TOKEN_HEX.toUpperCase()}/`), 'b');
  assert.equal(currentSection(`/s/Sec_2-A/${TOKEN_HEX.toUpperCase()}`), 'sec_2-a');
  assert.equal(currentSection(`/s/a/${TOKEN_HEX}/`), '');
  assert.equal(currentSection(`/s/A/${TOKEN_HEX}/`), '');
  assert.equal(currentSection('/s/b/0123/'), '');
  assert.equal(currentSection(`/s/b/${TOKEN_HEX}0/`), '');
  assert.equal(currentSection('/s/b/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/'), '');
  assert.equal(currentSection(`/s/-b/${TOKEN_HEX}/`), '');
  assert.equal(currentSection(`/s/${'a'.repeat(33)}/${TOKEN_HEX}/`), '');
  assert.ok(SECTION_PATH_RE instanceof RegExp);
});

test('keysForSection preserves frozen Section A keys and prefixes non-root Section keys', () => {
  assert.deepEqual(keysForSection(''), {
    draft: 'class_tasks_draft',
    progress: 'class_tasks_progress',
    checkpoints: 'class_tasks_checkpoints',
    cache: 'class_tasks_published_cache',
    legacy: 'class_tasks_mvp',
  });
  assert.deepEqual(keysForSection('a'), keysForSection(''));
  assert.deepEqual(keysForSection('b'), {
    draft: 'b_class_tasks_draft',
    progress: 'b_class_tasks_progress',
    checkpoints: 'b_class_tasks_checkpoints',
    cache: 'b_class_tasks_published_cache',
    legacy: null,
  });
  assert.equal(sectionKey('class_tasks_admin', ''), 'class_tasks_admin');
  assert.equal(sectionKey('class_tasks_admin', 'b'), 'b_class_tasks_admin');
  assert.equal(sectionKey('class_tasks_signed_out', 'b'), 'b_class_tasks_signed_out');
  assert.equal(sectionKey('class_tasks_seen', 'b'), 'b_class_tasks_seen');
});

test('migrateLegacy runs on root Section A only and is skipped on non-root sections', () => {
  const legacyPayload = JSON.stringify([{ id: 't1', title: 'Legacy Task', status: 'done' }]);

  const resB = runMigrateProbe(`/s/b/${TOKEN_HEX}/`, { class_tasks_mvp: legacyPayload });
  assert.equal(resB.legacyKey, null);
  assert.equal('b_class_tasks_draft' in resB.stored, false);
  assert.equal('b_class_tasks_progress' in resB.stored, false);
  assert.equal('class_tasks_mvp_backup' in resB.stored, false);
  assert.deepEqual(resB.progress, {});

  const resA = runMigrateProbe('/', { class_tasks_mvp: legacyPayload });
  assert.equal(resA.legacyKey, 'class_tasks_mvp');
  assert.equal('class_tasks_draft' in resA.stored, true);
  assert.equal('class_tasks_progress' in resA.stored, true);
  assert.equal('class_tasks_mvp_backup' in resA.stored, true);
  assert.equal(JSON.parse(resA.stored.class_tasks_progress).t1.status, 'done');
  assert.equal(JSON.parse(resA.stored.class_tasks_draft).tasks[0].title, 'Legacy Task');
});

test('resetSectionStorage isolates resets per Section and keeps device-wide preferences', () => {
  const seed = {
    class_tasks_progress: '{"a1":{"status":"done"}}',
    class_tasks_draft: '{"tasks":[]}',
    class_tasks_checkpoints: '[]',
    class_tasks_seen: '{"a1":1}',
    class_tasks_mvp: '[]',
    class_tasks_admin: '1',
    class_tasks_signed_out: '1',
    class_tasks_published_cache: '{"tasks":[]}',
    b_class_tasks_progress: '{"b1":{"status":"done"}}',
    b_class_tasks_draft: '{"tasks":[]}',
    b_class_tasks_checkpoints: '[]',
    b_class_tasks_seen: '{"b1":1}',
    b_class_tasks_admin: '1',
    b_class_tasks_signed_out: '1',
    b_class_tasks_published_cache: '{"tasks":[]}',
    class_tasks_theme: 'dark',
    class_tasks_sidebar: 'collapsed',
    class_tasks_view_class: 'board',
    class_tasks_view_admin: 'list',
    class_tasks_tour_seen: '1',
    unrelated_key: 'keep',
  };

  const sA = makeStorage(seed);
  assert.equal(resetSectionStorage({ storage: sA, section: '' }), true);
  for (const cleared of ['class_tasks_progress', 'class_tasks_draft', 'class_tasks_checkpoints', 'class_tasks_seen', 'class_tasks_mvp']) {
    assert.equal(sA.has(cleared), false, `A reset should remove ${cleared}`);
  }
  for (const kept of [
    'class_tasks_admin', 'class_tasks_signed_out', 'class_tasks_published_cache',
    'class_tasks_theme', 'class_tasks_sidebar', 'class_tasks_view_class', 'class_tasks_view_admin', 'class_tasks_tour_seen',
    'b_class_tasks_progress', 'b_class_tasks_draft', 'b_class_tasks_checkpoints', 'b_class_tasks_seen',
    'b_class_tasks_admin', 'b_class_tasks_signed_out', 'b_class_tasks_published_cache',
    'unrelated_key',
  ]) {
    assert.equal(sA.has(kept), true, `A reset must preserve ${kept}`);
  }

  const sB = makeStorage(seed);
  assert.equal(resetSectionStorage({ storage: sB, section: 'b' }), true);
  for (const cleared of ['b_class_tasks_progress', 'b_class_tasks_draft', 'b_class_tasks_checkpoints', 'b_class_tasks_seen']) {
    assert.equal(sB.has(cleared), false, `B reset should remove ${cleared}`);
  }
  for (const kept of [
    'b_class_tasks_admin', 'b_class_tasks_signed_out', 'b_class_tasks_published_cache',
    'class_tasks_theme', 'class_tasks_sidebar', 'class_tasks_view_class', 'class_tasks_view_admin', 'class_tasks_tour_seen',
    'class_tasks_progress', 'class_tasks_draft', 'class_tasks_checkpoints', 'class_tasks_seen', 'class_tasks_mvp',
    'class_tasks_admin', 'class_tasks_signed_out', 'class_tasks_published_cache',
    'unrelated_key',
  ]) {
    assert.equal(sB.has(kept), true, `B reset must preserve ${kept}`);
  }
});

test('app.js scopes ADMIN_KEY, SIGNED_OUT_KEY, and SEEN_KEY per section while view & tour stay device-wide', () => {
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const tourSrc = fs.readFileSync(path.join(ROOT, 'js', 'tour.js'), 'utf8');
  assert.match(appSrc, /ADMIN_KEY\s*=\s*sectionKey\('class_tasks_admin'\)/);
  assert.match(appSrc, /SIGNED_OUT_KEY\s*=\s*sectionKey\('class_tasks_signed_out'\)/);
  assert.match(appSrc, /SEEN_KEY\s*=\s*sectionKey\('class_tasks_seen'\)/);
  assert.match(appSrc, /VIEW_KEYS\s*=\s*\{\s*class:\s*'class_tasks_view_class',\s*admin:\s*'class_tasks_view_admin'\s*\}/);
  assert.match(tourSrc, /TOUR_KEY\s*=\s*'class_tasks_tour_seen'/);
});

test('transfer.js tags payloads with section and rejects cross-section or legacy-on-B imports without mutating state', async () => {
  const prevProgress = state.progress;
  const prevAdmin = state.isAdmin;
  try {
    state.isAdmin = false;
    state.progress = { t1: { status: 'done', movedAt: 100 } };

    const payloadA = buildTransferPayload('a');
    const payloadB = buildTransferPayload('b');
    assert.equal(payloadA.section, 'a');
    assert.equal(payloadB.section, 'b');

    const deps = { taskIdOk, STATUS_ORDER, Task };
    assert.deepEqual(validateTransfer(payloadA, 'a', deps).progress, state.progress);
    assert.deepEqual(validateTransfer(payloadB, 'b', deps).progress, state.progress);

    // Cross-section rejections
    assert.equal(validateTransfer(payloadA, 'b', deps), null);
    assert.match(transferSectionError(payloadA, 'b'), /Section A.*Section B/);
    assert.equal(validateTransfer(payloadB, 'a', deps), null);
    assert.match(transferSectionError(payloadB, 'a'), /Section B.*Section A/);
    assert.equal(validateTransfer({ v: 1, section: 'B', progress: {} }, 'b', deps), null);

    // Legacy export (no section): allowed on A, rejected on B
    const legacy = { v: 1, progress: { t1: { status: 'in_progress', movedAt: 50 } } };
    assert.equal(transferSectionError(legacy, 'a'), null);
    assert.deepEqual(validateTransfer(legacy, 'a', deps).progress, legacy.progress);
    assert.equal(validateTransfer(legacy, 'b', deps), null);
    assert.match(transferSectionError(legacy, 'b'), /Section A.*Section B/);

    // Incoming transfer rejection never mutates state.progress or checkpoints
    const originalProgress = { keep: { status: 'in_progress', movedAt: 42 } };
    state.progress = structuredClone(originalProgress);
    const checkpointsBefore = JSON.stringify([{ at: 1, tasks: [] }]);
    const storage = makeStorage({ b_class_tasks_checkpoints: checkpointsBefore });
    const toasts = [];
    let opened = 0;

    await checkIncomingTransfer('0'.repeat(32), {
      activeSection: 'b',
      fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ payload: payloadA }) }),
      showToast: (msg) => toasts.push(msg),
      openImport: () => { opened++; },
      taskIdOk,
      STATUS_ORDER,
      Task,
    });
    assert.equal(opened, 0);
    assert.equal(toasts.length, 1);
    assert.match(toasts[0], /Section A.*Section B/);
    assert.deepEqual(state.progress, originalProgress);
    assert.equal(storage.getItem('b_class_tasks_checkpoints'), checkpointsBefore);

    await checkIncomingTransfer('0'.repeat(32), {
      activeSection: 'b',
      fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ payload: legacy }) }),
      showToast: (msg) => toasts.push(msg),
      openImport: () => { opened++; },
      taskIdOk,
      STATUS_ORDER,
      Task,
    });
    assert.equal(opened, 0);
    assert.equal(toasts.length, 2);
    assert.match(toasts[1], /Section B/);
    assert.deepEqual(state.progress, originalProgress);
  } finally {
    state.progress = prevProgress;
    state.isAdmin = prevAdmin;
  }
});

test('mountSectionBadges renders nothing on Section A and adds SECTION B badges in headers and beside Publish', () => {
  function makeEl(tag, attrs = {}) {
    const el = {
      tagName: tag.toUpperCase(),
      className: attrs.className || '',
      id: attrs.id || '',
      textContent: '',
      dataset: {},
      children: [],
      parentNode: null,
      _attrs: new Map(Object.entries(attrs.raw || {})),
      getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
      setAttribute(k, v) { this._attrs.set(k, String(v)); },
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      insertBefore(child, ref) {
        child.parentNode = this;
        const i = this.children.indexOf(ref);
        if (i === -1) this.children.push(child);
        else this.children.splice(i, 0, child);
        return child;
      },
      querySelector(sel) {
        if (sel === '#btn-apply') return this.children.find((c) => c.id === 'btn-apply') || null;
        if (sel === '[data-section-badge]') return this.children.find((c) => c.dataset.sectionBadge !== undefined) || null;
        return null;
      },
    };
    return el;
  }

  function makeFakeDoc() {
    const desktopBrand = makeEl('a', { className: 'brand', raw: { 'aria-label': 'TaskTracker home' } });
    const mobileBrand = makeEl('a', { className: 'brand brand-m', raw: { 'aria-label': 'TaskTracker home' } });
    const applyBtn = makeEl('button', { id: 'btn-apply', className: 'primary-button' });
    const release = makeEl('span', { className: 'admin-group admin-release' });
    release.appendChild(applyBtn);

    const doc = {
      createElement: (tag) => makeEl(tag),
      querySelectorAll(sel) {
        if (sel === '.tb .brand, .brand-m') return [desktopBrand, mobileBrand];
        return [];
      },
      querySelector(sel) {
        if (sel === '#admin-bar .admin-release') return release;
        return null;
      },
    };
    return { doc, desktopBrand, mobileBrand, release, applyBtn };
  }

  const domA = makeFakeDoc();
  mountSectionBadges(domA.doc, '');
  assert.equal(domA.desktopBrand.children.length, 0);
  assert.equal(domA.mobileBrand.children.length, 0);
  assert.equal(domA.release.children.length, 1);
  assert.equal(domA.desktopBrand.getAttribute('aria-label'), 'TaskTracker home');

  const domB = makeFakeDoc();
  mountSectionBadges(domB.doc, 'b');
  mountSectionBadges(domB.doc, 'b'); // idempotent
  for (const host of [domB.desktopBrand, domB.mobileBrand]) {
    assert.equal(host.children.length, 1);
    const badge = host.children[0];
    assert.equal(badge.className, 'section-badge');
    assert.equal(badge.dataset.sectionBadge, 'b');
    assert.equal(badge.textContent, 'SECTION B');
    assert.equal(host.getAttribute('aria-label'), 'TaskTracker SECTION B home');
  }
  assert.equal(domB.release.children.length, 2);
  assert.equal(domB.release.children[0].className, 'section-badge');
  assert.equal(domB.release.children[0].dataset.sectionBadge, 'b');
  assert.equal(domB.release.children[0].textContent, 'SECTION B');
  assert.equal(domB.release.children[1], domB.applyBtn);
});
