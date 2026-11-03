// tests/e2e/check.mjs
//
// Re-captures every snapshot in memory through capture.mjs, diffs it against tests/e2e/golden/ and
// prints a readable diff. Exits 1 on any difference, missing golden or unexpected file. This file is
// not named *.test.js on purpose: it needs jsdom + esbuild, which are not repo dependencies and are not
// going to be (docs/adr/0004-plain-javascript.md), so it must stay out of `node --test`.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureAll, parseArgs, printRequests, SNAPSHOT_NAMES, DEFAULT_GOLDEN_DIR, DEFAULT_HARNESS, DEFAULT_ROOT } from './capture.mjs';

// Goldens are committed as LF. A Windows checkout with core.autocrlf can hand them back as CRLF, which
// is a platform artefact and not a change in the app.
const toLf = (text) => text.replace(/\r\n?/g, '\n');

const LOOKAHEAD = 20;
const MAX_PRINTED = 40;
const FIRST_CONTEXT = 5;

// Line diff with resync: an inserted or deleted line is reported once instead of shifting everything.
export function diffLines(expected, actual) {
  const diffs = [];
  let i = 0;
  let j = 0;
  while (i < expected.length && j < actual.length) {
    if (expected[i] === actual[j]) { i++; j++; continue; }
    let inserted = -1;
    for (let k = 1; k <= LOOKAHEAD && j + k < actual.length; k++) if (actual[j + k] === expected[i]) { inserted = k; break; }
    let removed = -1;
    for (let k = 1; k <= LOOKAHEAD && i + k < expected.length; k++) if (expected[i + k] === actual[j]) { removed = k; break; }
    if (inserted >= 0 && (removed < 0 || inserted <= removed)) {
      for (let k = 0; k < inserted; k++) diffs.push({ type: '+', goldenLine: null, actualLine: j + k + 1, text: actual[j + k] });
      j += inserted;
    } else if (removed >= 0) {
      for (let k = 0; k < removed; k++) diffs.push({ type: '-', goldenLine: i + k + 1, actualLine: null, text: expected[i + k] });
      i += removed;
    } else {
      diffs.push({ type: '-', goldenLine: i + 1, actualLine: null, text: expected[i] });
      diffs.push({ type: '+', goldenLine: null, actualLine: j + 1, text: actual[j] });
      i++;
      j++;
    }
  }
  for (; i < expected.length; i++) diffs.push({ type: '-', goldenLine: i + 1, actualLine: null, text: expected[i] });
  for (; j < actual.length; j++) diffs.push({ type: '+', goldenLine: null, actualLine: j + 1, text: actual[j] });
  return diffs;
}

function printDiff(name, expectedText, actualText) {
  const expected = expectedText.split('\n');
  const actual = actualText.split('\n');
  const diffs = diffLines(expected, actual);
  console.log('');
  console.log(name + ': DIFF (' + diffs.length + ' differing line(s), golden ' + Buffer.byteLength(expectedText)
    + ' bytes / now ' + Buffer.byteLength(actualText) + ' bytes)');
  const first = diffs[0];
  if (first && first.goldenLine) {
    const from = Math.max(1, first.goldenLine - FIRST_CONTEXT);
    for (let line = from; line < first.goldenLine; line++) {
      console.log('  ' + String(line).padStart(5) + ' | ' + (expected[line - 1] || ''));
    }
  }
  for (const entry of diffs.slice(0, MAX_PRINTED)) {
    const label = entry.type === '-' ? 'golden ' + entry.goldenLine : 'now    ' + entry.actualLine;
    console.log('  ' + entry.type + ' ' + label.padEnd(13) + ' | ' + entry.text);
  }
  if (diffs.length > MAX_PRINTED) console.log('  ... ' + (diffs.length - MAX_PRINTED) + ' more differing line(s)');
}

function main() {
  const argv = process.argv.slice(2).map((arg) => (arg === '--golden' ? '--out' : arg));
  const args = parseArgs(argv);
  const goldenDir = args.out || DEFAULT_GOLDEN_DIR;
  console.log('harness: ' + path.resolve(args.harness || DEFAULT_HARNESS));
  console.log('root:    ' + path.resolve(args.root || DEFAULT_ROOT));
  console.log('golden:  ' + goldenDir);
  if (!fs.existsSync(goldenDir)) throw new Error('check: no golden directory ' + goldenDir + ' (run capture.mjs --update first)');

  const onDisk = fs.readdirSync(goldenDir).sort();
  const missing = SNAPSHOT_NAMES.filter((name) => !onDisk.includes(name));
  const unexpected = onDisk.filter((name) => !SNAPSHOT_NAMES.includes(name));

  captureAll(args).then((snapshots) => {
    let failed = missing.length > 0 || unexpected.length > 0;
    for (const name of missing) console.log(name + ': MISSING from ' + goldenDir);
    for (const name of unexpected) { console.log(name + ': UNEXPECTED file in ' + goldenDir); }
    for (const name of SNAPSHOT_NAMES) {
      if (missing.includes(name)) continue;
      const goldenText = toLf(fs.readFileSync(path.join(goldenDir, name), 'utf8'));
      const actualText = snapshots.get(name);
      if (goldenText === actualText) {
        console.log(name.padEnd(20) + ' ok   ' + String(Buffer.byteLength(goldenText)).padStart(7) + ' bytes');
      } else {
        failed = true;
        printDiff(name, goldenText, actualText);
      }
    }
    const cards = (snapshots.get('01-board.html').match(/class="task-card[ "]/g) || []).length;
    const errors = JSON.parse(snapshots.get('errors.json'));
    console.log('');
    console.log('01-board.html task cards: ' + cards + ', errors.json entries: ' + errors.length);
    printRequests(snapshots);
    if (errors.length) { failed = true; console.log('errors.json must stay []: ' + JSON.stringify(errors)); }
    if (failed) {
      console.log('CHECK FAILED');
      process.exit(1);
    }
    console.log('CHECK OK: ' + SNAPSHOT_NAMES.length + ' goldens match, ' + cards + ' task cards, no console errors');
    process.exit(0);
  }).catch((error) => {
    console.error(String(error && error.stack || error));
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
