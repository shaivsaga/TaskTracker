import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createInsightsController } from '../js/insights-ui.js';
import { createInsightsRuntimeState, insightsKeysFor, readActivityHistory, readInsightsPrefs } from '../js/insights-store.js';

const ORIGINAL = {
  document: globalThis.document,
  matchMedia: globalThis.matchMedia,
  getComputedStyle: globalThis.getComputedStyle,
};

afterEach(() => {
  globalThis.document = ORIGINAL.document;
  globalThis.matchMedia = ORIGINAL.matchMedia;
  globalThis.getComputedStyle = ORIGINAL.getComputedStyle;
});

function makeStorage(initial = {}, opts = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [String(k), String(v)]));
  const mode = {
    failGet: opts.failGet || false,
    failSet: opts.failSet || false,
    failRemove: opts.failRemove || false,
    quotaOnSet: opts.quotaOnSet || false,
  };
  const storage = {
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) {
      if (mode.failGet) throw Object.assign(new Error('Blocked'), { name: 'SecurityError' });
      return data.has(k) ? data.get(k) : null;
    },
    setItem(k, v) {
      if (mode.quotaOnSet) throw Object.assign(new Error('Quota'), { name: 'QuotaExceededError' });
      if (mode.failSet) throw Object.assign(new Error('Blocked'), { name: 'SecurityError' });
      data.set(String(k), String(v));
    },
    removeItem(k) {
      if (mode.failRemove) throw Object.assign(new Error('Blocked'), { name: 'SecurityError' });
      data.delete(String(k));
    },
  };
  return { storage, data, mode };
}

function makeEl(doc, tag = 'div', attrs = {}) {
  const classes = new Set((attrs.className || '').split(/\s+/).filter(Boolean));
  const listeners = new Map();
  const children = [];
  const el = {
    tagName: tag.toUpperCase(),
    id: attrs.id || '',
    hidden: Boolean(attrs.hidden),
    disabled: Boolean(attrs.disabled),
    isConnected: true,
    inert: false,
    _textContent: '',
    _returnFocus: null,
    _attrs: new Map(),
    _listeners: listeners,
    dataset: { ...(attrs.dataset || {}) },
    children,
    classList: {
      add(...cs) { cs.forEach((c) => classes.add(c)); },
      remove(...cs) { cs.forEach((c) => classes.delete(c)); },
      toggle(c, force) {
        if (force === undefined) {
          if (classes.has(c)) { classes.delete(c); return false; }
          classes.add(c);
          return true;
        }
        if (force) classes.add(c);
        else classes.delete(c);
        return Boolean(force);
      },
      contains(c) { return classes.has(c); },
    },
    get textContent() {
      if (children.length === 0) return el._textContent;
      return children.map((c) => c.textContent).join('');
    },
    set textContent(v) {
      children.length = 0;
      el._textContent = v === null || v === undefined ? '' : String(v);
    },
    appendChild(child) {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    setAttribute(k, v) { el._attrs.set(k, String(v)); },
    getAttribute(k) { return el._attrs.has(k) ? el._attrs.get(k) : null; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchEvent(evt) {
      const e = { target: el, currentTarget: el, ...evt };
      let cur = el;
      while (cur) {
        e.currentTarget = cur;
        const curListeners = cur._listeners ? cur._listeners.get(e.type) : listeners.get(e.type);
        if (curListeners) {
          for (const fn of curListeners.slice()) fn(e);
        }
        cur = cur.parentNode || null;
      }
    },
    focus() { doc.activeElement = el; },
    closest(sel) {
      if (sel === '[hidden]') {
        let cur = el;
        while (cur) { if (cur.hidden) return cur; cur = cur.parentNode || null; }
        return null;
      }
      const attrMatch = /^\[([a-z-]+)\]$/.exec(sel);
      if (attrMatch) {
        let cur = el;
        while (cur) { if (cur.getAttribute(attrMatch[1]) !== null) return cur; cur = cur.parentNode || null; }
      }
      return null;
    },
    getClientRects() { return el.closest('[hidden]') ? [] : [{ width: 100, height: 44 }]; },
    querySelectorAll(sel) {
      const attrMatch = /^\[([a-z-]+)\]$/.exec(sel);
      const out = [];
      const walk = (node) => {
        for (const c of node.children) {
          if (attrMatch && c.getAttribute(attrMatch[1]) !== null) out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out;
    },
    querySelector(sel) {
      const eqMatch = /^\[([a-z-]+)="([^"]+)"\]$/.exec(sel);
      const out = [];
      const walk = (node) => {
        for (const c of node.children) {
          if (eqMatch && c.getAttribute(eqMatch[1]) === eqMatch[2]) out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out[0] || null;
    },
  };
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('data-') || k === 'aria-pressed' || k === 'role') el.setAttribute(k, v);
  }
  return el;
}

function makeHarness({ tasks = [], progress = {}, nowMs = Date.UTC(2026, 10, 8, 12, 0, 0), storage, runtimeState, section = '' } = {}) {
  const docListeners = new Map();
  const winListeners = new Map();
  const doc = {
    activeElement: null,
    documentElement: { dataset: { motion: 'reduce' } },
    createElement(tag) { return makeEl(doc, tag); },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = docListeners.get(type) || [];
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    querySelector() { return null; },
    dispatch(evt) {
      for (const fn of (docListeners.get(evt.type) || []).slice()) fn(evt);
    },
  };
  const win = {
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = winListeners.get(type) || [];
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchStorage(key) {
      for (const fn of (winListeners.get('storage') || []).slice()) fn({ key });
    },
  };
  globalThis.document = doc;
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
  globalThis.getComputedStyle = (el) => ({ opacity: el.hidden ? '0' : '1' });

  const uiDom = {
    actionFeedback: makeEl(doc, 'div'),
    settingsOverlay: makeEl(doc, 'div', { hidden: true }),
    settingsOpen: makeEl(doc, 'button'),
    mineInsightsBtn: makeEl(doc, 'button', { hidden: true }),
    mineInsightsDot: makeEl(doc, 'span', { hidden: true }),
    insightsOverlay: makeEl(doc, 'div', { hidden: true }),
    insightsClose: makeEl(doc, 'button'),
    insightsDegradedBanner: makeEl(doc, 'p', { hidden: true }),
    insightsWorkloadSummary: makeEl(doc, 'p'),
    insightsNoticesList: makeEl(doc, 'ul'),
    insightsSubjectsSection: makeEl(doc, 'section', { hidden: true }),
    insightsSubjectsList: makeEl(doc, 'ul'),
    insightsActivityContent: makeEl(doc, 'div'),
    insightsOpenSettings: makeEl(doc, 'button'),
    insightsShowSeg: makeEl(doc, 'div'),
    insightsActivitySeg: makeEl(doc, 'div'),
    insightsClearStart: makeEl(doc, 'button', { disabled: true }),
    insightsClearConfirm: makeEl(doc, 'div', { hidden: true }),
    insightsClearCancel: makeEl(doc, 'button'),
    insightsClearConfirmBtn: makeEl(doc, 'button'),
    insightsSettingsStatus: makeEl(doc, 'p', { hidden: true }),
  };

  uiDom.mineInsightsBtn.appendChild(uiDom.mineInsightsDot);
  uiDom.insightsOverlay.appendChild(uiDom.insightsClose);
  uiDom.insightsOverlay.appendChild(uiDom.insightsOpenSettings);

  const showOnBtn = makeEl(doc, 'button', { 'data-insights-show': 'on', 'aria-pressed': 'true' });
  const showOffBtn = makeEl(doc, 'button', { 'data-insights-show': 'off', 'aria-pressed': 'false' });
  uiDom.insightsShowSeg.appendChild(showOnBtn);
  uiDom.insightsShowSeg.appendChild(showOffBtn);

  const actOffBtn = makeEl(doc, 'button', { 'data-insights-activity': 'off', 'aria-pressed': 'true' });
  const actOnBtn = makeEl(doc, 'button', { 'data-insights-activity': 'on', 'aria-pressed': 'false' });
  uiDom.insightsActivitySeg.appendChild(actOffBtn);
  uiDom.insightsActivitySeg.appendChild(actOnBtn);

  const rt = runtimeState || createInsightsRuntimeState();
  let curTasks = tasks;
  let curProgress = progress;
  let now = nowMs;
  let classRenders = 0;
  let allRenders = 0;
  let progressReloads = 0;
  let settingsOpenedCount = 0;

  const controller = createInsightsController();
  controller.init({
    dom: uiDom,
    doc,
    win,
    storage,
    section,
    runtimeState: rt,
    now: () => now,
    getTasks: () => curTasks,
    getProgress: () => curProgress,
    getCatalog: () => [],
    createSubjectTag: (code) => {
      const span = makeEl(doc, 'span', { className: 'subject-tag' });
      span.textContent = code;
      return span;
    },
    renderClassTasks: () => { classRenders++; controller.refresh(); },
    renderAllTasks: () => { allRenders++; controller.refresh(); },
    openSettings: () => { settingsOpenedCount++; uiDom.settingsOverlay.hidden = false; controller.syncSettings(); },
    reloadProgressFromStorage: () => { progressReloads++; controller.refresh(); },
  });

  return {
    controller,
    uiDom,
    doc,
    win,
    rt,
    buttons: { showOnBtn, showOffBtn, actOffBtn, actOnBtn },
    setTasks: (t) => { curTasks = t; },
    setProgress: (p) => { curProgress = p; },
    setNow: (ms) => { now = ms; },
    counts: () => ({ classRenders, allRenders, progressReloads, settingsOpenedCount }),
  };
}

function makeTask(id, dueDate, { subject = 'GENSCI', status = 'not_started', dueTime } = {}) {
  const [y, m, d] = dueDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    id,
    title: `Task ${id}`,
    subject,
    dueDate: dt,
    dueTime,
    status,
    closedAt: 0,
    getDeadline() { return dt; },
    getDueTimestamp() {
      const ts = new Date(y, m - 1, d);
      if (dueTime) {
        const [hh, mm] = dueTime.split(':').map(Number);
        ts.setHours(hh, mm, 0, 0);
      } else {
        ts.setHours(23, 59, 59, 999);
      }
      return ts;
    },
  };
}

test('default state enables deterministic insights, keeps activity disabled with 0 written bytes, and returns cues only for clusters', () => {
  const { storage, data } = makeStorage();
  const keys = insightsKeysFor('');
  const tasks = [
    makeTask('c1', '2026-11-12', { subject: 'GENSCI' }),
    makeTask('c2', '2026-11-12', { subject: 'GENMATH' }),
    makeTask('s1', '2026-11-16', { subject: 'EFFCOM' }),
    makeTask('o1', '2026-11-05', { subject: 'PKLP' }),
  ];
  const h = makeHarness({ tasks, storage, nowMs: Date.UTC(2026, 10, 8, 12, 0, 0) });

  assert.equal(h.uiDom.mineInsightsBtn.hidden, false);
  assert.equal(h.uiDom.mineInsightsDot.hidden, false);
  assert.equal(h.controller.getTaskCue(tasks[0], 'Nov 12'), '2 due Nov 12');
  assert.equal(h.controller.getTaskCue(tasks[1], 'Nov 12'), '2 due Nov 12');
  assert.equal(h.controller.getTaskCue(tasks[2], 'Nov 16'), null);
  assert.equal(h.controller.getTaskCue(tasks[3], 'Overdue'), null);
  assert.equal(data.has(keys.activity), false);

  const recRes = h.controller.recordTransition(tasks[0], 'in_progress');
  assert.equal(recRes.written, false);
  assert.equal(data.has(keys.activity), false);

  h.controller.openInsights(h.uiDom.mineInsightsBtn);
  assert.equal(h.uiDom.insightsOverlay.hidden, false);
  assert.match(h.uiDom.insightsWorkloadSummary.textContent, /4 open tasks/);
  assert.match(h.uiDom.insightsActivityContent.textContent, /Off by default/);

  h.doc.dispatch({ type: 'keydown', key: 'Escape' });
  assert.equal(h.uiDom.insightsOverlay.hidden, true);
  assert.equal(h.doc.activeElement, h.uiDom.mineInsightsBtn);
  h.controller.dispose();
});

test('three separate settings controls: opt-in recording, show/hide keeping history, clear preserving opt-in, and immediate delete on opt-out', () => {
  const { storage, data } = makeStorage();
  const keys = insightsKeysFor('');
  const tasks = [
    makeTask('t1', '2026-11-12', { subject: 'GENSCI' }),
    makeTask('t2', '2026-11-12', { subject: 'GENMATH' }),
  ];
  const h = makeHarness({ tasks, storage, nowMs: Date.UTC(2026, 10, 8, 12, 0, 0) });

  h.uiDom.settingsOverlay.hidden = false;
  h.controller.syncSettings();
  assert.equal(h.uiDom.insightsClearStart.disabled, true);

  h.buttons.actOnBtn.dispatchEvent({ type: 'click', target: h.buttons.actOnBtn });
  assert.equal(readInsightsPrefs({ storage, section: '' }).activityOptIn, true);
  assert.equal(h.uiDom.insightsClearStart.disabled, true);

  const w1 = h.controller.recordTransition(tasks[0], 'in_progress');
  assert.equal(w1.written, true);
  h.setNow(Date.UTC(2026, 10, 8, 12, 5, 0));
  const w2 = h.controller.recordTransition(tasks[0], 'done');
  assert.equal(w2.written, true);

  h.controller.syncSettings();
  assert.equal(h.uiDom.insightsClearStart.disabled, false);

  h.controller.openInsights(h.uiDom.mineInsightsBtn);
  const actText = h.uiDom.insightsActivityContent.textContent;
  assert.match(actText, /Status changes/);
  assert.match(actText, /2/);
  assert.doesNotMatch(actText, /risk|score|streak|%/i);
  h.controller.closeInsights(true);

  h.buttons.showOffBtn.dispatchEvent({ type: 'click', target: h.buttons.showOffBtn });
  assert.equal(h.uiDom.mineInsightsBtn.hidden, true);
  assert.equal(h.controller.getTaskCue(tasks[0], 'Nov 12'), null);
  assert.ok(readActivityHistory({ storage, section: '' })?.tasks?.t1);

  h.buttons.showOnBtn.dispatchEvent({ type: 'click', target: h.buttons.showOnBtn });
  assert.equal(h.uiDom.mineInsightsBtn.hidden, false);
  assert.equal(h.controller.getTaskCue(tasks[0], 'Nov 12'), '2 due Nov 12');

  h.uiDom.insightsClearStart.dispatchEvent({ type: 'click', target: h.uiDom.insightsClearStart });
  assert.equal(h.uiDom.insightsClearConfirm.hidden, false);
  h.uiDom.insightsClearConfirmBtn.dispatchEvent({ type: 'click', target: h.uiDom.insightsClearConfirmBtn });
  assert.equal(data.has(keys.activity), false);
  assert.equal(readInsightsPrefs({ storage, section: '' }).activityOptIn, true);
  assert.equal(h.uiDom.insightsClearStart.disabled, true);

  h.controller.recordTransition(tasks[1], 'in_progress');
  assert.ok(data.has(keys.activity));
  h.buttons.actOffBtn.dispatchEvent({ type: 'click', target: h.buttons.actOffBtn });
  assert.equal(readInsightsPrefs({ storage, section: '' }).activityOptIn, false);
  assert.equal(data.has(keys.activity), false);
  h.controller.dispose();
});

test('degraded blocked storage keeps deterministic insights active and disables opt-in with honest warning', () => {
  const h = makeHarness({
    tasks: [makeTask('a1', '2026-11-12'), makeTask('a2', '2026-11-12')],
    storage: null,
    nowMs: Date.UTC(2026, 10, 8, 12, 0, 0),
  });

  assert.equal(h.uiDom.mineInsightsBtn.hidden, false);
  assert.equal(h.controller.getTaskCue({ id: 'a1' }, ''), '2 due Nov 12');

  h.controller.openInsights(h.uiDom.mineInsightsBtn);
  assert.equal(h.uiDom.insightsDegradedBanner.hidden, false);
  assert.match(h.uiDom.insightsDegradedBanner.textContent, /unavailable|disabled/i);

  h.controller.syncSettings();
  assert.equal(h.buttons.actOnBtn.disabled, true);
  assert.equal(h.uiDom.insightsSettingsStatus.hidden, false);
  assert.equal(h.uiDom.insightsSettingsStatus.classList.contains('is-warning'), true);
  assert.equal(h.uiDom.insightsSettingsStatus.getAttribute('role'), 'alert');

  h.buttons.showOffBtn.dispatchEvent({ type: 'click', target: h.buttons.showOffBtn });
  assert.equal(h.uiDom.mineInsightsBtn.hidden, true);
  assert.match(h.uiDom.insightsSettingsStatus.textContent, /session only/i);
  h.controller.dispose();
});

test('deletion failure and opt-out failure surface durableConfirmed === false warning accurately without claiming success', () => {
  const { storage, data, mode } = makeStorage();
  const keys = insightsKeysFor('');
  const h = makeHarness({
    tasks: [makeTask('d1', '2026-11-12')],
    storage,
    nowMs: Date.UTC(2026, 10, 8, 12, 0, 0),
  });

  h.buttons.actOnBtn.dispatchEvent({ type: 'click', target: h.buttons.actOnBtn });
  h.controller.recordTransition({ id: 'd1', subject: 'GENSCI' }, 'done');
  assert.ok(data.has(keys.activity));

  mode.failRemove = true;
  h.uiDom.settingsOverlay.hidden = false;
  h.controller.syncSettings();
  h.uiDom.insightsClearStart.dispatchEvent({ type: 'click', target: h.uiDom.insightsClearStart });
  h.uiDom.insightsClearConfirmBtn.dispatchEvent({ type: 'click', target: h.uiDom.insightsClearConfirmBtn });

  assert.equal(h.uiDom.insightsSettingsStatus.hidden, false);
  assert.equal(h.uiDom.insightsSettingsStatus.classList.contains('is-warning'), true);
  assert.equal(h.uiDom.insightsSettingsStatus.getAttribute('role'), 'alert');
  assert.match(h.uiDom.insightsSettingsStatus.textContent, /could not be confirmed/i);
  assert.equal(h.uiDom.insightsClearStart.disabled, false);

  mode.failSet = true;
  h.buttons.actOffBtn.dispatchEvent({ type: 'click', target: h.buttons.actOffBtn });
  assert.match(h.uiDom.insightsSettingsStatus.textContent, /failed/i);
  assert.equal(h.buttons.actOnBtn.disabled, true);

  mode.failRemove = false;
  mode.failSet = false;
  h.win.dispatchStorage(keys.prefs);
  assert.equal(data.has(keys.activity), false);
  h.controller.dispose();
});

test('cross-tab storage event refreshes displayed cues, prefs, history, and progress', () => {
  const { storage, data } = makeStorage();
  const keys = insightsKeysFor('b');
  const tasks = [
    makeTask('b1', '2026-11-12', { subject: 'GENSCI' }),
    makeTask('b2', '2026-11-12', { subject: 'GENMATH' }),
  ];
  const h = makeHarness({
    tasks,
    storage,
    section: 'b',
    nowMs: Date.UTC(2026, 10, 8, 12, 0, 0),
  });
  h.controller.openInsights(h.uiDom.mineInsightsBtn);

  data.set(keys.prefs, JSON.stringify({ v: 1, showInsights: true, activityOptIn: true }));
  data.set(keys.activity, JSON.stringify({
    v: 1,
    tasks: { b1: { s: 'GENSCI', d: null, r: 0, e: [[1, 1794139200]], lastSec: 1794139200 } },
  }));
  h.win.dispatchStorage(keys.activity);
  assert.match(h.uiDom.insightsActivityContent.textContent, /Status changes/);
  assert.match(h.uiDom.insightsActivityContent.textContent, /1/);

  data.set(keys.prefs, JSON.stringify({ v: 1, showInsights: false, activityOptIn: true }));
  h.win.dispatchStorage(keys.prefs);
  assert.equal(h.uiDom.insightsOverlay.hidden, true);
  assert.equal(h.uiDom.mineInsightsBtn.hidden, true);
  assert.equal(h.controller.getTaskCue(tasks[0], 'Nov 12'), null);

  h.win.dispatchStorage('b_class_tasks_progress');
  assert.ok(h.counts().progressReloads >= 1);
  h.controller.dispose();
});

test('empty and all-done boards render calmly without throwing', () => {
  const { storage } = makeStorage();
  const h = makeHarness({ tasks: [], storage });
  assert.equal(h.uiDom.mineInsightsBtn.hidden, true);
  h.uiDom.insightsOverlay.hidden = false;
  h.controller.refresh();
  assert.equal(h.uiDom.insightsWorkloadSummary.textContent, 'No class tasks posted yet.');
  assert.equal(h.uiDom.insightsNoticesList.hidden, true);

  h.setTasks([makeTask('e1', '2026-11-12', { status: 'done' })]);
  h.controller.refresh();
  assert.equal(h.uiDom.mineInsightsBtn.hidden, false);
  assert.equal(h.uiDom.insightsWorkloadSummary.textContent, 'All caught up — no open class tasks right now.');
  h.controller.dispose();
});

test('activity read failure when opted in surfaces degraded warning immediately on overlay and settings', () => {
  const { storage } = makeStorage();
  const keys = insightsKeysFor('');
  storage.setItem(keys.prefs, JSON.stringify({ v: 1, showInsights: true, activityOptIn: true }));
  storage.setItem(keys.activity, JSON.stringify({ v: 1, tasks: { x1: { s: 'GENSCI', d: null, r: 0, e: [[1, 1794139200]], lastSec: 1794139200 } } }));

  const guarded = {
    get length() { return storage.length; },
    key(i) { return storage.key(i); },
    getItem(k) {
      if (k === keys.activity) throw Object.assign(new Error('Blocked'), { name: 'SecurityError' });
      return storage.getItem(k);
    },
    setItem(k, v) { return storage.setItem(k, v); },
    removeItem(k) { return storage.removeItem(k); },
  };
  const h = makeHarness({
    tasks: [makeTask('x1', '2026-11-12')],
    storage: guarded,
    nowMs: Date.UTC(2026, 10, 8, 12, 0, 0),
  });

  h.controller.openInsights(h.uiDom.mineInsightsBtn);
  assert.equal(h.uiDom.insightsDegradedBanner.hidden, false);
  assert.match(h.uiDom.insightsDegradedBanner.textContent, /suspended/i);
  assert.match(h.uiDom.insightsActivityContent.textContent, /paused/i);
  h.controller.closeInsights(true);

  h.uiDom.settingsOverlay.hidden = false;
  h.controller.syncSettings();
  assert.equal(h.uiDom.insightsSettingsStatus.hidden, false);
  assert.equal(h.uiDom.insightsSettingsStatus.classList.contains('is-warning'), true);
  assert.equal(h.uiDom.insightsSettingsStatus.getAttribute('role'), 'alert');
  assert.match(h.uiDom.insightsSettingsStatus.textContent, /suspended/i);
  h.controller.dispose();
});
