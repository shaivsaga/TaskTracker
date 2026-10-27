import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dayDiff,
  toInputValue,
  cleanFiles,
  Task,
  sortTasks,
  lookup,
  parseTimeWord,
  makeDate,
  mergeProgress
} from '../logic.js';

const dateOffset = (days) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
};

test('dayDiff handles today, past, and future calendar days', () => {
  assert.equal(dayDiff(dateOffset(0)), 0);
  assert.equal(dayDiff(dateOffset(-3)), -3);
  assert.equal(dayDiff(dateOffset(5)), 5);
});

test('toInputValue formats dates with padded month and day values', () => {
  assert.equal(toInputValue(new Date(2026, 0, 2)), '2026-01-02');
  assert.equal(toInputValue(new Date(2026, 10, 12)), '2026-11-12');
});

test('parseTimeWord accepts twelve-hour and twenty-four-hour forms', () => {
  assert.equal(parseTimeWord('3pm'), '15:00');
  assert.equal(parseTimeWord('12:05am'), '00:05');
  assert.equal(parseTimeWord('1159pm'), '23:59');
  assert.equal(parseTimeWord('7:30'), '07:30');
  assert.equal(parseTimeWord('13:60'), null);
  assert.equal(parseTimeWord('0pm'), null);
});

test('makeDate rejects rollover dates and creates valid dates', () => {
  assert.equal(toInputValue(makeDate(2026, 1, 28)), '2026-02-28');
  assert.equal(makeDate(2026, 1, 29), null);
  assert.equal(makeDate(2026, 12, 1), null);
});

test('Task applies constructor defaults and normalizes supplied values', () => {
  const task = new Task();
  assert.equal(task.title, 'New Task');
  assert.equal(task.status, 'not_started');
  assert.equal(task.movedAt, 0);
  assert.equal(task.notes, '');
  assert.equal(task.subject, '');
  assert.equal(task.closedAt, 0);
  assert.deepEqual(task.files, []);
  assert.equal(new Task({ title: '', status: 4, id: 12 }).title, 'New Task');
  assert.equal(new Task({ title: 'Read', status: 4, id: 12 }).status, '4');
});

test('sortTasks orders open tasks by due timestamp and completed tasks last', () => {
  const tasks = [
    new Task({ id: 'done', title: 'Done', status: 'done', movedAt: 10 }),
    new Task({ id: 'later', title: 'Later', dueDate: dateOffset(3) }),
    new Task({ id: 'soon', title: 'Soon', dueDate: dateOffset(1) }),
    new Task({ id: 'none', title: 'No due date' })
  ];
  assert.deepEqual(sortTasks(tasks).map(({ id }) => id), ['soon', 'later', 'none', 'done']);
});

test('cleanFiles keeps safe upload metadata and sanitizes its shape', () => {
  const longName = 'x'.repeat(130);
  const valid = { id: `${'a'.repeat(32)}.pdf`, name: longName, size: 12.9 };
  const files = cleanFiles([
    valid,
    { id: `${'b'.repeat(32)}.exe`, name: 'bad', size: 1 },
    { id: `${'c'.repeat(32)}.png`, name: 'negative', size: -4 },
    null
  ]);
  assert.deepEqual(files, [
    { id: valid.id, name: 'x'.repeat(120), size: 12 },
    { id: `${'c'.repeat(32)}.png`, name: 'negative', size: 0 }
  ]);
  assert.deepEqual(cleanFiles('not an array'), []);
});

test('lookup only reads own map properties', () => {
  const map = Object.create({ inherited: 'nope' });
  map.own = 'yes';
  assert.equal(lookup(map, 'own'), 'yes');
  assert.equal(lookup(map, 'inherited'), undefined);
});

test('mergeProgress uses newer entries and keeps local entries on ties', () => {
  const local = {
    same: { status: 'in_progress', movedAt: 4 },
    old: { status: 'not_started', movedAt: 1 }
  };
  const result = mergeProgress(local, {
    same: { status: 'done', movedAt: 4 },
    old: { status: 'done', movedAt: 2 },
    added: { status: 'done', movedAt: 3 }
  });
  assert.deepEqual(result.merged.same, local.same);
  assert.deepEqual(result.merged.old, { status: 'done', movedAt: 2 });
  assert.deepEqual(result.merged.added, { status: 'done', movedAt: 3 });
  assert.deepEqual(
    { added: result.added, updated: result.updated, kept: result.kept },
    { added: 1, updated: 1, kept: 1 }
  );
});
