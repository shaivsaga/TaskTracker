/**
 * tests/update-notice.test.js - selectNoticeChanges(tasks, seen) decides which live tasks the
 * one-per-visit update notice names as New or Updated.
 *
 * The helper is pure: it reads each task's raw, server-supplied changedAt stamp and the stamp map
 * this device saved when it last acknowledged the board. The first visit saves a quiet baseline;
 * a later visit announces an id that was not in the map (New) or whose finite positive stamp has
 * advanced (Updated). Everything else - unchanged, decreased, missing or nonfinite stamps - stays
 * quiet, so an unchanged republish cannot spam the notice and a dismissed baseline cannot repeat.
 *
 * The module is loaded dynamically and checked before use, so a missing module or missing export
 * fails these tests as a behavioural failure rather than as an ESM link/parse error.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

async function loadSelectNoticeChanges() {
  let mod;
  try {
    mod = await import('../js/update-notice.js');
  } catch (err) {
    assert.fail(`js/update-notice.js could not be loaded: ${err.message}`);
  }
  assert.equal(
    typeof mod.selectNoticeChanges,
    'function',
    'js/update-notice.js must export selectNoticeChanges(tasks, seen)',
  );
  return mod.selectNoticeChanges;
}

const task = (id, changedAt) => (changedAt === undefined ? { id } : { id, changedAt });

test('a missing or invalid saved stamp map is a quiet first baseline', async () => {
  const selectNoticeChanges = await loadSelectNoticeChanges();
  const board = [task('a', 10), task('b', 10)];

  for (const seen of [undefined, null, [], '10', 10, 0, true, false]) {
    assert.deepEqual(
      selectNoticeChanges(board, seen),
      [],
      `seen=${String(seen)} must not announce anything on a first visit`,
    );
  }

  // Positive control: a valid saved map announces, and an empty one means nothing is acknowledged.
  assert.deepEqual(selectNoticeChanges(board, { a: 10 }), [{ id: 'b', isNew: true }]);
  assert.deepEqual(selectNoticeChanges(board, {}), [
    { id: 'a', isNew: true },
    { id: 'b', isNew: true },
  ]);
});

test('a known zero stamp that becomes positive is Updated; an unseen id is New', async () => {
  const selectNoticeChanges = await loadSelectNoticeChanges();

  assert.deepEqual(
    selectNoticeChanges(
      [task('legacy', 7), task('known', 7), task('unseen', 7)],
      { legacy: 0, known: 7 },
    ),
    [
      { id: 'legacy', isNew: false },
      { id: 'unseen', isNew: true },
    ],
  );

  // A legacy zero stamp that is still zero is quiet; only the advance from zero is meaningful.
  assert.deepEqual(
    selectNoticeChanges([task('stillZero', 0), task('advanced', 1)], { stillZero: 0, advanced: 0 }),
    [{ id: 'advanced', isNew: false }],
  );

  // isNew is the boolean the dialog turns into New vs Updated, not a truthy string.
  const [{ isNew: firstIsNew }, { isNew: secondIsNew }] = selectNoticeChanges(
    [task('legacy', 7), task('unseen', 7)],
    { legacy: 0 },
  );
  assert.equal(firstIsNew, false);
  assert.equal(secondIsNew, true);
});

test('unchanged and decreased stamps stay quiet', async () => {
  const selectNoticeChanges = await loadSelectNoticeChanges();

  assert.deepEqual(
    selectNoticeChanges([task('same', 10), task('lower', 9)], { same: 10, lower: 10 }),
    [],
  );

  // Positive control: the same baseline does notice a stamp that actually advanced.
  assert.deepEqual(
    selectNoticeChanges([task('same', 10), task('lower', 9), task('ahead', 11)], {
      same: 10,
      lower: 10,
      ahead: 10,
    }),
    [{ id: 'ahead', isNew: false }],
  );
});

test('missing and nonfinite changedAt stamps are treated as zero', async () => {
  const selectNoticeChanges = await loadSelectNoticeChanges();
  const board = [
    { id: 'missing' },
    { id: 'null', changedAt: null },
    { id: 'nan', changedAt: NaN },
    { id: 'infinite', changedAt: Infinity },
    { id: 'negativeInfinite', changedAt: -Infinity },
    { id: 'text', changedAt: 'not a stamp' },
  ];
  const zero = { missing: 0, null: 0, nan: 0, infinite: 0, negativeInfinite: 0, text: 0 };

  // Zero against zero is unchanged - in particular Infinity must not look like a huge advance.
  assert.deepEqual(selectNoticeChanges(board, zero), []);

  // A positive saved stamp still beats the zero these invalid stamps fall back to.
  assert.deepEqual(
    selectNoticeChanges(board, {
      missing: 5,
      null: 5,
      nan: 5,
      infinite: 5,
      negativeInfinite: 5,
      text: 5,
    }),
    [],
  );

  // Positive control: an unknown id is still New, and a real positive stamp still advances.
  assert.deepEqual(
    selectNoticeChanges([{ id: 'unknown' }, task('positive', 1)], { positive: 0 }),
    [
      { id: 'unknown', isNew: true },
      { id: 'positive', isNew: false },
    ],
  );
});

test('a dismissed baseline does not repeat the same notice, but later edits still do', async () => {
  const selectNoticeChanges = await loadSelectNoticeChanges();
  const board = [task('a', 100), task('b', 200)];

  assert.deepEqual(selectNoticeChanges(board, { a: 50, b: 150 }), [
    { id: 'a', isNew: false },
    { id: 'b', isNew: false },
  ]);

  // Dismissing writes the current stamps back. The same board must now be silent.
  const afterDismiss = { a: 100, b: 200 };
  assert.deepEqual(selectNoticeChanges(board, afterDismiss), []);

  // A later edit to one task is the only thing announced...
  assert.deepEqual(selectNoticeChanges([task('a', 100), task('b', 201)], afterDismiss), [
    { id: 'b', isNew: false },
  ]);

  // ...and a genuinely new id is still New against the dismissed baseline.
  assert.deepEqual(
    selectNoticeChanges([task('a', 100), task('b', 200), task('c', 300)], afterDismiss),
    [{ id: 'c', isNew: true }],
  );
});
