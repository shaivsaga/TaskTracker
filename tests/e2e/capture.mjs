// tests/e2e/capture.mjs
//
// Drives the real app (index.html + app.js) inside jsdom through the external harness and produces
// normalised text snapshots. See README.md. This file is deliberately not named *.test.js: it needs
// jsdom + esbuild, which are not repo dependencies and are not going to be (docs/adr/0004).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
export const DEFAULT_HARNESS = 'C:\\xampp\\tt-overnight\\harness';
export const DEFAULT_GOLDEN_DIR = path.join(HERE, 'golden');
export const FIXTURE_PATH = path.join(HERE, 'fixture-board.json');
export const TRANSFER_TOKEN = '0123456789abcdef0123456789abcdef';

export const SNAPSHOT_NAMES = [
  '01-board.html', '02-board-dark.html', '03-calendar.html', '04-done.html', '05-settings.html',
  '06-admin.html', '07-dialog.html', '08-popover.html', '09-search.html', '10-quickadd.html',
  '11-transfer.html', '12-progress.json', 'requests.json', 'errors.json',
];

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr']);

// Normalisation: CRLF to LF, data: URLs shortened, absolute paths removed. Applied to every value
// that reaches a golden, so a golden never depends on where the repo is checked out.
export function normalise(value) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/data:[^\s"'<>]+/g, 'data:<omitted>')
    .replace(/file:\/\/\/[^\s"'<>]*/gi, 'file://<path>')
    .replace(/[A-Za-z]:[\\/][^\s"'<>]*/g, '<path>');
}

const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function writeNode(node, depth, out) {
  const pad = '  '.repeat(depth);
  if (node.nodeType === 3) {
    const text = normalise(node.nodeValue.replace(/\s+/g, ' ').trim());
    if (text) out.push(pad + escapeText(text));
    return;
  }
  if (node.nodeType === 8) {
    const text = node.nodeValue.replace(/\s+/g, ' ').trim();
    if (text) out.push(pad + '<!-- ' + escapeText(text) + ' -->');
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  let attrs = '';
  for (const attr of node.attributes) {
    attrs += ' ' + attr.name + '="' + escapeAttr(normalise(attr.value)) + '"';
  }
  // Live form state is not visible in attributes, so record it explicitly.
  if (tag === 'input') {
    if (node.type === 'checkbox' || node.type === 'radio') attrs += ' checked="' + (node.checked ? 'true' : 'false') + '"';
    else attrs += ' value="' + escapeAttr(normalise(node.value)) + '"';
  } else if (tag === 'textarea') {
    attrs += ' value="' + escapeAttr(normalise(node.value)) + '"';
  } else if (tag === 'select') {
    attrs += ' value="' + escapeAttr(normalise(node.value)) + '"';
  }
  const children = Array.from(node.childNodes).filter((c) => c.nodeType !== 3 || c.nodeValue.trim());
  if (VOID_TAGS.has(tag)) { out.push(pad + '<' + tag + attrs + '>'); return; }
  if (!children.length) { out.push(pad + '<' + tag + attrs + '></' + tag + '>'); return; }
  if (children.length === 1 && children[0].nodeType === 3) {
    const text = escapeText(normalise(children[0].nodeValue.replace(/\s+/g, ' ').trim()));
    out.push(pad + '<' + tag + attrs + '>' + text + '</' + tag + '>');
    return;
  }
  out.push(pad + '<' + tag + attrs + '>');
  for (const child of children) writeNode(child, depth + 1, out);
  out.push(pad + '</' + tag + '>');
}

export function serialise(element) {
  const out = [];
  writeNode(element, 0, out);
  return out.join('\n');
}

function renderSections(sections) {
  const parts = sections.map((section) => {
    const body = typeof section.text === 'string' ? normalise(section.text) : serialise(section.el);
    return '<!-- ' + section.label + ' -->\n' + body;
  });
  return normalise(parts.join('\n\n')) + '\n';
}

function sortedProgress(raw) {
  const parsed = JSON.parse(raw || '{}');
  const out = {};
  for (const id of Object.keys(parsed).sort()) {
    out[id] = Object.fromEntries(Object.entries(parsed[id]).sort());
  }
  return JSON.stringify(out, null, 2);
}

function sortedDraft(raw) {
  const parsed = JSON.parse(raw || '{"tasks":[],"announcements":[]}');
  const tasks = (parsed.tasks || []).slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((task) => Object.fromEntries(Object.entries(task).sort()));
  return JSON.stringify({ tasks, announcements: parsed.announcements || [] }, null, 2);
}

export async function captureAll(options = {}) {
  const harnessDir = path.resolve(options.harness || DEFAULT_HARNESS);
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const fixture = path.resolve(options.fixture || FIXTURE_PATH);
  for (const required of [root, fixture, path.join(harnessDir, 'load.mjs')]) {
    if (!fs.existsSync(required)) throw new Error('capture: missing ' + required);
  }
  const { boot, DEFAULT_NOW, requestSummary } = await import(pathToFileURL(path.join(harnessDir, 'load.mjs')).href);

  const now = DEFAULT_NOW;
  const day = 86400000;
  const snapshots = new Map();
  const requests = [];
  const errors = [];
  const fail = (message) => { throw new Error('capture: ' + message); };
  const take = (name, sections) => snapshots.set(name, renderSections(sections));
  const record = (name, app) => {
    for (const entry of app.requests) requests.push({ snapshot: name, ...requestSummary(entry) });
    for (const entry of app.errors) errors.push({ snapshot: name, ...entry });
  };
  const at = (app, selector) => {
    const el = app.document.querySelector(selector);
    if (!el) fail('no element matches ' + selector);
    return el;
  };
  const many = (app, selector) => app.document.querySelectorAll(selector).length;
  const openBoard = (extra = {}) => boot({ root, fixture, ...extra });

  // 01 - default route, published board.
  {
    const app = await openBoard();
    await app.settle(300);
    const cards = many(app, '#page-class-tasks .task-card');
    if (cards < 10) fail('01-board: expected the fixture board, saw ' + cards + ' cards');
    take('01-board.html', [{ label: '#page-class-tasks (class board + list, default route)', el: at(app, '#page-class-tasks') }]);
    record('01-board.html', app);
    app.close();
  }

  // 02 - theme wiring: start from light, click the toggle until dark.
  {
    const app = await openBoard({ storage: { class_tasks_theme: 'light' } });
    await app.settle(300);
    if (app.document.documentElement.dataset.theme !== 'light') fail('02-board-dark: seeded light theme was not applied');
    let clicks = 0;
    while (app.document.documentElement.dataset.theme !== 'dark') {
      app.click('#theme-toggle');
      await app.settle(30);
      if (++clicks > 4) fail('02-board-dark: #theme-toggle never reached data-theme="dark"');
    }
    take('02-board-dark.html', [
      { label: 'head, after ' + clicks + ' click(s) on #theme-toggle', el: at(app, 'head') },
      { label: '#theme-toggle', el: at(app, '#theme-toggle') },
      { label: '#page-class-tasks', el: at(app, '#page-class-tasks') },
    ]);
    record('02-board-dark.html', app);
    app.close();
  }

  // 03 - calendar route.
  {
    const app = await openBoard();
    await app.settle(300);
    app.setHash('#calendar');
    await app.settle(120);
    const page = at(app, '#page-calendar');
    if (page.hidden) fail('03-calendar: #calendar did not open #page-calendar');
    const days = page.querySelectorAll('.cal-day').length;
    if (days < 28) fail('03-calendar: calendar grid has only ' + days + ' day cells');
    take('03-calendar.html', [{ label: '#page-calendar (#calendar)', el: page }]);
    record('03-calendar.html', app);
    app.close();
  }

  // 04 - done route with a seeded progress store so the page is not empty.
  {
    const progress = {
      fx006: { status: 'done', movedAt: now - 3 * day },
      fx007: { status: 'done', movedAt: now - day },
      fx008: { status: 'in_progress', movedAt: now - 2 * day },
    };
    const app = await openBoard({ storage: { class_tasks_progress: JSON.stringify(progress) } });
    await app.settle(300);
    app.setHash('#done');
    await app.settle(120);
    const page = at(app, '#page-done');
    if (page.hidden) fail('04-done: #done did not open #page-done');
    take('04-done.html', [{ label: '#page-done (#done, two fixture tasks are done here)', el: page }]);
    record('04-done.html', app);
    app.close();
  }

  // 05 - settings overlay (there is no #settings route; the panel is #settings-overlay).
  {
    const app = await openBoard();
    await app.settle(300);
    app.click('#settings-open');
    await app.settle(80);
    const overlay = at(app, '#settings-overlay');
    if (overlay.hidden) fail('05-settings: #settings-open did not open #settings-overlay');
    take('05-settings.html', [{ label: '#settings-overlay (#settings-open)', el: overlay }]);
    record('05-settings.html', app);
    app.close();
  }

  // 06 - admin route (data-page="my-tasks") with the published board seeded as the draft.
  {
    const board = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    const draft = JSON.stringify({ tasks: board.tasks, announcements: board.announcements });
    const app = await openBoard({ admin: true, storage: { class_tasks_draft: draft } });
    await app.settle(300);
    app.setHash('#my-tasks');
    await app.settle(120);
    const page = at(app, '#page-my-tasks');
    if (page.hidden) fail('06-admin: #my-tasks did not open #page-my-tasks');
    const cards = many(app, '#page-my-tasks .task-card');
    if (cards < 10) fail('06-admin: expected the seeded draft, saw ' + cards + ' cards');
    take('06-admin.html', [
      { label: '#admin-bar', el: at(app, '#admin-bar') },
      { label: '#page-my-tasks (#my-tasks, admin draft = published board)', el: page },
    ]);
    record('06-admin.html', app);
    app.close();
  }

  // 07 - task dialog from the first card.
  {
    const app = await openBoard();
    await app.settle(300);
    const first = at(app, '#page-class-tasks .task-card');
    const firstId = first.dataset.taskId;
    app.click('#page-class-tasks .task-card');
    await app.settle(80);
    const overlay = at(app, '#task-dialog-overlay');
    if (overlay.hidden) fail('07-dialog: clicking a card did not open #task-dialog-overlay');
    const title = first.querySelector('.task-card-title').textContent;
    const shown = app.document.querySelector('#dialog-title-input').value;
    if (shown !== title) fail('07-dialog: dialog shows "' + shown + '" but the card says "' + title + '"');
    take('07-dialog.html', [{ label: '#task-dialog-overlay (first card: ' + firstId + ')', el: overlay }]);
    record('07-dialog.html', app);
    app.close();
  }

  // 08 - status popover from the first card's status control.
  {
    const app = await openBoard();
    await app.settle(300);
    app.click('#page-class-tasks .task-card .status-check');
    await app.settle(80);
    const popover = at(app, 'body > .status-popover:not(.subject-dropdown)');
    if (popover.hidden) fail('08-popover: .status-check did not open .status-popover');
    const options = popover.querySelectorAll('.status-option[data-status]').length;
    if (options !== 3) fail('08-popover: expected 3 status options, saw ' + options);
    take('08-popover.html', [
      { label: 'body > .status-popover (after clicking the first card status control)', el: popover },
      { label: 'the card it belongs to', el: at(app, '#page-class-tasks .task-card') },
    ]);
    record('08-popover.html', app);
    app.close();
  }

  // 09 - search filtering ("statistical" matches one fixture task).
  {
    const app = await openBoard();
    await app.settle(300);
    const before = many(app, '#page-class-tasks .task-card');
    app.type('#class-task-search', 'statistical');
    await app.settle(120);
    const after = many(app, '#page-class-tasks .task-card');
    if (after !== 1 || before <= after) fail('09-search: expected the filter to narrow ' + before + ' cards to 1, saw ' + after);
    take('09-search.html', [{ label: '#page-class-tasks with "statistical" in #class-task-search (' + before + ' -> ' + after + ' cards)', el: at(app, '#page-class-tasks') }]);
    record('09-search.html', app);
    app.close();
  }

  // 10 - quick add through the natural-language parser, before and after submit. Admin, because the
  // quick-added task is a draft and #my-tasks falls back to #class-tasks when not signed in.
  {
    const app = await openBoard({ admin: true });
    await app.settle(300);
    app.click('#new-task-btn');
    await app.settle(60);
    app.type('#quick-input', 'math homework tomorrow 5pm');
    await app.settle(60);
    const preview = at(app, '#quick-overlay');
    if (preview.hidden) fail('10-quickadd: #new-task-btn did not open #quick-overlay');
    const sections = [{ label: '#quick-overlay after typing "math homework tomorrow 5pm"', el: preview }];
    if (at(app, '#quick-add-btn').disabled) fail('10-quickadd: #quick-add-btn stayed disabled');
    app.click('#quick-add-btn');
    await app.settle(300);
    const page = at(app, '#page-my-tasks');
    if (page.hidden) fail('10-quickadd: submit did not switch to #page-my-tasks');
    const cards = many(app, '#page-my-tasks .task-card');
    if (cards !== 1) fail('10-quickadd: expected 1 new card, saw ' + cards);
    const draft = JSON.parse(app.document.defaultView.localStorage.getItem('class_tasks_draft') || '{}');
    const added = (draft.tasks || [])[0];
    if (!added) fail('10-quickadd: nothing was written to the draft');
    if (added.title !== 'math homework') fail('10-quickadd: parsed title is "' + added.title + '"');
    if (!/^2026-11-04/.test(String(added.dueDate))) fail('10-quickadd: parsed due date is ' + added.dueDate);
    if (added.dueTime !== '17:00') fail('10-quickadd: parsed due time is ' + added.dueTime);
    sections.push({ label: '#page-my-tasks after submitting "math homework tomorrow 5pm"', el: page });
    sections.push({ label: 'localStorage class_tasks_draft after submitting', text: sortedDraft(app.document.defaultView.localStorage.getItem('class_tasks_draft')) });
    take('10-quickadd.html', sections);
    record('10-quickadd.html', app);
    app.close();
  }

  // 11 - progress transfer: stub token, import overlay, merge.
  {
    const payload = {
      v: 1,
      progress: {
        fx006: { status: 'done', movedAt: now - 60000 },
        fx007: { status: 'in_progress', movedAt: now - 3 * day },
      },
    };
    const app = await openBoard({
      search: '?transfer=' + TRANSFER_TOKEN,
      transfers: { [TRANSFER_TOKEN]: { payload } },
      storage: { class_tasks_progress: JSON.stringify({ fx007: { status: 'done', movedAt: now - 30000 } }) },
    });
    await app.settle(400);
    const overlay = at(app, '#import-overlay');
    if (overlay.hidden) fail('11-transfer: the stub token did not open #import-overlay');
    const lines = overlay.querySelectorAll('#import-summary li').length;
    if (lines < 1) fail('11-transfer: #import-summary is empty');
    const sections = [{ label: '#import-overlay before merge (' + lines + ' summary lines)', el: overlay }];
    app.click('#import-apply');
    await app.settle(300);
    sections.push({ label: '#import-overlay after merge', el: at(app, '#import-overlay') });
    sections.push({ label: 'localStorage class_tasks_progress after merge', text: sortedProgress(app.document.defaultView.localStorage.getItem('class_tasks_progress')) });
    take('11-transfer.html', sections);
    record('11-transfer.html', app);
    app.close();
  }

  // 12 - the progress store shape after one status change.
  {
    const app = await openBoard();
    await app.settle(300);
    const first = at(app, '#page-class-tasks .task-card');
    const id = first.dataset.taskId;
    app.click('#page-class-tasks .task-card .status-check');
    await app.settle(60);
    app.click('body > .status-popover:not(.subject-dropdown) .status-option[data-status="in_progress"]');
    await app.settle(150);
    const raw = app.document.defaultView.localStorage.getItem('class_tasks_progress');
    const parsed = JSON.parse(raw || '{}');
    if (parsed[id]?.status !== 'in_progress') fail('12-progress: ' + id + ' is not in_progress in the progress store');
    take('12-progress.json', [
      { label: 'localStorage class_tasks_progress after moving ' + id + ' to in_progress', text: sortedProgress(raw) },
      { label: 'the card that changed (#page-class-tasks .task-card[data-task-id="' + id + '"])', el: at(app, '#page-class-tasks .task-card[data-task-id="' + id + '"]') },
    ]);
    record('12-progress.json', app);
    app.close();
  }

  snapshots.set('requests.json', JSON.stringify(requests, null, 2) + '\n');
  snapshots.set('errors.json', JSON.stringify(errors, null, 2) + '\n');
  return snapshots;
}

// The fetch log, printed by both scripts so a cache policy can be asserted from the console output
// and not only by reading requests.json.
export function printRequests(snapshots, label = 'fetches') {
  const requests = JSON.parse(snapshots.get('requests.json'));
  console.log(label + ' (' + requests.length + '), with options:');
  requests.forEach((entry, index) => {
    console.log('  [' + index + '] ' + entry.snapshot + ': ' + entry.method + ' ' + entry.url + ' cache=' + entry.cache);
  });
  return requests;
}

export function parseArgs(argv) {
  const args = { update: false, harness: undefined, root: undefined, fixture: undefined, out: DEFAULT_GOLDEN_DIR };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--update') args.update = true;
    else if (arg === '--harness') args.harness = argv[++i];
    else if (arg === '--root') args.root = argv[++i];
    else if (arg === '--fixture') args.fixture = argv[++i];
    else if (arg === '--out') args.out = path.resolve(argv[++i]);
    else throw new Error('capture: unknown argument ' + arg);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  captureAll(args).then((snapshots) => {
    let bytes = 0;
    for (const name of SNAPSHOT_NAMES) {
      const text = snapshots.get(name);
      if (text === undefined) throw new Error('capture: no snapshot named ' + name);
      bytes += Buffer.byteLength(text);
      if (args.update) {
        fs.mkdirSync(args.out, { recursive: true });
        fs.writeFileSync(path.join(args.out, name), text);
      }
      console.log((args.update ? 'wrote ' : 'built ') + name.padEnd(20) + String(Buffer.byteLength(text)).padStart(7) + ' bytes');
    }
    const cards = (snapshots.get('01-board.html').match(/class="task-card[ "]/g) || []).length;
    console.log('total ' + bytes + ' bytes, 01-board.html has ' + cards + ' task cards');
    printRequests(snapshots);
    if (!args.update) console.log('nothing written; pass --update to rewrite ' + args.out);
    process.exit(0);
  }).catch((error) => {
    console.error(String(error && error.stack || error));
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
