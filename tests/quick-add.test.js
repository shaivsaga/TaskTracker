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

test('quickWords preserves quoted literal phrases and keeps status words intact', () => {
  assert.deepEqual(quickWords('GENMATH "Report due Friday" monday'), ['GENMATH', 'Report due Friday', 'monday']);
  assert.deepEqual(quickWords('not started quiz'), ['not', 'started', 'quiz']);
});

test('parseQuickAdd peels only leading subject and trailing unambiguous date/time (preserving ip and sat/sun)', () => {
  const out = parseQuickAdd('genmath Worksheet 4 ip tmr 3pm', baseOpts());
  assert.equal(out.subject, 'GENMATH');
  assert.equal(out.status, 'not_started');
  assert.equal(out.typedStatus, false);
  assert.equal(out.dueDate.getFullYear(), 2026);
  assert.equal(out.dueDate.getMonth(), 10);
  assert.equal(out.dueDate.getDate(), 19);
  assert.equal(out.dueTime, '15:00');
  assert.equal(out.title, 'Worksheet 4 ip');

  const satWord = parseQuickAdd('Review for sat', baseOpts());
  assert.equal(satWord.dueDate, undefined);
  assert.equal(satWord.title, 'Review for sat');

  const sunWord = parseQuickAdd('Study solar sun', baseOpts());
  assert.equal(sunWord.dueDate, undefined);
  assert.equal(sunWord.title, 'Study solar sun');

  const fullWeekend = parseQuickAdd('BIO Field trip saturday', baseOpts());
  assert.equal(fullWeekend.subject, 'BIO');
  assert.equal(fullWeekend.dueDate.getDate(), 21);
  assert.equal(fullWeekend.title, 'Field trip');

  const middleSubjectAndDate = parseQuickAdd('Prep monday GENMATH quiz', baseOpts());
  assert.equal(middleSubjectAndDate.subject, '');
  assert.equal(middleSubjectAndDate.dueDate, undefined);
  assert.equal(middleSubjectAndDate.title, 'Prep monday GENMATH quiz');
});

test('parseQuickAdd respects double quotes and keepLiteral mode', () => {
  const quoted = parseQuickAdd('BIO "Read notes due Friday"', baseOpts());
  assert.equal(quoted.subject, 'BIO');
  assert.equal(quoted.dueDate, undefined);
  assert.equal(quoted.title, 'Read notes due Friday');

  const lit = parseQuickAdd('GENMATH Report due Friday monday', baseOpts({ keepLiteral: true }));
  assert.equal(lit.subject, '');
  assert.equal(lit.dueDate, undefined);
  assert.equal(lit.title, 'GENMATH Report due Friday monday');
  assert.equal(lit.parsedKeyword, false);
});

test('parseQuickAdd preserves trailing time in title without date and lets picker override', () => {
  const noDate = parseQuickAdd('BIO lab 4pm', baseOpts());
  assert.equal(noDate.subject, 'BIO');
  assert.equal(noDate.dueDate, undefined);
  assert.equal(noDate.dueTime, undefined);
  assert.equal(noDate.title, 'lab 4pm');

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
