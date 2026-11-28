import { state } from './state.js';
import { dom } from './dom.js';
import { assignableSubjects, subjectFor, subjectDisplayName } from './subjects.js';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const EMPTY_SCHEDULE = { term: '', sectionLabel: '', room: '', slots: [] };

let deps = null;
let activeDay = 1;
let editingKey = null;

function setExpanded(open) {
  if (!dom.scheduleBody || !dom.scheduleToggle) return;
  const expanded = Boolean(open);
  dom.scheduleBody.hidden = !expanded;
  dom.scheduleToggle.setAttribute('aria-expanded', String(expanded));
  dom.scheduleToggle.textContent = expanded ? 'Hide schedule' : 'Show schedule';
}

function currentDraft() {
  if (state.draftSchedule && typeof state.draftSchedule === 'object' && !Array.isArray(state.draftSchedule)) {
    return {
      term: typeof state.draftSchedule.term === 'string' ? state.draftSchedule.term : '',
      sectionLabel: typeof state.draftSchedule.sectionLabel === 'string' ? state.draftSchedule.sectionLabel : '',
      room: typeof state.draftSchedule.room === 'string' ? state.draftSchedule.room : '',
      slots: Array.isArray(state.draftSchedule.slots) ? state.draftSchedule.slots.map((s) => ({ ...s })) : [],
    };
  }
  return { ...EMPTY_SCHEDULE, slots: [] };
}

function knownSubjectCodes() {
  return state.draftSubjects.map((s) => s && s.code).filter(Boolean);
}

function commitSchedule(candidate, message) {
  const { schedule, error } = deps.validateSchedule(candidate, knownSubjectCodes());
  if (error) {
    if (dom.scheduleStatus) dom.scheduleStatus.textContent = error;
    return false;
  }
  state.draftSchedule = schedule;
  state.hasDraftSchedule = true;
  if (deps.saveTasks && !deps.saveTasks()) return false;
  render();
  deps.renderScheduleView?.();
  deps.updateAdminBar?.(deps.diffDraft());
  if (dom.scheduleStatus) {
    dom.scheduleStatus.textContent = message || 'Schedule updated in draft. Publish to make it live.';
  }
  return true;
}

function readMetaFromInputs(base) {
  return {
    ...base,
    term: dom.scheduleTerm ? dom.scheduleTerm.value : base.term,
    sectionLabel: dom.scheduleSection ? dom.scheduleSection.value : base.sectionLabel,
    room: dom.scheduleRoom ? dom.scheduleRoom.value : base.room,
  };
}

function syncKindFields() {
  const kindEl = document.querySelector('#schedule-slot-kind');
  const subjWrap = document.querySelector('#schedule-slot-subject-wrap');
  const lblWrap = document.querySelector('#schedule-slot-label-wrap');
  if (!kindEl || !subjWrap || !lblWrap) return;
  const isSubject = kindEl.value === 'subject';
  subjWrap.hidden = !isSubject;
  lblWrap.hidden = isSubject;
}

function populateSubjectSelect(selectedCode = '') {
  const select = document.querySelector('#schedule-slot-subject');
  if (!select) return;
  const prev = selectedCode || select.value;
  const list = assignableSubjects(state.draftSubjects);
  select.replaceChildren();

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = list.length ? 'Choose subject…' : 'Add a subject first';
  select.appendChild(blank);

  list.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.code;
    opt.textContent = `${s.code} — ${s.name}`;
    select.appendChild(opt);
  });

  if (prev && !list.some((s) => s.code === prev)) {
    const retired = subjectFor(state.draftSubjects, prev);
    const opt = document.createElement('option');
    opt.value = prev;
    opt.textContent = retired ? `${retired.code} — ${retired.name} (retired)` : prev;
    select.appendChild(opt);
  }
  select.value = prev;
}

function resetSlotForm() {
  editingKey = null;
  const startEl = document.querySelector('#schedule-slot-start');
  const endEl = document.querySelector('#schedule-slot-end');
  const kindEl = document.querySelector('#schedule-slot-kind');
  const lblEl = document.querySelector('#schedule-slot-label');
  const submitEl = document.querySelector('#schedule-slot-submit');
  const cancelEl = document.querySelector('#schedule-slot-cancel');
  if (startEl) startEl.value = '07:30';
  if (endEl) endEl.value = '08:30';
  if (kindEl) kindEl.value = 'subject';
  populateSubjectSelect('');
  if (lblEl) lblEl.value = '';
  if (submitEl) submitEl.textContent = 'Add slot';
  if (cancelEl) cancelEl.hidden = true;
  syncKindFields();
}

function beginEditSlot(slot) {
  editingKey = { day: slot.day, start: slot.start, end: slot.end };
  const startEl = document.querySelector('#schedule-slot-start');
  const endEl = document.querySelector('#schedule-slot-end');
  const kindEl = document.querySelector('#schedule-slot-kind');
  const lblEl = document.querySelector('#schedule-slot-label');
  const submitEl = document.querySelector('#schedule-slot-submit');
  const cancelEl = document.querySelector('#schedule-slot-cancel');
  if (startEl) startEl.value = slot.start;
  if (endEl) endEl.value = slot.end;
  if (kindEl) kindEl.value = slot.kind || 'subject';
  populateSubjectSelect(slot.subject || '');
  if (lblEl) lblEl.value = slot.label || '';
  if (submitEl) submitEl.textContent = 'Save slot';
  if (cancelEl) cancelEl.hidden = false;
  syncKindFields();
  startEl?.focus();
}

function onSubmitSlot(e) {
  e.preventDefault();
  const startRaw = String(document.querySelector('#schedule-slot-start')?.value || '').trim().slice(0, 5);
  const endRaw = String(document.querySelector('#schedule-slot-end')?.value || '').trim().slice(0, 5);
  const kind = String(document.querySelector('#schedule-slot-kind')?.value || 'subject');
  const subject = String(document.querySelector('#schedule-slot-subject')?.value || '').trim();
  const label = String(document.querySelector('#schedule-slot-label')?.value || '').trim();

  const newSlot = {
    day: editingKey ? editingKey.day : activeDay,
    start: startRaw,
    end: endRaw,
    kind,
  };
  if (kind === 'subject') newSlot.subject = subject;
  else newSlot.label = label;

  const base = readMetaFromInputs(currentDraft());
  const nextSlots = editingKey
    ? base.slots.filter((s) => !(s.day === editingKey.day && s.start === editingKey.start && s.end === editingKey.end))
    : base.slots.slice();
  nextSlots.push(newSlot);

  const labelDesc = kind === 'subject' ? subject : label;
  if (commitSchedule({ ...base, slots: nextSlots }, editingKey ? `Updated ${labelDesc}.` : `Added ${labelDesc} on ${DAY_NAMES[newSlot.day]}.`)) {
    resetSlotForm();
  }
}

function removeSlot(slot) {
  const base = readMetaFromInputs(currentDraft());
  const nextSlots = base.slots.filter((s) => !(s.day === slot.day && s.start === slot.start && s.end === slot.end));
  if (editingKey && editingKey.day === slot.day && editingKey.start === slot.start && editingKey.end === slot.end) {
    resetSlotForm();
  }
  const title = slot.kind === 'subject' ? slot.subject : slot.label;
  commitSchedule({ ...base, slots: nextSlots }, `Removed ${title} from ${DAY_NAMES[slot.day]}.`);
}

function clearSchedule() {
  resetSlotForm();
  commitSchedule(null, 'Schedule cleared in draft. Publish to remove it from the class board.');
}

function syncDayTabs() {
  if (!dom.scheduleDayTabs) return;
  dom.scheduleDayTabs.querySelectorAll('[data-sched-day]').forEach((btn) => {
    const day = Number(btn.dataset.schedDay);
    const on = day === activeDay;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

export function render() {
  if (!dom.schedulePanel || !deps) return;
  const sched = state.draftSchedule;
  if (dom.scheduleTerm && document.activeElement !== dom.scheduleTerm) dom.scheduleTerm.value = (sched && sched.term) || '';
  if (dom.scheduleSection && document.activeElement !== dom.scheduleSection) dom.scheduleSection.value = (sched && sched.sectionLabel) || '';
  if (dom.scheduleRoom && document.activeElement !== dom.scheduleRoom) dom.scheduleRoom.value = (sched && sched.room) || '';

  syncDayTabs();
  populateSubjectSelect(editingKey ? undefined : '');
  syncKindFields();

  if (dom.scheduleClearBtn) {
    dom.scheduleClearBtn.disabled = !sched;
  }

  const list = dom.scheduleSlotList;
  if (!list) return;
  list.replaceChildren();

  const daySlots = (sched && Array.isArray(sched.slots) ? sched.slots : [])
    .filter((s) => s.day === activeDay)
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

  if (!daySlots.length) {
    const empty = document.createElement('li');
    empty.className = 'announce-empty';
    empty.textContent = `No slots for ${DAY_NAMES[activeDay]} yet. Add one below.`;
    list.appendChild(empty);
    return;
  }

  daySlots.forEach((slot) => {
    const li = document.createElement('li');
    li.className = 'history-item sched-editor-row';

    const info = document.createElement('div');
    info.className = 'sched-editor-info';

    const timeRange = `${deps.formatTime(slot.start)}–${deps.formatTime(slot.end)}`;
    const tm = document.createElement('span');
    tm.className = 'sched-editor-time';
    tm.textContent = timeRange;

    const title = slot.kind === 'subject'
      ? (() => {
        const name = subjectDisplayName(state.draftSubjects, slot.subject);
        return name && name !== slot.subject ? `${slot.subject} · ${name}` : slot.subject;
      })()
      : `${slot.label} (${slot.kind})`;

    const titleEl = document.createElement('span');
    titleEl.className = 'sched-editor-title';
    titleEl.textContent = title;
    info.append(tm, titleEl);

    const actions = document.createElement('div');
    actions.className = 'sched-editor-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'text-button';
    editBtn.textContent = 'Edit';
    editBtn.setAttribute('aria-label', `Edit ${title} (${timeRange})`);
    editBtn.addEventListener('click', () => beginEditSlot(slot));

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'text-button is-danger';
    rmBtn.textContent = 'Remove';
    rmBtn.setAttribute('aria-label', `Remove ${title} (${timeRange})`);
    rmBtn.addEventListener('click', () => removeSlot(slot));

    actions.append(editBtn, rmBtn);
    li.append(info, actions);
    list.appendChild(li);
  });
}

export function init(d) {
  deps = d;
  if (dom.scheduleToggle) {
    dom.scheduleToggle.addEventListener('click', () => {
      setExpanded(dom.scheduleBody ? dom.scheduleBody.hidden : true);
    });
  }
  [dom.scheduleTerm, dom.scheduleSection, dom.scheduleRoom].forEach((input) => {
    if (!input) return;
    input.addEventListener('change', () => {
      const base = currentDraft();
      const next = readMetaFromInputs(base);
      if (!state.draftSchedule && !next.term && !next.sectionLabel && !next.room) return;
      commitSchedule(next);
    });
  });
  if (dom.scheduleDayTabs) {
    dom.scheduleDayTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sched-day]');
      if (!btn) return;
      activeDay = Number(btn.dataset.schedDay) || 1;
      resetSlotForm();
      render();
    });
  }
  document.querySelector('#schedule-slot-kind')?.addEventListener('change', syncKindFields);
  document.querySelector('#schedule-slot-cancel')?.addEventListener('click', () => {
    resetSlotForm();
    if (dom.scheduleStatus) dom.scheduleStatus.textContent = '';
  });
  if (dom.scheduleAddForm) {
    dom.scheduleAddForm.addEventListener('submit', onSubmitSlot);
  }
  if (dom.scheduleClearBtn) {
    if (deps.armInlineConfirm) {
      deps.armInlineConfirm(dom.scheduleClearBtn, 'Clear schedule', 'Confirm clearing class schedule', clearSchedule);
    } else {
      dom.scheduleClearBtn.addEventListener('click', clearSchedule);
    }
  }
  resetSlotForm();
}
