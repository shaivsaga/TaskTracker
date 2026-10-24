// Tests for logic.js. Run with: node --test tests/
// logic.js is a plain browser script, so it is loaded into a sandbox here.
// Time is frozen at Saturday 2026-10-24 12:00 local so date labels are stable.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RealDate = Date;
const NOW = new RealDate(2026, 9, 24, 12, 0, 0).getTime();
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}

const ctx = vm.createContext({ Date: FakeDate, console });
const src = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
vm.runInContext(src, ctx, { filename: 'logic.js' });
const L = vm.runInContext(
  '({ Task, dayDiff, toInputValue, cleanFiles, sortTasks, mergeProgress, parseTimeWord, parseDateText, makeDate, todayDate })',
  ctx
);
// Objects built inside the sandbox have a different prototype; compare plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));
const day = (offset, h = 0, m = 0) => new FakeDate(2026, 9, 24 + offset, h, m);
const task = (o) => new L.Task(o);

test('dayDiff counts calendar days, ignoring the time of day', () => {
  assert.equal(L.dayDiff(day(0, 23, 59)), 0);
  assert.equal(L.dayDiff(day(1)), 1);
  assert.equal(L.dayDiff(day(-3)), -3);
  assert.equal(L.dayDiff(new FakeDate(2026, 10, 3)), 10); // across a month end
});

test('toInputValue pads month and day', () => {
  assert.equal(L.toInputValue(new FakeDate(2026, 0, 5)), '2026-01-05');
  assert.equal(L.toInputValue(new FakeDate(2026, 11, 31)), '2026-12-31');
});

test('makeDate rejects dates that do not exist', () => {
  assert.equal(L.makeDate(2026, 1, 30), null);
  assert.equal(L.toInputValue(L.makeDate(2028, 1, 29)), '2028-02-29');
  assert.equal(L.makeDate(2027, 1, 29), null);
});

test('parseTimeWord understands the quick-add time shorthands', () => {
  const cases = {
    '3pm': '15:00', '3:30pm': '15:30', '12am': '00:00', '12pm': '12:00',
    '1159pm': '23:59', '315pm': '15:15', '930am': '09:30', '15:30': '15:30', '9:05': '09:05',
  };
  for (const [word, want] of Object.entries(cases)) assert.equal(L.parseTimeWord(word), want, word);
  for (const bad of ['13pm', '0pm', '25:00', '12:60', 'hello', '', 'tmr']) {
    assert.equal(L.parseTimeWord(bad), null, bad);
  }
});

test('parseDateText understands the date shorthands (today is Sat 2026-10-24)', () => {
  const iso = (text) => { const d = L.parseDateText(text); return d && L.toInputValue(d); };
  assert.equal(iso('today'), '2026-10-24');
  assert.equal(iso('tmr'), '2026-10-25');
  assert.equal(iso('Tomorrow'), '2026-10-25');
  assert.equal(iso('fri'), '2026-10-30');
  assert.equal(iso('sat'), '2026-10-31', 'the same weekday means next week, not today');
  assert.equal(iso('10/5'), '2026-10-05');
  assert.equal(iso('10/5/27'), '2027-10-05');
  assert.equal(iso('10-5-2026'), '2026-10-05');
  assert.equal(iso('2026-10-05'), '2026-10-05');
  assert.equal(iso('oct 5'), '2026-10-05');
  assert.equal(iso('5 oct 2026'), '2026-10-05');
  assert.equal(iso('  OCT 5, 2026 '), '2026-10-05');
  for (const bad of ['', '   ', '2/30', '13/1', 'garbage', 'foo 5']) assert.equal(L.parseDateText(bad), null, bad);
});

test('Task defaults and title fallback', () => {
  const t = task({});
  assert.equal(t.title, 'New Task');
  assert.equal(t.status, 'not_started');
  assert.equal(task({ title: '' }).title, 'New Task');
  assert.equal(task({ dueDate: '2026-10-30' }).dueDate, undefined, 'a string is not a Date');
});

test('Task.toJSON keeps the date as YYYY-MM-DD and omits empty optional fields', () => {
  const j = plain(task({ id: 'a', title: 'T', dueDate: day(2), dueTime: '15:00', subject: 'PE' }).toJSON());
  assert.deepEqual(j, { id: 'a', title: 'T', dueDate: '2026-10-26', dueTime: '15:00', notes: '', subject: 'PE' });
  assert.equal('files' in plain(task({ id: 'b' }).toJSON()), false);
  assert.equal('closedAt' in plain(task({ id: 'b' }).toJSON()), false);
});

test('getDueDateDisplay uses Today and Tomorrow, then a weekday or full date', () => {
  assert.equal(task({ dueDate: day(0) }).getDueDateDisplay(), 'Today');
  assert.equal(task({ dueDate: day(1) }).getDueDateDisplay(), 'Tomorrow');
  assert.equal(task({}).getDueDateDisplay(), '');
  const far = task({ dueDate: day(40) }).getDueDateDisplay();
  assert.match(far, /2026/, 'a date far away shows the full date');
});

test('getDueHint: future countdowns', () => {
  const hint = (offset, time) => task({ dueDate: day(offset), dueTime: time }).getDueHint();
  assert.equal(hint(0), 'today');
  assert.equal(hint(0, '15:00'), 'in 3 hr');
  assert.equal(hint(0, '12:30'), 'in 30 min');
  assert.equal(hint(1), 'tomorrow');
  assert.equal(hint(5), 'in 5 days');
  assert.equal(hint(13), 'in 13 days');
  assert.equal(hint(20), 'in 2 weeks');
  assert.equal(hint(90), 'in 3 months');
  assert.equal(task({}).getDueHint(), '');
});

test('getDueHint: overdue wording', () => {
  const hint = (offset, time) => task({ dueDate: day(offset), dueTime: time }).getDueHint();
  assert.equal(hint(0, '11:30'), '30 min overdue');
  assert.equal(hint(0, '09:00'), '3 hr overdue');
  assert.equal(hint(-1), '1 day overdue');
  assert.equal(hint(-2), '2 days overdue');
  assert.equal(hint(-7), '1 week overdue');
  assert.equal(hint(-14), '2+ weeks overdue');
});

test('a task with no time is due at the end of its day', () => {
  assert.equal(task({ dueDate: day(0) }).isOverdue(), false);
  assert.equal(task({ dueDate: day(0), dueTime: '11:59' }).isOverdue(), true);
  assert.equal(task({ dueDate: day(0), dueTime: '12:01' }).isOverdue(), false);
  assert.equal(task({ dueDate: day(-1) }).isOverdue(), true);
  assert.equal(task({}).isOverdue(), false);
});

test('getDueLabel capitalises the countdown and appends the time', () => {
  assert.equal(task({}).getDueLabel(), 'Someday');
  assert.equal(task({ dueDate: day(1) }).getDueLabel(), 'Due tomorrow');
  assert.equal(task({ dueDate: day(5) }).getDueLabel(), 'In 5 days');
  assert.equal(task({ dueDate: day(-2) }).getDueLabel(), '2 days overdue');
  assert.match(task({ dueDate: day(5), dueTime: '15:00' }).getDueLabel(), /^In 5 days · /);
});

test('a task moves to Past when closed, or more than 7 days after its due date', () => {
  assert.equal(task({ dueDate: day(-6) }).isPast(), false);
  assert.equal(task({ dueDate: day(-7) }).isPast(), false, '7 days and 12 hours after 23:59 is not yet over a week');
  assert.equal(task({ dueDate: day(-8) }).isPast(), true);
  assert.equal(task({ dueDate: day(-8) }).getPastLabel(), 'Expired');
  const closed = task({ dueDate: day(3), closedAt: NOW });
  assert.equal(closed.isPast(), true);
  assert.equal(closed.getPastLabel(), 'Closed');
  assert.equal(task({}).isPast(), false, 'no due date never expires');
});

test('cleanFiles keeps only well-formed attachments', () => {
  const id = (n, ext = 'pdf') => `${String(n).repeat(32)}.${ext}`;
  const out = plain(L.cleanFiles([
    { id: id('a'), name: 'ok.pdf', size: 10.9 },
    { id: id('b', 'exe'), name: 'bad ext', size: 1 },
    { id: 'short.pdf', name: 'bad id', size: 1 },
    { id: id('c'), name: 'no size' },
    { id: id('d'), name: 5, size: 1 },
    { id: id('e', 'png'), name: 'x'.repeat(300), size: -5 },
    null,
  ]));
  assert.deepEqual(out.map((f) => f.id), [id('a'), id('e', 'png')]);
  assert.equal(out[0].size, 10);
  assert.equal(out[1].name.length, 120);
  assert.equal(out[1].size, 0);
  assert.deepEqual(plain(L.cleanFiles('nope')), []);
  const many = Array.from({ length: 15 }, () => ({ id: id('f'), name: 'f', size: 1 }));
  assert.equal(L.cleanFiles(many).length, 10);
});

test('sortTasks: open tasks by due date, undated last, ties by title, done at the bottom', () => {
  const t = (title, offset, extra = {}) => task({ id: title, title, dueDate: offset === null ? undefined : day(offset), ...extra });
  const sorted = L.sortTasks([
    t('Zeta', 2),
    t('Someday', null),
    t('alpha', 2),
    t('Soon', 1),
    t('Late', -3),
    t('Finished old', 1, { status: 'done', movedAt: 100 }),
    t('Finished new', 5, { status: 'done', movedAt: 200 }),
  ]);
  assert.deepEqual(sorted.map((x) => x.title), ['Late', 'Soon', 'alpha', 'Zeta', 'Someday', 'Finished new', 'Finished old']);
});

test('sortTasks: a time breaks a tie on the same day, and the input is not mutated', () => {
  const a = task({ id: 'a', title: 'A', dueDate: day(1), dueTime: '17:00' });
  const b = task({ id: 'b', title: 'B', dueDate: day(1), dueTime: '08:00' });
  const input = [a, b];
  assert.deepEqual(L.sortTasks(input).map((x) => x.id), ['b', 'a']);
  assert.deepEqual(input.map((x) => x.id), ['a', 'b']);
});

test('mergeProgress: the newer change wins, a tie keeps the local one', () => {
  const local = { a: { status: 'done', movedAt: 100 }, b: { status: 'in_progress', movedAt: 500 }, c: { status: 'done', movedAt: 300 } };
  const incoming = { a: { status: 'not_started', movedAt: 200 }, b: { status: 'done', movedAt: 400 }, c: { status: 'not_started', movedAt: 300 } };
  const r = plain(L.mergeProgress(local, incoming));
  assert.equal(r.merged.a.status, 'not_started', 'incoming is newer');
  assert.equal(r.merged.b.status, 'in_progress', 'local is newer');
  assert.equal(r.merged.c.status, 'done', 'a tie keeps local');
  assert.equal(r.updated, 1);
  assert.equal(r.kept, 2);
  assert.equal(r.added, 0);
});

test('mergeProgress: new tasks are added, not-started ones are not counted, and nothing is mutated', () => {
  const local = { a: { status: 'done', movedAt: 1 } };
  const incoming = { a: { status: 'done', movedAt: 1 }, x: { status: 'done', movedAt: 5 }, y: { status: 'not_started', movedAt: 6 } };
  const snapshot = plain(local);
  const r = plain(L.mergeProgress(local, incoming));
  assert.deepEqual(Object.keys(r.merged).sort(), ['a', 'x', 'y']);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 0);
  assert.equal(r.kept, 0);
  assert.deepEqual(plain(local), snapshot);
});

test('mergeProgress: a task id named like an Object method does not break the merge', () => {
  const r = plain(L.mergeProgress({}, { toString: { status: 'done', movedAt: 9 }, hasOwnProperty: { status: 'done', movedAt: 9 } }));
  assert.equal(r.added, 2);
  assert.equal(r.merged.toString.status, 'done');
});
