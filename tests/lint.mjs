import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_DEFAULT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

export function codeOnly(src) {
  const out = [];
  const stack = [];
  const keywords = new Set([
    'return', 'typeof', 'case', 'in', 'of', 'new', 'delete',
    'void', 'instanceof', 'do', 'else', 'yield', 'await',
  ]);
  let mode = 'code';
  let braces = 0;
  let last = '';
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
      if (c === '`') {
        blank(c); i++; stack.pop();
        const top = stack[stack.length - 1];
        mode = 'code';
        braces = top && top.kind === 'interp' ? top.braces : 0;
        continue;
      }
      if (c === '$' && n === '{') {
        blank(c); blank(n); i += 2;
        stack.push({ kind: 'interp', braces: 1 });
        mode = 'code'; braces = 1; last = '{';
        continue;
      }
      blank(c); i++; continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { blank(src[i]); i++; } continue; }
    if (c === '/' && n === '*') {
      blank(c); blank(n); i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { blank(src[i]); i++; }
      if (i < src.length) { blank('*'); blank('/'); i += 2; }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c; blank(c); i++;
      while (i < src.length) {
        if (src[i] === '\\') { blank(src[i]); blank(src[i + 1] ?? ''); i += 2; continue; }
        const d = src[i]; blank(d); i++;
        if (d === q) break;
      }
      last = 'string'; continue;
    }
    if (c === '`') { blank(c); i++; stack.push({ kind: 'template' }); mode = 'template'; continue; }
    if (c === '/' && regexAllowed()) {
      blank(c); i++;
      let inClass = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { blank(d); blank(src[i + 1] ?? ''); i += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
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
        if (braces === 0 && top && top.kind === 'interp') {
          stack.pop(); mode = 'template';
          const under = stack[stack.length - 1];
          braces = under && under.kind === 'interp' ? under.braces : 0;
        }
      }
    }
    i++;
  }
  return out.join('');
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function declaredTaskMembers(logicSrc) {
  const start = logicSrc.indexOf('class Task {');
  if (start < 0) return new Set();
  const block = logicSrc.slice(start, logicSrc.indexOf('\nfunction sortTasks', start));
  const members = new Set();
  for (const m of block.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*=/g)) members.add(m[1]);
  for (const m of block.matchAll(/^  (?:static\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) {
    if (m[1] !== 'constructor') members.add(m[1]);
  }
  return members;
}

function movedStateDomNames(root) {
  const jsDir = path.join(root, 'js');
  const names = new Set();
  const statePath = path.join(jsDir, 'state.js');
  const domPath = path.join(jsDir, 'dom.js');
  if (fs.existsSync(statePath)) {
    const s = fs.readFileSync(statePath, 'utf8');
    const body = s.slice(s.indexOf('{'), s.lastIndexOf('}'));
    for (const m of body.matchAll(/^ {2}([A-Za-z_$][\w$]*)\s*:/gm)) names.add(m[1]);
  }
  if (fs.existsSync(domPath)) {
    const d = fs.readFileSync(domPath, 'utf8');
    for (const m of d.matchAll(/\bdom\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  }
  return [...names].sort();
}

function collectJsFiles(root) {
  const out = [];
  if (fs.existsSync(path.join(root, 'app.js'))) out.push('app.js');
  const jsDir = path.join(root, 'js');
  if (fs.existsSync(jsDir)) {
    for (const f of fs.readdirSync(jsDir).filter((x) => x.endsWith('.js')).sort()) {
      out.push(path.join('js', f));
    }
  }
  return out;
}

function checkUnknownTaskProps(rel, src, taskMembers, errors) {
  const code = codeOnly(src);
  const checkProp = (varName, prop, index) => {
    if (taskMembers.has(prop)) return;
    errors.push({
      rule: 'no-unknown-task-prop',
      file: rel,
      line: lineAt(code, index),
      message: `Unknown Task property ".${prop}" on "${varName}". Use a declared Task field or method from logic.js (e.g. task.isClosed(), task.closedAt, task.getDeadline()).`,
    });
  };
  for (const m of code.matchAll(/\b(task|state\.currentTask)\.([A-Za-z_$][\w$]*)\b/g)) {
    const before = code.slice(Math.max(0, m.index - 1), m.index);
    if (before === '.') continue;
    checkProp(m[1], m[2], m.index);
  }
  for (const m of code.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g)) {
    const param = m[1];
    let i = m.index + m[0].length;
    while (i < code.length && /\s/.test(code[i])) i++;
    let end = i;
    if (code[i] === '{') {
      let depth = 0;
      for (; end < code.length; end++) {
        if (code[end] === '{') depth++;
        else if (code[end] === '}') { depth--; if (depth === 0) break; }
      }
    } else {
      let depth = 0;
      for (; end < code.length; end++) {
        const ch = code[end];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; }
        else if ((ch === ',' || ch === ';' || ch === '\n') && depth === 0) break;
      }
    }
    const body = code.slice(i, end);
    const looksLikeTask = new RegExp(`\\b${param}\\.(?:dueDate|endDate|dueTime|closedAt|isPast|isExpired|isOverdue|isClosed|getDeadline|status)\\b`).test(body);
    if (!looksLikeTask) continue;
    for (const pm of body.matchAll(new RegExp(`\\b${param}\\.([A-Za-z_$][\\w$]*)\\b`, 'g'))) {
      const absIdx = i + pm.index;
      if (code[absIdx - 1] === '.') continue;
      checkProp(param, pm[1], absIdx);
    }
  }
}

function checkRawDeadlineMath(rel, src, errors) {
  const code = codeOnly(src);
  for (const m of code.matchAll(/\bdayDiff\(\s*(?:task|t|x|a|b)\.dueDate\b/g)) {
    errors.push({
      rule: 'no-raw-task-deadline-math',
      file: rel,
      line: lineAt(code, m.index),
      message: 'Pass task.getDeadline() instead of task.dueDate to dayDiff() so date-range tasks use endDate.',
    });
  }
}

function checkBareMovedStateInModules(rel, src, names, errors) {
  if (!rel.startsWith('js/') || rel === 'js/state.js' || rel === 'js/dom.js') return;
  const code = codeOnly(src);
  const declared = new Set();
  for (const m of src.matchAll(/^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/gm)) {
    for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(id[0]);
  }
  for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)\b/g)) declared.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}/g)) {
    for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(id[0]);
  }
  for (const m of code.matchAll(/(?:function\s*[A-Za-z_$]*\s*)?\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(id[0]);
  }
  for (const name of names) {
    if (declared.has(name)) continue;
    for (const m of code.matchAll(new RegExp(`\\b${name}\\b`, 'g'))) {
      const idx = m.index;
      const before = code.slice(Math.max(0, idx - 12), idx);
      const after = code.slice(idx + name.length, idx + name.length + 3);
      if (/[\w$]$/.test(before)) continue;
      if (/\.$/.test(before) && !/\.\.\.$/.test(before)) continue;
      if (/^\s*:/.test(after)) continue;
      errors.push({
        rule: 'no-bare-moved-state',
        file: rel,
        line: lineAt(code, idx),
        message: `Bare reference to moved state/dom binding "${name}". Read it as "state.${name}" or "dom.${name}".`,
      });
    }
  }
}

async function checkD6ModuleBoundary(root, rel, src, errors, { checkRuntimeImport = true } = {}) {
  if (!rel.startsWith('js/')) return;
  for (const m of src.matchAll(/^import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    if (/(?:^|\/)logic\.js(?:\?|$)/.test(spec)) {
      errors.push({
        rule: 'd6-module-boundary',
        file: rel,
        line: lineAt(src, m.index),
        message: `js/ modules must not import logic.js directly (breaks ?v= asset stamping). Pass helpers from logic.js through init(deps) in app.js.`,
      });
    }
    if (/\?v=/.test(spec)) {
      errors.push({
        rule: 'd6-module-boundary',
        file: rel,
        line: lineAt(src, m.index),
        message: `Remove ?v= from module import "${spec}". CI stamps only the 5 root assets in index.html and app.js.`,
      });
    }
  }
  if (checkRuntimeImport) {
    const url = pathToFileURL(path.join(root, rel)).href + `?lint=${Date.now()}-${Math.random()}`;
    try {
      await import(url);
    } catch (err) {
      errors.push({
        rule: 'd6-module-boundary',
        file: rel,
        line: 1,
        message: `Module threw at evaluation time under plain Node (${err.message}). Keep DOM, window, and localStorage reads inside init() or exported functions.`,
      });
    }
  }
}

function checkDualSpriteSheets(root, css, errors) {
  const lightPath = path.join(root, 'assets', 'sprites-light.svg');
  const darkPath = path.join(root, 'assets', 'sprites-dark.svg');
  if (!fs.existsSync(lightPath) || !fs.existsSync(darkPath)) {
    errors.push({
      rule: 'dual-sprite-sheets',
      file: 'assets/',
      line: 1,
      message: 'Both assets/sprites-light.svg and assets/sprites-dark.svg must exist. Restore per-theme sprite sheets instead of collapsing them into one.',
    });
    return;
  }
  const lightSvg = fs.readFileSync(lightPath, 'utf8');
  const darkSvg = fs.readFileSync(darkPath, 'utf8');
  if (lightSvg === darkSvg) {
    errors.push({
      rule: 'dual-sprite-sheets',
      file: 'assets/sprites-dark.svg',
      line: 1,
      message: 'sprites-light.svg and sprites-dark.svg are identical. Keep dark ink outline (#14183A) on light and white outline (#FFFFFF) on dark.',
    });
  }
  if (!/--sheet:\s*url\([^)]*sprites-light\.svg\)/.test(css) || !/--sheet:\s*url\([^)]*sprites-dark\.svg\)/.test(css)) {
    errors.push({
      rule: 'dual-sprite-sheets',
      file: 'styles.css',
      line: 1,
      message: 'styles.css must bind --sheet to assets/sprites-light.svg in :root and assets/sprites-dark.svg in :root[data-theme="dark"].',
    });
  }
}

function checkSingleBoardFetch(root, jsFiles, errors) {
  const hits = [];
  for (const rel of jsFiles) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const code = codeOnly(src);
    const lines = code.split('\n');
    lines.forEach((line, i) => {
      if (/\b(?:API|api)\.current\b/.test(line)) {
        hits.push({ rel, line: i + 1, raw: src.split(/\r?\n/)[i] || '' });
      }
    });
  }
  if (hits.length !== 1 || hits[0].rel !== 'js/store.js') {
    errors.push({
      rule: 'single-board-fetch',
      file: hits[0]?.rel || 'js/store.js',
      line: hits[0]?.line || 1,
      message: `Fetch data/current.json from exactly one place (js/store.js); found ${hits.length} reference(s): ${hits.map((h) => `${h.rel}:${h.line}`).join(', ')}.`,
    });
    return;
  }
  const raw = hits[0].raw;
  if (/\?t=|Date\.now\(\)/.test(raw)) {
    errors.push({
      rule: 'single-board-fetch',
      file: hits[0].rel,
      line: hits[0].line,
      message: 'Remove per-load ?t=/Date.now() query string from the Board fetch so nginx ETag/304 revalidation works.',
    });
  }
  if (/cache:\s*['"]no-store['"]/.test(raw) || !/cache:\s*['"]no-cache['"]/.test(raw)) {
    errors.push({
      rule: 'single-board-fetch',
      file: hits[0].rel,
      line: hits[0].line,
      message: "Use cache: 'no-cache' (never 'no-store') on the Board fetch so conditional 304 responses work.",
    });
  }
  if (!/AbortSignal\.timeout\(\s*\d+\s*\)/.test(raw)) {
    errors.push({
      rule: 'single-board-fetch',
      file: hits[0].rel,
      line: hits[0].line,
      message: 'Keep AbortSignal.timeout(...) on the Board fetch so offline loads fall back instead of hanging.',
    });
  }
}

function checkDuePickerComposedPath(rel, src, errors) {
  const code = codeOnly(src);
  for (const m of code.matchAll(/\b(?:state\.)?dpEl\.contains\(\s*e\.target\s*\)/g)) {
    errors.push({
      rule: 'no-contains-on-rerendered-picker',
      file: rel,
      line: lineAt(code, m.index),
      message: 'Use e.composedPath().includes(dpEl) instead of dpEl.contains(e.target) because renderGrid() detaches clicked day nodes before bubbling.',
    });
  }
}

function checkForbiddenComments(rel, src, errors) {
  for (const m of src.matchAll(/\/\/[^\n]*(?:app\.js split, slice|moved verbatim|D6: this module)/g)) {
    errors.push({
      rule: 'no-forbidden-comments',
      file: rel,
      line: lineAt(src, m.index),
      message: 'Delete split-history and D6 boilerplate comments; tests/lint.mjs enforces the D6 boundary structurally.',
    });
  }
}

function checkHtmlAndCssStructure(root, html, css, errors) {
  const propsStart = html.indexOf('class="dialog-controls"');
  const propsEnd = propsStart >= 0 ? html.indexOf('class="dialog-footer"', propsStart) : -1;
  const propsSlice = propsStart >= 0 && propsEnd > propsStart ? html.slice(propsStart, propsEnd) : html;
  for (const m of propsSlice.matchAll(/<label\b([^>]*class="[^"]*\bfield-label\b[^"]*"[^>]*)>/gi)) {
    if (!/\bfor\s*=/.test(m[1])) {
      errors.push({
        rule: 'no-orphan-field-label',
        file: 'index.html',
        line: lineAt(html, (propsStart >= 0 ? propsStart : 0) + m.index),
        message: 'Replace orphan <label class="field-label"> in task dialog body with <span class="field-label" id="..."> linked via aria-labelledby on its control.',
      });
    }
  }
  const hasAbsPlus = /\.cal-plus\s*\{[^}]*position:\s*absolute/s.test(css);
  const hasRelDay = /\.cal-day\s*\{[^}]*position:\s*relative/s.test(css);
  if (hasAbsPlus && !hasRelDay) {
    errors.push({
      rule: 'cal-plus-anchor',
      file: 'styles.css',
      line: 1,
      message: '.cal-plus uses position: absolute, so .cal-day must declare position: relative to contain it.',
    });
  }
}

export async function lintRepo(root = ROOT_DEFAULT, opts = {}) {
  const errors = [];
  const logicPath = path.join(root, 'logic.js');
  const cssPath = path.join(root, 'styles.css');
  const htmlPath = path.join(root, 'index.html');
  const logicSrc = fs.existsSync(logicPath) ? fs.readFileSync(logicPath, 'utf8') : '';
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';

  const taskMembers = declaredTaskMembers(logicSrc);
  const movedNames = movedStateDomNames(root);
  const jsFiles = collectJsFiles(root);

  for (const rel of jsFiles) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    checkUnknownTaskProps(rel, src, taskMembers, errors);
    checkRawDeadlineMath(rel, src, errors);
    checkBareMovedStateInModules(rel, src, movedNames, errors);
    await checkD6ModuleBoundary(root, rel, src, errors, opts);
    checkDuePickerComposedPath(rel, src, errors);
    checkForbiddenComments(rel, src, errors);
  }
  checkDualSpriteSheets(root, css, errors);
  checkSingleBoardFetch(root, jsFiles, errors);
  checkHtmlAndCssStructure(root, html, css, errors);
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : ROOT_DEFAULT;
  const errors = await lintRepo(root);
  if (errors.length) {
    for (const e of errors) console.error(`[${e.rule}] ${e.file}:${e.line}: ${e.message}`);
    console.error(`\nlint: ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log('lint: OK (0 errors)');
}
