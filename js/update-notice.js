// js/update-notice.js - decide which live tasks the once-per-visit update notice names.
//
// The helper is deliberately pure: it reads the raw server-supplied changedAt stamp from each task
// and the stamp map this device saved when it last acknowledged the board. It never touches the
// DOM, localStorage, Task reconstruction or module state, so the board contract can be tested in
// node without a browser.
//
// A valid saved map is a plain object keyed by task id. An id missing from it is New; an id already
// in it is Updated only when a finite positive stamp advanced. Missing, nonfinite, negative and
// zero stamps all behave as zero, so legacy records and an unchanged republish stay quiet.

// Server stamps are epoch seconds. Anything that is not a finite positive number is noise from a
// legacy record, a malformed payload or a cached board, and must never look like a huge advance.
const noticeStamp = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

function isSeenMap(seen) {
  return !!seen && typeof seen === 'object' && !Array.isArray(seen);
}

export function selectNoticeChanges(tasks, seen) {
  // A missing or invalid saved map is a quiet first baseline: the caller records the current
  // stamps instead of announcing a whole board as New.
  if (!isSeenMap(seen) || !Array.isArray(tasks)) return [];

  const changes = [];
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    const id = String(task.id);
    if (!Object.hasOwn(seen, id)) {
      changes.push({ id, isNew: true });
      continue;
    }
    const current = noticeStamp(task.changedAt);
    if (current > 0 && current > noticeStamp(seen[id])) {
      changes.push({ id, isNew: false });
    }
  }
  return changes;
}
