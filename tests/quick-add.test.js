/**
 * tests/quick-add.test.js - pure natural-language quick-add parsing tests.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookup, parseTimeWord, WEEKDAYS } from '../logic.js';
import { quickWords, parseQuickAdd } from '../js/quick-add.js';

const baseOpts = (extra = {}) => ({
  subjects: { GENMATH: 'bg-blue', BIO: 'bg-green' },
  picked: { date: null, endDate: null, time: null },
  now: new Date(2026, 10, 18, 9, 0, 0), // Wed Nov 18, 2026
  parseTimeWord,
  lookup,
  weekdays: WEEKDAYS,
  ...extra,
});

test('quickWords keeps two-word statuses together', () => {
  assert.deepEqual(quickWords('GENMATH in progress worksheet'), ['GENMATH', 'in progress', 'worksheet']);
  assert.deepEqual(quickWords('not started quiz'), ['not started', 'quiz']);
});

test('parseQuickAdd extracts subject, status, date, time, and title', () => {
  const out = parseQuickAdd('genmath Worksheet 4 ip tmr 3pm', baseOpts());
  assert.equal(out.subject, 'GENMATH');
  assert.equal(out.status, 'in_progress');
  assert.equal(out.typedStatus, true);
  assert.equal(out.dueDate.getFullYear(), 2026);
  assert.equal(out.dueDate.getMonth(), 10);
  assert.equal(out.dueDate.getDate(), 19);
  assert.equal(out.dueTime, '15:00');
  assert.equal(out.title, 'Worksheet 4');
});

test('parseQuickAdd drops orphan dueTime without a date and lets picker override typed date/range', () => {
  const noDate = parseQuickAdd('BIO lab 4pm', baseOpts());
  assert.equal(noDate.dueDate, undefined);
  assert.equal(noDate.dueTime, undefined);

  const start = new Date(2026, 10, 20);
  const end = new Date(2026, 10, 23);
  const picked = parseQuickAdd('BIO lab today', baseOpts({ picked: { date: start, endDate: end, time: '14:30' } }));
  assert.equal(picked.dueDate, start);
  assert.equal(picked.endDate, end);
  assert.equal(picked.dueTime, '14:30');
});

test('parseQuickAdd recognises custom-colour subjects whose class value is empty string', () => {
  const out = parseQuickAdd('CUSTOM essay today', baseOpts({ subjects: { CUSTOM: '' } }));
  assert.equal(out.subject, 'CUSTOM');
  assert.equal(out.title, 'essay');
});
