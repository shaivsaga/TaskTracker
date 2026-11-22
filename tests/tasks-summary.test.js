import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Task } from '../logic.js';
import { summarizeMine } from '../js/tasks.js';

test('summarizeMine hides on empty board and counts only active unfinished tasks using range endDate', () => {
  const now = new Date(2026, 10, 21, 12, 0, 0).getTime();
  assert.equal(summarizeMine([], now).hidden, true);

  const closed = new Task({ id: 'c1', title: 'Closed', dueDate: new Date(2026, 10, 22), closedAt: now - 1000 });
  const done = new Task({ id: 'd1', title: 'Done', dueDate: new Date(2026, 10, 22), status: 'done' });
  const expired = new Task({ id: 'e1', title: 'Old', dueDate: new Date(2026, 10, 1) });
  const range = new Task({ id: 'r1', title: 'Range task', dueDate: new Date(2026, 10, 11), endDate: new Date(2026, 10, 22) });

  const summary = summarizeMine([closed, done, expired, range], now);
  assert.equal(summary.hidden, false);
  assert.equal(summary.count, 1);
  assert.equal(summary.olderOverdue, 1);
  assert.match(summary.nextText, /Next: Range task · Tomorrow/);
  assert.doesNotMatch(summary.nextText, /older in Past/);
});
