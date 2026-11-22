const INLINE_SRC = /src="(data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+)"/g;

export function inlineImagesIn(notes) {
  const seen = new Map();
  for (const m of String(notes || '').matchAll(INLINE_SRC)) if (!seen.has(m[1])) seen.set(m[1], m[2]);
  return [...seen].map(([dataUrl, mime]) => ({ dataUrl, mime }));
}

export function rewriteNotes(notes, map) {
  return String(notes || '').replace(INLINE_SRC, (all, dataUrl) => {
    const url = map.get(dataUrl);
    return url ? 'src="' + url + '"' : all;
  });
}

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
