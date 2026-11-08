// tests/e2e/label-in-name.mjs - static WCAG 2.5.3 check (label in name), in the repository.
//
// Brought in from the Phase 3 run's outside-the-repo battery (tmp\judge-run\labelinname.mjs), where
// it found a real violation the other judges could not see. axe-core does not implement 2.5.3, so
// this cheap sweep is the only committed check for it: for every widget carrying aria-label, the
// element's own visible text must be contained in that label, case-insensitively.
//
// Widget elements only (a, button, input, select, textarea, summary): WCAG 2.5.3 is about the name
// of an interactive control, and containers carry labels too - that was this script's one
// false-positive class.
//
// Node builtins only. Usage: node tests/e2e/label-in-name.mjs [index.html] (default: this repo's)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(process.argv[2] || path.join(HERE, '..', '..', 'index.html'));
const html = fs.readFileSync(file, 'utf8');
const tagRe = /<(a|button|input|select|textarea|summary)\b[^>]*aria-label\s*=\s*"([^"]*)"[^>]*>/gi;
const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

let m;
const rows = [];
let bad = 0;
while ((m = tagRe.exec(html))) {
  const tag = m[1].toLowerCase();
  const label = m[2].trim();
  const start = m.index + m[0].length;
  // Visible text = everything up to the matching close tag for this element type.
  const close = html.indexOf('</' + tag + '>', start);
  const inner = close === -1 ? '' : html.slice(start, close);
  const text = tag === 'input' ? '' : strip(inner);
  if (!text) continue;
  const ok = label.toLowerCase().includes(text.toLowerCase());
  if (!ok) bad++;
  rows.push({ line: html.slice(0, m.index).split('\n').length, tag, label, text, ok });
}
console.log('elements with aria-label AND visible text: ' + rows.length);
for (const r of rows) console.log((r.ok ? '  ok   ' : '  FAIL ') + 'L' + r.line + ' <' + r.tag + '> aria-label="' + r.label + '" visible="' + r.text + '"');
console.log(bad === 0 ? 'LABEL-IN-NAME: 0 violation(s)' : 'LABEL-IN-NAME: ' + bad + ' violation(s)');
process.exit(bad === 0 ? 0 : 1);
