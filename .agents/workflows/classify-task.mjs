#!/usr/bin/env node
/**
 * Deterministic risk & mode classifier for TaskTracker tasks.
 * Zero external dependencies.
 *
 * Usage:
 *   node .agents/workflows/classify-task.mjs --task "Fix mobile calendar spacing" --files styles.css
 *   node .agents/workflows/classify-task.mjs --task "Add schedule validation" --git-diff main --json
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DEEP_PATHS = [
  /^api\/_board\.php$/,
  /^api\/publish\.php$/,
  /^api\/versions\.php$/,
  /^api\/_session\.php$/,
  /^api\/login\.php$/,
  /^api\/logout\.php$/,
  /^api\/upload\.php$/,
  /^api\/migrate-subjects\.php$/,
  /^transfer\.php$/,
  /^deploy\//,
  /^\.github\/workflows\//,
  /^js\/store\.js$/,
  /^js\/publish\.js$/,
  /^js\/recovery\.js$/,
  /^js\/transfer\.js$/,
  /^tests\/formal\//,
];

const STANDARD_PATHS = [
  /^index\.html$/,
  /^app\.js$/,
  /^logic\.js$/,
  /^attachments\.js$/,
  /^qr-draw\.js$/,
  /^js\/.+\.js$/,
  /^api\/.+\.php$/,
  /^tests\/.+\.(?:js|mjs|php)$/,
];

const BOARD_SYNC_PATHS = [
  /^api\/_board\.php$/,
  /^api\/publish\.php$/,
  /^api\/versions\.php$/,
  /^js\/store\.js$/,
  /^js\/publish\.js$/,
  /^js\/recovery\.js$/,
  /^tests\/formal\//,
];

const DEEP_KEYWORDS = [
  /\bauth(?:entication|orization)?\b/i,
  /\b(?:login|logout|session|cookie|htpasswd|csp|security|hsts|xss|sanitize)\b/i,
  /\b(?:multi-section|section isolation|section link|section token)\b/i,
  /\b(?:persistence|current\.json|schema\s*version|migration|atomic|flock|publish lock)\b/i,
  /\b(?:sync|stale_base|operationid|crash recovery|deletion authority|permanent delete)\b/i,
  /\b(?:nginx|azure|deploy|startup\.sh|backup|restore)\b/i,
  /\b(?:major refactor|architectural refactor|rewrite)\b/i,
];

const STANDARD_KEYWORDS = [
  /\b(?:feature|timetable|schedule|calendar|dialog|modal|popover|filter|search)\b/i,
  /\b(?:admin|draft|preview|history|recycle bin|announcement|subject|attachment|qr)\b/i,
  /\b(?:accessibility|a11y|aria|keyboard|focus|responsive|mobile|viewport|320px|dark theme|dark mode)\b/i,
  /\b(?:bug|regression|broken|race condition|state)\b/i,
];

function parseArgs(argv) {
  const out = { task: '', files: [], gitDiff: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task' && argv[i + 1]) out.task = argv[++i];
    else if (a === '--files' && argv[i + 1]) {
      out.files.push(...argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--git-diff') {
      out.gitDiff = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'main';
    } else if (a === '--json') out.json = true;
  }
  return out;
}

function getGitDiffFiles(baseRef) {
  const files = new Set();
  try {
    const diffOut = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    for (const line of diffOut.split('\n')) if (line.trim()) files.add(line.trim());
  } catch {}
  try {
    const wtOut = execFileSync('git', ['diff', '--name-only'], { cwd: ROOT, encoding: 'utf8' });
    for (const line of wtOut.split('\n')) if (line.trim()) files.add(line.trim());
  } catch {}
  try {
    const stagedOut = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: ROOT, encoding: 'utf8' });
    for (const line of stagedOut.split('\n')) if (line.trim()) files.add(line.trim());
  } catch {}
  try {
    const untrackedOut = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    for (const line of untrackedOut.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('.cursor/')) files.add(trimmed);
    }
  } catch {}
  return [...files].sort();
}

export function classifyTask({ task = '', files = [] }) {
  const normFiles = [...new Set(files.map((f) => f.replace(/^\.?\//, '').replace(/\\/g, '/')))];
  const reasons = [];
  const protectedBoundaries = new Set();

  let score = 0; // 0 = FAST, 1 = STANDARD, 2 = DEEP
  let touchesFrontend = false;
  let touchesBackend = false;
  let touchesOrchestrationRules = false;

  for (const f of normFiles) {
    if (DEEP_PATHS.some((re) => re.test(f))) {
      score = Math.max(score, 2);
      reasons.push(`High-risk path touched: ${f}`);
    } else if (STANDARD_PATHS.some((re) => re.test(f))) {
      score = Math.max(score, 1);
      reasons.push(`Core app/test path touched: ${f}`);
    }

    if (BOARD_SYNC_PATHS.some((re) => re.test(f))) protectedBoundaries.add('board-sync-formal');
    if (/^deploy\//.test(f)) protectedBoundaries.add('nginx-deploy-boundary');
    if (/^api\/|^transfer\.php$/.test(f)) {
      touchesBackend = true;
      protectedBoundaries.add('php-backend');
    }
    if (/^deploy\/|^tests\/formal\/|^tests\/php\//.test(f)) touchesBackend = true;
    if (/^(index\.html|styles\.css|app\.js|logic\.js|attachments\.js|qr-draw\.js|js\/|assets\/)/.test(f)) {
      touchesFrontend = true;
    }
    if (f === 'index.html') protectedBoundaries.add('csp-inline-script-and-5-stamps');
    if (/^data\//.test(f)) protectedBoundaries.add('forbidden-live-data');
    if (/^tests\/e2e\/golden\/|^tests\/module-state\.test\.js$/.test(f)) {
      protectedBoundaries.add('do-not-hand-edit-snapshot-guard');
    }
    if (/^\.agents\/rules\/|^AGENTS\.md$/.test(f)) touchesOrchestrationRules = true;
  }

  for (const re of DEEP_KEYWORDS) {
    if (re.test(task)) {
      score = Math.max(score, 2);
      reasons.push(`High-risk keyword matched: ${re.source}`);
    }
  }
  if (score < 2) {
    for (const re of STANDARD_KEYWORDS) {
      if (re.test(task)) {
        score = Math.max(score, 1);
        reasons.push(`Standard feature/UI keyword matched: ${re.source}`);
      }
    }
  }

  if (normFiles.length >= 4 && score === 0) {
    score = 1;
    reasons.push(`Multi-file scope (${normFiles.length} files) exceeds FAST threshold`);
  }

  if (!touchesFrontend && !touchesBackend) {
    if (/php|nginx|deploy|backend|server|api\//i.test(task)) touchesBackend = true;
    if (/css|ui|html|calendar|mobile|button|dialog|theme|style|copy|board|list/i.test(task)) touchesFrontend = true;
  }

  const mode = score === 2 ? 'DEEP' : score === 1 ? 'STANDARD' : 'FAST';

  const specialists = ['orchestrator'];
  if (mode !== 'FAST') {
    specialists.push('architect-planner');
    if (touchesFrontend || !touchesBackend) specialists.push('frontend-engineer');
    if (touchesBackend) specialists.push('backend-engineer');
    specialists.push('independent-reviewer', 'verification-engineer', 'technical-mentor');
  }

  const requiredChecks = [];
  if (touchesFrontend || normFiles.some((f) => /\.m?js$|^index\.html$|^styles\.css$/.test(f)) || mode !== 'FAST') {
    requiredChecks.push('npm run lint', 'npm test');
  }
  if (normFiles.includes('index.html') || touchesFrontend) {
    requiredChecks.push('node tests/e2e/label-in-name.mjs');
  }
  if (touchesBackend || mode === 'DEEP') {
    requiredChecks.push('/opt/lampp/bin/php tests/php/run.php');
  }
  if (touchesFrontend && mode !== 'FAST') {
    requiredChecks.push('node tests/e2e/audit.mjs --require-browser');
    requiredChecks.push(
      mode === 'DEEP'
        ? 'node .agents/skills/verify-tasktracker/scripts/verify.mjs drive all'
        : 'node .agents/skills/verify-tasktracker/scripts/verify.mjs drive <targeted-feature>',
    );
  }
  if (protectedBoundaries.has('board-sync-formal')) {
    requiredChecks.push(
      'bash tests/formal/run-tlc.sh BoardSync.cfg',
      'REQUIRE_PHP=1 node --test tests/board-sync-replay.test.js',
    );
  }
  if (protectedBoundaries.has('nginx-deploy-boundary')) {
    requiredChecks.push(
      'node --test tests/nginx-conf.test.js tests/startup.test.js tests/section-script.test.js',
      'docker nginx:alpine + verify-hardening.mjs',
    );
  }

  return {
    recommendedMode: mode,
    rationale: reasons.length ? reasons : ['Localized, low-risk scope with no protected contract boundaries.'],
    filesAnalyzed: normFiles,
    protectedBoundaries: [...protectedBoundaries],
    touchesOrchestrationRules,
    specialists,
    parallelImplementationPossible: mode !== 'FAST' && touchesFrontend && touchesBackend,
    maxFixCycles: mode === 'DEEP' ? 3 : mode === 'STANDARD' ? 2 : 1,
    requiresPlanApproval: mode === 'DEEP',
    requiresWalkthrough: mode !== 'FAST',
    requiresComprehensionQuestions: mode === 'DEEP',
    requiredChecks: [...new Set(requiredChecks)],
    bannedModels: ['claude-opus-5-5*', 'claude-sonnet-5-5*', 'gpt-6.2-sol (unless prompted)', 'gpt-6.2-astra (unless prompted)'],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const files = [...args.files, ...(args.gitDiff ? getGitDiffFiles(args.gitDiff) : [])];
  const result = classifyTask({ task: args.task, files });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Recommended Mode : ${result.recommendedMode}`);
    console.log(`Max Fix Cycles   : ${result.maxFixCycles}`);
    console.log(`Plan Approval    : ${result.requiresPlanApproval ? 'REQUIRED before edits' : 'Orchestrator-managed'}`);
    console.log(`Specialists      : ${result.specialists.join(', ')}`);
    console.log(`Parallel FE+BE   : ${result.parallelImplementationPossible ? 'Yes (if files disjoint)' : 'No'}`);
    if (result.protectedBoundaries.length) {
      console.log(`Protected Zones  : ${result.protectedBoundaries.join(', ')}`);
    }
    if (result.touchesOrchestrationRules) {
      console.log(`WARNING          : Touches orchestration rules — explicit owner approval required.`);
    }
    console.log('Rationale:');
    for (const r of result.rationale) console.log(`  - ${r}`);
    console.log('Required Checks:');
    for (const c of result.requiredChecks) console.log(`  - ${c}`);
  }
}
