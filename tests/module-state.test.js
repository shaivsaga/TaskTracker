/**
 * tests/module-state.test.js - moved module state must never be read bare.
 *
 * The split moves module-scope bindings out of app.js into js/ modules, one slice at a
 * time: js/state.js (one mutable `state` object), js/dom.js (`dom` + cacheDom()) and
 * js/util.js (pure helpers and constant maps). Every site that used such a name bare has
 * to become `state.x`, `dom.x` or an import, because the old top-level declaration is
 * deleted on purpose - a missed site is a ReferenceError that only fires on the one code
 * path that touches it.
 *
 * That is not hypothetical. Slice 2.1 missed eight sites: findTask's published board, five
 * status-change undo snapshots (`{ ...progress[id] }`), the status popover's arrow-key
 * navigation and the history overlay's server versions. tests/e2e/check.mjs stayed green
 * through all eight, because none of those paths runs while a task already has recorded
 * progress. This test reads the source instead of running it, so an incomplete move fails
 * here rather than in the owner's browser.
 *
 * Structural, in the style of tests/index-integrity.test.js: no browser, no network, no
 * build step, no new dependencies.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const JS_DIR = path.join(ROOT, 'js');
const APP_PATH = path.join(ROOT, 'app.js');
const APP_SRC = fs.readFileSync(APP_PATH, 'utf8');

/**
 * Blank out everything that is not code - comments, string literals, template text and
 * regex literals - keeping line breaks so reported line numbers stay true. Template
 * interpolations `${...}` are code and stay visible.
 */
function codeOnly(src) {
  const out = [];
  const stack = [];            // template frames: { kind: 'template' } or { kind: 'interp', braces }
  const keywords = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'yield', 'await']);
  let mode = 'code';
  let braces = 0;
  let last = '';               // last significant token, so / can be told from a regex start
  let i = 0;
  const blank = (ch) => out.push(ch === '\n' ? '\n' : ' ');
  const regexAllowed = () => {
    if (last === '') return true;
    if (/^[A-Za-z_$][\w$]*$/.test(last)) return keywords.has(last);
    if (/^[\d.]+$/.test(last)) return false;
    if (last === ')' || last === ']' || last === '++' || last === '--') return false;
    return true;
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'template') {
      if (c === '\\') { blank(c); blank(n ?? ''); i += 2; continue; }
      if (c === '`') { blank(c); i++; stack.pop(); const top = stack[stack.length - 1]; mode = 'code'; braces = top && top.kind === 'interp' ? top.braces : 0; continue; }
      if (c === '$' && n === '{') { blank(c); blank(n); i += 2; stack.push({ kind: 'interp', braces: 1 }); mode = 'code'; braces = 1; last = '{'; continue; }
      blank(c); i++; continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { blank(src[i]); i++; } continue; }
    if (c === '/' && n === '*') { blank(c); blank(n); i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { blank(src[i]); i++; } if (i < src.length) { blank('*'); blank('/'); i += 2; } continue; }
    if (c === '"' || c === "'") { const q = c; blank(c); i++; while (i < src.length) { if (src[i] === '\\') { blank(src[i]); blank(src[i + 1] ?? ''); i += 2; continue; } const d = src[i]; blank(d); i++; if (d === q) break; } last = 'string'; continue; }
    if (c === '`') { blank(c); i++; stack.push({ kind: 'template' }); mode = 'template'; continue; }
    if (c === '/' && regexAllowed()) {
      blank(c); i++;
      let inClass = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { blank(d); blank(src[i + 1] ?? ''); i += 2; continue; }
        if (d === '[') inClass = true; else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { blank(d); i++; break; }
        else if (d === '\n') break;
        blank(d); i++;
      }
      last = 'regex'; continue;
    }
    out.push(c);
    if (!/\s/.test(c)) {
      if (/[\w$]/.test(c)) last = /^[A-Za-z_$][\w$]*$/.test(last) ? last + c : c;
      else if ((c === '+' || c === '-') && last === c) last = c + c;
      else last = c;
      if (c === '{') braces++;
      else if (c === '}') {
        braces--;
        const top = stack[stack.length - 1];
        if (braces === 0 && top && top.kind === 'interp') { stack.pop(); mode = 'template'; const under = stack[stack.length - 1]; braces = under && under.kind === 'interp' ? under.braces : 0; }
      }
    }
    i++;
  }
  return out.join('');
}

/** Every name the split has moved out of app.js so far. */
function movedNames() {
  const names = new Set();
  const read = (file) => fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  const stateSrc = read('state.js');
  for (const m of stateSrc.slice(stateSrc.indexOf('{'), stateSrc.lastIndexOf('}')).matchAll(/^ {2}([A-Za-z_$][\w$]*)\s*:/gm)) names.add(m[1]);
  for (const m of read('dom.js').matchAll(/\bdom\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  for (const file of fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'))) {
    for (const m of read(file).matchAll(/^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  }
  return [...names].sort();
}

/**
 * Bare reads of moved names in one source file. A name that app.js still declares itself is
 * skipped: the local binding is what its bare occurrences resolve to, and that is legal.
 */
function bareReads(source, names) {
  const code = codeOnly(source);
  const srcLines = source.split(/\r?\n/);
  const imported = new Set();
  for (const m of source.matchAll(/^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/gm)) {
    for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) imported.add(id[0]);
  }
  const found = [];
  for (const name of names) {
    if (imported.has(name)) continue;
    if (new RegExp('(?:const|let|var|function|class)\\s+' + name + '\\b').test(source)) continue;
    for (const m of code.matchAll(new RegExp('\\b' + name + '\\b', 'g'))) {
      const idx = m.index;
      const before = code.slice(Math.max(0, idx - 12), idx);
      const after = code.slice(idx + name.length, idx + name.length + 3);
      if (/[\w$]$/.test(before)) continue;                          // a longer identifier
      if (/\.$/.test(before) && !/\.\.\.$/.test(before)) continue;  // state.x / dom.x - but a spread reads the binding
      if (/^\s*:/.test(after)) continue;                            // object literal key
      const line = code.slice(0, idx).split('\n').length;
      found.push({ name, line, text: (srcLines[line - 1] || '').trim().slice(0, 120) });
    }
  }
  return found;
}

const NAMES = movedNames();

test('the lexer reads code, not strings, comments, templates or regex literals', () => {
  const sample = [
    '// progress',
    'const a = "progress";',
    "const b = 'progress';",
    'const c = `no progress here`;',
    'const d = `yes ${progress} here`;',
    'const e = /progress\\/x/;',
    '/* progress */',
    'const f = progress;',
  ].join('\n');
  const hits = [...codeOnly(sample).matchAll(/\bprogress\b/g)].map((m) => codeOnly(sample).slice(0, m.index).split('\n').length);
  assert.deepEqual(hits, [5, 8], 'only the template interpolation and the real read are code');
});

test('moved module state is never read bare in app.js', () => {
  assert.ok(NAMES.length > 90, `expected the moved-name list to be populated, got ${NAMES.length}`);
  const found = bareReads(APP_SRC, NAMES);
  assert.deepEqual(found, [], 'these reads would throw ReferenceError:\n' + found.map((f) => `  app.js:${f.line}  ${f.name}  ${f.text}`).join('\n'));
});

test('the guard notices a bare read when one is introduced', () => {
  const broken = APP_SRC.replace('state.publishedTasks', 'publishedTasks');
  assert.notEqual(broken, APP_SRC, 'the positive control no longer matches app.js');
  const found = bareReads(broken, NAMES);
  assert.ok(found.some((f) => f.name === 'publishedTasks'), 'the guard stayed silent on a deliberately broken read');
});
