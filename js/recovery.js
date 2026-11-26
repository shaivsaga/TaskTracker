export const RECOVERED_PREFIX = '[Recovered copy] ';
export const MAX_TITLE = 500;
const ID_TRIES = 8;

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function markerIds(deletedIds) {
  if (!Array.isArray(deletedIds)) return null;
  const out = [];
  for (const entry of deletedIds) {
    const id = typeof entry === 'string' ? entry : (isObject(entry) && typeof entry.id === 'string' ? entry.id : null);
    if (id === null || id === '') return null;
    out.push(id);
  }
  return out;
}

function filterIdMap(source, deletedIds) {
  const obj = isObject(source) ? source : {};
  const ids = markerIds(deletedIds);
  if (ids === null || ids.length === 0) return { next: { ...obj }, removed: [] };

  const gone = new Set(ids);
  const next = {};
  const removed = [];
  for (const [id, value] of Object.entries(obj)) {
    if (gone.has(id)) { removed.push(id); continue; }
    next[id] = value;
  }
  return { next, removed };
}

export function filterDeletedProgress(progress, deletedIds) {
  const { next, removed } = filterIdMap(progress, deletedIds);
  return { progress: next, removed };
}

export function filterDeletedActivity(activity, deletedIds) {
  if (!isObject(activity) || !isObject(activity.tasks)) {
    return { activity: null, removed: [] };
  }
  const { next, removed } = filterIdMap(activity.tasks, deletedIds);
  return { activity: { ...activity, tasks: next }, removed };
}

export function nextAuthority(known, board) {
  const base = isObject(known) ? known : { revision: 0, deletedIds: [] };
  const knownIds = Array.isArray(base.deletedIds) ? base.deletedIds : [];
  if (!isObject(board)) return null;
  const revision = board.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) return null;
  if (revision < (Number.isSafeInteger(base.revision) ? base.revision : 0)) return null;

  const fromBoard = markerIds(Array.isArray(board.deletedTasks) ? board.deletedTasks : []);
  if (fromBoard === null) return null;
  const incoming = new Set(fromBoard);
  for (const id of knownIds) if (!incoming.has(id)) return null;
  const merged = [...knownIds];
  const seen = new Set(knownIds);
  for (const id of fromBoard) {
    if (!seen.has(id)) { seen.add(id); merged.push(id); }
  }
  return { revision, deletedIds: merged };
}

function trimTitle(title, id) {
  const base = typeof title === 'string' && title !== '' ? title : String(id);
  const room = MAX_TITLE - RECOVERED_PREFIX.length;
  return RECOVERED_PREFIX + (base.length > room ? base.slice(0, room) : base);
}

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
