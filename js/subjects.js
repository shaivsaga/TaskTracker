/**
 * js/subjects.js - the subject catalogue: validation, readable ink, and preset application.
 *
 * Pure: no DOM, no network, no storage. The server repeats these rules (api/_board.php); a value
 * this module rejects must never be sent, and a value it accepts must not be rejected there.
 *
 * A Subject is {code, name, color, active}. The code is immutable once created, so renaming or
 * recolouring a subject never re-tags a task; retiring one only removes it from new choices.
 */

/** The ten colours the app already ships, in the order the design system lists them. */
export const PALETTE = [
  '#58affc', '#ff9f6b', '#70d1fe', '#8fe3a8', '#d8c7a0',
  '#c3c7d6', '#c9a6e0', '#f7cd54', '#fba6f7', '#7ff0e0',
];

export const MAX_SUBJECTS = 300;
export const MAX_NAME = 100;

/** The class each shipped palette colour already uses, so an unchanged colour renders identically. */
export const COLOR_CLASSES = [
  'bg-blue', 'bg-sunglow', 'bg-cyan', 'bg-green', 'bg-sand',
  'bg-stone', 'bg-mauve', 'bg-yellow', 'bg-pink', 'bg-teal',
];

/** The shipped class for a colour, or '' when the colour is beyond the palette (inline vars then). */
export function classForColor(color) {
  const i = PALETTE.indexOf(String(color).toLowerCase());
  return i === -1 ? '' : COLOR_CLASSES[i];
}
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** The neutral definition shown for a code that is no longer configured. Display only. */
export function retiredSubject(code) {
  return { code: String(code), name: String(code), color: '#c3c7d6', active: false };
}

/**
 * Validate a catalogue. Returns {subjects} or {error}; a catalogue is accepted or rejected whole,
 * never silently repaired, because a half-valid list would publish half the colours.
 */
export function validateSubjects(raw) {
  if (!Array.isArray(raw)) return { error: 'Subjects must be a list.' };
  if (raw.length > MAX_SUBJECTS) return { error: `Too many subjects (max ${MAX_SUBJECTS}).` };
  const out = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const n = i + 1;
    const s = raw[i];
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { error: `Subject ${n} is not an object.` };
    const code = s.code;
    if (typeof code !== 'string' || !CODE_RE.test(code)) {
      return { error: `Subject ${n} needs a code of 1-32 letters, digits, dot, dash or underscore, starting with a letter or digit.` };
    }
    if (RESERVED.has(code)) return { error: `Subject ${n} uses a reserved code.` };
    if (seen.has(code)) return { error: `The code ${code} is used twice.` };
    seen.add(code);
    if (typeof s.name !== 'string') return { error: `Subject ${n} needs a name.` };
    const name = s.name.trim();
    if (name === '' || name.length > MAX_NAME) return { error: `Subject ${n} needs a name of 1-${MAX_NAME} characters.` };
    if (CONTROL_RE.test(name)) return { error: `Subject ${n} has control characters in its name.` };
    if (typeof s.color !== 'string' || !COLOR_RE.test(s.color.toLowerCase())) return { error: `Subject ${n} needs a colour like #58affc.` };
    if (typeof s.active !== 'boolean') return { error: `Subject ${n} needs active to be true or false.` };
    out.push({ code, name, color: s.color.toLowerCase(), active: s.active });
  }
  return { subjects: out };
}

/** sRGB relative luminance, the WCAG definition. */
export function luminance(hex) {
  const v = String(hex).replace('#', '');
  const channel = (i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The readable ink for a solid six-digit colour: whichever of black or white contrasts more.
 * Derived, never stored, so a stored foreground can never drift from its background. For any
 * colour the better of the two is at least 4.58:1, so this always clears WCAG AA for body text.
 */
export function subjectTextColor(hex) {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';
}

/** The definition for a code in this catalogue, or null. Never invents one. */
export function subjectFor(catalog, code) {
  if (!Array.isArray(catalog) || typeof code !== 'string' || code === '') return null;
  return catalog.find((s) => s && s.code === code) || null;
}

/** Human-readable display name for a subject code, falling back to the code itself. */
export function subjectDisplayName(catalog, code) {
  if (typeof code !== 'string' || code === '') return '';
  const def = subjectFor(catalog, code);
  return def && typeof def.name === 'string' && def.name.trim() !== '' ? def.name : code;
}

/**
 * Normalize and validate a newly created subject before its code is locked.
 * Normalizes code to uppercase; if code is omitted, derives it from name.
 */
export function validateNewSubject(input, existing = []) {
  const rawCode = typeof input?.code === 'string' ? input.code.trim().toUpperCase() : '';
  const rawName = typeof input?.name === 'string' ? input.name.trim() : '';
  const code = rawCode || codeFromName(rawName);
  if (!code || !CODE_RE.test(code)) {
    return { error: 'Enter a code of 1-32 letters, digits, dot, dash or underscore, starting with a letter or digit.' };
  }
  if (RESERVED.has(code) || RESERVED.has(code.toLowerCase())) {
    return { error: `${code} is a reserved code.` };
  }
  const list = Array.isArray(existing) ? existing : [];
  if (list.some((s) => s && typeof s.code === 'string' && s.code.toUpperCase() === code)) {
    return { error: `The code ${code} is already used.` };
  }
  const name = rawName || code;
  if (name.length > MAX_NAME) {
    return { error: `A name of 1-${MAX_NAME} characters is required.` };
  }
  if (CONTROL_RE.test(name)) {
    return { error: 'Subject name cannot contain control characters.' };
  }
  const color = typeof input?.color === 'string' && COLOR_RE.test(input.color.trim().toLowerCase())
    ? input.color.trim().toLowerCase()
    : PALETTE[list.length % PALETTE.length];
  return { subject: { code, name, color, active: true } };
}
/**
 * Replace the catalogue's choices with a preset's, without touching a single task.
 * A code the preset leaves out but a task still uses is kept as a retired definition, so the task
 * keeps displaying correctly and the code cannot silently disappear from the board.
 */
export function applyPresetCatalog(current, preset, referencedCodes) {
  const next = [];
  const seen = new Set();
  for (const s of Array.isArray(preset) ? preset : []) {
    if (!s || typeof s.code !== 'string' || seen.has(s.code)) continue;
    next.push({ code: s.code, name: s.name, color: s.color, active: s.active !== false });
    seen.add(s.code);
  }
  for (const code of Array.isArray(referencedCodes) ? referencedCodes : []) {
    if (typeof code !== 'string' || code === '' || seen.has(code)) continue;
    const existing = subjectFor(current, code);
    const retired = existing
      ? { code: existing.code, name: existing.name, color: existing.color, active: false }
      : retiredSubject(code);
    next.push(retired);
    seen.add(code);
  }
  return next;
}

/** What a preset would change, for the confirmation preview. Counts only; it retags nothing. */
export function describePreset(current, preset, referencedCodes) {
  const next = applyPresetCatalog(current, preset, referencedCodes);
  const before = new Map((Array.isArray(current) ? current : []).map((s) => [s.code, s]));
  const added = [];
  const changed = [];
  const retired = [];
  for (const s of next) {
    const old = before.get(s.code);
    if (!old) { added.push(s.code); continue; }
    if (old.name !== s.name || old.color !== s.color) changed.push(s.code);
    if (old.active && !s.active) retired.push(s.code);
  }
  const removed = [...before.keys()].filter((code) => !next.some((s) => s.code === code));
  return { next, added, changed, retired, removed };
}

/** The choices a *new* assignment may pick: configured and still active. */
export function assignableSubjects(catalog) {
  return (Array.isArray(catalog) ? catalog : []).filter((s) => s && s.active !== false);
}

/** A stable signature for cache invalidation: a rename or recolour must repaint calendars. */
export function catalogSignature(catalog) {
  return (Array.isArray(catalog) ? catalog : [])
    .map((s) => `${s.code}:${s.name}:${s.color}:${s.active ? 1 : 0}`)
    .sort()
    .join('|');
}

/** An uppercase code from a name, for the "new subject" flow: stable once the admin accepts it. */
export function codeFromName(name) {
  const base = String(name).toUpperCase().replace(/[^A-Z0-9_.-]+/g, '').slice(0, 32);
  return /^[A-Z0-9]/.test(base) ? base : '';
}
