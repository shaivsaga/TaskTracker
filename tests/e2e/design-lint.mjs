// tests/e2e/design-lint.mjs - Phase 3 design lint (tokens, subsumption, CSP hashes).
//
// S1 one :root and one :root[data-theme="dark"] block, no light override layer. S2 the
// mockup's 20 token names, identical values, in both app blocks (light vs light). S3 no
// selector declared twice in one cascade context (top level / the same media query). S4
// every px value is one the mockup has, or carries lint-allow:px. S5 hex lives only in the
// two :root blocks or a .bg-* palette rule and is a mockup (or ten-code) colour, or carries
// lint-allow:hex. S6 rgba()/rgb()/hsl() is a :root token, a mockup literal, or allowed the
// same way. S7 every url() resolves under --root (data: ignored). S8 the index.html inline
// <script> bodies, CRLF->LF and sha256-base64, match the pins in deploy/nginx-default.conf.
// S9 exactly two inline <script> elements and no on*= handler. S10 a [hidden] rule still
// declares display:none !important. S11 [[section:name]] markers balance (zero passes). S12
// no @import and no external http(s) URL. A1 markers are well formed, carry a reason of at
// least 8 characters, and name a value that really occurs in the file: a stale allowlist
// lies, so that is a failure.
//
// Markers: /* lint-allow:px 137px -- reason */, lint-allow:hex #123456, lint-allow:color
// rgba(20,24,58,.5) - on the declaration's line or the line directly above it.
// Sections: /* [[section:name]] */ opens and /* [[/section:name]] */ closes.
//
// Node builtins only (no jsdom, no esbuild, no spawn, no network, no build step). Every
// helper is total: map entries are created before use and no reader assumes a match exists,
// because a reader that throws would make every check useless.
//
// Usage: node tests/e2e/design-lint.mjs [--root <dir>] [--css <file>] [--mock <dir>]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || "");
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) { out[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !String(next).startsWith("--")) { out[arg.slice(2)] = String(next); i++; }
    else out[arg.slice(2)] = "";
  }
  return out;
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

const argv = parseArgs(process.argv.slice(2));
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(argv.root || path.resolve(here, "..", ".."));
const cssPath = path.resolve(argv.css || path.join(root, "styles.css"));
const mockDir = path.resolve(argv.mock || "C:/xampp/tt-overnight/mockup");
const indexHtmlPath = path.join(root, "index.html");
const nginxPath = path.join(root, "deploy", "nginx-default.conf");
const mockCssPath = path.join(mockDir, "styles.css");
const mockJsPath = path.join(mockDir, "app.js");

// Blank comments but keep every byte position and newline, so line numbers stay true.
function blankComments(src) { return String(src).replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (m) => m.replace(/[^\n]/g, " ")); }
function lineOf(src, index) { return String(src).slice(0, Math.max(0, index)).split("\n").length; }
function normSel(sel) { return String(sel).replace(/\s+/g, " ").trim(); }
function normCompound(sel) { return String(sel).replace(/\s+/g, "").replace(/["']/g, ""); }
function normValue(v) { return String(v).replace(/\s+/g, "").replace(/["']/g, "").toLowerCase(); }
function normNum(n) { const v = parseFloat(n); return Number.isFinite(v) ? String(v) : String(n); }
function normColor(lit) {
  return String(lit).toLowerCase().replace(/\s+/g, "").replace(/(\d*\.?\d+)(%?)/g, (m, n, pct) => (pct ? normNum(n) + "%" : normNum(n)));
}

// One pass over the comment-blanked sheet. Each rule keeps its line span and enclosing
// at-rules, so a value's owning rule (and whether it is a :root or .bg-* block) is known.
function parseCss(css) {
  const src = blankComments(css);
  const rules = [];
  const stack = [];
  let buf = "";
  let line = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\n") { line++; continue; }
    if (ch === "{") {
      const pre = normSel(buf);
      buf = "";
      if (pre.startsWith("@")) stack.push({ at: pre.toLowerCase(), rule: null });
      else {
        const ctx = stack.map((f) => f.at).filter(Boolean).join(" && ");
        const rule = { sel: pre, line, endLine: line, ctx, inKeyframes: stack.some((f) => f.at && f.at.startsWith("@keyframes")) };
        rules.push(rule);
        stack.push({ at: null, rule });
      }
    } else if (ch === "}") {
      const frame = stack.pop();
      if (frame && frame.rule) frame.rule.endLine = line;
      buf = "";
    } else buf += ch;
  }
  for (const rule of rules) {
    const compound = normCompound(rule.sel);
    rule.rootKind = compound === ":root" ? "light"
      : compound === ":root[data-theme=dark]" ? "dark"
        : /^:root(\[[^\]]*\])*$/.test(compound) ? "other" : null;
    rule.isRoot = rule.rootKind === "light" || rule.rootKind === "dark";
    rule.isBg = String(rule.sel).split(",").some((part) => /^\.bg-[A-Za-z0-9_-]+$/.test(normSel(part)));
  }
  return { src, rules };
}

function bodyOf(rule, src) {
  const chunk = String(src).split("\n").slice(Math.max(0, rule.line - 1), Math.max(rule.line, rule.endLine)).join("\n");
  const open = chunk.indexOf("{");
  if (open === -1) return "";
  const close = chunk.lastIndexOf("}");
  return close > open ? chunk.slice(open + 1, close) : chunk.slice(open + 1);
}

// Innermost rule whose span covers the line; null when the line is outside every rule.
function ownerOf(rules, line) {
  let best = null;
  for (const rule of rules) if (rule.line <= line && line <= rule.endLine && (!best || rule.line >= best.line)) best = rule;
  return best;
}

function tokensOf(text) {
  const out = {};
  for (const m of String(text).matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g)) out[m[1]] = normValue(m[2]);
  return out;
}

function pxAt(src) {
  const out = [];
  for (const m of String(src).matchAll(/(-?\d*\.?\d+)px\b/g)) {
    const num = parseFloat(m[1]);
    if (Number.isFinite(num)) out.push({ num, line: lineOf(src, m.index), text: m[0] });
  }
  return out;
}

function hexAt(src) {
  const out = [];
  for (const m of String(src).matchAll(/(^|[^\w#-])#([0-9a-fA-F]{3,8})\b/g)) out.push({ hex: m[2].toLowerCase(), line: lineOf(src, m.index + m[1].length) });
  return out;
}

function colorAt(src) {
  const out = [];
  for (const m of String(src).matchAll(/\b(rgba?|hsla?)\(([^)]*)\)/g)) out.push({ norm: normColor(m[0]), line: lineOf(src, m.index), text: m[0] });
  return out;
}

function urlAt(src) {
  const out = [];
  for (const m of String(src).matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/g)) {
    const url = String(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3] || "").trim();
    out.push({ url, line: lineOf(src, m.index) });
  }
  return out;
}

const MARKER_RE = /\/\*\s*lint-allow\s*:\s*(px|hex|color)\s+(\S+)\s+--\s*([\s\S]*?)\s*\*\//g;

function markersOf(src) {
  const text = String(src);
  const ok = [];
  for (const m of text.matchAll(MARKER_RE)) ok.push({ type: m[1], value: m[2], reason: m[3].trim(), line: lineOf(text, m.index), index: m.index });
  const indexes = new Set(ok.map((m) => m.index));
  const malformed = [];
  for (const m of text.matchAll(/\/\*[\s\S]*?(?:\*\/|$)/g)) {
    if (!/lint-allow/.test(m[0]) || indexes.has(m.index)) continue;
    malformed.push({ line: lineOf(text, m.index), text: m[0].replace(/\s+/g, " ").trim().slice(0, 80) });
  }
  return { ok, malformed };
}

function near(marker, line) { return marker.line === line || marker.line === line - 1; }
function pxAllowed(markers, num, line) {
  return markers.some((m) => m.type === "px" && near(m, line) && normNum(parseFloat(m.value)) === String(num));
}
function hexAllowed(markers, hex, line) {
  return markers.some((m) => (m.type === "hex" || m.type === "color") && near(m, line) && m.value.toLowerCase() === "#" + hex);
}
function colorAllowed(markers, normLit, line) {
  return markers.some((m) => (m.type === "color" || m.type === "hex") && near(m, line) && normColor(m.value) === normLit);
}

const appCss = readText(cssPath);
const mockCss = readText(mockCssPath);
const mockJs = readText(mockJsPath);
const app = appCss === null ? null : parseCss(appCss);
const mock = mockCss === null ? null : parseCss(mockCss);
const markers = appCss === null ? { ok: [], malformed: [] } : markersOf(appCss);
const blankApp = appCss === null ? "" : app.src;
const blankMock = mockCss === null ? "" : mock.src;
const mockPx = new Set(pxAt(blankMock).map((p) => String(p.num)));
const mockHex = new Set(hexAt(blankMock).map((h) => h.hex));
const mockColors = new Set(colorAt(blankMock).map((c) => c.norm));
const tenCode = new Set((String(mockJs || "").split("\n")[0] || "").match(/#[0-9a-fA-F]{3,8}\b/g)?.map((h) => h.replace(/^#/, "").toLowerCase()) || []);

const needApp = appCss === null ? "styles.css not found: " + cssPath : null;
const needMock = mockCss === null || mockJs === null
  ? "mockup source not found: " + [mockCss === null ? mockCssPath : null, mockJs === null ? mockJsPath : null].filter(Boolean).join(", ")
  : null;

const checks = [];
function check(name, broken, fn) {
  if (broken) { checks.push({ name, ok: false, detail: broken }); return; }
  try {
    const result = fn() || {};
    checks.push({ name, ok: result.ok !== false, detail: String(result.detail === undefined ? "" : result.detail) });
  } catch (err) {
    checks.push({ name, ok: false, detail: "check threw: " + String((err && err.message) || err) });
  }
}

check("S1", needApp, () => {
  const roots = app.rules.filter((r) => r.rootKind !== null);
  const light = roots.filter((r) => r.rootKind === "light").length;
  const dark = roots.filter((r) => r.rootKind === "dark").length;
  const extra = roots.filter((r) => r.rootKind === "other");
  return {
    ok: light === 1 && dark === 1 && extra.length === 0,
    detail: ':root x' + light + ', :root[data-theme="dark"] x' + dark + ", other root-scoped blocks x" + extra.length
      + (extra.length ? " (" + extra.map((r) => normCompound(r.sel) + "@" + r.line).join(", ") + ")" : ""),
  };
});

check("S2", needApp || needMock, () => {
  const tokensFor = (parsed, kind) => {
    const out = {};
    for (const rule of parsed.rules) if (rule.rootKind === kind) Object.assign(out, tokensOf(bodyOf(rule, parsed.src)));
    return out;
  };
  const light = tokensFor(mock, "light");
  const dark = tokensFor(mock, "dark");
  const appLight = tokensFor(app, "light");
  const appDark = tokensFor(app, "dark");
  const counts = (want, got) => {
    const names = Object.keys(want);
    const missing = names.filter((n) => !(n in got));
    const extra = Object.keys(got).filter((n) => !(n in want));
    const differing = names.filter((n) => n in got && want[n] !== got[n]);
    return {
      missing: missing.length, extra: extra.length, differing: differing.length,
      sample: missing.concat(differing).slice(0, 3).map((n) => n + "(mock " + want[n] + " vs app " + got[n] + ")"),
    };
  };
  const l = counts(light, appLight);
  const d = counts(dark, appDark);
  const total = Object.keys(light).length;
  return {
    ok: total > 0 && l.missing + l.extra + l.differing + d.missing + d.extra + d.differing === 0,
    detail: total + " mockup tokens; missing " + l.missing + "/" + d.missing + ", extra " + l.extra + "/" + d.extra
      + ", differing " + l.differing + "/" + d.differing + " (light/dark)" + (l.sample.length || d.sample.length ? "; " + l.sample.concat(d.sample).join(", ") : ""),
  };
});

check("S3", needApp, () => {
  const seen = new Map();
  const dups = [];
  for (const rule of app.rules) {
    if (rule.inKeyframes) continue;
    const key = rule.ctx + "||" + rule.sel;
    if (seen.has(key)) dups.push(seen.get(key).line + "+" + rule.line + " " + rule.sel + (rule.ctx ? " in " + rule.ctx : ""));
    else seen.set(key, rule);
  }
  return {
    ok: dups.length === 0,
    detail: app.rules.length + " rules, " + dups.length + " selector(s) declared twice in one context" + (dups.length ? ": " + dups.slice(0, 6).join("; ") : ""),
  };
});

check("S4", needApp || needMock, () => {
  const all = pxAt(blankApp);
  const bad = new Map();
  for (const p of all) {
    if (mockPx.has(String(p.num)) || pxAllowed(markers.ok, p.num, p.line)) continue;
    if (!bad.has(String(p.num))) bad.set(String(p.num), p);
  }
  const list = [...bad.values()].sort((a, b) => a.line - b.line).map((p) => p.num + "px@" + p.line);
  return {
    ok: list.length === 0,
    detail: all.length + " px values, " + list.length + " not in the mockup or marker-allowed" + (list.length ? ": " + list.slice(0, 14).join(", ") : ""),
  };
});

check("S5", needApp || needMock, () => {
  const all = hexAt(blankApp);
  const bad = [];
  for (const h of all) {
    const owner = ownerOf(app.rules, h.line);
    if (owner && owner.isRoot) continue;
    if (owner && owner.isBg && (mockHex.has(h.hex) || tenCode.has(h.hex))) continue;
    if (hexAllowed(markers.ok, h.hex, h.line)) continue;
    const why = owner && owner.isBg ? "not a mockup or ten-code colour"
      : owner ? "outside :root and .bg-* (in " + owner.sel.slice(0, 40) + ")" : "outside any rule";
    bad.push("#" + h.hex + "@" + h.line + " " + why);
  }
  return {
    ok: bad.length === 0,
    detail: all.length + " hex literals, " + bad.length + " not allowed" + (bad.length ? ": " + bad.slice(0, 12).join("; ") : ""),
  };
});

check("S6", needApp || needMock, () => {
  const all = colorAt(blankApp);
  const bad = [];
  for (const c of all) {
    if (mockColors.has(c.norm)) continue;
    const owner = ownerOf(app.rules, c.line);
    const lineText = blankApp.split("\n")[c.line - 1] || "";
    const head = lineText.slice(0, Math.max(0, lineText.indexOf(c.text)));
    if (owner && owner.isRoot && /--[A-Za-z0-9_-]+\s*:[^;]*$/.test(head)) continue;
    if (colorAllowed(markers.ok, c.norm, c.line)) continue;
    bad.push(c.norm + "@" + c.line);
  }
  return {
    ok: bad.length === 0,
    detail: all.length + " rgb()/rgba()/hsl() literals, " + bad.length + " not a :root token, mockup literal or marker-allowed" + (bad.length ? ": " + bad.slice(0, 8).join(", ") : ""),
  };
});

check("S7", needApp, () => {
  const all = urlAt(blankApp);
  const bad = [];
  for (const u of all) {
    if (/^data:/i.test(u.url)) continue;
    if (u.url === "" || u.url.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(u.url)) { bad.push(u.url + "@" + u.line + " not a local path"); continue; }
    if (!fs.existsSync(path.resolve(root, decodeURIComponent(u.url.split(/[?#]/)[0])))) bad.push(u.url + "@" + u.line + " missing");
  }
  return { ok: bad.length === 0, detail: all.length + " url() targets, " + bad.length + " unresolved under " + root + (bad.length ? ": " + bad.slice(0, 6).join(", ") : "") };
});

check("S8", readText(indexHtmlPath) === null ? "index.html not found: " + indexHtmlPath : readText(nginxPath) === null ? "nginx config not found: " + nginxPath : null, () => {
  const html = readText(indexHtmlPath) || "";
  const pins = new Set([...(readText(nginxPath) || "").matchAll(/sha256-[A-Za-z0-9+/=]+/g)].map((m) => m[0]));
  const bodies = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc\s*=/i.test(m[1])).map((m) => m[2]);
  const hashes = bodies.map((body) => "sha256-" + crypto.createHash("sha256").update(Buffer.from(body.replace(/\r\n/g, "\n"), "utf8")).digest("base64"));
  const unpinned = hashes.filter((h) => !pins.has(h));
  return {
    ok: hashes.length > 0 && unpinned.length === 0,
    detail: hashes.length + " inline script hash(es), " + unpinned.length + " unpinned; "
      + (hashes.map((h) => h.replace("sha256-", "").slice(0, 12) + " " + (pins.has(h) ? "pinned" : "UNPINNED")).join(", ") || "none found"),
  };
});

check("S9", readText(indexHtmlPath) === null ? "index.html not found: " + indexHtmlPath : null, () => {
  const html = readText(indexHtmlPath) || "";
  const inline = [...html.matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/\bsrc\s*=/i.test(m[1])).length;
  const handlers = [...html.matchAll(/\son[a-z]+\s*=/gi)].map((m) => m[0].trim());
  return { ok: inline === 2 && handlers.length === 0, detail: inline + " inline <script> element(s), " + handlers.length + " inline on*= handler(s)" + (handlers.length ? ": " + handlers.slice(0, 5).join(", ") : "") };
});

check("S10", needApp, () => {
  const rule = app.rules.find((r) => String(r.sel).split(",").some((part) => normSel(part) === "[hidden]"));
  const ok = Boolean(rule) && /display\s*:\s*none\s*!important/i.test(rule ? bodyOf(rule, app.src) : "");
  return { ok, detail: rule ? "[hidden] rule at line " + rule.line + (ok ? " declares display:none !important" : " does not declare display:none !important") : "no [hidden] rule found" };
});

check("S11", needApp, () => {
  const text = appCss || "";
  const stack = [];
  const problems = [];
  let count = 0;
  for (const m of text.matchAll(/\/\*\s*\[\[\s*(\/?)\s*section\s*:\s*([A-Za-z0-9_.-]+)\s*\]\]\s*\*\//g)) {
    count++;
    const name = m[2];
    if (m[1] !== "/") {
      if (stack.length) problems.push("nested opener " + name + "@" + lineOf(text, m.index));
      else stack.push({ name, line: lineOf(text, m.index) });
    } else if (!stack.length) {
      problems.push("closer without opener " + name + "@" + lineOf(text, m.index));
    } else {
      const open = stack.pop();
      if (open.name !== name) problems.push("closer " + name + "@" + lineOf(text, m.index) + " closes " + open.name + "@" + open.line);
    }
  }
  for (const open of stack) problems.push("unclosed opener " + open.name + "@" + open.line);
  return { ok: problems.length === 0, detail: count + " section marker(s), " + problems.length + " problem(s)" + (problems.length ? ": " + problems.slice(0, 5).join(", ") : "") };
});

check("S12", needApp, () => {
  const imports = [...blankApp.matchAll(/@import\b/gi)].length;
  const remote = [...new Set([...blankApp.matchAll(/https?:\/\/[^\s)'"]*/gi)].map((m) => m[0]))];
  return { ok: imports === 0 && remote.length === 0, detail: imports + " @import, " + remote.length + " external http(s) URL(s)" + (remote.length ? ": " + remote.slice(0, 5).join(", ") : "") };
});

check("A1", needApp, () => {
  const problems = [];
  for (const m of markers.malformed) problems.push("malformed marker at line " + m.line + ": " + m.text);
  const pxSeen = new Set(pxAt(blankApp).map((p) => String(p.num)));
  const hexSeen = new Set(hexAt(blankApp).map((h) => h.hex));
  const colorSeen = new Set(colorAt(blankApp).map((c) => c.norm));
  for (const m of markers.ok) {
    if (m.reason.length < 8) problems.push("reason under 8 characters at line " + m.line + " (" + m.value + ")");
    const present = m.type === "px" ? pxSeen.has(normNum(parseFloat(m.value)))
      : m.type === "hex" ? hexSeen.has(m.value.toLowerCase().replace(/^#/, ""))
        : colorSeen.has(normColor(m.value));
    if (!present) problems.push("stale marker at line " + m.line + ": " + m.value + " does not occur in " + path.basename(cssPath));
  }
  return { ok: problems.length === 0, detail: markers.ok.length + " marker(s), " + problems.length + " problem(s)" + (problems.length ? ": " + problems.slice(0, 5).join("; ") : "") };
});

for (const c of checks) console.log((c.ok ? "PASS " : "FAIL ") + c.name + " - " + c.detail);
const failed = checks.filter((c) => !c.ok).length;
console.log("design-lint: " + checks.length + " checks, " + (checks.length - failed) + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
