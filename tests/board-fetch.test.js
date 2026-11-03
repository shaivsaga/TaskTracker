/**
 * tests/board-fetch.test.js - the Board fetch must stay revalidatable.
 *
 * data/current.json is about 1.70 MB, almost all of it embedded document bodies and
 * base64 images. Fetching `${API.current}?t=${Date.now()}` made every page load a brand
 * new URL, so a cached copy could never match, and cache: 'no-store' forbade the
 * conditional request outright: every visit downloaded the file in full. nginx already
 * serves /data/current.json with `Cache-Control: no-cache` (deploy/nginx-default.conf),
 * which only pays off if the client asks for the same URL again and lets the ETag
 * answer 304.
 *
 * These guards are structural, in the style of tests/index-integrity.test.js: no
 * browser, no network, no build step. The behavioural half (the board still renders)
 * is covered by the jsdom harness kept outside the repository (see DECISIONS.md D3).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const LINES = APP.split(/\r?\n/);
const FETCH_LINE = LINES.find((l) => l.includes('fetch(') && l.includes('API.current'));

test('the Board is fetched at a stable URL', () => {
  assert.ok(FETCH_LINE, 'app.js no longer fetches API.current at all');
  assert.doesNotMatch(FETCH_LINE, /\?t=/, 'the Board fetch carries a per-load ?t= query, so it can never be revalidated');
  assert.doesNotMatch(FETCH_LINE, /Date\.now\(\)/, 'the Board URL changes on every load');
});

test('the Board fetch asks for revalidation instead of bypassing the cache', () => {
  assert.match(FETCH_LINE, /cache:\s*'no-cache'/, "the Board fetch must use cache: 'no-cache' so nginx's ETag can answer 304");
  assert.doesNotMatch(FETCH_LINE, /cache:\s*'no-store'/, 'no-store forbids the conditional request, so the whole Board is downloaded again');
});

test('the Board fetch keeps its abort timeout', () => {
  assert.match(FETCH_LINE, /AbortSignal\.timeout\(\s*\d+\s*\)/, 'the Board fetch lost its AbortSignal timeout');
});

test('the Board is fetched from exactly one place', () => {
  const hits = LINES.filter((l) => l.includes('API.current'));
  assert.equal(hits.length, 1, 'API.current is referenced on ' + hits.length + ' lines: ' + hits.map((l) => l.trim()).join(' | '));
});
