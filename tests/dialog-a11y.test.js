import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintRepo } from './lint.mjs';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

test('dialog files field replaces orphan <label> with aria-labelledby heading', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('id="dialog-files-field"');
  const end = html.indexOf('</div>', html.indexOf('id="dialog-file-input"', start));
  const block = html.slice(start, end);
  assert.doesNotMatch(block, /<label\b/i, '#dialog-files-field must not contain an unassociated <label>');
  assert.match(block, /<span[^>]*id="dialog-files-label"[^>]*>Files<\/span>/);
  assert.match(block, /<ul[^>]*id="dialog-files"[^>]*aria-labelledby="dialog-files-label"/);
});

test('no-orphan-field-label lint rule catches orphan <label> injected into #dialog-files-field', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-files-lint-'));
  try {
    for (const rel of ['logic.js', 'app.js', 'index.html', 'styles.css']) {
      fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
    }
    fs.mkdirSync(path.join(dir, 'js'));
    for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter((x) => x.endsWith('.js'))) {
      fs.copyFileSync(path.join(ROOT, 'js', f), path.join(dir, 'js', f));
    }
    fs.mkdirSync(path.join(dir, 'assets'));
    for (const f of ['sprites-light.svg', 'sprites-dark.svg']) {
      fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(dir, 'assets', f));
    }
    const htmlPath = path.join(dir, 'index.html');
    fs.writeFileSync(
      htmlPath,
      fs.readFileSync(htmlPath, 'utf8').replace('<span class="field-label" id="dialog-files-label">Files</span>', '<label class="field-label">Files</label>'),
    );
    const errors = await lintRepo(dir, { checkRuntimeImport: false });
    assert.ok(errors.some((e) => e.rule === 'no-orphan-field-label'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('app.js builds WAI-ARIA APG grid hierarchy and roving tabindex for .dp-grid', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(src, /class="dp-grid" role="grid" aria-labelledby="dp-month-label"/);
  assert.match(src, /role', 'row'|'role', 'row'/);
  assert.match(src, /'role', 'columnheader'/);
  assert.match(src, /'role', 'gridcell'/);
  assert.match(src, /'aria-selected', String\(selected\)/);
  assert.match(src, /b\.tabIndex = key === activeKey \? 0 : -1/);
  assert.match(src, /e\.key === 'PageUp'/);
  assert.match(src, /e\.key === 'PageDown'/);
  assert.match(src, /addMonthsClamped/);
});

test('js/tasks.js disambiguates file Remove labels and caps at MAX_TASK_FILES (10)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'tasks.js'), 'utf8');
  assert.match(src, /const MAX_TASK_FILES = 10;/);
  assert.match(src, /rm\.setAttribute\('aria-label', `Remove \$\{f\.name\}`\)/);
  assert.match(src, /dom\.dialogAttachBtn\.disabled = atCap/);
  assert.match(src, /onDone: \(\) => anchor\?\.focus\?\.\(\)/);
});
