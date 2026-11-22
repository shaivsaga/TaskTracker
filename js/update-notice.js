const noticeStamp = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

function isSeenMap(seen) {
  return !!seen && typeof seen === 'object' && !Array.isArray(seen);
}

export function selectNoticeChanges(tasks, seen) {

  if (!isSeenMap(seen) || !Array.isArray(tasks)) return [];

  const changes = [];
  for (const raw of tasks) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id);
    if (!Object.hasOwn(seen, id)) {
      changes.push({ id, isNew: true });
      continue;
    }
    const current = noticeStamp(raw.changedAt);
    if (current > 0 && current > noticeStamp(seen[id])) {
      changes.push({ id, isNew: false });
    }
  }
  return changes;
}
