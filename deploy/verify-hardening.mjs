#!/usr/bin/env node
// Behavioural verification of the TaskTracker host hardening.
//
// WHY THIS EXISTS
// `nginx -t` proves the config PARSES. It does not prove the running host APPLIES it.
// On 2026-10-31 the custom config was merged and deployed, the deploy workflow went
// green, and every rule in it was still inert on the host: /package.json was served,
// /Tests/php/run.php executed, and no security header was sent. Nothing in CI could
// notice, because nothing in CI ever asked the live host a question.
//
// WHAT IT DOES
// Sends read-only GETs and asserts the status codes and headers that only an applied
// config can produce. Any failure exits non-zero, so a deploy that does not actually
// harden the host turns red instead of going quietly green.
//
// USAGE
//   node deploy/verify-hardening.mjs [base-url]        # default https://dsct.dev
//
// DELIBERATELY NOT CHECKED
// The login throttle (M1) needs six requests inside a minute, which would 429 the
// caller's IP for the next minute. Never run that from the owner's network; see
// POST_DEPLOY_VERIFICATION.md (repo root).

const BASE = (process.argv[2] || process.env.VERIFY_BASE_URL || 'https://dsct.dev').replace(/\/+$/, '');

// The header set the config repeats in EVERY location that declares its own
// add_header (nginx does not inherit add_header into such a location).
const SECURITY_HEADERS = [
  ['strict-transport-security', /max-age=\d+/],
  ['content-security-policy', /sha256-[A-Za-z0-9+/=]{20,}/],
  ['x-frame-options', /^\s*DENY\s*$/i],
  ['referrer-policy', /^\s*strict-origin-when-cross-origin\s*$/i],
  ['permissions-policy', /camera=\(\)/],
  ['x-content-type-options', /^\s*nosniff\s*$/i],
];

const checks = [
  // Case-varied bypasses (C1-C3): Azure's wwwroot resolves paths case-insensitively,
  // so a case-sensitive prefix match never fires and the request reaches the handler.
  { path: '/Api/login.php', status: 404, why: 'case-varied API route must not reach PHP' },
  { path: '/Api/versions.php', status: 404, why: 'case-varied API route must not reach PHP' },
  { path: '/Data/current.json', status: 403, why: 'case-varied data path must be denied' },
  { path: '/Deploy/startup.sh', status: 403, why: 'deploy scripts must not be downloadable' },
  { path: '/Tests/php/run.php', status: 403, why: 'a stale tests/ tree must not execute' },
  { path: '/Package.json', status: 403, why: 'package.json is denied in any casing' },
  { path: '/package.json', status: 403, why: 'package.json is denied in any casing' },
  // The one route that is supposed to prompt, and the one that must keep working.
  { path: '/api/login.php', status: 401, headers: [['www-authenticate', /basic/i]], why: 'admin login must challenge before PHP runs' },
  { path: '/data/current.json', status: 200, why: 'the board payload must keep loading', warn: [['cache-control', /no-cache/i, 'Cache-Control should be no-cache so clients revalidate']] },
  // Header sets, on the entry point and on a location with its own add_header.
  { path: '/', status: 200, securityHeaders: true, why: 'entry point must carry the full header set' },
  { path: '/app.js', status: 200, securityHeaders: true, why: 'locations with their own add_header must repeat the set' },
  { path: '/data/current.json', status: 200, securityHeaders: true, why: 'data location must repeat the set' },
  // Perf items: real, but not worth failing a security gate over.
  { path: '/app.js', status: 200, gzip: true, why: 'JS should be compressed (S3)', soft: true },
  { path: '/data/current.json', status: 200, gzip: true, why: 'the board payload should be compressed (S3)', soft: true },
  { path: '/', status: 200, serverTokens: true, why: 'nginx version should not be advertised (M2)', soft: true },
];

async function probe(path, extraHeaders = {}) {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { accept: '*/*', 'user-agent': 'tasktracker-hardening-verify/1', ...extraHeaders },
  });
  return res;
}

const results = [];
for (const check of checks) {
  const problems = [];
  let soft = Boolean(check.soft);
  let observed = null;
  try {
    const res = await probe(check.path, check.gzip ? { 'accept-encoding': 'gzip' } : {});
    const status = res.status;
    observed = status;
    if (status !== check.status) problems.push(`status ${status}, expected ${check.status}`);
    for (const [name, re] of check.headers || []) {
      const v = res.headers.get(name);
      if (!v || !re.test(v)) problems.push(`header ${name}: ${v === null ? 'missing' : JSON.stringify(v)}`);
    }
    if (check.gzip) {
      const ce = res.headers.get('content-encoding') || '';
      if (!/gzip|br|zstd/i.test(ce)) problems.push(`content-encoding: ${ce || 'none'}`);
    }
    if (check.securityHeaders) {
      for (const [name, re] of SECURITY_HEADERS) {
        const v = res.headers.get(name);
        if (!v) problems.push(`missing ${name}`);
        else if (!re.test(v)) problems.push(`${name} does not match ${re}`);
      }
      const xpb = res.headers.get('x-powered-by');
      if (xpb) problems.push(`x-powered-by leaked: ${xpb}`);
    }
    if (check.serverTokens) {
      const server = res.headers.get('server') || '';
      if (/nginx\/\d/i.test(server)) problems.push(`server advertises a version: ${server}`);
    }
    // Only advisory *when the check otherwise behaved*. A soft header warning must never
    // soften a wrong status: a deny rule that wrongly catches /data/current.json is a dead
    // board, and downgrading that to WARN would let the gate exit 0.
    if (status === check.status) {
      let advisory = 0;
      for (const [name, re, message] of check.warn || []) {
        const v = res.headers.get(name);
        if (!v || !re.test(v)) { problems.push(message); advisory += 1; }
      }
      // Only when the warn entries are the ONLY problems: a check that also asserts headers
      // must not let a perf warning soften its security failure.
      if (advisory && advisory === problems.length) soft = true;
    }
  } catch (err) {
    problems.push(`request failed: ${err.message}`);
  }
  results.push({ ...check, problems, soft, observed });
}

const failed = results.filter((r) => r.problems.length && !r.soft);
const warned = results.filter((r) => r.problems.length && r.soft);

const lines = [];
lines.push(`Hardening verification against ${BASE}${process.env.VERIFY_SHA ? ` (deployed ${process.env.VERIFY_SHA.slice(0, 7)})` : ''}`);
for (const r of results) {
  const mark = r.problems.length ? (r.soft ? 'WARN' : 'FAIL') : 'ok  ';
  lines.push(`  [${mark}] ${r.path} -> ${r.observed ?? 'no response'} (${r.why})`);
  for (const p of r.problems) lines.push(`         ${p}`);
}
lines.push(`${results.length - failed.length - warned.length}/${results.length} checks passed, ${warned.length} warning(s), ${failed.length} failure(s)`);

if (failed.length) {
  lines.push('');
  lines.push('A failed check means the host is NOT applying deploy/nginx-default.conf:');
  lines.push('the config parses in CI and the deploy went green, but the running nginx');
  lines.push('is still on a default configuration. On Azure App Service the usual cause is');
  lines.push('the Startup Command: it must be /home/site/wwwroot/deploy/startup.sh.');
  lines.push('See POST_DEPLOY_VERIFICATION.md for the host checklist.');
}

console.log(lines.join('\n'));
for (const f of failed) console.log(`::error::${f.path} ${f.problems.join('; ')}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const fs = await import('node:fs');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Hardening verification\n\n```\n' + lines.join('\n') + '\n```\n');
}
process.exit(failed.length ? 1 : 0);
