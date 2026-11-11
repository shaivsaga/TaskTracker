/**
 * tests/overlay-motion.test.js - shared overlay lifecycle core.
 *
 * No browser and no real timers: a tiny fake element records WAAPI calls and lets each
 * test fire onfinish when it wants to. Globals are installed before every test and put
 * back afterwards, because js/motion.js reads matchMedia/document lazily at call time.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  openOverlay, hideOverlay, isReducedMotion,
} from '../js/motion.js';

const ORIGINAL = {
  document: globalThis.document,
  getComputedStyle: globalThis.getComputedStyle,
  matchMedia: globalThis.matchMedia,
  MutationObserver: globalThis.MutationObserver,
};

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';
let mediaReduced = false;
let mediaListeners = [];
let rootObserver = null;

function installDom({ reduce = false, motion } = {}) {
  mediaReduced = reduce;
  mediaListeners = [];
  rootObserver = null;
  globalThis.document = { documentElement: { dataset: {} } };
  if (motion !== undefined) globalThis.document.documentElement.dataset.motion = motion;
  globalThis.matchMedia = (query) => ({
    get matches() { return query === REDUCE_QUERY ? mediaReduced : false; },
    addEventListener(type, fn) { if (type === 'change') mediaListeners.push(fn); },
  });
  // Captures the preference observer so a test can deliver a data-motion change.
  globalThis.MutationObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(target, options) { rootObserver = { cb: this.cb, target, options }; }
    disconnect() {}
  };
  globalThis.getComputedStyle = (el) => ({ opacity: el._opacity ?? (el.hidden ? '0' : '1') });
}

beforeEach(() => installDom());
afterEach(() => {
  globalThis.document = ORIGINAL.document;
  globalThis.getComputedStyle = ORIGINAL.getComputedStyle;
  globalThis.matchMedia = ORIGINAL.matchMedia;
  if (ORIGINAL.MutationObserver === undefined) delete globalThis.MutationObserver;
  else globalThis.MutationObserver = ORIGINAL.MutationObserver;
});

function fireMediaChange(matches) {
  mediaReduced = matches;
  for (const fn of mediaListeners) fn({ matches, media: REDUCE_QUERY });
}

function fireMotionAttribute() {
  assert.ok(rootObserver, 'init must observe data-motion');
  rootObserver.cb([{ attributeName: 'data-motion', target: rootObserver.target }]);
}

// A fresh module instance per init test keeps the one-time preference observer under test.
let freshCount = 0;
const freshMotion = () => import(`../js/motion.js?fresh=${++freshCount}`);

// A deterministic stand-in for the pieces of an element the overlay core touches.
function makeEl({ hidden = true, opacity = 1 } = {}) {
  const classes = new Set();
  const events = [];
  const anims = [];
  let inertValue = false;
  const el = {
    hidden,
    _opacity: String(opacity),
    _returnFocus: undefined,
    _anims: anims,
    _events: events,
    classList: {
      add(c) { classes.add(c); events.push(`add:${c}`); },
      remove(c) { classes.delete(c); events.push(`remove:${c}`); },
      contains(c) { return classes.has(c); },
    },
    focus() { events.push('focus'); },
    animate(keyframes, options) {
      const anim = {
        keyframes, options, cancelled: false,
        cancel() { anim.cancelled = true; },
        // Simulate a completed animation: apply the last keyframe, then call onfinish.
        finish() {
          assert.equal(anim.cancelled, false, 'cannot finish a cancelled animation');
          const last = keyframes[keyframes.length - 1];
          if (last && last.opacity !== undefined) el._opacity = String(last.opacity);
          anim.onfinish?.();
        },
      };
      anims.push(anim);
      return anim;
    },
  };
  Object.defineProperty(el, 'inert', {
    get() { return inertValue; },
    set(v) { inertValue = v; events.push(`inert:${v}`); },
  });
  return el;
}

const opacities = (anim) => anim.keyframes.map((k) => k.opacity);

test('isReducedMotion reads the OS preference and dataset.motion at call time', () => {
  assert.equal(isReducedMotion(), false);
  mediaReduced = true;
  assert.equal(isReducedMotion(), true);
  mediaReduced = false;
  document.documentElement.dataset.motion = 'reduce';
  assert.equal(isReducedMotion(), true);
  document.documentElement.dataset.motion = 'full';
  assert.equal(isReducedMotion(), false);
});

test('openOverlay fades a hidden overlay in from zero and focuses it', () => {
  const el = makeEl({ hidden: true });
  openOverlay(el);

  assert.equal(el.hidden, false);
  assert.equal(el.inert, false);
  assert.equal(el.classList.contains('is-closing'), false);
  assert.equal(el._anims.length, 1);
  const anim = el._anims[0];
  assert.deepEqual(opacities(anim), [0, 1]);
  assert.equal(anim.options.duration, 180);
  assert.equal(anim.options.fill, 'forwards');
  assert.ok(el._events.includes('focus'));

  anim.finish();
  assert.equal(el.hidden, false);
});

test('hideOverlay releases focus at logical close and hides only at finish', () => {
  const el = makeEl({ hidden: false, opacity: 1 });
  const opener = { isConnected: true };
  el._returnFocus = opener;

  const released = hideOverlay(el);

  assert.equal(released, opener);
  assert.equal(el._returnFocus, null);
  assert.equal(el.inert, true);
  assert.equal(el.classList.contains('is-closing'), true);
  assert.equal(el.hidden, false, 'hide waits for the fade');
  assert.equal(el._anims.length, 1);
  const anim = el._anims[0];
  assert.deepEqual(opacities(anim), [1, 0]);
  assert.equal(anim.options.duration, 180);

  anim.finish();
  assert.equal(el.hidden, true);
  assert.equal(el.classList.contains('is-closing'), false);
});

test('hideOverlay honours a custom duration on the same fade path', () => {
  const el = makeEl({ hidden: false, opacity: 1 });
  hideOverlay(el, 240);
  assert.equal(el._anims[0].options.duration, 240);
  assert.deepEqual(opacities(el._anims[0]), [1, 0]);
});

test('open during close starts from the interrupted presentation opacity', () => {
  const el = makeEl({ hidden: false, opacity: 1 });
  el._returnFocus = {};
  hideOverlay(el);
  const closing = el._anims[0];

  el._opacity = '0.4';
  openOverlay(el);
  const opening = el._anims[1];

  assert.equal(closing.cancelled, true, 'the close animation is cancelled');
  assert.deepEqual(opacities(opening), [0.4, 1]);
  assert.equal(el.hidden, false);
  assert.equal(el.inert, false);
  assert.equal(el.classList.contains('is-closing'), false);
});

test('close during open starts from the interrupted presentation opacity', () => {
  const el = makeEl({ hidden: false, opacity: 1 });
  openOverlay(el);
  const opening = el._anims[0];

  el._opacity = '0.6';
  el._returnFocus = {};
  hideOverlay(el);
  const closing = el._anims[1];

  assert.equal(opening.cancelled, true, 'the open animation is cancelled');
  assert.deepEqual(opacities(closing), [0.6, 0]);
});

test('close/reopen/close cannot finish an older cycle', () => {
  const el = makeEl({ hidden: false, opacity: 1 });
  const opener = {};
  el._returnFocus = opener;
  hideOverlay(el);
  const firstClose = el._anims[0];
  const staleCloseFinish = firstClose.onfinish;

  el._opacity = '0.4';
  openOverlay(el);
  assert.equal(firstClose.cancelled, true);

  const focusAt = el._events.lastIndexOf('focus');
  assert.ok(el._events.indexOf('inert:false') < focusAt, 'inert is cleared before focus');
  assert.ok(el._events.indexOf('remove:is-closing') < focusAt, 'is-closing is cleared before focus');

  staleCloseFinish();
  assert.equal(el.hidden, false, 'stale close must not hide a reopened overlay');
  assert.equal(el.classList.contains('is-closing'), false);

  const openAnim = el._anims[1];
  const staleOpenFinish = openAnim.onfinish;
  el._returnFocus = opener;
  hideOverlay(el);
  const secondClose = el._anims[2];

  staleOpenFinish();
  assert.equal(el.hidden, false, 'stale open must not unhide a closing overlay');
  assert.equal(el.classList.contains('is-closing'), true);

  secondClose.finish();
  assert.equal(el.hidden, true);
});

test('reduced mode from the OS preference hides and shows synchronously', () => {
  installDom({ reduce: true });
  const el = makeEl({ hidden: true });

  openOverlay(el);
  assert.equal(el.hidden, false);
  assert.equal(el.inert, false);
  assert.equal(el._anims.length, 0, 'reduced open must not animate');
  assert.ok(el._events.includes('focus'));

  const opener = {};
  el._returnFocus = opener;
  const released = hideOverlay(el);
  assert.equal(released, opener);
  assert.equal(el.hidden, true, 'reduced close hides immediately');
  assert.equal(el.inert, true);
  assert.equal(el.classList.contains('is-closing'), false);
  assert.equal(el._anims.length, 0, 'reduced close must not animate');
});

test('reduced mode from dataset.motion hides and shows synchronously', () => {
  installDom({ reduce: false, motion: 'reduce' });
  const el = makeEl({ hidden: true });

  openOverlay(el);
  assert.equal(el.hidden, false);
  assert.equal(el._anims.length, 0);

  el._returnFocus = {};
  assert.ok(hideOverlay(el));
  assert.equal(el.hidden, true);
  assert.equal(el.classList.contains('is-closing'), false);
  assert.equal(el._anims.length, 0);
});

test('missing Web Animations API opens and hides synchronously', () => {
  const el = makeEl({ hidden: true });
  delete el.animate;

  openOverlay(el);
  assert.equal(el.hidden, false);
  assert.equal(el.inert, false);
  assert.equal(el.classList.contains('is-closing'), false);
  assert.equal(el._anims.length, 0, 'missing animate must not animate');
  assert.ok(el._events.includes('focus'));

  const opener = {};
  el._returnFocus = opener;
  const released = hideOverlay(el);
  assert.equal(released, opener);
  assert.equal(el._returnFocus, null);
  assert.equal(el.hidden, true, 'missing animate hides immediately');
  assert.equal(el.inert, true);
  assert.equal(el.classList.contains('is-closing'), false);
  assert.equal(el._anims.length, 0, 'missing animate must not animate');
});

test('duplicate and already-hidden closes do not restart work', () => {
  const el = makeEl({ hidden: false, opacity: 1 });
  el._returnFocus = {};
  assert.ok(hideOverlay(el));
  const count = el._anims.length;

  assert.equal(hideOverlay(el), null, 'duplicate close returns no focus');
  assert.equal(el._anims.length, count, 'duplicate close does not animate');

  el._anims[0].finish();
  assert.equal(hideOverlay(el), null, 'already-hidden close returns no focus');
  assert.equal(el._anims.length, count, 'already-hidden close does not animate');

  const neverShown = makeEl({ hidden: true });
  assert.equal(hideOverlay(neverShown), null);
  assert.equal(neverShown._anims.length, 0);
  assert.equal(neverShown.hidden, true);
});

test('an OS reduced-motion change finishes a fading close and the overlay reopens usable', async () => {
  const motion = await freshMotion();
  const el = makeEl({ hidden: false, opacity: 1 });
  el._returnFocus = {};

  motion.init();
  motion.init();
  assert.equal(mediaListeners.length, 1, 'init observes the OS preference exactly once');
  assert.deepEqual(rootObserver.options, { attributes: true, attributeFilter: ['data-motion'] });

  motion.hideOverlay(el);
  const close = el._anims[0];
  let spinnerFinished = false;
  const spinner = {
    effect: { getTiming: () => ({ iterations: Infinity }) },
    finish() { spinnerFinished = true; },
  };
  document.getAnimations = () => [close, spinner];

  fireMediaChange(true);

  assert.equal(el.hidden, true, 'the current close finishes');
  assert.equal(el.inert, true);
  assert.equal(el.classList.contains('is-closing'), false);
  assert.equal(spinnerFinished, false, 'an infinite spinner keeps running');

  motion.openOverlay(el);
  assert.equal(el.hidden, false, 'the reopened overlay is visible');
  assert.equal(el.inert, false);
  assert.equal(el.classList.contains('is-closing'), false);
  assert.equal(el._events.at(-1), 'focus', 'the reopened overlay takes focus');
  assert.equal(el._anims.length, 1, 'a reduced open needs no fade');
});

test('a data-motion change finishes a fading close and the overlay reopens usable', async () => {
  const motion = await freshMotion();
  const el = makeEl({ hidden: false, opacity: 1 });
  el._returnFocus = {};

  motion.init();
  motion.hideOverlay(el);
  const close = el._anims[0];
  let spinnerFinished = false;
  const spinner = {
    effect: { getTiming: () => ({ iterations: Infinity }) },
    finish() { spinnerFinished = true; },
  };
  document.getAnimations = () => [close, spinner];

  document.documentElement.dataset.motion = 'full';
  fireMotionAttribute();
  assert.equal(el.hidden, false, 'a non-reduce value does not settle motion');
  assert.equal(el.classList.contains('is-closing'), true);

  document.documentElement.dataset.motion = 'reduce';
  fireMotionAttribute();

  assert.equal(el.hidden, true, 'the current close finishes');
  assert.equal(el.inert, true);
  assert.equal(el.classList.contains('is-closing'), false);
  assert.equal(spinnerFinished, false, 'an infinite spinner keeps running');

  motion.openOverlay(el);
  assert.equal(el.hidden, false, 'the reopened overlay is visible');
  assert.equal(el.inert, false);
  assert.equal(el.classList.contains('is-closing'), false);
  assert.equal(el._events.at(-1), 'focus', 'the reopened overlay takes focus');
  assert.equal(el._anims.length, 1, 'a reduced open needs no fade');

  // The jsdom harness has no getAnimations at all; a later preference change must not throw.
  delete document.getAnimations;
  document.documentElement.dataset.motion = 'full';
  fireMotionAttribute();
  document.documentElement.dataset.motion = 'reduce';
  fireMotionAttribute();
  assert.equal(el.hidden, false, 'the overlay stays usable without the WAAPI collection');
});
