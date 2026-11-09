/**
 * tests/recovery.test.js - the device-side half of the recovery contract.
 *
 * Two pure decisions, both deliberately separate from the DOM and from any network call:
 *   filterDeletedProgress  which saved progress entries a verified deletion authority erases
 *   prepareRecoveredDraft  which source tasks may keep their id and which must become a new copy
 *
 * Authority itself is never stored in these payloads: the caller passes the ids the server just
 * proved, and these functions cannot invent one.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterDeletedProgress, prepareRecoveredDraft, RECOVERED_PREFIX, MAX_TITLE } from '../js/recovery.js';

const entry = (status, movedAt) => ({ status, movedAt });

test('only marked ids are erased, and the input progress object is not mutated', () => {
  const progress = {
    marked: entry('done', 10),
    kept: entry('in_progress', 20),
    'never-seen': entry('not_started', 30),
  };
  const before = JSON.stringify(progress);
  const { progress: next, removed } = filterDeletedProgress(progress, ['marked']);

  assert.deepEqual(next, { kept: entry('in_progress', 20), 'never-seen': entry('not_started', 30) });
  assert.deepEqual(removed, ['marked']);
  assert.equal(JSON.stringify(progress), before, 'the caller keeps its before-image for retry');
  assert.notEqual(next, progress, 'a new object, never the same reference');
});

test('absence from the board authorises nothing on its own', () => {
  const progress = { 'not-on-board': entry('done', 1) };
  const { progress: next, removed } = filterDeletedProgress(progress, []);
  assert.deepEqual(next, progress);
  assert.deepEqual(removed, []);
});

test('a marked id that has no saved progress removes nothing and still reports cleanly', () => {
  const { progress: next, removed } = filterDeletedProgress({ a: entry('done', 1) }, ['ghost']);
  assert.deepEqual(next, { a: entry('done', 1) });
  assert.deepEqual(removed, []);
});

test('malformed authority is ignored rather than trusted', () => {
  const progress = { a: entry('done', 1) };
  for (const ids of [null, undefined, 'marked', 42, [null], [{}], [['a']]]) {
    const { progress: next, removed } = filterDeletedProgress(progress, ids);
    assert.deepEqual(next, progress, `ids=${JSON.stringify(ids)} must not erase anything`);
    assert.deepEqual(removed, []);
  }
});

test('a marked id is matched exactly, so a near miss is not erased', () => {
  const progress = { abc: entry('done', 1), abcd: entry('done', 2) };
  const { progress: next } = filterDeletedProgress(progress, ['abc']);
  assert.deepEqual(Object.keys(next), ['abcd']);
});

test('unmarked ids keep their id, title and stamp exactly', () => {
  const content = {
    tasks: [
      { id: 'free', title: 'Ordinary', closedAt: 5, changedAt: 7 },
      { id: 'dead', title: 'Permanently deleted', closedAt: 5, changedAt: 7 },
    ],
    announcements: [{ text: 'hi', createdAt: 1 }],
    subjects: [{ code: 'AA', name: 'Alpha', color: '#112233', active: true }],
  };
  const { content: next, recovered } = prepareRecoveredDraft(content, ['dead'], () => 'new-id');

  assert.deepEqual(next.tasks[0], content.tasks[0], 'an unmarked task is byte-identical');
  assert.deepEqual(next.announcements, content.announcements);
  assert.deepEqual(next.subjects, content.subjects);
  assert.deepEqual(content.tasks[1], { id: 'dead', title: 'Permanently deleted', closedAt: 5, changedAt: 7 },
    'the source content is not mutated');

  assert.equal(next.tasks[1].id, 'new-id');
  assert.equal(next.tasks[1].title, `${RECOVERED_PREFIX}Permanently deleted`);
  assert.equal('closedAt' in next.tasks[1], false, 'a recovered copy is not closed');
  assert.equal('changedAt' in next.tasks[1], false, 'the server re-stamps it on publish');
  assert.deepEqual(recovered, [{ from: 'dead', to: 'new-id' }]);
});

test('a recovered title stays within the publish limit', () => {
  const long = 'x'.repeat(MAX_TITLE);
  const { content: next } = prepareRecoveredDraft({ tasks: [{ id: 'dead', title: long }] }, ['dead'], () => 'new-id');
  assert.equal(next.tasks[0].title.length, MAX_TITLE);
  assert.ok(next.tasks[0].title.startsWith(RECOVERED_PREFIX));
});

test('a generated id that collides is regenerated, and a forbidden one is never reused', () => {
  const content = { tasks: [{ id: 'keep', title: 'Kept' }, { id: 'dead', title: 'Gone' }] };
  const ids = ['keep', 'dead', 'fresh'];
  const { content: next } = prepareRecoveredDraft(content, ['dead'], () => ids.shift());
  assert.equal(next.tasks[1].id, 'fresh', 'both the live id and the forbidden id are refused');
  assert.equal(next.tasks[0].id, 'keep');
});

test('an id generator that never yields a free id is refused instead of silently reusing one', () => {
  const content = { tasks: [{ id: 'keep', title: 'Kept' }, { id: 'dead', title: 'Gone' }] };
  assert.throws(() => prepareRecoveredDraft(content, ['dead'], () => 'keep'), /could not allocate/i);
});

test('content without tasks, or with junk entries, still yields a usable draft', () => {
  assert.deepEqual(prepareRecoveredDraft({}, [], () => 'x').content.tasks, []);
  const { content: next } = prepareRecoveredDraft({ tasks: [null, 'x', { id: 'a', title: 'A' }] }, [], () => 'x');
  assert.deepEqual(next.tasks, [{ id: 'a', title: 'A' }]);
});
