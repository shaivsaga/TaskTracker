import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inlineImagesIn, inlineImages, rewriteNotes, adoptInlineImages } from '../js/note-images.js';

// Two tiny but valid base64 payloads. Their content is irrelevant: atob only has to decode them.
const A = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a';
const B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const note = (srcs) => srcs.map((s) => `<div>text<img src="${s}" loading="lazy"></div>`).join('');

// A stand-in for window.TTFiles that records what it was asked to upload.
function fakeFiles(fail = null) {
  const uploads = [];
  return {
    uploads,
    async prepare(file) { return { blob: file, name: file.name }; },
    async upload(blob, name) {
      if (fail && name.includes(fail)) throw new Error('Upload failed.');
      const id = 'a'.repeat(32) + '.' + (name.endsWith('.png') ? 'png' : 'jpg');
      uploads.push({ name, size: blob.size, id });
      return { id };
    },
    urlFor(id) { return 'uploads/' + id; },
  };
}

test('inlineImagesIn finds each distinct inline image once, in order', () => {
  const found = inlineImagesIn(note([A, B, A]));
  assert.deepEqual(found.map((f) => f.dataUrl), [A, B]);
  assert.deepEqual(found.map((f) => f.mime), ['jpeg', 'png']);
});

test('inlineImagesIn ignores uploaded files and plain text', () => {
  const uploaded = 'uploads/' + 'a'.repeat(32) + '.jpg';
  assert.deepEqual(inlineImagesIn(note([uploaded]) + '<div>no pictures</div>'), []);
  assert.deepEqual(inlineImagesIn(''), []);
  assert.deepEqual(inlineImagesIn(undefined), []);
});

test('rewriteNotes replaces the mapped image and leaves everything else byte-identical', () => {
  const map = new Map([[A, 'uploads/' + 'b'.repeat(32) + '.jpg']]);
  const out = rewriteNotes(note([A, B]), map);
  assert.ok(out.includes('src="uploads/' + 'b'.repeat(32) + '.jpg"'), 'mapped image was not rewritten');
  assert.ok(out.includes('src="' + B + '"'), 'unmapped image must be left alone');
  assert.ok(out.includes('<div>text<img src='), 'surrounding markup must survive');
  assert.equal(rewriteNotes('', map), '');
});

test('inlineImages dedupes across tasks, so one picture is uploaded once', () => {
  const tasks = [{ id: 't1', notes: note([A, B]) }, { id: 't2', notes: note([A]) }, { id: 't3', notes: '' }];
  assert.equal(inlineImages(tasks).length, 2);
});

test('adoptInlineImages uploads each image once and returns the rewritten tasks', async () => {
  const files = fakeFiles();
  const tasks = [{ id: 't1', notes: note([A, B]) }, { id: 't2', notes: note([A]) }];
  const res = await adoptInlineImages(tasks, files);
  assert.equal(res.count, 2);
  assert.equal(files.uploads.length, 2, 'the shared image must not be uploaded twice');
  assert.equal(res.map.size, 2);
  for (const t of res.tasks) {
    assert.ok(!t.notes.includes('base64'), 'task ' + t.id + ' still carries image bytes');
    assert.match(t.notes, /src="uploads\/[a-f0-9]{32}\.(jpg|png)"/);
  }
  assert.equal(tasks[0].notes, note([A, B]), 'the input array must not be mutated');
});

test('adoptInlineImages is a no-op when nothing is inline', async () => {
  const tasks = [{ id: 't1', notes: '<div>plain</div>' }];
  const res = await adoptInlineImages(tasks, fakeFiles());
  assert.equal(res.count, 0);
  assert.equal(res.tasks, tasks);
  assert.equal(res.map.size, 0);
});

test('adoptInlineImages fails closed when the upload client is unavailable', async () => {
  await assert.rejects(() => adoptInlineImages([{ id: 't1', notes: note([A]) }], null), /Sign in again/);
  await assert.rejects(() => adoptInlineImages([{ id: 't1', notes: note([A]) }], {}), /Sign in again/);
});

test('adoptInlineImages fails closed when an upload is rejected', async () => {
  const tasks = [{ id: 't1', notes: note([A, B]) }];
  await assert.rejects(() => adoptInlineImages(tasks, fakeFiles('note-image.png')), /Upload failed/);
});
