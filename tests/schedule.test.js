import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = undefined;
globalThis.window = undefined;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const {
  validateSchedule, canonicalSchedule, resolveCurrentSlot, buildWeekGrid,
  SCHEDULE_MAX_SLOTS, SCHEDULE_MAX_META, SCHEDULE_MAX_LABEL, SCHEDULE_KINDS,
} = await import('../logic.js');
const { createBoardStore, normalizeBoard } = await import('../js/store.js');

const DSCT_CODES = [
  'CP104', 'PKLP', 'GENSCI', 'EFFCOM', 'THEO-112N', 'GENMATH',
  'FINMATH101', 'MABKOM', 'LCS-PERDEV', 'LCS-PE',
];

const SAMPLE_DSCT = {
  term: '2ND TERM – AY 2026-2027',
  sectionLabel: 'DSCT11-A',
  adviser: 'Mr. Jomari V. Borja',
  room: '92C ST. SCHO',
  slots: [
    { day: 3, start: '07:30', end: '09:30', subject: 'FINMATH101', teacher: 'Ms. Shiela Grospe' },
    { day: 1, start: '09:30', end: '09:50', kind: 'break', label: 'RECESS' },
    { day: 1, start: '07:30', end: '08:30', subject: 'CP104', teacher: 'Mr. James Robert A. Salud' },
    { day: 1, start: '08:30', end: '09:30', subject: 'PKLP', teacher: 'Mr. Jay Z. Silvano' },
    { day: 2, start: '07:10', end: '07:30', kind: 'activity', label: 'HOMEROOM' },
    { day: 5, start: '13:50', end: '14:50', kind: 'activity', label: 'CLUB' },
  ],
};

test('validateSchedule validates DSCT11-A, allows touching bounds, and sorts canonically', () => {
  assert.deepEqual(validateSchedule(null), { schedule: null, error: null });
  assert.deepEqual(validateSchedule(undefined), { schedule: null, error: null });

  const res = validateSchedule(SAMPLE_DSCT, DSCT_CODES);
  assert.equal(res.error, null);
  assert.equal(res.schedule.term, '2ND TERM – AY 2026-2027');
  assert.equal(res.schedule.slots.length, 6);
  // Sorted by day, then start: Mon 07:30, Mon 08:30, Mon 09:30, Tue 07:10, Wed 07:30, Fri 13:50
  assert.deepEqual(
    res.schedule.slots.map((s) => `${s.day}:${s.start}`),
    ['1:07:30', '1:08:30', '1:09:30', '2:07:10', '3:07:30', '5:13:50'],
  );
  // Omitted kind with subject defaults cleanly to 'subject'
  assert.equal(res.schedule.slots[0].kind, 'subject');
  assert.equal(res.schedule.slots[0].subject, 'CP104');

  assert.deepEqual(canonicalSchedule({ ...SAMPLE_DSCT, slots: SAMPLE_DSCT.slots.slice().reverse() }), res.schedule);
});

test('validateSchedule rejects overlaps, invalid times, out-of-range days, reserved names, unknown subjects, and excess counts', () => {
  assert.ok(validateSchedule([]).error);
  assert.ok(validateSchedule('bad').error);
  assert.ok(validateSchedule({ slots: 'bad' }).error);

  const overSlots = Array.from({ length: SCHEDULE_MAX_SLOTS + 1 }, (_, i) => ({
    day: 1, start: '07:00', end: '07:01', kind: 'break', label: `B${i}`,
  }));
  assert.ok(validateSchedule({ slots: overSlots }).error);

  // Overlapping slots on same day (half-open): 07:30-09:00 and 08:30-09:30 overlap
  const overlap = validateSchedule({
    slots: [
      { day: 1, start: '07:30', end: '09:00', subject: 'CP104' },
      { day: 1, start: '08:30', end: '09:30', subject: 'PKLP' },
    ],
  });
  assert.match(overlap.error, /overlap/i);

  // Bad days
  for (const badDay of [0, 6, 1.5, '1', null]) {
    assert.ok(validateSchedule({ slots: [{ day: badDay, start: '07:30', end: '08:30', kind: 'break', label: 'X' }] }).error);
  }
  // Bad HH:MM or start >= end
  for (const [s, e] of [['7:30', '08:30'], ['24:00', '23:59'], ['12:60', '13:00'], ['09:00', '09:00'], ['10:00', '09:00']]) {
    assert.ok(validateSchedule({ slots: [{ day: 1, start: s, end: e, kind: 'break', label: 'X' }] }).error);
  }
  // Missing break label, too-long label, control chars
  assert.ok(validateSchedule({ slots: [{ day: 1, start: '07:30', end: '08:00', kind: 'break', label: '   ' }] }).error);
  assert.ok(validateSchedule({ slots: [{ day: 1, start: '07:30', end: '08:00', kind: 'activity', label: 'x'.repeat(SCHEDULE_MAX_LABEL + 1) }] }).error);
  assert.ok(validateSchedule({ term: 'x'.repeat(SCHEDULE_MAX_META + 1), slots: [] }).error);
  assert.ok(validateSchedule({ term: 'Term\u0007', slots: [] }).error);
  // Reserved & unknown subjects
  assert.ok(validateSchedule({ slots: [{ day: 1, start: '07:30', end: '08:30', subject: '__proto__' }] }).error);
  assert.ok(validateSchedule({ slots: [{ day: 1, start: '07:30', end: '08:30', subject: 'UNKNOWN' }] }, DSCT_CODES).error);
  assert.deepEqual(SCHEDULE_KINDS, ['subject', 'break', 'activity']);
});

test('resolveCurrentSlot enforces strict now, resolves active/upcoming/after_hours/weekend, and handles sparse weekdays', () => {
  assert.throws(() => resolveCurrentSlot(SAMPLE_DSCT), TypeError);
  assert.throws(() => resolveCurrentSlot(SAMPLE_DSCT, new Date('invalid')), TypeError);
  assert.throws(() => resolveCurrentSlot(SAMPLE_DSCT, { day: 7, minutes: 60 }), TypeError);

  assert.equal(resolveCurrentSlot(null, { day: 1, minutes: 500 }).state, 'empty');

  // Mon 07:30 exact start boundary -> active CP104 (60 min left), next PKLP
  const atStart = resolveCurrentSlot(SAMPLE_DSCT, new Date(2026, 10, 23, 7, 30));
  assert.equal(atStart.state, 'active');
  assert.equal(atStart.current.subject, 'CP104');
  assert.equal(atStart.minutesLeft, 60);
  assert.equal(atStart.next.subject, 'PKLP');

  // Mon 08:30 exact end boundary of CP104 / start of PKLP -> transitions cleanly to PKLP
  const atBoundary = resolveCurrentSlot(SAMPLE_DSCT, { day: 1, minutes: 8 * 60 + 30 });
  assert.equal(atBoundary.state, 'active');
  assert.equal(atBoundary.current.subject, 'PKLP');
  assert.equal(atBoundary.minutesLeft, 60);
  assert.equal(atBoundary.next.label, 'RECESS');

  // Mon 07:05 -> upcoming CP104 in 25 min
  const beforeClass = resolveCurrentSlot(SAMPLE_DSCT, { day: 1, minutes: 7 * 60 + 5 });
  assert.equal(beforeClass.state, 'upcoming');
  assert.equal(beforeClass.current, null);
  assert.equal(beforeClass.next.subject, 'CP104');
  assert.equal(beforeClass.minutesUntilNext, 25);

  // Fri 15:00 -> after_hours, wraps weekend to Mon 07:30 CP104
  const friAfter = resolveCurrentSlot(SAMPLE_DSCT, { day: 5, minutes: 15 * 60 });
  assert.equal(friAfter.state, 'after_hours');
  assert.equal(friAfter.nextDay, 1);
  assert.equal(friAfter.next.subject, 'CP104');

  // Sunday 12:00 -> weekend, next is Mon 07:30 CP104
  const sunday = resolveCurrentSlot(SAMPLE_DSCT, new Date(2026, 10, 8, 12, 0));
  assert.equal(sunday.state, 'weekend');
  assert.equal(sunday.nextDay, 1);
  assert.equal(sunday.next.subject, 'CP104');

  // Sparse schedule (Wed only): Thu afternoon wraps around full week back to Wed!
  const wedOnly = { slots: [{ day: 3, start: '09:00', end: '10:00', kind: 'activity', label: 'LAB' }] };
  const thuAfter = resolveCurrentSlot(wedOnly, { day: 4, minutes: 12 * 60 });
  assert.equal(thuAfter.state, 'after_hours');
  assert.equal(thuAfter.nextDay, 3);
  assert.equal(thuAfter.next.label, 'LAB');
});

test('buildWeekGrid coordinate-compresses irregular endpoints and spans merged multi-hour blocks', () => {
  const grid = buildWeekGrid(SAMPLE_DSCT);
  assert.deepEqual(grid.boundaries, ['07:10', '07:30', '08:30', '09:30', '09:50', '13:50', '14:50']);
  assert.equal(grid.rows.length, 6);

  // FINMATH101 is Wed 07:30-09:30 across 07:30->08:30 and 08:30->09:30 => rowSpan 2
  const finmath = grid.cells.find((c) => c.slot.subject === 'FINMATH101');
  assert.ok(finmath);
  assert.equal(finmath.day, 3);
  assert.equal(finmath.col, 4);
  assert.equal(finmath.rowStart, 3);
  assert.equal(finmath.rowEnd, 5);
  assert.equal(finmath.rowSpan, 2);

  // Row 0 (07:10-07:30) has empty cells on Mon, Wed, Thu, Fri (only Tue HOMEROOM occupied)
  const r0Empty = grid.emptyCells.filter((e) => e.rowStart === 2).map((e) => e.day);
  assert.deepEqual(r0Empty, [1, 3, 4, 5]);
});

test('normalizeBoard and replaceDraft respect Decision A3 for pre-schedule vs schedule snapshots', async () => {
  assert.equal(normalizeBoard({ tasks: [], schedule: 'bad' }).schedule, undefined);
  assert.equal(normalizeBoard({ tasks: [], schedule: { slots: [] } }).schedule.slots.length, 0);

  const mockState = {
    publishedTasks: [],
    verifiedDeletedIds: [],
    announcements: [],
    draftSubjects: [],
    draftSchedule: SAMPLE_DSCT,
    hasDraftSchedule: true,
    isAdmin: true,
  };
  const boardStore = createBoardStore({
    stateObj: mockState,
    read: () => ({}),
    write: () => true,
    fetchFn: async () => ({ ok: true, json: async () => ({}) }),
  });

  // Pre-schedule snapshot omitting 'schedule' preserves state.draftSchedule (A3)
  let rendered = 0;
  const keepRes = await boardStore.replaceDraft(
    { tasks: [], announcements: [] },
    {
      myTasks: [],
      Task: class { static fromJSON(o) { return o; } },
      validateSchedule,
      renderScheduleEditor: () => { rendered++; },
      renderScheduleView: () => { rendered++; },
    },
  );
  assert.equal(keepRes.ok, true);
  assert.equal(mockState.draftSchedule.sectionLabel, 'DSCT11-A');
  assert.equal(mockState.hasDraftSchedule, true);
  assert.equal(rendered, 2);

  // Explicit schedule: null snapshot clears draftSchedule
  const clearRes = await boardStore.replaceDraft(
    { tasks: [], announcements: [], schedule: null },
    { myTasks: [], Task: class { static fromJSON(o) { return o; } }, validateSchedule },
  );
  assert.equal(clearRes.ok, true);
  assert.equal(mockState.draftSchedule, null);
  assert.equal(mockState.hasDraftSchedule, true);
});
