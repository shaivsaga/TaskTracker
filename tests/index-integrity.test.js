/**
 * tests/index-integrity.test.js - structural guards on index.html.
 *
 * On 2026-11-01 the feat/ux-redesign worktree was found with index.html replaced by a
 * standalone prototype shell: 761 lines, a single <script> element, its own fabricated
 * seed data behind the localStorage key tt_shell_v3, and no reference at all to app.js,
 * logic.js, styles.css, attachments.js, qrcode.js or qr-draw.js. The application was
 * unreachable, and merging that file would have deleted every feature - yet CI stayed
 * green, because nothing asserted that index.html still loads the application.
 *
 * These tests are deliberately structural: no browser, no build step, no network. They
 * pin the load contract (which modules index.html must pull in, and that they are not
 * inlined instead), the asset version stamps that must agree with app.js, and the static
 * DOM contract app.js binds at module scope.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Defaults to this checkout; INDEX_INTEGRITY_ROOT points the same guards at another
// worktree, which is how the corruption above was caught before it could be merged.
const ROOT = process.env.INDEX_INTEGRITY_ROOT
  ? path.resolve(process.env.INDEX_INTEGRITY_ROOT)
  : path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const HTML = read("index.html");
const APP = read("app.js");

// Both quote characters, built without literals so this file stays easy to re-quote.
const Q = String.fromCharCode(34) + String.fromCharCode(39);
const quoted = (re) => new RegExp("[" + Q + "]" + re + "[" + Q + "]");

// Modules index.html must load for the application to exist at all.
const REQUIRED_MODULES = ["logic.js", "app.js"];

// Element ids app.js binds at module scope. If one is missing the app throws while
// loading, so this is the minimum static DOM contract and it is safe to pin.
const REQUIRED_IDS = [
  "theme-toggle",
  "meta-theme-color",
  "breadcrumb-current",
  "action-feedback",
  "task-dialog-overlay",
  "dialog-title-input",
  "dialog-close",
  "toast",
  "toast-message",
  "page-my-tasks",
  "announce-admin",
  "sync-note",
];

// A shell that reimplements the UI inside index.html announces itself with its own
// storage key and fabricated seed data. None of that may ship.
const SHELL_MARKERS = ["tt_shell", "seedTasks", "Mockup controls", "DCLogic", "x-dc"];

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const ATTR = /\b(src|href|type|rel)\s*=\s*([^\s>]+)/gi;
const STAMP = /[\w./-]*\/([\w.-]+\.(?:js|css))\?v=(\d+)|["\u0027(]([\w.-]+\.(?:js|css))\?v=(\d+)/g;

function unquote(value) {
  return value.replace(new RegExp("^[" + Q + "]|[" + Q + "]$", "g"), "");
}

function scriptTags(html) {
  const tags = [];
  for (const m of html.matchAll(SCRIPT)) {
    const attrs = {};
    for (const a of m[1].matchAll(ATTR)) attrs[a[1].toLowerCase()] = unquote(a[2]);
    tags.push({ attrs, body: m[2] });
  }
  return tags;
}

function stamps(text) {
  const out = new Map();
  for (const m of text.matchAll(STAMP)) {
    const asset = m[1] || m[3];
    const version = m[2] || m[4];
    if (asset) out.set(asset, version);
  }
  return out;
}

const TAGS = scriptTags(HTML);

test("index.html loads the application as ES modules", () => {
  assert.ok(TAGS.length > 0, "index.html declares no script elements at all");
  for (const asset of REQUIRED_MODULES) {
    const hit = TAGS.find((t) => t.attrs.src === asset || (t.attrs.src || "").startsWith(asset + "?"));
    assert.ok(hit, "index.html no longer loads " + asset + " - the application would not start");
    assert.equal(hit.attrs.type, "module", asset + " must be loaded as an ES module");
  }
});

test("index.html links the application stylesheet", () => {
  const links = [...HTML.matchAll(/<link\b([^>]*)>/gi)].map((m) => {
    const attrs = {};
    for (const a of m[1].matchAll(ATTR)) attrs[a[1].toLowerCase()] = unquote(a[2]);
    return attrs;
  });
  const css = links.find((l) => (l.href || "").startsWith("styles.css"));
  assert.ok(css, "index.html does not link styles.css");
  assert.equal(css.rel, "stylesheet", "the styles.css link must keep rel=stylesheet");
});

test("index.html does not inline application logic", () => {
  const inline = TAGS.filter((t) => !t.attrs.src);
  const bytes = inline.reduce((n, t) => n + t.body.length, 0);
  assert.ok(
    bytes < 4096,
    "index.html carries " + bytes + " bytes of inline script; application logic belongs in app.js, not index.html",
  );
});

test("every local asset index.html references exists on disk", () => {
  const refs = new Set();
  for (const m of HTML.matchAll(/\b(?:src|href)\s*=\s*([^\s>]+)/gi)) refs.add(unquote(m[1]));
  const local = [...refs].filter((r) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(r));
  assert.ok(local.length >= 4, "expected several local asset references, found " + local.length);
  for (const ref of local) {
    const file = ref.split("?")[0].split("#")[0];
    assert.ok(
      fs.existsSync(path.join(ROOT, file)),
      "index.html references " + ref + " but " + file + " does not exist",
    );
  }
});

test("asset version stamps agree between index.html and app.js", () => {
  const fromHtml = stamps(HTML);
  const fromApp = stamps(APP);
  assert.ok(fromHtml.size > 0, "index.html declares no ?v= asset stamps");
  for (const [asset, version] of fromApp) {
    if (!fromHtml.has(asset)) continue;
    assert.equal(
      fromHtml.get(asset),
      version,
      asset + " is stamped ?v=" + fromHtml.get(asset) + " in index.html but ?v=" + version +
        " where app.js imports it, so browsers would cache the two out of step",
    );
  }
});

test("the static DOM contract app.js binds is present", () => {
  for (const id of REQUIRED_IDS) {
    assert.match(
      HTML,
      new RegExp("id\\s*=\\s*[" + Q + "]" + id + "[" + Q + "]"),
      "index.html is missing the id " + id + ", which app.js queries at module scope",
    );
  }
});

test("no standalone-shell marker has replaced the application", () => {
  for (const marker of SHELL_MARKERS) {
    assert.ok(!HTML.includes(marker), "index.html contains the prototype-shell marker " + marker);
  }
  assert.ok(
    !/id\s*=\s*["\u0027]view["\u0027]/.test(HTML),
    "index.html exposes a bare #view mount, which belongs to a prototype shell rather than the app",
  );
});

test("index.html is a complete HTML document", () => {
  assert.match(HTML, /<!doctype html>/i, "index.html lost its doctype");
  assert.match(HTML, /<html\b/i, "index.html lost its html element");
  assert.match(HTML, /<\/body>\s*<\/html>\s*$/i, "index.html does not end with </body></html>");
});
