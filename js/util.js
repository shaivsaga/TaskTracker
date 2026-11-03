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
