import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = undefined;
globalThis.window = undefined;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { computePublishDiff } = await import('../js/publish.js');

test('computePublishDiff lists named added, edited (with changed fields), removed tasks, announcements, and subjects', () => {
  const pubBoard = {
    tasks: [
      { id: 't1', title: 'Unchanged task', subject: 'GENMATH', dueDate: '2026-11-10', notes: '' },
      { id: 't2', title: 'Lab report', subject: 'GENSCI', dueDate: '2026-11-11', notes: 'Draft' },
      { id: 't3', title: 'Dropped task', subject: 'PE', dueDate: '2026-11-12', notes: '' },
    ],
    announcements: [{ id: 'a1', text: 'Welcome', createdAt: 100 }],
    subjects: [
      { code: 'GENMATH', name: 'GENMATH', color: '#fba6f7', active: true },
      { code: 'PE', name: 'PE', color: '#f7cd54', active: true },
    ],
  };
  const draftSnap = {
    tasks: [
      { id: 't1', title: 'Unchanged task', subject: 'GENMATH', dueDate: '2026-11-10', notes: '' },
      { id: 't2', title: 'Lab report final', subject: 'GENSCI', dueDate: '2026-11-14', notes: 'Revised notes' },
      { id: 't4', title: 'New essay', subject: 'EFFCOM', dueDate: '2026-11-15', notes: '' },
    ],
    announcements: [
      { id: 'a1', text: 'Welcome', createdAt: 100 },
      { id: 'a2', text: 'Exam friday', createdAt: 200 },
    ],
    subjects: [
      { code: 'GENMATH', name: 'General Math', color: '#fba6f7', active: true },
      { code: 'PE', name: 'PE', color: '#f7cd54', active: false },
      { code: 'EFFCOM', name: 'Effective Comm', color: '#8fe3a8', active: true },
    ],
  };

  const diff = computePublishDiff(pubBoard, draftSnap);
  assert.deepEqual(diff.added, [{ id: 't4', title: 'New essay', subject: 'EFFCOM' }]);
  assert.deepEqual(diff.removed, [{ id: 't3', title: 'Dropped task', subject: 'PE' }]);
  assert.equal(diff.edited.length, 1);
  assert.equal(diff.edited[0].title, 'Lab report final');
  assert.deepEqual(diff.edited[0].fields, ['title', 'due date', 'notes']);
  assert.equal(diff.announcements.changed, true);
  assert.deepEqual(diff.announcements.added, ['Exam friday']);
  assert.deepEqual(diff.subjects.added, ['EFFCOM']);
  assert.deepEqual(diff.subjects.updated, ['GENMATH']);
  assert.deepEqual(diff.subjects.retired, ['PE']);
  assert.deepEqual(diff.schedule, { changed: false, action: 'none', slotCount: 0 });

  const withSchedule = computePublishDiff(pubBoard, {
    ...draftSnap,
    schedule: { term: 'T2', slots: [{ day: 1, start: '07:30', end: '08:30', subject: 'GENMATH' }] },
  });
  assert.deepEqual(withSchedule.schedule, { changed: true, action: 'added', slotCount: 1 });

  const updatedSchedule = computePublishDiff(
    { ...pubBoard, schedule: { term: 'T2', slots: [{ day: 1, start: '07:30', end: '08:30', subject: 'GENMATH' }] } },
    { ...draftSnap, schedule: null },
  );
  assert.deepEqual(updatedSchedule.schedule, { changed: true, action: 'cleared', slotCount: 0 });

  const cleared = computePublishDiff(pubBoard, {
    ...draftSnap,
    schedule: { term: 'T2', slots: [{ day: 1, start: '07:30', end: '08:30', subject: 'GENMATH' }] },
  }, { clearBoard: true });
  assert.equal(cleared.added.length, 0);
  assert.equal(cleared.edited.length, 0);
  assert.equal(cleared.removed.length, 3);
  assert.equal(cleared.announcements.changed, false);
  assert.equal(cleared.schedule.changed, false);
});
