// js/quick-add.js - the quick-add overlay and its pickers (app.js split, slice 2.3).
//
// Moved verbatim out of app.js: isDateWord, openQuickPicker, clearQuickDue, quickText, quickField,
// renderQuickPreview, renderQuickChips, syncQuickChips, applyQuickToken, openQuickAdd, closeQuickAdd,
// submitQuickAdd and the region's listeners. openQuickAdd stays exported because app.js's
// startNewTask() and the N shortcut still open the overlay.
//
// D6: this module never imports logic.js and never reads a bare global. The natural-language parser
// (parseQuickAdd) and the tokenizer it shares with the chip handlers (quickWords) stay in app.js and
// arrive through init(deps): logic.js has no quick-add parser at this tip, only the material the
// parser is built from (lookup, parseTimeWord, WEEKDAYS) plus Task, dayDiff, toInputValue and
// STATUS_LABELS - all passed in the same call. `subjects` and `statusCodes` are thunks: the module
// reads the maps while it renders, never while init() runs (docs/p6-architecture-findings.md 4, D6).
//
// quickPicked/quickPrev/quickChipEls/quickReturnFocus stay in js/state.js (slice 2.1) and are read
// and written through `state` here.
//
// Importing this module touches nothing: no DOM read, no listener, no state read and no timer at
// evaluation time, so
//   node --input-type=module -e "await import('./js/quick-add.js')"
// is clean under plain Node.

import { state } from './state.js';
import { dom } from './dom.js';
import { formatTime } from './util.js';
import { openOverlay } from './motion.js';

let quickWords = null;        // app.js's tokenizer (the parser that stays there uses it)
let parseQuickAdd = null;     // the natural-language parser, kept in app.js and passed in
let lookup = null;            // logic.js
let parseTimeWord = null;     // logic.js
let WEEKDAYS = null;          // logic.js
let dayDiff = null;           // logic.js
let toInputValue = null;      // logic.js
let STATUS_LABELS = null;     // logic.js
let Task = null;              // logic.js
let subjects = null;          // the SUBJECTS map, read at call time (never captured)
let statusCodes = null;       // the STATUS_CODES map, read at call time
let createSubjectTag = null;  // app.js (Subject chip and preview tag)
let openDuePicker = null;     // app.js, the picker shared with the task dialog
let closeDuePicker = null;    // app.js, the picker shared with the task dialog
let hideAnimated = null;      // app.js
let myTasks = null;           // app.js's draft list: one stable array, only ever mutated in place
let setStatus = null;         // app.js
let saveTasks = null;         // app.js
let setPage = null;           // app.js
let renderAllTasks = null;    // app.js
let openTaskDialog = null;    // app.js
let showToast = null;         // app.js

function isDateWord(w) {
  const l = w.toLowerCase();
  return /^(\d{1,2})[\/-](\d{1,2})$/.test(w) || ['today', 'tmr', 'tomorrow'].includes(l) || lookup(WEEKDAYS, l) !== undefined;
}

function openQuickPicker(kind) {
  const p = parseQuickAdd(dom.quickInput.value);
  const chip = state.quickChipEls.find((c) => c.dataset.type === (kind === 'time' ? 'time' : 'pick'));
  openDuePicker({
    anchor: chip || dom.quickInput,
    focus: kind,
    date: p.dueDate || null,
    endDate: p.endDate || null,
    time: p.dueTime || null,
    onChange: ({ date, endDate, time }) => {
      if (!date) { clearQuickDue(false); return; }
      state.quickPicked = { date, endDate: endDate || null, time };
      renderQuickPreview();
    },
    onDone: () => dom.quickInput.focus(),
  });
}

function clearQuickDue(refocus = true) {
  state.quickPicked = { date: null, endDate: null, time: null };
  const kept = quickWords(dom.quickInput.value).filter((w) => !isDateWord(w) && !parseTimeWord(w));
  dom.quickInput.value = kept.length ? kept.join(' ') + ' ' : '';
  closeDuePicker();
  if (refocus) dom.quickInput.focus();
  renderQuickPreview();
}

function quickText(text, cls) {
  const s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = text;
  return s;
}

function quickField(label, content, changed) {
  const row = document.createElement('div');
  row.className = 'quick-field';
  const value = quickText('', 'quick-field-value');
  if (content) value.appendChild(content);
  else { value.textContent = '—'; value.classList.add('is-empty'); }
  if (changed) value.classList.add('is-changed');
  row.append(quickText(label, 'quick-field-label'), value);
  return row;
}

function renderQuickPreview() {
  dom.quickPreview.replaceChildren();
  const p = (dom.quickInput.value.trim() || state.quickPicked.date) ? parseQuickAdd(dom.quickInput.value) : null;
  const next = {
    subject: p ? p.subject : '',
    status: p && p.typedStatus ? p.status : '',
    due: p && p.dueDate ? toInputValue(p.dueDate) + (p.endDate ? '→' + toInputValue(p.endDate) : '') + (p.dueTime || '') : '',
  };
  const changed = (k) => next[k] !== '' && next[k] !== state.quickPrev[k];
  let dueNode = null;
  if (p && p.dueDate) {
    dueNode = document.createElement('span');
    dueNode.className = 'quick-due';
    const startStr = p.dueDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const endStr = p.endDate ? p.endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    dueNode.appendChild(quickText(
      endStr ? `${startStr} → ${endStr}` : startStr,
      'quick-chip is-mono'
    ));
    if (p.dueTime) dueNode.appendChild(quickText(formatTime(p.dueTime), 'quick-chip is-mono'));
  }
  dom.quickPreview.append(
    quickField('Task', p && quickText(p.title, 'quick-title')),
    quickField('Subject', p && p.subject ? createSubjectTag(p.subject) : null, changed('subject')),
    quickField('Status', p ? quickText(STATUS_LABELS[p.status], 'quick-chip') : null, changed('status')),
    quickField('Due', dueNode, changed('due'))
  );
  state.quickPrev = next;
  syncQuickChips(p);
  const hasText = !!dom.quickInput.value.trim();
  document.querySelector('#quick-add-btn').disabled = !hasText;
  document.querySelector('#quick-open-btn').disabled = !hasText;
}

function renderQuickChips() {
  const host = document.querySelector('#quick-chips');
  host.replaceChildren();
  state.quickChipEls = [];
  const groups = [
    ['Subject', Object.keys(subjects()).map((code) => ({ type: 'subject', code }))],
    ['Status', [['ns', 'Not started', 'ns'], ['ip', 'In progress', 'ip'], ['dn', 'Done', 'dn']].map(([code, label, shown]) => ({ type: 'status', code, label, shown }))],
    ['Due', [
      { type: 'date', code: 'today', label: 'Today', shown: 'today' },
      { type: 'date', code: 'tmr', label: 'Tomorrow', shown: 'tmr' },
      { type: 'pick', code: 'pick', label: 'Date & time', shown: 'cal' },
      { type: 'clear', code: 'clear', label: 'Clear' },
    ]],
  ];
  groups.forEach(([name, items]) => {
    const group = document.createElement('div');
    group.className = 'quick-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', name);
    group.appendChild(quickText(name, 'quick-group-label'));
    items.forEach(({ type, code, label, shown }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quick-chip-btn';
      btn.dataset.type = type;
      btn.dataset.code = code;
      btn.title = type === 'subject' ? code : shown ? `Shortcut: ${shown}` : label;
      btn.setAttribute('aria-pressed', 'false');
      if (type === 'subject') {
        btn.classList.add('is-subject');
        btn.appendChild(createSubjectTag(code));
      } else {
        btn.appendChild(quickText(label));
        if (shown) btn.appendChild(quickText(shown, 'quick-code'));
      }
      btn.addEventListener('click', () => applyQuickToken(type, code));
      group.appendChild(btn);
      state.quickChipEls.push(btn);
    });
    host.appendChild(group);
  });
}

function syncQuickChips(p) {
  state.quickChipEls.forEach((el) => {
    const { type, code } = el.dataset;
    let on = false;
    if (p) {
      if (type === 'subject') on = p.subject === code;
      else if (type === 'status') on = p.typedStatus && p.status === statusCodes()[code];
      else if (type === 'date') on = !!p.dueDate && !state.quickPicked.date && dayDiff(p.dueDate) === (code === 'today' ? 0 : 1);
      else if (type === 'pick') on = !!state.quickPicked.date;
      else if (type === 'time') on = !!p.dueTime;
    }
    if (type === 'clear') el.hidden = !(p && p.dueDate);
    el.classList.toggle('is-selected', on);
    el.setAttribute('aria-pressed', String(on));
  });
}

// Clicking a chip swaps that token in the input; clicking it again removes it.
function applyQuickToken(type, code) {
  if (type === 'pick') { openQuickPicker('date'); return; }
  if (type === 'time') { openQuickPicker('time'); return; }
  if (type === 'clear') { clearQuickDue(); return; }
  const isToken = {
    subject: (w) => !!lookup(subjects(), w.toUpperCase()),
    status: (w) => !!lookup(statusCodes(), w.toLowerCase()),
    date: isDateWord,
  }[type];
  const wasOn = state.quickChipEls.some((c) => c.dataset.type === type && c.dataset.code === code && c.classList.contains('is-selected'));
  if (type === 'date') state.quickPicked.date = null;
  const kept = quickWords(dom.quickInput.value).filter((w) => !isToken(w));
  if (!wasOn) { if (type === 'subject') kept.unshift(code); else kept.push(code); }
  dom.quickInput.value = kept.length ? kept.join(' ') + ' ' : '';
  dom.quickInput.focus();
  renderQuickPreview();
}

export function openQuickAdd() {
  if (!dom.dialogOverlay.hidden && !dom.dialogOverlay.classList.contains('is-closing')) return;
  state.quickReturnFocus = document.activeElement;
  dom.quickInput.value = '';
  state.quickPicked = { date: null, time: null };
  closeDuePicker();
  state.quickPrev = { subject: '', status: '', due: '' };
  renderQuickChips();
  renderQuickPreview();
  openOverlay(dom.quickOverlay);
  dom.quickInput.focus();
}

function closeQuickAdd() {
  closeDuePicker();
  hideAnimated(dom.quickOverlay, 120);
  if (state.quickReturnFocus && state.quickReturnFocus.focus) state.quickReturnFocus.focus();
}

function submitQuickAdd(openDetails) {
  if (!dom.quickInput.value.trim()) return;
  const p = parseQuickAdd(dom.quickInput.value);
  const task = new Task({ title: p.title, subject: p.subject, dueDate: p.dueDate, endDate: p.endDate, dueTime: p.dueTime });
  myTasks.push(task);
  if (p.status !== 'not_started') setStatus(task, p.status);
  else saveTasks();
  state.justChangedId = task.id;   // a new task arrives (is-entering); nothing else enters
  closeDuePicker();
  hideAnimated(dom.quickOverlay, 120);
  if (state.searchQuery) { state.searchQuery = ''; document.querySelector('#task-search').value = ''; }
  setPage('my-tasks');
  renderAllTasks();
  if (openDetails) openTaskDialog(task, null, false);
  else showToast('Task added');
}

// Called once by app.js, at the spot the moved listeners used to occupy. Every dep is read at call
// time: the two maps are thunks, so they are not captured while this runs.
export function init(deps) {
  quickWords = deps.quickWords;
  parseQuickAdd = deps.parseQuickAdd;
  lookup = deps.lookup;
  parseTimeWord = deps.parseTimeWord;
  WEEKDAYS = deps.WEEKDAYS;
  dayDiff = deps.dayDiff;
  toInputValue = deps.toInputValue;
  STATUS_LABELS = deps.STATUS_LABELS;
  Task = deps.Task;
  subjects = deps.subjects;
  statusCodes = deps.statusCodes;
  createSubjectTag = deps.createSubjectTag;
  openDuePicker = deps.openDuePicker;
  closeDuePicker = deps.closeDuePicker;
  hideAnimated = deps.hideAnimated;
  myTasks = deps.myTasks;
  setStatus = deps.setStatus;
  saveTasks = deps.saveTasks;
  setPage = deps.setPage;
  renderAllTasks = deps.renderAllTasks;
  openTaskDialog = deps.openTaskDialog;
  showToast = deps.showToast;
document.querySelector('#quick-add-btn').addEventListener('click', () => submitQuickAdd(false));
document.querySelector('#quick-open-btn').addEventListener('click', () => submitQuickAdd(true));
document.querySelector('#quick-cancel-btn').addEventListener('click', closeQuickAdd);
dom.quickInput.addEventListener('input', () => {
  const m = /(^|\s)(cal|date)\s$/i.exec(dom.quickInput.value);
  if (m) {
    dom.quickInput.value = dom.quickInput.value.slice(0, m.index + m[1].length);
    renderQuickPreview();
    openQuickPicker('date');
    return;
  }
  renderQuickPreview();
});
dom.quickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(e.shiftKey); }
  if (e.key === 'Escape') { e.preventDefault(); closeQuickAdd(); }
});
dom.quickOverlay.addEventListener('click', (e) => { if (e.target === dom.quickOverlay) closeQuickAdd(); });
}
