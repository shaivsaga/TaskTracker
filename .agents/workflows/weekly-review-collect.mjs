#!/usr/bin/env node
/**
 * Read-only telemetry collector for the optional weekly orchestration review.
 * Zero external dependencies. Never modifies files.
 *
 * Usage:
 *   node .agents/workflows/weekly-review-collect.mjs [--days 7] [--json]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CURRENT_STATE = '/home/markus/omp-memory-export/CURRENT_STATE.md';
const OKF_SYNC = '/home/markus/knowledge/scripts/okf-sync.mjs';

function parseArgs(argv) {
  const out = { days: 7, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days' && argv[i + 1]) out.days = Number(argv[++i]) || 7;
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

function safeExec(cmd, args, cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 15000 });
  return { ok: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const args = parseArgs(process.argv.slice(2));
const since = `${args.days}.days.ago`;

const gitLog = safeExec('git', ['log', `--since=${since}`, '--oneline', '--no-merges']);
const commits = gitLog.ok && gitLog.stdout ? gitLog.stdout.split('\n') : [];
const revertOrFixup = commits.filter((c) => /\b(revert|fixup|oops|wip)\b/i.test(c));

const prs = safeExec('gh', [
  'pr', 'list', '--state', 'all', '--limit', '20',
  '--json', 'number,title,state,headRefName,mergedAt,createdAt',
]);
let prList = [];
if (prs.ok && prs.stdout) {
  try { prList = JSON.parse(prs.stdout); } catch {}
}
const overnightBranches = prList.filter((p) => /^overnight\//i.test(p.headRefName || '')).map((p) => `#${p.number} (${p.headRefName})`);

const okfCheck = fs.existsSync(OKF_SYNC)
  ? safeExec('node', [OKF_SYNC, '--bundle', 'tasktracker', '--check'])
  : { ok: false, stdout: '', stderr: 'okf-sync.mjs not found' };

let currentStateLines = null;
if (fs.existsSync(CURRENT_STATE)) {
  currentStateLines = fs.readFileSync(CURRENT_STATE, 'utf8').split('\n').length;
}

const logDir = path.join(os.tmpdir(), 'tt-orch-logs');
const cutoffMs = Date.now() - args.days * 86400 * 1000;
const verifyRuns = [];
if (fs.existsSync(logDir)) {
  for (const name of fs.readdirSync(logDir).filter((n) => n.endsWith('.json'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(logDir, name), 'utf8'));
      const ts = Date.parse(data.timestamp || '');
      if (!Number.isNaN(ts) && ts >= cutoffMs) verifyRuns.push(data);
    } catch {}
  }
}

const summary = {
  windowDays: args.days,
  collectedAt: new Date().toISOString(),
  git: {
    nonMergeCommits: commits.length,
    revertOrFixupCommits: revertOrFixup,
    recentCommits: commits.slice(0, 15),
  },
  github: {
    recentPrCount: prList.length,
    overnightNamedPrs: overnightBranches,
  },
  knowledgeHealth: {
    currentStateLines,
    currentStateOverBudget: currentStateLines !== null && currentStateLines > 80,
    okfCheckOk: okfCheck.ok,
    okfOutput: okfCheck.stdout || okfCheck.stderr,
  },
  verificationTelemetry: {
    runsLogged: verifyRuns.length,
    passed: verifyRuns.filter((r) => r.overall === 'PASS').length,
    failed: verifyRuns.filter((r) => r.overall === 'FAIL').length,
    withUnverified: verifyRuns.filter((r) => r.overall === 'PASS_WITH_UNVERIFIED').length,
  },
};

if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`# Weekly Review Telemetry (last ${args.days} days)`);
  console.log(`- Non-merge commits: ${summary.git.nonMergeCommits} (reverts/fixups: ${revertOrFixup.length})`);
  console.log(`- Recent PRs fetched: ${summary.github.recentPrCount} (overnight/* count: ${overnightBranches.length})`);
  console.log(`- CURRENT_STATE.md lines: ${currentStateLines ?? 'missing'} ${summary.knowledgeHealth.currentStateOverBudget ? '(OVER 80-LINE BUDGET)' : '(OK)'}`);
  console.log(`- OKF sync check: ${summary.knowledgeHealth.okfCheckOk ? 'PASS' : 'FAIL'} — ${summary.knowledgeHealth.okfOutput}`);
  console.log(`- Saved verify-matrix runs: ${summary.verificationTelemetry.runsLogged} (${summary.verificationTelemetry.passed} PASS / ${summary.verificationTelemetry.failed} FAIL / ${summary.verificationTelemetry.withUnverified} PASS_WITH_UNVERIFIED)`);
}
