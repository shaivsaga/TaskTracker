#!/usr/bin/env node
/**
 * Deterministic verification matrix runner & Evidence Ledger generator for TaskTracker.
 * Zero external dependencies. Never touches repo data/ and never fabricates results.
 *
 * Usage:
 *   node .agents/workflows/verify-matrix.mjs --base main --mode standard
 *   node .agents/workflows/verify-matrix.mjs --files styles.css,js/calendar.js --mode standard --dry-run
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
  const out = {
    base: 'main',
    files: [],
    mode: 'standard',
    dryRun: false,
    skipBrowser: false,
    json: false,
    outFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base' && argv[i + 1]) out.base = argv[++i];
    else if (a === '--files' && argv[i + 1]) {
      out.files.push(...argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--mode' && argv[i + 1]) out.mode = argv[++i].toLowerCase();
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-browser') out.skipBrowser = true;
    else if (a === '--json') out.json = true;
    else if (a === '--out' && argv[i + 1]) out.outFile = argv[++i];
  }
  return out;
}

function resolvePhpBin() {
  if (fs.existsSync('/opt/lampp/bin/php')) return '/opt/lampp/bin/php';
  const r = spawnSync('which', ['php'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

function hasCommand(cmd) {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}

function getChangedFiles(base) {
  const set = new Set();
  for (const args of [
    ['diff', '--name-only', `${base}...HEAD`],
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    try {
      const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
      for (const line of out.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('.cursor/')) set.add(trimmed);
      }
    } catch {}
  }
  return [...set].sort();
}

function mapFirefoxFeatures(files, mode) {
  if (mode === 'deep') return ['all'];
  const features = new Set();
  for (const f of files) {
    if (f === 'js/calendar.js') features.add('calendar');
    else if (f === 'js/tasks.js' || f === 'js/quick-add.js' || f === 'js/announcements.js') {
      features.add('class-board');
      features.add('status-and-done');
    } else if (f === 'js/bin.js') features.add('past-archive');
    else if (f === 'js/settings.js' || f === 'js/motion.js' || f === 'js/note-images.js') {
      features.add('task-dialog-and-theme');
    } else if (f === 'js/util.js' || f === 'js/transfer.js') features.add('multi-section');
    else if (f === 'styles.css' || f === 'index.html' || f === 'app.js' || f === 'logic.js') {
      features.add('class-board');
      features.add('task-dialog-and-theme');
    }
  }
  return features.size ? [...features] : ['class-board'];
}

export function buildCheckPlan({ files, mode, skipBrowser = false }) {
  const norm = files.map((f) => f.replace(/^\.?\//, ''));
  const touchesJsHtmlCss = norm.some((f) =>
    /^(index\.html|styles\.css|app\.js|logic\.js|attachments\.js|qr-draw\.js|js\/|assets\/|tests\/.+\.m?js$)/.test(f),
  );
  const touchesUi = norm.some((f) => /^(index\.html|styles\.css|app\.js|logic\.js|js\/|assets\/)/.test(f));
  const touchesPhp = norm.some((f) => /^(api\/|transfer\.php$|tests\/php\/)/.test(f));
  const touchesBoardSync = norm.some((f) =>
    /^(api\/_board\.php|api\/publish\.php|api\/versions\.php|js\/store\.js|js\/publish\.js|js\/recovery\.js|tests\/formal\/)/.test(f),
  );
  const touchesDeploy = norm.some((f) => /^deploy\//.test(f));
  const touchesWorkflows = norm.some((f) => /^\.github\/workflows\//.test(f));
  const touchesOrchestration = norm.some((f) => /^(AGENTS\.md|\.agents\/(?:agents|workflows|rules)\/)/.test(f));

  const checks = [];
  const phpBin = resolvePhpBin();

  if (touchesOrchestration) {
    checks.push({
      id: 'orchestration-selftest',
      what: 'Orchestration classifier, verify-matrix, orchestrate.py AST + model bans, and role prompts',
      cmd: 'node',
      args: ['.agents/workflows/selftest.mjs'],
      expected: 'Exit 0 with all orchestration checks passing',
    });
  }

  if (touchesJsHtmlCss || touchesWorkflows || norm.length === 0 || mode !== 'fast') {
    checks.push({
      id: 'repo-lint',
      what: 'TaskTracker structural linter (AST/boundary/invariant checks)',
      cmd: 'node',
      args: ['tests/lint.mjs'],
      expected: 'Exit 0 with zero lint errors',
    });
    checks.push({
      id: 'node-tests',
      what: 'Full Node unit & contract test suite',
      cmd: 'node',
      args: ['--test', 'tests/*.test.js'],
      shell: true,
      expected: 'Exit 0 with 0 failed tests',
    });
  }

  if (touchesUi) {
    checks.push({
      id: 'label-in-name',
      what: 'WCAG 2.5.3 Label-in-Name static sweep',
      cmd: 'node',
      args: ['tests/e2e/label-in-name.mjs'],
      expected: 'Exit 0 with 0 violations',
    });
  }

  if (touchesPhp || mode === 'deep') {
    checks.push({
      id: 'php-suite',
      what: 'PHP backend validation, publish, and multi-section test suite',
      cmd: phpBin || 'php',
      args: ['tests/php/run.php'],
      unavailableReason: phpBin ? null : 'Neither /opt/lampp/bin/php nor php on PATH was found',
      expected: 'Exit 0 with 0 failed assertions',
    });
  }

  if (touchesUi && mode !== 'fast' && !skipBrowser) {
    checks.push({
      id: 'playwright-audit',
      what: 'Real-browser Chromium audit (320-1280px, light/dark, keyboard, focus, filters)',
      cmd: 'node',
      args: ['tests/e2e/audit.mjs', '--require-browser'],
      expected: 'Exit 0 with 0 failures and 0 console errors',
    });

    const ffScript = fs.existsSync(path.join(ROOT, '.agents/skills/verify-tasktracker/scripts/verify.mjs'))
      ? '.agents/skills/verify-tasktracker/scripts/verify.mjs'
      : '.cursor/skills/verify-tasktracker/scripts/verify.mjs';
    if (fs.existsSync(path.join(ROOT, ffScript))) {
      const features = mapFirefoxFeatures(norm, mode);
      const outDir = path.join(os.tmpdir(), `tt-verify-ff-${Date.now()}`);
      for (const feat of features) {
        checks.push({
          id: `firefox-${feat}`,
          what: `Real headless Firefox journey (${feat}, desktop/90% zoom/phone, isolated server)`,
          cmd: 'node',
          args: [ffScript, 'drive', feat, '--out', path.join(outDir, feat)],
          artifactDir: path.join(outDir, feat),
          expected: 'Exit 0 with all checks passed and 0 console errors',
        });
      }
    }
  }

  if (touchesBoardSync) {
    const canRunTlc = hasCommand('java') || hasCommand('docker');
    checks.push({
      id: 'tlc-board-sync',
      what: 'TLA+ formal model check of BoardSync.tla invariants',
      cmd: 'bash',
      args: ['tests/formal/run-tlc.sh', 'BoardSync.cfg'],
      unavailableReason: canRunTlc ? null : 'Neither java nor docker is installed to run TLC',
      expected: 'Exit 0 with 0 invariant violations',
    });
    checks.push({
      id: 'board-sync-replay',
      what: 'Real PHP + JS trace replay of BoardSync protocol',
      cmd: 'node',
      args: ['--test', 'tests/board-sync-replay.test.js'],
      env: { ...process.env, REQUIRE_PHP: '1', ...(phpBin ? { PHP_BIN: phpBin } : {}) },
      unavailableReason: phpBin ? null : 'PHP binary missing for REQUIRE_PHP=1 replay',
      expected: 'Exit 0 with all replay scenarios passing',
    });
  }

  if (touchesDeploy) {
    checks.push({
      id: 'deploy-tests',
      what: 'Nginx config, startup script, and section script contract tests',
      cmd: 'node',
      args: ['--test', 'tests/nginx-conf.test.js', 'tests/startup.test.js', 'tests/section-script.test.js'],
      expected: 'Exit 0 with 0 failures',
    });
  }

  return checks;
}

function tailLines(str, maxLines = 25) {
  const lines = String(str || '').trim().split('\n').filter(Boolean);
  if (lines.length <= maxLines) return lines.join('\n');
  return `... (${lines.length - maxLines} earlier lines omitted)\n` + lines.slice(-maxLines).join('\n');
}

function runCheck(check) {
  const displayCmd = `${check.cmd} ${check.args.join(' ')}`;
  if (check.unavailableReason) {
    return {
      ...check,
      displayCmd,
      status: 'UNVERIFIED',
      evidenceTier: '[inferred]',
      exitCode: null,
      durationMs: 0,
      actual: `Blocked: ${check.unavailableReason}`,
      logTail: '',
    };
  }
  const t0 = Date.now();
  const res = check.shell
    ? spawnSync(displayCmd, { cwd: ROOT, shell: true, encoding: 'utf8', env: check.env || process.env, timeout: 240000 })
    : spawnSync(check.cmd, check.args, { cwd: ROOT, encoding: 'utf8', env: check.env || process.env, timeout: 240000 });
  const durationMs = Date.now() - t0;
  const combined = [res.stdout, res.stderr].filter(Boolean).join('\n');
  const passed = res.status === 0 && !res.error;
  return {
    ...check,
    displayCmd,
    status: passed ? 'PASS' : 'FAIL',
    evidenceTier: '[agent-test]',
    exitCode: res.status,
    durationMs,
    actual: res.error
      ? `Spawn error: ${res.error.message}`
      : `Exit ${res.status} in ${(durationMs / 1000).toFixed(2)}s`,
    logTail: tailLines(combined, passed ? 8 : 30),
  };
}

function formatMarkdown(report) {
  const lines = [
    `# Verification Evidence Ledger`,
    ``,
    `- **Mode:** \`${report.mode.toUpperCase()}\``,
    `- **Timestamp:** ${report.timestamp}`,
    `- **Changed files (${report.files.length}):** ${report.files.length ? report.files.map((f) => `\`${f}\``).join(', ') : '_none (full baseline check)_'}`,
    `- **Overall:** **${report.overall}** (${report.counts.pass} PASS / ${report.counts.fail} FAIL / ${report.counts.unverified} UNVERIFIED)`,
    ``,
    `| Check | Status | Tier | Actual | Command |`,
    `| :--- | :---: | :---: | :--- | :--- |`,
  ];
  for (const r of report.results) {
    lines.push(`| ${r.what} | **${r.status}** | \`${r.evidenceTier}\` | ${r.actual} | \`${r.displayCmd}\` |`);
  }
  const failing = report.results.filter((r) => r.status === 'FAIL');
  if (failing.length) {
    lines.push('', '## Failures');
    for (const f of failing) {
      lines.push(`### ${f.id} (\`${f.displayCmd}\`)`, '```text', f.logTail || '(no output)', '```');
    }
  }
  const artifacts = report.results.filter((r) => r.artifactDir);
  if (artifacts.length) {
    lines.push('', '## Artifacts');
    for (const a of artifacts) lines.push(`- \`${a.id}\`: \`${a.artifactDir}\``);
  }
  lines.push(
    '',
    '## Remaining Uncertainty',
    '- Native iOS Safari / physical phone touch ergonomics are not exercised by Linux headless browsers.',
    '- Live Azure App Service nginx runtime & restart persistence are only proven after deploy via `deploy/verify-hardening.mjs https://dsct.dev`.',
    '- Automated checks are `[agent-test]`, never `[live-test]` — real classmate/owner UAT stays separate.',
  );
  return lines.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const files = args.files.length ? args.files : getChangedFiles(args.base);
  const plan = buildCheckPlan({ files, mode: args.mode, skipBrowser: args.skipBrowser });

  if (args.dryRun) {
    const out = { mode: args.mode, files, plannedChecks: plan.map((c) => ({ id: c.id, what: c.what, cmd: `${c.cmd} ${c.args.join(' ')}`, unavailableReason: c.unavailableReason || null })) };
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  const results = plan.map(runCheck);
  const counts = {
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    unverified: results.filter((r) => r.status === 'UNVERIFIED').length,
  };
  const report = {
    timestamp: new Date().toISOString(),
    mode: args.mode,
    files,
    overall: counts.fail > 0 ? 'FAIL' : counts.unverified > 0 ? 'PASS_WITH_UNVERIFIED' : 'PASS',
    counts,
    results,
  };

  // Persist lightweight telemetry for optional weekly review under /tmp/tt-orch-logs/
  try {
    const logDir = path.join(os.tmpdir(), 'tt-orch-logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `verify-${Date.now()}.json`);
    fs.writeFileSync(logPath, JSON.stringify({ ...report, results: report.results.map(({ logTail, ...rest }) => rest) }, null, 2));
  } catch {}

  const output = args.json ? JSON.stringify(report, null, 2) : formatMarkdown(report);
  if (args.outFile) fs.writeFileSync(args.outFile, output);
  console.log(output);
  process.exit(counts.fail > 0 ? 1 : 0);
}
