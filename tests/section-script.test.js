import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const SECTION_SH = path.join(ROOT, 'deploy', 'section.sh');
const VERIFY_SCRIPT = path.join(ROOT, 'deploy', 'verify-hardening.mjs');

const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'x-content-type-options',
];

const CSP_HASH = "'sha256-hgakgEjVGdLiVUqTyUxCoKPOpnq7d5ftvwYsV7jK9n8='";

function scanNginxConf(conf) {
  const lines = [];
  let depth = 0;
  let quote = null;
  for (const raw of conf.split('\n')) {
    let text = '';
    for (const c of raw) {
      if (quote) {
        if (c === quote) quote = null;
        text += c;
      } else if (c === '"' || c === "'") {
        quote = c;
        text += c;
      } else if (c === '#') break;
      else text += c;
    }
    const t = text.trim();
    const start = depth;
    for (const c of t) {
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
    }
    assert.ok(depth >= 0, `unbalanced braces near: ${raw}`);
    if (t) lines.push({ text: t, depth: start });
  }
  assert.equal(depth, 0, 'generated nginx config has unbalanced braces');
  return lines;
}

function runSection(args, env = {}) {
  return spawnSync('bash', [SECTION_SH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('deploy/section.sh provision seeds section board, generates configs, and rejects invalid/duplicate ids', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-section-prov-'));
  try {
    const wwwroot = path.join(work, 'wwwroot');
    const secure = path.join(work, 'secure');
    fs.mkdirSync(path.join(wwwroot, 'data'), { recursive: true });
    const subjects = [
      { code: 'MATH', name: 'Mathematics', color: '#58affc', active: true },
      { code: 'ENG', name: 'English', color: '#f59e0b', active: false },
    ];
    fs.writeFileSync(
      path.join(wwwroot, 'data', 'current.json'),
      JSON.stringify({ schemaVersion: 2, revision: 4, subjects, tasks: [{ id: 't1', title: 'Secret A' }], announcements: [{ text: 'A only' }] }),
    );

    const env = { TT_WWWROOT: wwwroot, TT_SECURE_DIR: secure, TT_SKIP_RELOAD: '1' };

    for (const badId of ['a', 'B', '../x', 'foo/bar', 'a b', '-b', '_b', 'x'.repeat(33), '']) {
      const bad = runSection(['provision', badId], env);
      assert.notEqual(bad.status, 0, `expected invalid ID "${badId}" to fail`);
    }

    const res = runSection(['provision', 'b'], env);
    assert.equal(res.status, 0, `provision failed: ${res.stderr}`);
    const linkMatch = /\/s\/b\/([a-f0-9]{32})\//.exec(res.stdout);
    assert.ok(linkMatch, `expected 32-hex Section Link in stdout, got: ${res.stdout}`);
    const token = linkMatch[1];
    assert.match(res.stdout, /htpasswd_b/);

    const seeded = JSON.parse(fs.readFileSync(path.join(wwwroot, 'data', 'sections', 'b', 'current.json'), 'utf8'));
    assert.equal(seeded.schemaVersion, 2);
    assert.equal(seeded.revision, 0);
    assert.deepEqual(seeded.subjects, subjects);
    assert.deepEqual(seeded.tasks, []);
    assert.deepEqual(seeded.announcements, []);
    assert.deepEqual(seeded.deletedTasks, []);
    assert.match(seeded.publishedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);

    const httpConf = fs.readFileSync(path.join(secure, 'sections-http-b.conf'), 'utf8');
    assert.equal(httpConf.trim(), 'limit_req_zone $binary_remote_addr zone=login_b:10m rate=5r/m;');

    const serverConf = fs.readFileSync(path.join(secure, 'sections-server-b.conf'), 'utf8');
    const lines = scanNginxConf(serverConf);
    const locations = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].depth !== 0 || !/^location\b/.test(lines[i].text)) continue;
      const body = [];
      for (let j = i + 1; j < lines.length && lines[j].depth > 0; j += 1) body.push(lines[j].text);
      locations.push({ at: lines[i].text, body });
    }

    const locNoSlash = locations.find((l) => l.at === `location = /s/b/${token} {`);
    assert.ok(locNoSlash, `missing route /s/b/${token}`);
    assert.ok(locNoSlash.body.includes('absolute_redirect off;'), 'missing absolute_redirect off in non-slash location');
    assert.ok(locNoSlash.body.includes(`return 301 /s/b/${token}/;`), 'missing 301 redirect in non-slash location');

    const locSlash = locations.find((l) => l.at === `location = /s/b/${token}/ {`);
    assert.ok(locSlash, `missing route /s/b/${token}/`);
    assert.ok(locSlash.body.includes(`rewrite ^ /s/b/${token}/index.html last;`), 'missing internal rewrite in trailing-slash location');
    assert.ok(!locSlash.body.some((t) => /\balias\b/.test(t)), 'trailing-slash location must not use alias');

    const withHeaders = locations.filter((l) => l.body.some((t) => /^add_header\b/.test(t)));
    assert.ok(withHeaders.length >= 6, `expected header-bearing locations, got ${withHeaders.length}`);
    for (const loc of withHeaders) {
      for (const h of SECURITY_HEADERS) {
        assert.ok(
          loc.body.some((t) => new RegExp(`^add_header\\s+${h}\\b`, 'i').test(t)),
          `${loc.at} is missing ${h}`,
        );
      }
      assert.ok(
        loc.body.some((t) => t.includes(CSP_HASH)),
        `${loc.at} must pin exact CSP hash`,
      );
    }

    for (const ep of ['login', 'logout', 'versions', 'publish', 'upload']) {
      const loc = locations.find((l) => l.at.startsWith(`location = /s/b/${token}/api/${ep}.php`));
      assert.ok(loc, `missing route /s/b/${token}/api/${ep}.php`);
      assert.ok(loc.body.includes('fastcgi_param TT_SECTION "b";'), `${ep} missing TT_SECTION`);
      assert.ok(loc.body.includes(`fastcgi_param SCRIPT_NAME /s/b/${token}/api/${ep}.php;`), `${ep} missing SCRIPT_NAME`);
      assert.ok(loc.body.includes(`fastcgi_param SCRIPT_FILENAME ${wwwroot}/api/${ep}.php;`), `${ep} missing SCRIPT_FILENAME`);
      if (ep === 'login') {
        assert.ok(loc.body.includes('limit_req zone=login_b burst=3 nodelay;'));
        assert.ok(loc.body.includes(`auth_basic_user_file ${secure}/htpasswd_b;`));
        assert.ok(loc.body.includes('fastcgi_param REMOTE_USER $remote_user;'));
      } else {
        assert.ok(loc.body.includes('fastcgi_param REMOTE_USER "";'));
      }
      if (ep === 'upload') {
        assert.ok(loc.body.includes('client_max_body_size 12m;'));
      }
    }

    const xfer = locations.find((l) => l.at.startsWith(`location = /s/b/${token}/transfer.php`));
    assert.ok(xfer, 'missing section transfer.php route');
    assert.ok(xfer.body.includes('fastcgi_param TT_SECTION "b";'));
    assert.ok(xfer.body.includes(`fastcgi_param SCRIPT_NAME /s/b/${token}/transfer.php;`));

    assert.match(serverConf, new RegExp(`location ~\\* \\^/s/b/${token}/api/`));
    assert.match(serverConf, new RegExp(`location ~\\* \\^/s/b/${token}/\\(data\\|deploy\\|tests\\)/`));

    // Idempotency guard: second provision refuses and points to rotate.
    const dup = runSection(['provision', 'b'], env);
    assert.notEqual(dup.status, 0);
    assert.match(dup.stderr, /rotate b/);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('deploy/section.sh provision seeds empty subjects when Section A current.json is absent', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-section-empty-'));
  try {
    const wwwroot = path.join(work, 'wwwroot');
    const secure = path.join(work, 'secure');
    fs.mkdirSync(wwwroot, { recursive: true });
    const res = runSection(['provision', 'c-1'], { TT_WWWROOT: wwwroot, TT_SECURE_DIR: secure, TT_SKIP_RELOAD: '1' });
    assert.equal(res.status, 0, res.stderr);
    const seeded = JSON.parse(fs.readFileSync(path.join(wwwroot, 'data', 'sections', 'c-1', 'current.json'), 'utf8'));
    assert.deepEqual(seeded.subjects, []);
    assert.equal(seeded.revision, 0);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('deploy/section.sh rotate replaces token, calls nginx -t && -s reload, and rolls back on failed nginx -t', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-section-rot-'));
  try {
    const wwwroot = path.join(work, 'wwwroot');
    const secure = path.join(work, 'secure');
    fs.mkdirSync(wwwroot, { recursive: true });

    const prov = runSection(['provision', 'b'], { TT_WWWROOT: wwwroot, TT_SECURE_DIR: secure, TT_SKIP_RELOAD: '1' });
    assert.equal(prov.status, 0, prov.stderr);
    const oldToken = /\/s\/b\/([a-f0-9]{32})\//.exec(prov.stdout)[1];

    const logFile = path.join(work, 'nginx-calls.log');
    const stubOk = path.join(work, 'nginx-ok.sh');
    fs.writeFileSync(stubOk, `#!/bin/sh\necho "$*" >> "${logFile}"\nexit 0\n`, { mode: 0o755 });

    const rotOk = runSection(['rotate', 'b'], {
      TT_WWWROOT: wwwroot,
      TT_SECURE_DIR: secure,
      TT_NGINX_BIN: stubOk,
      TT_SKIP_RELOAD: '0',
    });
    assert.equal(rotOk.status, 0, rotOk.stderr);
    const newToken = /\/s\/b\/([a-f0-9]{32})\//.exec(rotOk.stdout)[1];
    assert.notEqual(newToken, oldToken);

    const serverConfAfter = fs.readFileSync(path.join(secure, 'sections-server-b.conf'), 'utf8');
    assert.ok(!serverConfAfter.includes(oldToken), 'old token must be completely removed');
    assert.ok(serverConfAfter.includes(newToken), 'new token must be written');
    assert.equal(fs.readFileSync(logFile, 'utf8').trim(), '-t\n-s reload');

    // Failing nginx -t must roll back to serverConfAfter.
    const stubFail = path.join(work, 'nginx-fail.sh');
    fs.writeFileSync(stubFail, '#!/bin/sh\necho "bad config" >&2\nexit 1\n', { mode: 0o755 });
    const rotFail = runSection(['rotate', 'b'], {
      TT_WWWROOT: wwwroot,
      TT_SECURE_DIR: secure,
      TT_NGINX_BIN: stubFail,
      TT_SKIP_RELOAD: '0',
    });
    assert.notEqual(rotFail.status, 0);
    assert.equal(fs.readFileSync(path.join(secure, 'sections-server-b.conf'), 'utf8'), serverConfAfter);

    const missing = runSection(['rotate', 'z'], { TT_WWWROOT: wwwroot, TT_SECURE_DIR: secure, TT_SKIP_RELOAD: '1' });
    assert.notEqual(missing.status, 0);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('deploy/verify-hardening.mjs --section-url verifies section endpoints and fails on regressions', async () => {
  const token = '0123456789abcdef0123456789abcdef';
  const secPrefix = `/s/b/${token}`;
  let breakRule = false;

  const secHeaders = {
    'Strict-Transport-Security': 'max-age=300',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' ${CSP_HASH}`,
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Content-Type-Options': 'nosniff',
  };

  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '').split('?')[0];
    const send = (status, body, extra = {}) => {
      const headers = { ...extra };
      let payload = Buffer.from(body);
      if (status === 200 && String(req.headers['accept-encoding'] || '').includes('gzip')) {
        payload = zlib.gzipSync(payload);
        headers['Content-Encoding'] = 'gzip';
      }
      res.writeHead(status, headers);
      res.end(payload);
    };

    if (urlPath === '/Api/login.php' || urlPath === '/Api/versions.php') return send(404, 'not found');
    if (['/Data/current.json', '/Deploy/startup.sh', '/Tests/php/run.php', '/Package.json', '/package.json'].includes(urlPath)) {
      return send(403, 'forbidden');
    }
    if (urlPath === '/api/login.php') return send(401, 'auth required', { 'WWW-Authenticate': 'Basic realm="TaskTracker admin"' });
    if (urlPath === '/data/current.json') return send(200, '{}', { ...secHeaders, 'Cache-Control': 'no-cache' });
    if (urlPath === '/' || urlPath === '/app.js') return send(200, 'ok', secHeaders);

    if (urlPath === `${secPrefix}/`) return send(200, '<html></html>', { ...secHeaders, 'Cache-Control': 'no-cache' });
    if (urlPath === `${secPrefix}/data/current.json`) return send(200, '{}', { ...secHeaders, 'Cache-Control': 'no-cache' });
    if (urlPath === `${secPrefix}/api/login.php`) return send(401, 'auth required', { 'WWW-Authenticate': 'Basic realm="TaskTracker admin"' });
    if (urlPath === `${secPrefix}/Api/login.php`) return send(breakRule ? 200 : 404, 'api gate');
    if (urlPath === `${secPrefix}/Api/versions.php`) return send(404, 'api gate');
    if (urlPath === `${secPrefix}/Data/current.json` || urlPath === `${secPrefix}/data/admin/state.json`) return send(403, 'forbidden');

    return send(404, 'not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const sectionUrl = `${base}${secPrefix}/`;

    const ok = await execFileAsync('node', [VERIFY_SCRIPT, base, '--section-url', sectionUrl], { encoding: 'utf8' });
    assert.match(ok.stdout, /25\/25 checks passed, 0 warning\(s\), 0 failure\(s\)/);

    breakRule = true;
    await assert.rejects(
      () => execFileAsync('node', [VERIFY_SCRIPT, base, '--section-url', sectionUrl], { encoding: 'utf8' }),
      (err) => err.code === 1 && /\[FAIL\] \/s\/b\/[a-f0-9]{32}\/Api\/login\.php/.test(err.stdout),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
