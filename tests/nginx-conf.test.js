/**
 * tests/nginx-conf.test.js - structural guards on deploy/nginx-default.conf.
 *
 * `nginx -t` is the real check (deploy/check-nginx.sh, run in CI), but it needs nginx, and
 * the failure that took production down on 2026-10-31 was invisible to a locally-wrapped
 * config: the file's top level is the http context, Azure's own nginx.conf already sets
 * `gzip` there, and a second one is fatal --
 *   nginx: [emerg] "gzip" directive is duplicate in /etc/nginx/sites-enabled/default:14
 * -- so startup.sh refused to install ANY of the rules and the host kept serving
 * /Deploy/startup.sh with HTTP 200.
 *
 * check-nginx.sh's wrapper now declares `gzip on;` too, so CI reproduces that. These tests
 * assert the same property with no nginx installed, and pin the security rules the fix had
 * to leave untouched.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const CONF = fs.readFileSync(path.join(ROOT, 'deploy', 'nginx-default.conf'), 'utf8');
const WRAPPER = fs.readFileSync(path.join(ROOT, 'deploy', 'check-nginx.sh'), 'utf8');

// The set the config repeats in every location that declares its own add_header (nginx does
// not inherit add_header into such a location). Copied from the file, pinned here so a
// dropped repeat fails loudly instead of silently unhardening one route.
const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'x-content-type-options',
];

/**
 * One entry per line: { text, depth } where depth is the context the line's own directive
 * sits in - 0 is the http context (this file is included into http{}), 1 is our server, 2+ is
 * a location. Quote- and comment-aware, because regex locations contain literal braces
 * (`^/uploads/([a-f0-9]{32}\.(pdf|jpg|png))$`) that a naive brace count would miscount.
 */
function scan(conf) {
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
  assert.equal(depth, 0, 'nginx-default.conf has unbalanced braces');
  return lines;
}

const LINES = scan(CONF);
const named = (re) => LINES.filter((l) => re.test(l.text)).map((l) => ({ ...l, name: re.exec(l.text)[1] }));

test('no gzip directive sits in the http context the host already owns', () => {
  // The exact production failure. Azure's nginx.conf sets `gzip` in http; ours must not.
  const httpGzip = LINES.filter((l) => l.depth === 0 && /^gzip/.test(l.text));
  assert.deepEqual(
    httpGzip.map((l) => l.text),
    [],
    'a top-level gzip directive is a duplicate of the host config and makes nginx -t fail',
  );
  // ...and the settings must still be applied, just scoped to our server.
  const serverGzip = LINES.filter((l) => l.depth === 1 && /^gzip/.test(l.text));
  assert.equal(serverGzip.length, 6, `expected the 6 gzip directives inside server{}, got ${serverGzip.length}`);
  assert.ok(serverGzip.some((l) => l.text === 'gzip on;'), 'gzip must still be switched on');
  assert.ok(
    serverGzip.some((l) => /^gzip_types\b/.test(l.text) && /application\/javascript/.test(l.text)),
    'gzip_types must still cover the JS/CSS/JSON the S3 finding was about',
  );
});

test('http-only directives stay in the http context', () => {
  // `map` and `limit_req_zone` are valid ONLY in http; moving them into server{} would be a
  // new emerg in place of the one we just fixed.
  const map = named(/^(map)\b/);
  assert.equal(map.length, 1);
  assert.equal(map[0].depth, 0, 'map is http-context only');
  const zone = named(/^(limit_req_zone)\b/);
  assert.equal(zone.length, 1);
  assert.equal(zone[0].depth, 0, 'limit_req_zone is http-context only');
});

test('limit_req_status sits in our server{}, never the host-owned http context', () => {
  // Same collision class as gzip, and the reason this one *can* be fixed while limit_req_zone
  // cannot: limit_req_status is valid in server too, so it moves down out of the context
  // Azure's nginx.conf already owns. Exactly one copy, in server{}, still 429.
  const status = named(/^(limit_req_status)\b/);
  assert.equal(status.length, 1, `expected exactly 1 limit_req_status directive, got ${status.length}`);
  assert.equal(status[0].depth, 1, 'limit_req_status must sit in our server{}, not the http context');
  assert.equal(status[0].text, 'limit_req_status 429;', 'a throttled login must still answer 429, not 503');
  const inHttp = LINES.filter((l) => l.depth === 0 && /^limit_req_status\b/.test(l.text));
  assert.deepEqual(
    inHttp.map((l) => l.text),
    [],
    'limit_req_status is back in the http context, where it duplicates the host config',
  );
  // ...and the status only means anything if the login route still consumes the zone.
  assert.ok(
    CONF.includes('limit_req zone=login burst=3 nodelay;'),
    'no route applies the login zone, so the throttle (and its 429) is dead config',
  );
});

test('check-nginx.sh reproduces the host http context', () => {
  // The wrapper is why CI was green while the host was broken. It must declare the
  // directives the host already owns, or the same class of collision passes CI again.
  const wrapperHttp = /http\s*\{([\s\S]*?)\n\}/.exec(WRAPPER);
  assert.ok(wrapperHttp, 'check-nginx.sh no longer has an http{} wrapper to inspect');
  assert.match(wrapperHttp[1], /^\s*gzip on;/m, 'the wrapper must declare the host\'s http-level gzip');
  assert.ok(WRAPPER.includes('include $CONF'), 'the wrapper must still include the config under test');
});

test('the security rules the fix had to preserve are all still present', () => {
  const all = CONF;
  assert.equal(named(/^add_header\s+(strict-transport-security)/i).length > 0, true);
  assert.match(all, /auth_basic\s/, 'admin login must still challenge');
  assert.match(all, /auth_basic_user_file\s/, 'admin login must still read its htpasswd');
  assert.match(all, /server_tokens\s+off/, 'the version must still not be advertised');
  // Private paths denied in any casing (Azure's wwwroot resolves case-insensitively).
  assert.match(all, /location\s+~\*\s+\^\/\(data\|deploy\|tests\)\//, 'the private-directory deny is gone');
  assert.match(all, /location\s+~\*\s+\^\/package\\\.json\$/, 'the package.json deny is gone');
  assert.match(all, /limit_req_zone\s+\$binary_remote_addr\s+zone=login:/, 'the login throttle is gone');
});

test('the security gates this file has silently lost before stay pinned', () => {
  const all = CONF;
  // 03c9559: as `^~ /api/` this never fired for /Api/login.php, so the request reached the
  // generic PHP handler and skipped this gate AND the login throttle. It must stay a
  // case-insensitive regex.
  assert.match(all, /location\s+~\*\s+\^\/api\//, 'the case-insensitive /api/ 404 gate is gone or lost its ~*');
  assert.doesNotMatch(all, /location\s+\^~\s+\/api\//, 'a prefix /api/ gate is case-sensitive on Linux and never fires for /Api/');
  for (const route of ['login', 'logout', 'versions', 'publish', 'upload']) {
    assert.ok(
      all.includes(`location = /api/${route}.php`),
      `/api/${route}.php is no longer one of the five exact routes`,
    );
  }
  assert.ok(all.includes('location ~ /\\.(?!well-known)'), 'the hidden-file deny is gone');
});

test('every location with its own add_header repeats the whole security set', () => {
  // The trap the config warns about: one add_header in a location drops the inherited set.
  const locations = [];
  for (let i = 0; i < LINES.length; i += 1) {
    if (LINES[i].depth !== 1 || !/^location\b/.test(LINES[i].text)) continue;
    const body = [];
    for (let j = i + 1; j < LINES.length && LINES[j].depth > 1; j += 1) body.push(LINES[j].text);
    locations.push({ at: LINES[i].text, body });
  }
  assert.ok(locations.length >= 6, `expected the config's locations, found ${locations.length}`);
  const withHeaders = locations.filter((l) => l.body.some((t) => /^add_header\b/.test(t)));
  assert.ok(withHeaders.length > 0, 'no location declares add_header; this test would prove nothing');
  for (const loc of withHeaders) {
    for (const header of SECURITY_HEADERS) {
      assert.ok(
        loc.body.some((t) => new RegExp(`^add_header\\s+${header}\\b`, 'i').test(t)),
        `${loc.at} declares add_header but does not repeat ${header}`,
      );
    }
  }
});
