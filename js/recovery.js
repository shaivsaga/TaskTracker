/**
 * js/recovery.js - the device-side half of the recovery contract.
 *
 * Pure, no DOM and no network. The server owns deletion authority; these helpers only decide what
 * a *verified* authority means for this browser's data, and never invent one. A caller that cannot
 * prove an authority passes nothing, and nothing is erased.
 */

// A recovered copy is visibly labelled: it is not the task that was permanently deleted.
export const RECOVERED_PREFIX = '[Recovered copy] ';
export const MAX_TITLE = 500;
const ID_TRIES = 8;

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// A verified marker list, or null when the value cannot be trusted as authority at all. An
// imported or cached array must never be usable here: only ids the server proved reach this point.
function markerIds(deletedIds) {
  if (!Array.isArray(deletedIds)) return null;
  const out = [];
  for (const entry of deletedIds) {
    const id = typeof entry === 'string' ? entry : (isObject(entry) && typeof entry.id === 'string' ? entry.id : null);
    if (id === null || id === '') return null;   // one bad element makes the whole list unusable
    out.push(id);
  }
  return out;
}

/**
 * Erase exactly the progress entries whose ids the server proved deleted.
 * Returns a new progress object plus the ids actually removed. Absence from the board is not
 * authority: an id that is merely missing keeps its entry.
 */
export function filterDeletedProgress(progress, deletedIds) {
  const source = isObject(progress) ? progress : {};
  const ids = markerIds(deletedIds);
  if (ids === null || ids.length === 0) return { progress: { ...source }, removed: [] };

  const gone = new Set(ids);
  const next = {};
  const removed = [];
  for (const [id, value] of Object.entries(source)) {
    if (gone.has(id)) { removed.push(id); continue; }
    next[id] = value;
  }
  return { progress: next, removed };
}

/**
 * Fold one board's authority into what this session already knows. Growth only: a lower revision, a
 * revision that is not a safe integer, or a board whose marker list lost an id we already knew is
 * not a newer truth, so it is refused rather than believed.
 * Returns { revision, deletedIds } or null.
 */
export function nextAuthority(known, board) {
  const base = isObject(known) ? known : { revision: 0, deletedIds: [] };
  const knownIds = Array.isArray(base.deletedIds) ? base.deletedIds : [];
  if (!isObject(board)) return null;
  const revision = board.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) return null;
  if (revision < (Number.isSafeInteger(base.revision) ? base.revision : 0)) return null;

  const fromBoard = markerIds(Array.isArray(board.deletedTasks) ? board.deletedTasks : []);
  if (fromBoard === null) return null;
  const merged = [...knownIds];
  const seen = new Set(knownIds);
  for (const id of fromBoard) {
    if (!seen.has(id)) { seen.add(id); merged.push(id); }
  }
  for (const id of knownIds) if (!seen.has(id)) return null;   // a marker disappeared: refuse the board
  return { revision, deletedIds: merged };
}

function trimTitle(title, id) {
  const base = typeof title === 'string' && title !== '' ? title : String(id);
  const room = MAX_TITLE - RECOVERED_PREFIX.length;
  return RECOVERED_PREFIX + (base.length > room ? base.slice(0, room) : base);
}

/**
 * Build a draft from restored content. A task whose id is still usable keeps its id, definition
 * and stamps exactly; a task whose id was permanently deleted, or which would collide, becomes a
 * labelled copy with a fresh id, no closed state and no change stamp (the server re-stamps it),
 * and no progress is carried over.
 * Returns { content, recovered: [{from, to}] }, or throws when a free id cannot be allocated.
 */
export function prepareRecoveredDraft(content, forbiddenIds, makeId) {
  const source = isObject(content) ? content : {};
  const forbidden = new Set(markerIds(forbiddenIds) ?? []);
  const tasks = (Array.isArray(source.tasks) ? source.tasks : []).filter(isObject);
  const taken = new Set(tasks.map((t) => String(t.id)));

  const used = new Set();
  const recovered = [];
  const out = tasks.map((task) => {
    const id = String(task.id);
    const collides = forbidden.has(id) || used.has(id);
    if (!collides) {
      used.add(id);
      return { ...task };
    }
    let fresh = null;
    for (let i = 0; i < ID_TRIES && fresh === null; i++) {
      const candidate = String(makeId());
      if (candidate === '' || candidate === id || forbidden.has(candidate) || taken.has(candidate) || used.has(candidate)) continue;
      fresh = candidate;
    }
    if (fresh === null) throw new Error(`recovery could not allocate a free id for task ${id}`);
    used.add(fresh);
    taken.add(fresh);
    recovered.push({ from: id, to: fresh });
    const copy = { ...task, id: fresh, title: trimTitle(task.title, id) };
    delete copy.closedAt;
    delete copy.changedAt;
    return copy;
  });

  const next = { ...source, tasks: out };
  if (!Array.isArray(next.announcements)) delete next.announcements;
  return { content: next, recovered };
}
