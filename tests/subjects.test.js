/**
 * tests/subjects.test.js - the catalogue contract.
 *
 * The same rules run on the server (api/_board.php). These tests pin the client half: a whole-list
 * reject, a stable code, derived ink that clears WCAG AA, and a preset that replaces choices
 * without ever re-tagging a task.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PALETTE, MAX_SUBJECTS, validateSubjects, subjectTextColor, contrastRatio, luminance,
  applyPresetCatalog, describePreset, subjectFor, assignableSubjects, catalogSignature,
  retiredSubject, codeFromName,
} from '../js/subjects.js';

const S = (code, extra = {}) => ({ code, name: code, color: '#58affc', active: true, ...extra });

test('a valid catalogue is normalised, never rewritten beyond colour case and name trim', () => {
  const { subjects } = validateSubjects([
    { code: 'AA', name: '  Alpha  ', color: '#58AFFC', active: true },
    { code: 'bb.c-1', name: 'Beta', color: '#c3c7d6', active: false },
  ]);
  assert.deepEqual(subjects, [
    { code: 'AA', name: 'Alpha', color: '#58affc', active: true },
    { code: 'bb.c-1', name: 'Beta', color: '#c3c7d6', active: false },
  ]);
});

test('one malformed entry rejects the whole catalogue', () => {
  const bad = [
    { code: '', name: 'X', color: '#58affc', active: true },
    { code: '-AA', name: 'X', color: '#58affc', active: true },
    { code: 'A'.repeat(33), name: 'X', color: '#58affc', active: true },
    { code: 'AA', name: '', color: '#58affc', active: true },
    { code: 'AA', name: '   ', color: '#58affc', active: true },
    { code: 'AA', name: 'X'.repeat(101), color: '#58affc', active: true },
    { code: 'AA', name: 'X\u0007', color: '#58affc', active: true },
    { code: 'AA', name: 'X', color: '#fff', active: true },
    { code: 'AA', name: 'X', color: 'red', active: true },
    { code: 'AA', name: 'X', color: '#58affcff', active: true },
    { code: 'AA', name: 'X', color: '#58affc' },
    { code: 'AA', name: 'X', color: '#58affc', active: 'yes' },
    { code: '__proto__', name: 'X', color: '#58affc', active: true },
  ];
  for (const entry of bad) {
    assert.ok(validateSubjects([S('OK'), entry]).error, `entry ${JSON.stringify(entry)} must be rejected`);
  }
  assert.ok(validateSubjects(null).error);
  assert.ok(validateSubjects('AA').error);
  assert.ok(validateSubjects([...Array(MAX_SUBJECTS + 1)].map((_, i) => S('S' + i))).error);
});

test('a duplicate code is rejected even when the entries differ', () => {
  assert.ok(validateSubjects([S('AA'), S('AA', { name: 'Other' })]).error);
});

test('every shipped palette colour, black, white and a mid tone pick a readable ink', () => {
  const samples = [...PALETTE, '#000000', '#ffffff', '#767676', '#7f7f7f', '#123456', '#abcdee'];
  for (const color of samples) {
    const ink = subjectTextColor(color);
    assert.ok(ink === '#000000' || ink === '#ffffff', `${color} -> ${ink}`);
    const ratio = contrastRatio(color, ink);
    assert.ok(ratio >= 4.5, `${color} on ${ink} is ${ratio.toFixed(2)}:1, below AA`);
    const other = ink === '#000000' ? '#ffffff' : '#000000';
    assert.ok(ratio >= contrastRatio(color, other), `${color} chose the weaker ink`);
  }
});

test('luminance and contrast follow the WCAG definition', () => {
  assert.equal(luminance('#000000'), 0);
  assert.ok(Math.abs(luminance('#ffffff') - 1) < 1e-9);
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-6);
  assert.equal(contrastRatio('#58affc', '#58affc'), 1);
});

test('applying a preset replaces choices but keeps a referenced code as retired', () => {
  const current = [S('KEEP'), S('DROP'), S('USED')];
  const preset = [S('KEEP', { name: 'Kept', color: '#ff9f6b' }), S('DROP')];
  const next = applyPresetCatalog(current, preset, ['USED', 'GONE']);

  assert.deepEqual(next.map((s) => s.code), ['KEEP', 'DROP', 'USED', 'GONE']);
  assert.equal(subjectFor(next, 'USED').active, false, 'a referenced code stays displayable but unassignable');
  assert.equal(subjectFor(next, 'USED').name, 'USED');
  assert.equal(subjectFor(next, 'GONE').active, false, 'an unknown code becomes a neutral retired definition');
  assert.equal(subjectFor(next, 'GONE').color, '#c3c7d6');
  assert.deepEqual(next.map((s) => s.code).sort(), ['DROP', 'GONE', 'KEEP', 'USED']);
});

test('a preset never invents an active subject for a code it does not define', () => {
  const next = applyPresetCatalog([], [S('ONLY')], ['ORPHAN']);
  assert.deepEqual(next.filter((s) => s.active).map((s) => s.code), ['ONLY']);
});

test('the preview reports what a preset would add, change, retire and remove', () => {
  const current = [S('A', { name: 'Alpha' }), S('B', { name: 'Beta' }), S('C')];
  const preset = [S('A', { name: 'Alpha', color: '#ff9f6b' }), S('N')];
  const d = describePreset(current, preset, ['B']);
  assert.deepEqual(d.added, ['N']);
  assert.deepEqual(d.changed, ['A']);
  assert.deepEqual(d.retired, ['B']);
  assert.deepEqual(d.removed, ['C']);
  assert.equal(d.next.length, 3);
});

test('only configured, active subjects are offered for new assignments', () => {
  const catalog = [S('A'), S('B', { active: false })];
  assert.deepEqual(assignableSubjects(catalog).map((s) => s.code), ['A']);
  assert.deepEqual(assignableSubjects(null), []);
});

test('the catalogue signature changes on a rename or recolour, so caches can be invalidated', () => {
  const a = [S('A', { name: 'One' }), S('B')];
  const renamed = [S('A', { name: 'Two' }), S('B')];
  const recoloured = [S('A', { name: 'One', color: '#ff9f6b' }), S('B')];
  const reordered = [S('B'), S('A', { name: 'One' })];
  assert.equal(catalogSignature(a), catalogSignature(reordered), 'order is not a change');
  assert.notEqual(catalogSignature(a), catalogSignature(renamed));
  assert.notEqual(catalogSignature(a), catalogSignature(recoloured));
});

test('the retired definition is neutral and clearly not assignable', () => {
  assert.deepEqual(retiredSubject('OLD'), { code: 'OLD', name: 'OLD', color: '#c3c7d6', active: false });
});

test('a code suggested from a name is uppercase, legal, and empty when it cannot be', () => {
  assert.equal(codeFromName('Data Structures'), 'DATASTRUCTURES');
  assert.equal(codeFromName('finite math 101'), 'FINITEMATH101');
  assert.equal(codeFromName('!!!'), '');
});
