// js/note-images.js - a note image pasted while the upload path is unavailable is kept inline as
// base64 (`insertDocImages`'s fallback in js/tasks.js). Inline bytes belong to the note, so they ride
// in every published board: ten of them made data/current.json 1.70 MB, and a phone on a slow link
// could not fetch it before app.js's 8 s abort, so the app showed "Offline" over a cached board.
//
// Publishing now moves each inline image to uploads/ and rewrites the note, so the shared board
// carries a URL instead of the picture. `uploads/<id>` is already the other shape sanitizeDoc allows.
//
// No DOM and no globals: the upload client (window.TTFiles) arrives as an argument, so this module
// can be imported and tested in node.

// src="data:image/jpeg;base64,..." as sanitizeDoc serialises an <img>. Base64 cannot contain a
// quote, so the attribute value is unambiguous.
const INLINE_SRC = /src="(data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+)"/g;

// The distinct inline images inside one note string, in the order they appear.
export function inlineImagesIn(notes) {
  const seen = new Map();
  for (const m of String(notes || '').matchAll(INLINE_SRC)) if (!seen.has(m[1])) seen.set(m[1], m[2]);
  return [...seen].map(([dataUrl, mime]) => ({ dataUrl, mime }));
}

// The same note with every inline image that has an upload replaced; unknown ones are left alone.
export function rewriteNotes(notes, map) {
  return String(notes || '').replace(INLINE_SRC, (all, dataUrl) => {
    const url = map.get(dataUrl);
    return url ? 'src="' + url + '"' : all;
  });
}

// Every distinct inline image across a task list, deduped by data URL so one picture uploads once.
export function inlineImages(tasks) {
  const seen = new Map();
  for (const t of tasks) for (const img of inlineImagesIn(t.notes)) if (!seen.has(img.dataUrl)) seen.set(img.dataUrl, img);
  return [...seen.values()];
}

function fileFor({ dataUrl, mime }) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new File([bytes], 'note-image.' + (mime === 'jpeg' ? 'jpg' : mime), { type: mime });
}

// Uploads each inline image once and returns the rewritten task list plus the data URL -> uploads/
// map. Throws instead of publishing: a board that still carries the image bytes is the bug.
export async function adoptInlineImages(tasks, files) {
  const inline = inlineImages(tasks);
  if (!inline.length) return { tasks, map: new Map(), count: 0 };
  if (!files || typeof files.prepare !== 'function' || typeof files.upload !== 'function') {
    throw new Error('Sign in again to publish: the note images must be uploaded first.');
  }
  const map = new Map();
  for (const img of inline) {
    const { blob, name } = await files.prepare(fileFor(img));
    const out = await files.upload(blob, name);
    map.set(img.dataUrl, files.urlFor(out.id));
  }
  return { tasks: tasks.map((t) => ({ ...t, notes: rewriteNotes(t.notes, map) })), map, count: inline.length };
}
