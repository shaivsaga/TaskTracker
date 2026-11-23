import { state } from './state.js';
import { dom } from './dom.js';
import { formatTime } from './util.js';
import { openOverlay, hideOverlay } from './motion.js';

let lookup = null;
let parseTimeWord = null;
let WEEKDAYS = null;
let dayDiff = null;
let toInputValue = null;
let STATUS_LABELS = null;
let Task = null;
let subjects = null;
let createSubjectTag = null;
let openDuePicker = null;
let closeDuePicker = null;
let myTasks = null;
let setStatus = null;
let saveTasks = null;
let setPage = null;
let renderAllTasks = null;
let openTaskDialog = null;
let showToast = null;

let quickReturnFocus = null;
let quickPicked = { date: null, endDate: null, time: null };
let quickPrev = { subject: '', due: '' };
let quickKeepLiteral = false;
let quickChipEls = [];
let quickAnnounceTimer = null;

const AMBIGUOUS_WEEKDAYS = new Set(['sat', 'sun']);

function tokenizeQuick(text) {
  const s = String(text || '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1);
      if (end !== -1) {
        const inner = s.slice(i + 1, end).trim();
        if (inner) out.push({ text: inner, quoted: true, raw: s.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
    }
    let j = i;
    while (j < s.length && !/\s/.test(s[j]) && s[j] !== '"') j++;
    out.push({ text: s.slice(i, j), quoted: false, raw: s.slice(i, j) });
    i = j;
  }
  return out;
}

export function quickWords(text) {
  return tokenizeQuick(text).map((t) => t.text);
}

function parseEdgeDateWord(word, now, lookupFn, weekdaysMap) {
  const lower = word.toLowerCase();
  if (AMBIGUOUS_WEEKDAYS.has(lower)) return undefined;
  const md = /^(\d{1,2})[\/-](\d{1,2})$/.exec(word);
  if (md) {
    const d = new Date(now.getFullYear(), +md[1] - 1, +md[2]);
    return d.getMonth() === +md[1] - 1 ? d : undefined;
  }
  if (lower === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (lower === 'tmr' || lower === 'tomorrow') return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const weekday = lookupFn(weekdaysMap, lower);
  if (weekday !== undefined) {
    const ahead = ((weekday - now.getDay() + 7) % 7) || 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
  }
  return undefined;
}

export function parseQuickAdd(text, opts = {}) {
  const subjectMap = opts.subjects ?? (subjects ? subjects() : {});
  const picked = opts.picked ?? quickPicked;
  const now = opts.now ?? new Date();
  const timeFn = opts.parseTimeWord ?? parseTimeWord;
  const lookupFn = opts.lookup ?? lookup;
  const weekdaysMap = opts.weekdays ?? WEEKDAYS;
  const keepLiteral = opts.keepLiteral ?? false;
  const out = { subject: '', status: 'not_started', typedStatus: false, dueDate: undefined, endDate: undefined, dueTime: undefined, parsedKeyword: false, title: '' };
  const tokens = tokenizeQuick(text);
  if (!keepLiteral && tokens.length) {
    const head = tokens[0];
    if (!head.quoted) {
      const code = head.text.replace(/,$/, '').toUpperCase();
      if (code && lookupFn(subjectMap, code) !== undefined) {
        out.subject = code;
        tokens.shift();
      }
    }
    let heldTime = null;
    for (let step = 0; step < 2 && tokens.length > 0; step++) {
      const tail = tokens[tokens.length - 1];
      if (tail.quoted) break;
      if (!out.dueTime && !heldTime) {
        const t = timeFn(tail.text);
        if (t) { heldTime = { tok: tail, value: t }; tokens.pop(); continue; }
      }
      if (!out.dueDate) {
        const d = parseEdgeDateWord(tail.text, now, lookupFn, weekdaysMap);
        if (d) { out.dueDate = d; tokens.pop(); continue; }
      }
      break;
    }
    if (heldTime) {
      if (out.dueDate) out.dueTime = heldTime.value;
      else tokens.push(heldTime.tok);
    }
    if (tokens.length > 0 && !out.dueTime && out.dueDate) {
      const tail = tokens[tokens.length - 1];
      if (!tail.quoted) {
        const t = timeFn(tail.text);
        if (t) { out.dueTime = t; tokens.pop(); }
      }
    }
    out.parsedKeyword = Boolean(out.subject || out.dueDate);
  }
  if (picked && picked.date) { out.dueDate = picked.date; out.endDate = picked.endDate || undefined; out.dueTime = picked.time || undefined; }
  if (!out.dueDate) { out.endDate = undefined; out.dueTime = undefined; }
  out.title = (tokens.map((t) => t.text).join(' ') || (out.subject ? `${out.subject} task` : 'New Task')).slice(0, 500);
  return out;
}

let quickSubjectOpen = false;
let quickSubjectSig = '';

const subjectItems = (p) => {
  const guess = p && p.subject ? p.subject : '';
  if (!quickSubjectOpen) return guess ? [{ type: 'subject', code: guess }, { type: 'change' }] : [{ type: 'change' }];
  return Object.keys(subjects()).map((code) => ({ type: 'subject', code }));
};

function isDateWord(w) {
  return parseEdgeDateWord(w, new Date(), lookup, WEEKDAYS) !== undefined;
}

function openQuickPicker(kind) {
  const p = parseQuickAdd(dom.quickInput.value, { keepLiteral: quickKeepLiteral });
  const chip = quickChipEls.find((c) => c.dataset.type === (kind === 'time' ? 'time' : 'pick'));
  openDuePicker({
    anchor: chip || dom.quickInput,
    focus: kind,
    date: p.dueDate || null,
    endDate: p.endDate || null,
    time: p.dueTime || null,
    onChange: ({ date, endDate, time }) => {
      if (!date) { clearQuickDue(false); return; }
      quickPicked = { date, endDate: endDate || null, time };
      renderQuickPreview();
    },
    onDone: () => dom.quickInput.focus(),
  });
}

function clearQuickDue(refocus = true) {
  quickPicked = { date: null, endDate: null, time: null };
  const tokens = tokenizeQuick(dom.quickInput.value);
  while (tokens.length > 0 && !tokens[tokens.length - 1].quoted && (isDateWord(tokens[tokens.length - 1].text) || parseTimeWord(tokens[tokens.length - 1].text))) {
    tokens.pop();
  }
  dom.quickInput.value = tokens.length ? tokens.map((t) => t.raw).join(' ') + ' ' : '';
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
  const p = (dom.quickInput.value.trim() || quickPicked.date)
    ? parseQuickAdd(dom.quickInput.value, { keepLiteral: quickKeepLiteral })
    : null;
  dom.quickPreview.hidden = !p;
  clearTimeout(quickAnnounceTimer);
  if (!p) {
    quickPrev = { subject: '', due: '' };
    syncQuickChips(null);
    document.querySelector('#quick-add-btn').disabled = true;
    document.querySelector('#quick-open-btn').disabled = true;
    return;
  }
  const next = {
    subject: p ? p.subject : '',
    due: p && p.dueDate ? toInputValue(p.dueDate) + (p.endDate ? '→' + toInputValue(p.endDate) : '') + (p.dueTime || '') : '',
  };
  const changed = (k) => next[k] !== '' && next[k] !== quickPrev[k];
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
    quickField('Due', dueNode, changed('due'))
  );
  if (p.parsedKeyword || quickKeepLiteral) {
    const keepBtn = document.createElement('button');
    keepBtn.type = 'button';
    keepBtn.className = 'text-button quick-keep-btn';
    keepBtn.id = 'quick-keep-literal';
    keepBtn.textContent = quickKeepLiteral ? 'Parse keywords' : 'Keep in title';
    keepBtn.addEventListener('click', () => {
      quickKeepLiteral = !quickKeepLiteral;
      renderQuickPreview();
      dom.quickInput.focus();
    });
    dom.quickPreview.appendChild(keepBtn);
  }
  quickPrev = next;
  syncQuickChips(p);
  const parts = [`Task ${p.title}`];
  if (p.subject) parts.push(`Subject ${p.subject}`);
  if (p.dueDate) {
    const startStr = p.dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    parts.push(`Due ${startStr}${p.dueTime ? ' ' + formatTime(p.dueTime) : ''}`);
  }
  const summary = parts.join(', ');
  quickAnnounceTimer = setTimeout(() => {
    if (!dom.quickOverlay.hidden && dom.actionFeedback) dom.actionFeedback.textContent = summary;
  }, 350);
  const hasText = !!dom.quickInput.value.trim();
  document.querySelector('#quick-add-btn').disabled = !hasText;
  document.querySelector('#quick-open-btn').disabled = !hasText;
}

function renderQuickChips(p) {
  const host = document.querySelector('#quick-chips');
  host.replaceChildren();
  quickChipEls = [];
  quickSubjectSig = `${(p && p.subject) || ''}|${quickSubjectOpen}`;
  const groups = [
    ['Subject', 'subject', subjectItems(p)],

    ['Due', 'due', [
      { type: 'date', code: 'today', label: 'Today', shown: 'today' },
      { type: 'date', code: 'tmr', label: 'Tomorrow', shown: 'tmr' },
      { type: 'pick', code: 'pick', label: 'Date & time', shown: 'cal' },
      { type: 'clear', code: 'clear', label: 'Clear' },
    ]],
  ];
  groups.forEach(([name, key, items]) => {
    const group = document.createElement('div');
    group.className = 'quick-group';
    group.dataset.group = key;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', name);
    group.appendChild(quickText(name, 'quick-group-label'));
    items.forEach(({ type, code, label, shown }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quick-chip-btn';
      btn.dataset.type = type;
      if (code) btn.dataset.code = code;
      btn.title = type === 'subject' ? code : shown ? `Shortcut: ${shown}` : label;
      btn.setAttribute('aria-pressed', 'false');
      if (type === 'change') {
        const guessed = !!(p && p.subject);
        btn.textContent = guessed ? 'Change subject' : 'Add subject';
        btn.title = 'Show every subject';
        btn.addEventListener('click', () => { quickSubjectOpen = true; renderQuickPreview(); });
      } else if (type === 'subject') {
        btn.classList.add('is-subject');
        btn.appendChild(createSubjectTag(code));
        btn.addEventListener('click', () => applyQuickToken(type, code));
      } else {
        btn.appendChild(quickText(label));
        if (shown) btn.appendChild(quickText(shown, 'quick-code'));
        btn.addEventListener('click', () => applyQuickToken(type, code));
      }
      if (type === 'change') btn.classList.add('is-change');
      group.appendChild(btn);
      quickChipEls.push(btn);
    });
    host.appendChild(group);
  });
}

function syncQuickChips(p) {

  const subjectGroup = document.querySelector('#quick-chips .quick-group[data-group="subject"]');
  const hadFocus = !!subjectGroup && subjectGroup.contains(document.activeElement);
  if (`${(p && p.subject) || ''}|${quickSubjectOpen}` !== quickSubjectSig) {
    renderQuickChips(p);
    if (hadFocus) {
      const next = quickSubjectOpen
        ? document.querySelector('#quick-chips .quick-group[data-group="subject"] .quick-chip-btn')
        : dom.quickInput;
      if (next) next.focus();
    }
  }
  quickChipEls.forEach((el) => {
    const { type, code } = el.dataset;
    let on = false;
    if (p) {
      if (type === 'subject') on = p.subject === code;
      else if (type === 'date') on = !!p.dueDate && !quickPicked.date && dayDiff(p.dueDate) === (code === 'today' ? 0 : 1);
      else if (type === 'pick') on = !!quickPicked.date;
      else if (type === 'time') on = !!p.dueTime;
    }
    if (type === 'clear') el.hidden = !(p && p.dueDate);
    el.classList.toggle('is-selected', on);
    el.setAttribute('aria-pressed', String(on));
  });
}

function applyQuickToken(type, code) {
  if (type === 'pick') { openQuickPicker('date'); return; }
  if (type === 'time') { openQuickPicker('time'); return; }
  if (type === 'clear') { clearQuickDue(); return; }
  quickKeepLiteral = false;
  const tokens = tokenizeQuick(dom.quickInput.value);
  const wasOn = quickChipEls.some((c) => c.dataset.type === type && c.dataset.code === code && c.classList.contains('is-selected'));
  if (type === 'subject') {
    if (tokens.length > 0 && !tokens[0].quoted && lookup(subjects(), tokens[0].text.replace(/,$/, '').toUpperCase()) !== undefined) {
      tokens.shift();
    }
    if (!wasOn) tokens.unshift({ text: code, quoted: false, raw: code });
  } else if (type === 'date') {
    quickPicked.date = null;
    while (tokens.length > 0 && !tokens[tokens.length - 1].quoted && (isDateWord(tokens[tokens.length - 1].text) || parseTimeWord(tokens[tokens.length - 1].text))) {
      tokens.pop();
    }
    if (!wasOn) tokens.push({ text: code, quoted: false, raw: code });
  }
  dom.quickInput.value = tokens.length ? tokens.map((t) => t.raw).join(' ') + ' ' : '';
  dom.quickInput.focus();
  renderQuickPreview();
}

export function openQuickAdd() {
  if (!dom.dialogOverlay.hidden && !dom.dialogOverlay.classList.contains('is-closing')) return;
  quickReturnFocus = document.activeElement;
  clearTimeout(quickAnnounceTimer);
  dom.quickInput.value = '';
  quickPicked = { date: null, endDate: null, time: null };
  quickKeepLiteral = false;
  closeDuePicker();
  quickPrev = { subject: '', due: '' };
  quickSubjectOpen = false;
  renderQuickChips();
  renderQuickPreview();
  openOverlay(dom.quickOverlay);
  dom.quickInput.focus();
}

function closeQuickAdd() {
  clearTimeout(quickAnnounceTimer);
  closeDuePicker();
  hideOverlay(dom.quickOverlay, 120);
  if (quickReturnFocus && quickReturnFocus.focus) quickReturnFocus.focus();
}

function submitQuickAdd(openDetails) {
  if (!dom.quickInput.value.trim()) return;
  clearTimeout(quickAnnounceTimer);
  const p = parseQuickAdd(dom.quickInput.value, { keepLiteral: quickKeepLiteral });
  const task = new Task({ title: p.title, subject: p.subject, dueDate: p.dueDate, endDate: p.endDate, dueTime: p.dueTime });
  myTasks.push(task);
  if (p.status !== 'not_started') setStatus(task, p.status);
  else saveTasks();
  state.justChangedId = task.id;
  closeDuePicker();
  hideOverlay(dom.quickOverlay, 120);
  if (state.searchQuery) { state.searchQuery = ''; document.querySelector('#task-search').value = ''; }
  if (state.adminSubjectFilter && p.subject !== state.adminSubjectFilter) {
    state.adminSubjectFilter = '';
    const sel = document.querySelector('#admin-subject-filter');
    if (sel) sel.value = '';
  }
  setPage('my-tasks');
  renderAllTasks();
  if (openDetails) openTaskDialog(task, null, false);
  else showToast('Task added');
}

export function init(deps) {
  lookup = deps.lookup;
  parseTimeWord = deps.parseTimeWord;
  WEEKDAYS = deps.WEEKDAYS;
  dayDiff = deps.dayDiff;
  toInputValue = deps.toInputValue;
  STATUS_LABELS = deps.STATUS_LABELS;
  Task = deps.Task;
  subjects = deps.subjects;
  createSubjectTag = deps.createSubjectTag;
  openDuePicker = deps.openDuePicker;
  closeDuePicker = deps.closeDuePicker;
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
  if (!dom.quickInput.value.trim()) quickKeepLiteral = false;
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
