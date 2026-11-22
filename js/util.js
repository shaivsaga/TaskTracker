// js/util.js - leaf-pure helpers shared by app.js (app.js split, slice 2.1).
//
// "Leaf-pure" is the entry bar: nothing here reads the DOM, the module state in js/state.js, or
// logic.js, and nothing runs at evaluation time. D6: no logic.js import, and no ?v= on the
// js/ <-> js/ imports, so every importer gets the same module instance.

// --- JSON over localStorage: never throws, so a full or blocked store degrades to the fallback -----
export const readJSON = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch (e) { return fallback; } };
export const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

// --- Small formatters ------------------------------------------------------------------------------
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const fmtWhen = (ts) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}


// --- Pure data maps, moved out of app.js (slice 2.2) ------------------------------------------------
// COLUMN_TO_STATUS/STATUS_TO_COLUMN drive the board columns; KEYS/API are the localStorage keys and
// endpoint paths. Pure data: no DOM, no state, nothing evaluated at import time.
export const COLUMN_TO_STATUS = {
  todo: 'not_started',
  progress: 'in_progress',
  done: 'done',
};

export const STATUS_TO_COLUMN = {
  not_started: 'todo',
  in_progress: 'progress',
  done: 'done',
};

export const SECTION_PATH_RE = /^\/s\/([a-z0-9][a-z0-9_-]{0,31})\/[a-f0-9]{32}(?:\/|$)/i;

export function currentSection(pathname = typeof location !== 'undefined' ? location.pathname : '') {
  const m = SECTION_PATH_RE.exec(String(pathname || ''));
  if (!m) return '';
  const id = m[1].toLowerCase();
  return id === 'a' ? '' : id;
}

export function sectionKey(base, section = currentSection()) {
  const id = String(section || '').toLowerCase();
  return id && id !== 'a' ? `${id}_${base}` : base;
}

export function keysForSection(section = currentSection()) {
  const id = String(section || '').toLowerCase();
  const sec = id && id !== 'a' ? id : '';
  return {
    draft: sectionKey('class_tasks_draft', sec),
    progress: sectionKey('class_tasks_progress', sec),
    checkpoints: sectionKey('class_tasks_checkpoints', sec),
    cache: sectionKey('class_tasks_published_cache', sec),
    legacy: sec ? null : 'class_tasks_mvp',
  };
}

export const KEYS = keysForSection();

export const API = { publish: 'api/publish.php', versions: 'api/versions.php', current: 'data/current.json' };
