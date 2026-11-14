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
  mergeProgress,
  clampPopoverPosition,
  pageFromHash,
  taskIdOk,
  STATUS_LABELS,
  statusChangeMessage
} from '../logic.js';

const dateOffset = (days) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
};

// Run fn with Date frozen at an ISO instant. logic.js and the Task methods read Date.now()
// and new Date() at call time, so both go through the replacement. The stand-in shares
// Date.prototype, so ordinary Date instances still pass `instanceof Date`.
const withFrozenNow = (iso, fn) => {
  const RealDate = Date;
  const frozen = new RealDate(iso).getTime();
  function FrozenDate(...args) { return args.length ? new RealDate(...args) : new RealDate(frozen); }
  Object.setPrototypeOf(FrozenDate, RealDate);
  FrozenDate.now = () => frozen;
  FrozenDate.prototype = RealDate.prototype;
  globalThis.Date = FrozenDate;
  try { return fn(); } finally { globalThis.Date = RealDate; }
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

test('clampPopoverPosition flips the popover above the trigger near the viewport bottom', () => {
  // Mobile 390x844: trigger at y 826-830, popover 150x116 — audit case A1
  const pos = clampPopoverPosition({ top: 826, bottom: 830, left: 12 }, 150, 116, 390, 844);
  assert.equal(pos.top, 706);
  assert.equal(pos.left, 12);
  assert.ok(pos.top >= 8 && pos.top + 116 <= 844 - 8, 'popover fully inside viewport');
});

test('clampPopoverPosition keeps a mid-screen popover below the trigger', () => {
  const pos = clampPopoverPosition({ top: 545, bottom: 549, left: 20 }, 150, 116, 390, 844);
  assert.equal(pos.top, 553);
  assert.equal(pos.left, 20);
});

test('clampPopoverPosition keeps the popover fully visible for desktop bottom rows', () => {
  const pos = clampPopoverPosition({ top: 640, bottom: 644, left: 100 }, 150, 116, 1280, 686);
  assert.equal(pos.top, 520);
  assert.equal(pos.left, 100);
  assert.ok(pos.top + 116 <= 686 - 8, 'popover fully inside viewport');
});

test('clampPopoverPosition clamps the popover horizontally inside the viewport', () => {
  const pos = clampPopoverPosition({ top: 100, bottom: 104, left: 350 }, 150, 116, 390, 844);
  assert.equal(pos.left, 390 - 150 - 8);
  assert.ok(pos.left + 150 <= 390, 'popover right edge inside viewport');
});

test('clampPopoverPosition pins degenerate cases to the viewport margin', () => {
  // popover taller than the viewport: top pinned to the margin, never negative
  const tall = clampPopoverPosition({ top: 20, bottom: 24, left: 8 }, 150, 2000, 390, 844);
  assert.equal(tall.top, 8);
  // trigger near the top with an oversized popover: no flip, still pinned to the margin
  const topPin = clampPopoverPosition({ top: 826, bottom: 830, left: 8 }, 150, 2000, 390, 844);
  assert.equal(topPin.top, 8);
  // hidden/detached anchor (zero-size rect): stays inside the viewport
  const zero = clampPopoverPosition({ top: 0, bottom: 0, left: 0 }, 0, 0, 390, 844);
  assert.deepEqual(zero, { top: 8, left: 8 });
});

test('pageFromHash resolves deep links, falling back like the sidebar does', () => {
  const pages = ['class-tasks', 'my-tasks', 'done', 'past', 'calendar'];
  // audit case A2: a shared/bookmarked hash lands on the right page
  assert.equal(pageFromHash('#calendar', pages, false), 'calendar');
  assert.equal(pageFromHash('#done', pages, false), 'done');
  assert.equal(pageFromHash('#past', pages, false), 'past');
  assert.equal(pageFromHash('#class-tasks', pages, false), 'class-tasks');
  // empty or missing hash -> default page
  assert.equal(pageFromHash('', pages, false), 'class-tasks');
  assert.equal(pageFromHash(undefined, pages, false), 'class-tasks');
  // unknown hash -> default page, never an invalid one
  assert.equal(pageFromHash('#bogus', pages, false), 'class-tasks');
  // admin-only page falls back for students, opens for the admin
  assert.equal(pageFromHash('#my-tasks', pages, false), 'class-tasks');
  assert.equal(pageFromHash('#my-tasks', pages, true), 'my-tasks');
});

test('statusChangeMessage names the status the task moved to', () => {
  // review finding 1: a reopen to "In progress" must not announce "not done"
  assert.equal(statusChangeMessage('done'), 'Marked done');
  assert.equal(statusChangeMessage('not_started'), 'Marked not started');
  assert.equal(statusChangeMessage('in_progress'), 'Marked in progress');
  // every status has a label, so the message always names a real status
  assert.deepEqual(Object.keys(STATUS_LABELS).sort(), ['done', 'in_progress', 'not_started']);
});

test('taskIdOk accepts generated ids and rejects anything that could break a selector', () => {
  // review finding L2: a transfer draft task id reaches [data-task-id="..."] and progress[id]
  assert.ok(taskIdOk('k3f9a2x1b7'));
  assert.ok(taskIdOk('a-b_c.d'));
  assert.ok(taskIdOk(42));                       // String(opts.id) in the Task constructor
  assert.ok(taskIdOk(undefined));                // absent id: the constructor generates one
  // a quote or bracket would escape the attribute selector
  assert.equal(taskIdOk('x"]'), false);
  assert.equal(taskIdOk('x\\'), false);
  assert.equal(taskIdOk('a b'), false);
  assert.equal(taskIdOk(''), false);
  assert.equal(taskIdOk('x'.repeat(101)), false);
  assert.equal(taskIdOk('__proto__'), false);    // the id is also an object key
  assert.equal(taskIdOk({}), false);             // "[object Object]" has a space and brackets
});

test('getDueLabel includes short calendar date alongside relative countdown beyond tomorrow', () => {
  const today = new Task({ title: 'Today task', dueDate: dateOffset(0) });
  const tomorrow = new Task({ title: 'Tomorrow task', dueDate: dateOffset(1) });
  const twoWeeks = new Task({ title: 'Future task', dueDate: dateOffset(15) });
  const overdue = new Task({ title: 'Overdue task', dueDate: dateOffset(-3) });
  assert.equal(today.getDueLabel(), 'Due today');
  assert.equal(tomorrow.getDueLabel(), 'Due tomorrow');
  assert.match(twoWeeks.getDueLabel(), /^In 2 weeks · [A-Z][a-z]{2} \d{1,2}/);
  assert.match(overdue.getDueLabel(), /^3 days overdue · [A-Z][a-z]{2} \d{1,2}/);
});

test('Task endDate serializes, validates ordering, and formats range with arrow', () => {
  const start = new Date(2026, 10, 13);
  const end = new Date(2026, 10, 16);
  const earlier = new Date(2026, 10, 10);

  const ranged = new Task({ title: 'Range', dueDate: start, endDate: end });
  assert.equal(ranged.toJSON().dueDate, '2026-11-13');
  assert.equal(ranged.toJSON().endDate, '2026-11-16');
  assert.match(ranged.getDueShort(), /→/);
  assert.match(ranged.getDueDateDisplay(), /→/);

  assert.equal(ranged.dueDate.getTime(), start.getTime());
  assert.equal(ranged.endDate.getTime(), end.getTime());

  const reversed = new Task({ title: 'Bad order', dueDate: start, endDate: earlier });
  assert.equal(reversed.endDate, undefined);
  assert.equal(reversed.toJSON().endDate, undefined);

  const orphan = new Task({ title: 'No start', endDate: end });
  assert.equal(orphan.endDate, undefined);

  // The range's last day is the deadline: the window is open on Nov 19, overdue on Nov 21.
  const open = () => new Task({ title: 'Open', dueDate: start, endDate: new Date(2026, 10, 20) });
  withFrozenNow('2026-11-19T12:00:00', () => {
    const task = open();
    assert.equal(task.isOverdue(), false);
    assert.equal(task.getDueTimestamp().getTime(), new Date(2026, 10, 20, 23, 59, 59, 999).getTime());
    assert.equal(task.getDueHint(), 'tomorrow');
    const label = task.getDueLabel();
    assert.match(label, /Nov 13[–-]20/);  // both endpoints, month collapsed (item 5's format)
    assert.doesNotMatch(label, /overdue/i);

    const sameMonth = new Task({ dueDate: new Date(2026, 10, 19), endDate: new Date(2026, 10, 20) });
    assert.match(sameMonth.getDueLabel(), /Nov 19–20/);

    const acrossMonths = new Task({ dueDate: new Date(2026, 10, 19), endDate: new Date(2026, 11, 3) });
    assert.match(acrossMonths.getDueLabel(), /Nov 19 – Dec 3/);

    const acrossYears = new Task({ dueDate: new Date(2026, 11, 30), endDate: new Date(2027, 0, 3) });
    assert.match(acrossYears.getDueLabel(), /Dec 30, 2026 – Jan 3, 2027/);
  });
  withFrozenNow('2026-11-19T12:00:00', () => {
    const timed = new Task({ title: 'Timed', dueDate: start, endDate: new Date(2026, 10, 20), dueTime: '08:30' });
    assert.equal(timed.getDueTimestamp().getTime(), new Date(2026, 10, 20, 8, 30).getTime());
    assert.ok(timed.getDueDateDisplay().includes(timed.getTimeLabel()));
  });
  withFrozenNow('2026-11-21T12:00:00', () => {
    assert.equal(open().isOverdue(), true);
  });
});
