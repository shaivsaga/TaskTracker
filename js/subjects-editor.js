/**
 * js/subjects-editor.js - the admin subject catalogue and its named presets.
 *
 * The catalogue being edited is a *draft*: nothing reaches students until Publish, and a code is
 * immutable once created, so renaming or recolouring never re-tags a task. A retired subject stops
 * being offered for new assignments but keeps rendering on the tasks that already use it.
 *
 * Presets are server-owned private state. Applying one is a local draft change (never a task edit),
 * previewed first, and saved presets survive a reload and a server restart.
 */

import { state } from './state.js';
import { dom } from './dom.js';
import { PALETTE, validateSubjects, subjectTextColor, codeFromName, MAX_NAME, describePreset } from './subjects.js';

let deps = null;
const EMPTY = 'No subjects configured yet. Add one, or apply a preset.';
let rowError = new Map();   // code -> message, shown inline and never stored
let openPaletteCode = null; // one subject row's swatch strip open at a time

function setExpanded(open) {
  if (!dom.subjectBody || !dom.subjectToggle) return;
  const expanded = Boolean(open);
  dom.subjectBody.hidden = !expanded;
  if (dom.subjectAdd) dom.subjectAdd.hidden = !expanded;
  dom.subjectToggle.setAttribute('aria-expanded', String(expanded));
  syncToggleLabel();
}

function syncToggleLabel() {
  if (!dom.subjectToggle) return;
  const open = dom.subjectBody && !dom.subjectBody.hidden;
  const count = state.draftSubjects.length;
  dom.subjectToggle.textContent = open
    ? 'Hide subjects'
    : (count ? `Manage subjects (${count})` : 'Manage subjects');
}

export function init(d) {
  deps = d;
  if (dom.subjectToggle) {
    dom.subjectToggle.addEventListener('click', () => {
      setExpanded(dom.subjectBody ? dom.subjectBody.hidden : true);
    });
  }
  dom.subjectAdd.addEventListener('click', addSubject);
  dom.subjectList.addEventListener('click', onListClick);
  dom.subjectList.addEventListener('change', onListChange);
  dom.presetApply.addEventListener('click', applySelectedPreset);
  dom.presetDelete.addEventListener('click', deleteSelectedPreset);
  dom.presetSave.addEventListener('click', savePreset);
}

/* ---- draft handling -------------------------------------------------------------------------- */

function commit(next, message) {
  const { subjects, error } = validateSubjects(next);
  if (error) {
    dom.subjectStatus.textContent = error;
    return false;
  }
  state.draftSubjects = subjects;
  deps.syncCatalog(subjects);           // tag rendering, pickers and calendar cache
  if (!deps.saveTasks()) return false;  // never claim a saved catalogue when storage refused
  render();
  dom.subjectStatus.textContent = message || 'Catalogue updated in the draft. Publish to apply it.';
  return true;
}

function edit(code, change) {
  const next = state.draftSubjects.map((s) => (s.code === code ? { ...s, ...change } : s));
  return commit(next);
}

function addSubject() {
  setExpanded(true);
  const used = new Set(state.draftSubjects.map((s) => s.code));
  let n = state.draftSubjects.length + 1;
  let code = codeFromName(`SUBJECT ${n}`);
  while (used.has(code)) { n += 1; code = codeFromName(`SUBJECT ${n}`); }
  const next = state.draftSubjects.concat([{
    code, name: `Subject ${n}`, color: PALETTE[state.draftSubjects.length % PALETTE.length], active: true,
  }]);
  if (commit(next, `Added ${code}. Rename it; the code stays fixed.`)) focusRow(code);
}

function removeSubject(code) {
  const referenced = deps.referencedCodes().includes(code);
  if (referenced) {
    dom.subjectStatus.textContent = `${code} is used by a task, so it is retired instead of removed.`;
    edit(code, { active: false });
    return;
  }
  commit(state.draftSubjects.filter((s) => s.code !== code), `${code} removed from the draft.`);
}

function focusRow(code) {
  const input = dom.subjectList.querySelector(`input[data-code="${CSS.escape(code)}"][data-field="name"]`);
  if (input) { input.focus(); input.select(); }
}

function onListClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const code = btn.dataset.code;
  if (btn.dataset.act === 'retire') {
    const current = state.draftSubjects.find((s) => s.code === code);
    if (current) edit(code, { active: !current.active });
  } else if (btn.dataset.act === 'remove') {
    if (openPaletteCode === code) openPaletteCode = null;
    removeSubject(code);
  } else if (btn.dataset.act === 'palette') {
    openPaletteCode = openPaletteCode === code ? null : code;
    render();
    const toggle = dom.subjectList.querySelector(`button[data-act="palette"][data-code="${CSS.escape(code)}"]`);
    if (toggle) toggle.focus();
  } else if (btn.dataset.act === 'swatch') {
    openPaletteCode = null;
    edit(code, { color: btn.dataset.color });
    focusRow(code);
  }
}

function onListChange(e) {
  const input = e.target.closest('input[data-code]');
  if (!input) return;
  const code = input.dataset.code;
  const field = input.dataset.field;
  const raw = input.value;

  if (field === 'name') {
    const name = raw.trim();
    if (name === '' || name.length > MAX_NAME) {
      rowError.set(code, `A name of 1-${MAX_NAME} characters is required.`);
      render();
      return;
    }
    rowError.delete(code);
    edit(code, { name });
    return;
  }
  if (field === 'color') {
    const value = raw.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(value)) {
      rowError.set(code, 'Use a six-digit colour like #58affc.');
      render();
      return;
    }
    rowError.delete(code);
    edit(code, { color: value });
  }
}

/* ---- rendering ------------------------------------------------------------------------------- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function render() {
  if (!dom.subjectList) return;
  dom.subjectList.replaceChildren();
  if (!state.draftSubjects.length) {
    dom.subjectStatus.textContent = EMPTY;
  } else if (dom.subjectStatus.textContent === EMPTY) {
    dom.subjectStatus.textContent = '';   // a stale empty-state line must not outlive the data
  }
  const referenced = new Set(deps.referencedCodes());

  for (const s of state.draftSubjects) {
    const li = el('li', 'history-item');
    const head = el('div', 'history-head');
    head.appendChild(el('span', 'history-label', s.code));

    const chip = el('span', 'subject-tag');
    chip.style.setProperty('--tag', s.color);
    chip.style.setProperty('--tag-ink', subjectTextColor(s.color));
    chip.textContent = s.name;
    head.appendChild(chip);
    if (!s.active) head.appendChild(el('span', 'history-detail', 'retired'));

    const nameWrap = el('label', 'search');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = s.name;
    nameInput.maxLength = MAX_NAME;
    nameInput.dataset.code = s.code;
    nameInput.dataset.field = 'name';
    nameInput.setAttribute('aria-label', `Name for ${s.code}`);
    nameWrap.appendChild(nameInput);
    head.appendChild(nameWrap);

    const hexWrap = el('label', 'search');
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.value = s.color;
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;
    hexInput.dataset.code = s.code;
    hexInput.dataset.field = 'color';
    hexInput.setAttribute('aria-label', `Colour for ${s.code}`);
    hexWrap.appendChild(hexInput);
    head.appendChild(hexWrap);

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = s.color;
    picker.dataset.code = s.code;
    picker.dataset.field = 'color';
    picker.setAttribute('aria-label', `Pick a colour for ${s.code}`);
    head.appendChild(picker);

    const paletteOpen = openPaletteCode === s.code;
    const paletteId = `palette-${s.code}`;
    const paletteBtn = el('button', 'text-button', paletteOpen ? 'Hide palette' : 'Palette');
    paletteBtn.type = 'button';
    paletteBtn.dataset.act = 'palette';
    paletteBtn.dataset.code = s.code;
    paletteBtn.setAttribute('aria-label', `${paletteOpen ? 'Hide' : 'Show'} palette for ${s.code}`);
    paletteBtn.setAttribute('aria-expanded', String(paletteOpen));
    paletteBtn.setAttribute('aria-controls', paletteId);
    head.appendChild(paletteBtn);

    const swatches = el('div', 'history-bar');
    swatches.id = paletteId;
    swatches.hidden = !paletteOpen;
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-label', `Palette for ${s.code}`);
    for (const color of PALETTE) {
      const b = el('button', 'text-button', '');
      b.type = 'button';
      b.style.width = '24px';
      b.style.height = '24px';
      b.style.background = color;
      b.style.border = '2px solid var(--mu)';
      b.dataset.act = 'swatch';
      b.dataset.code = s.code;
      b.dataset.color = color;
      b.setAttribute('aria-label', `Use ${color} for ${s.code}`);
      b.setAttribute('aria-pressed', String(color === s.color));
      swatches.appendChild(b);
    }
    head.appendChild(swatches);
    const actions = el('div', 'history-bar');
    const retire = el('button', 'text-button', s.active ? 'Retire' : 'Restore to choices');
    retire.type = 'button';
    retire.dataset.act = 'retire';
    retire.dataset.code = s.code;
    retire.setAttribute('aria-label', `${s.active ? 'Retire' : 'Restore'} ${s.code}`);
    actions.appendChild(retire);
    if (!referenced.has(s.code)) {
      const remove = el('button', 'text-button', 'Remove');
      remove.type = 'button';
      remove.dataset.act = 'remove';
      remove.dataset.code = s.code;
      remove.setAttribute('aria-label', `Remove ${s.code}`);
      actions.appendChild(remove);
    }
    head.appendChild(actions);

    li.appendChild(head);
    const err = rowError.get(s.code);
    if (err) {
      const p = el('p', 'history-detail', err);
      p.setAttribute('role', 'alert');
      li.appendChild(p);
    }
    dom.subjectList.appendChild(li);
  }
  syncToggleLabel();
  renderPresets();
}

function renderPresets() {
  if (!dom.presetSelect) return;
  const presets = Array.isArray(state.presets) ? state.presets : [];
  const keep = dom.presetSelect.value;
  dom.presetSelect.replaceChildren();
  if (!presets.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No saved presets';
    dom.presetSelect.appendChild(opt);
  }
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    dom.presetSelect.appendChild(opt);
  }
  if (keep && presets.some((p) => p.id === keep)) dom.presetSelect.value = keep;
  dom.presetApply.disabled = !presets.length;
  dom.presetDelete.disabled = !presets.length;
}

/* ---- presets --------------------------------------------------------------------------------- */

export async function loadPresets() {
  if (!state.isAdmin) return;
  try {
    const res = await fetch(`${deps.apiVersions}?view=admin`, { cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error('unavailable');
    if (typeof data.adminRevision === 'number') state.adminRevision = data.adminRevision;
    state.presets = Array.isArray(data.presets) ? data.presets : [];
    render();
  } catch (e) {
    dom.subjectStatus.textContent = 'Saved presets cannot be loaded right now.';
  }
}

async function savePreset() {
  const name = (dom.presetName.value || '').trim();
  if (!name) { dom.subjectStatus.textContent = 'Give the preset a name first.'; dom.presetName.focus(); return; }
  const out = await deps.adminAction('preset-save', { preset: { name, subjects: state.draftSubjects } });
  if (!out.ok) { dom.subjectStatus.textContent = out.status === 422 ? 'That name is already used by another preset.' : 'Could not save the preset.'; return; }
  dom.presetName.value = '';
  await loadPresets();
  dom.subjectStatus.textContent = `Preset “${name}” saved.`;
}

async function deleteSelectedPreset() {
  const id = dom.presetSelect.value;
  if (!id) return;
  const out = await deps.adminAction('preset-delete', { presetId: id });
  if (!out.ok) { dom.subjectStatus.textContent = 'Could not delete the preset.'; return; }
  await loadPresets();
  dom.subjectStatus.textContent = 'Preset deleted.';
}

// Applying is local: preview first, then replace the draft's choices. Tasks are never re-tagged.
async function applySelectedPreset() {
  const id = dom.presetSelect.value;
  const preset = (state.presets || []).find((p) => p.id === id);
  if (!preset) return;
  const plan = describePreset(state.draftSubjects, preset.subjects, deps.referencedCodes());
  const summary = [
    plan.added.length ? `${plan.added.length} added` : null,
    plan.changed.length ? `${plan.changed.length} changed` : null,
    plan.retired.length ? `${plan.retired.length} retired` : null,
    plan.removed.length ? `${plan.removed.length} removed` : null,
  ].filter(Boolean).join(', ') || 'no change';
  const go = deps.confirm(`Apply “${preset.name}” to the draft? ${summary}. Tasks keep their subjects.`);
  if (!go) return;
  commit(plan.next, `Applied “${preset.name}” (${summary}). Publish to apply it.`);
}
