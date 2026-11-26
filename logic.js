const STATUS_LABELS = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' };

function statusChangeMessage(status) {
  const label = STATUS_LABELS[status] || status;
  return `Marked ${String(label).toLowerCase()}`;
}

function dayDiff(date) {
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((start(date) - start(new Date())) / 86400000);
}
function toInputValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const FILE_ID_RE = /^[a-f0-9]{32}\.(pdf|pptx|docx|jpg|png)$/;
function cleanFiles(list) {
  return (Array.isArray(list) ? list : [])
    .filter((f) => f && typeof f.id === 'string' && FILE_ID_RE.test(f.id) && typeof f.name === 'string' && Number.isFinite(f.size))
    .slice(0, 10)
    .map((f) => ({ id: f.id, name: f.name.slice(0, 120), size: Math.max(0, Math.floor(f.size)) }));
}

function sanitizeDoc(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const out = document.createElement('div');
  const walk = (src, dst) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === 3) dst.appendChild(document.createTextNode(n.textContent));
      else if (n.nodeType === 1) {
        const tag = n.tagName.toLowerCase();
        if (tag === 'img') {
          const s = n.getAttribute('src') || '';
          if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(s) || /^uploads\/[a-f0-9]{32}\.(jpg|png)$/.test(s)) {
            const i = document.createElement('img'); i.src = s; i.alt = (n.getAttribute('alt') || '').slice(0, 200); i.loading = 'lazy'; i.decoding = 'async'; dst.appendChild(i);
          }
        } else if (tag === 'br') dst.appendChild(document.createElement('br'));
        else if (tag === 'b' || tag === 'strong' || tag === 'i' || tag === 'em') {
          const el = document.createElement(tag === 'b' || tag === 'strong' ? 'b' : 'i');
          walk(n, el); if (el.childNodes.length) dst.appendChild(el);
        } else if (tag === 'ul' || tag === 'ol') {
          const ul = document.createElement('ul'); walk(n, ul); dst.appendChild(ul);
        } else if (tag === 'li') {
          const li = document.createElement('li'); walk(n, li); dst.appendChild(li);
        } else if (tag === 'div' || tag === 'p') {
          const el = document.createElement('div'); walk(n, el); dst.appendChild(el);
        } else if (tag !== 'script' && tag !== 'style') walk(n, dst);
      }
    });
  };
  walk(tpl.content, out);
  return out.innerHTML;
}

const TASK_ID_RE = /^[\w.\-]{1,100}$/;
function taskIdOk(id) {
  if (id === undefined) return true;
  const s = String(id);
  return s !== '__proto__' && TASK_ID_RE.test(s);
}

class Task {
  constructor(opts = {}) {
    this.title = opts.title === undefined ? 'New Task' : String(opts.title);
    if (this.title === '') this.title = 'New Task';

    this.dueDate = opts.dueDate instanceof Date ? opts.dueDate : undefined;
    this.endDate = (this.dueDate && opts.endDate instanceof Date && opts.endDate.getTime() >= this.dueDate.getTime())
      ? opts.endDate : undefined;
    this.dueTime = typeof opts.dueTime === 'string' ? opts.dueTime : undefined;

    this.status = opts.status !== undefined ? String(opts.status) : 'not_started';
    this.movedAt = typeof opts.movedAt === 'number' ? opts.movedAt : 0;

    this.id = opts.id !== undefined ? String(opts.id) : Math.random().toString(36).substring(2, 12);

    this.notes = typeof opts.notes === 'string' ? opts.notes : '';

    this.subject = typeof opts.subject === 'string' ? opts.subject : '';

    this.closedAt = typeof opts.closedAt === 'number' ? opts.closedAt : 0;

    this.files = Array.isArray(opts.files) ? opts.files : [];

    Object.seal(this);
  }

  getDueDateDisplay() {
    if (!this.dueDate) return '';
    const opts = { year: 'numeric', month: 'long', day: 'numeric' };
    const full = this.dueDate.toLocaleDateString(undefined, opts);
    if (this.endDate && toInputValue(this.endDate) !== toInputValue(this.dueDate)) {
      const range = `${full} → ${this.endDate.toLocaleDateString(undefined, opts)}`;
      return this.dueTime ? `${range} · ${this.getTimeLabel()}` : range;
    }
    const diff = dayDiff(this.dueDate);
    if (diff < 0) return full;
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    const dayName = this.dueDate.toLocaleDateString(undefined, { weekday: 'long' });
    const daysToNextMonday = ((8 - new Date().getDay()) % 7) || 7;
    if (diff < daysToNextMonday) return dayName;
    if (diff < daysToNextMonday + 7) return `Next ${dayName}`;
    return full;
  }

  getDueTimestamp() {
    if (!this.dueDate) return null;
    const d = new Date(this.getDeadline());
    if (this.dueTime) {
      const [h, m] = this.dueTime.split(':').map(Number);
      d.setHours(h, m, 0, 0);
    } else {
      d.setHours(23, 59, 59, 999);
    }
    return d;
  }

  isOverdue() {
    const ts = this.getDueTimestamp();
    if (!ts) return false;
    return ts.getTime() < Date.now();
  }

  isClosed() { return this.closedAt > 0; }

  isExpired(now = Date.now()) {
    const ts = this.getDueTimestamp();
    return !!ts && now - ts.getTime() > 7 * 86400000;
  }

  isPast(now = Date.now()) { return this.isClosed() || this.isExpired(now); }

  getPastLabel() { return this.dueDate ? this.getRangeLabel() : 'Closed'; }

  getDueShort() {
    if (!this.dueDate) return 'Someday';
    const year = new Date().getFullYear();
    const fmt = (d, wd) => d.toLocaleDateString('en-US', d.getFullYear() === year
      ? (wd ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' })
      : { month: 'short', day: 'numeric', year: 'numeric' });
    if (this.endDate && toInputValue(this.endDate) !== toInputValue(this.dueDate)) {
      const range = `${fmt(this.dueDate, false)} → ${fmt(this.endDate, false)}`;
      return this.dueTime ? `${range} · ${this.getTimeLabel()}` : range;
    }
    if (this.dueTime) return `${fmt(this.dueDate, false)} · ${this.getTimeLabel()}`;
    return fmt(this.dueDate, true);
  }

  getDeadline() { return this.endDate || this.dueDate; }

  getDueHint() {
    if (!this.dueDate) return '';
    if (this.isOverdue()) return 'Overdue';
    const diff = dayDiff(this.getDeadline());
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    if (diff === 0) {
      if (!this.dueTime) return 'today';
      const mins = Math.max(1, Math.ceil((this.getDueTimestamp().getTime() - Date.now()) / 60000));
      return mins < 60 ? `in ${mins} min` : `in ${Math.floor(mins / 60)} hr`;
    }
    if (diff === 1) return 'tomorrow';
    if (diff <= 13) return `in ${diff} days`;
    if (diff < 60) return `in ${Math.floor(diff / 7)} weeks`;
    return `in ${plural(Math.floor(diff / 30), 'month')}`;
  }

  getDueLabel() {
    if (!this.dueDate) return 'Someday';
    const diff = dayDiff(this.getDeadline());
    const overdue = this.isOverdue();
    const base = this.dueTime && diff === 0 && !overdue ? 'today' : this.getDueHint();
    const lead = base === 'today' || base === 'tomorrow' ? `due ${base}` : base;
    const text = lead.charAt(0).toUpperCase() + lead.slice(1);
    const isRange = this.endDate && toInputValue(this.endDate) !== toInputValue(this.dueDate);
    const showDate = isRange || diff > 1 || diff < 0;
    const datePart = showDate ? this.getRangeLabel() : overdue ? 'Today' : '';
    return [text, datePart, this.getTimeLabel()].filter(Boolean).join(' · ');
  }

  getRangeLabel() {
    const year = new Date().getFullYear();
    if (!this.endDate || toInputValue(this.endDate) === toInputValue(this.dueDate)) {
      return this.dueDate.toLocaleDateString('en-US', this.dueDate.getFullYear() === year
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' });
    }
    const start = this.dueDate, end = this.endDate;
    if (start.getFullYear() !== end.getFullYear()) {
      const f = { month: 'short', day: 'numeric', year: 'numeric' };
      return `${start.toLocaleDateString('en-US', f)} – ${end.toLocaleDateString('en-US', f)}`;
    }
    if (start.getMonth() !== end.getMonth()) {
      const f = { month: 'short', day: 'numeric' };
      return `${start.toLocaleDateString('en-US', f)} – ${end.toLocaleDateString('en-US', f)}`;
    }
    const dayPart = start.getFullYear() === year ? String(end.getDate()) : `${end.getDate()}, ${end.getFullYear()}`;
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${dayPart}`;
  }
  getTimeLabel() {
    if (!this.dueTime) return '';
    const [h, m] = this.dueTime.split(':').map(Number);
    const d = new Date(); d.setHours(h, m);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      dueDate: this.dueDate ? toInputValue(this.dueDate) : undefined,
      endDate: (this.dueDate && this.endDate) ? toInputValue(this.endDate) : undefined,
      dueTime: this.dueTime,
      notes: this.notes,
      subject: this.subject,
      closedAt: this.closedAt || undefined,
      files: this.files.length ? this.files : undefined
    };
  }

  static fromJSON(obj) {
    let notes = typeof obj.notes === 'string' ? obj.notes : '';
    if (!/<[a-z][\s\S]*>/i.test(notes)) {
      const esc = document.createElement('div');
      esc.textContent = notes;
      notes = esc.innerHTML.replace(/\n/g, '<br>');
    }
    (Array.isArray(obj.images) ? obj.images : []).forEach((src) => { notes += `<div><img src="${src}"></div>`; });
    return new Task({
      id: obj.id,
      title: obj.title,
      dueDate: (() => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof obj.dueDate === 'string' ? obj.dueDate : '');
        return (m && makeDate(+m[1], +m[2] - 1, +m[3])) || undefined;
      })(),
      endDate: (() => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof obj.endDate === 'string' ? obj.endDate : '');
        return (m && makeDate(+m[1], +m[2] - 1, +m[3])) || undefined;
      })(),
      dueTime: typeof obj.dueTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(obj.dueTime) ? obj.dueTime : undefined,
      notes: sanitizeDoc(notes),
      subject: obj.subject,
      closedAt: Number.isFinite(obj.closedAt) ? obj.closedAt : 0,
      files: cleanFiles(obj.files)
    });
  }
}

function sortTasks(list) {
  const byText = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const due = (t) => { const d = t.getDueTimestamp(); return d ? d.getTime() : Infinity; };
  return list.slice().sort((a, b) => {
    const aDone = a.status === 'done', bDone = b.status === 'done';
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (aDone) return (b.movedAt - a.movedAt) || byText(a, b);
    const da = due(a), db = due(b);
    if (da !== db) return da < db ? -1 : 1;
    return byText(a, b);
  });
}

const WEEKDAYS = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

const lookup = (map, key) => (Object.hasOwn(map, key) ? map[key] : undefined);

function parseTimeWord(w) {
  let m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/i.exec(w);
  if (!m) {

    const c = /^(\d{1,2})(\d{2})(am|pm)$/i.exec(w);
    if (c) m = [c[0], c[1], c[2], c[3]];
  }
  if (m) {
    let h = +m[1];
    const min = +(m[2] || 0);
    if (h < 1 || h > 12 || min > 59) return null;
    if (m[3].toLowerCase() === 'pm' && h < 12) h += 12;
    if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(w);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function makeDate(y, mo, d) {
  const dt = new Date(y, mo, d);
  return dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d ? dt : null;
}

function todayDate() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function parseDateText(raw) {
  const s = raw.trim().toLowerCase().replace(/,/g, '');
  if (!s) return null;
  const t = todayDate();
  const y = t.getFullYear();
  const yr = (v) => (v === undefined ? y : +v < 100 ? 2000 + +v : +v);
  if (s === 'today') return t;
  if (s === 'tmr' || s === 'tomorrow') return new Date(y, t.getMonth(), t.getDate() + 1);
  const wd = lookup(WEEKDAYS, s);
  if (wd !== undefined) return new Date(y, t.getMonth(), t.getDate() + (((wd - t.getDay() + 7) % 7) || 7));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return makeDate(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/.exec(s);
  if (m) return makeDate(yr(m[3]), +m[1] - 1, +m[2]);
  m = /^([a-z]{3})[a-z]*\.? (\d{1,2})(?: (\d{4}))?$/.exec(s);
  if (m && MONTH_ABBR.includes(m[1])) return makeDate(yr(m[3]), MONTH_ABBR.indexOf(m[1]), +m[2]);
  m = /^(\d{1,2}) ([a-z]{3})[a-z]*(?: (\d{4}))?$/.exec(s);
  if (m && MONTH_ABBR.includes(m[2])) return makeDate(yr(m[3]), MONTH_ABBR.indexOf(m[2]), +m[1]);
  return null;
}

function mergeProgress(local, incoming) {
  const merged = {};
  Object.keys(local).forEach((id) => { merged[id] = local[id]; });
  let added = 0, updated = 0, kept = 0;
  Object.entries(incoming).forEach(([id, e]) => {
    const cur = Object.hasOwn(merged, id) ? merged[id] : null;
    if (!cur) { merged[id] = e; if (e.status !== 'not_started') added++; }
    else if (e.movedAt > cur.movedAt) { if (e.status !== cur.status) updated++; merged[id] = e; }
    else if (e.status !== cur.status) kept++;
  });
  return { merged, added, updated, kept };
}

function clampPopoverPosition(rect, width, height, viewportWidth, viewportHeight) {
  const margin = 8;
  const gap = 4;
  const below = viewportHeight - rect.bottom - margin;
  let top = height > below && rect.top > below
    ? Math.max(margin, rect.top - height - gap)
    : rect.bottom + gap;
  top = Math.max(margin, Math.min(top, viewportHeight - height - margin));
  const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
  return { top, left };
}

function pageFromHash(hash, knownPages, isAdmin) {
  const name = String(hash || '').replace(/^#/, '');
  if (!knownPages.includes(name)) return knownPages[0];
  if (name === 'my-tasks' && !isAdmin) return knownPages[0];
  return name;
}

const SCHEDULE_MAX_SLOTS = 80;
const SCHEDULE_MAX_META = 80;
const SCHEDULE_MAX_LABEL = 40;
const SCHEDULE_KINDS = ['subject', 'break', 'activity'];
const SCHEDULE_DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const SCHEDULE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCHEDULE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;
const SCHEDULE_CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SCHEDULE_RESERVED = new Set(['__proto__', 'prototype', 'constructor']);

function scheduleTimeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function validateSchedule(raw, validSubjectCodes = null) {
  if (raw === null || raw === undefined) return { schedule: null, error: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { schedule: null, error: 'Schedule must be an object.' };
  }
  const meta = {};
  for (const field of ['term', 'sectionLabel', 'adviser', 'room']) {
    const val = raw[field];
    if (val === undefined || val === null) {
      meta[field] = '';
      continue;
    }
    if (typeof val !== 'string') return { schedule: null, error: `Schedule ${field} must be text.` };
    const trimmed = val.trim();
    if (Array.from(trimmed).length > SCHEDULE_MAX_META) {
      return { schedule: null, error: `Schedule ${field} must be ${SCHEDULE_MAX_META} characters or fewer.` };
    }
    if (SCHEDULE_CONTROL_RE.test(trimmed)) {
      return { schedule: null, error: `Schedule ${field} has control characters.` };
    }
    meta[field] = trimmed;
  }
  if (!Array.isArray(raw.slots)) {
    return { schedule: null, error: 'Schedule slots must be a list.' };
  }
  if (raw.slots.length > SCHEDULE_MAX_SLOTS) {
    return { schedule: null, error: `Too many schedule slots (max ${SCHEDULE_MAX_SLOTS}).` };
  }

  let validSet = null;
  if (validSubjectCodes instanceof Set) validSet = validSubjectCodes;
  else if (Array.isArray(validSubjectCodes)) {
    validSet = new Set(validSubjectCodes.map((c) => (typeof c === 'string' ? c : c && c.code)).filter(Boolean));
  }

  const parsed = [];
  for (let i = 0; i < raw.slots.length; i++) {
    const n = i + 1;
    const slot = raw.slots[i];
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
      return { schedule: null, error: `Schedule slot ${n} is not an object.` };
    }
    const day = slot.day;
    if (!Number.isInteger(day) || day < 1 || day > 5) {
      return { schedule: null, error: `Slot ${n} needs an integer day from 1 (Mon) to 5 (Fri).` };
    }
    const start = slot.start;
    const end = slot.end;
    if (typeof start !== 'string' || !SCHEDULE_TIME_RE.test(start)) {
      return { schedule: null, error: `Slot ${n} needs a 24-hour start time like 07:30.` };
    }
    if (typeof end !== 'string' || !SCHEDULE_TIME_RE.test(end)) {
      return { schedule: null, error: `Slot ${n} needs a 24-hour end time like 08:30.` };
    }
    const startMin = scheduleTimeToMinutes(start);
    const endMin = scheduleTimeToMinutes(end);
    if (startMin >= endMin) {
      return { schedule: null, error: `Slot ${n} end time must be after start time.` };
    }

    let kind = slot.kind;
    if (kind === undefined) {
      if (typeof slot.subject === 'string' && slot.subject.trim() !== '') kind = 'subject';
      else return { schedule: null, error: `Slot ${n} needs a kind (subject, break, or activity).` };
    }
    if (typeof kind !== 'string' || !SCHEDULE_KINDS.includes(kind)) {
      return { schedule: null, error: `Slot ${n} has an invalid kind.` };
    }

    let teacher = '';
    if (slot.teacher !== undefined && slot.teacher !== null) {
      if (typeof slot.teacher !== 'string') return { schedule: null, error: `Slot ${n} teacher must be text.` };
      teacher = slot.teacher.trim();
      if (Array.from(teacher).length > SCHEDULE_MAX_META) {
        return { schedule: null, error: `Slot ${n} teacher must be ${SCHEDULE_MAX_META} characters or fewer.` };
      }
      if (SCHEDULE_CONTROL_RE.test(teacher)) {
        return { schedule: null, error: `Slot ${n} teacher has control characters.` };
      }
    }

    const out = { day, start, end, kind };
    if (kind === 'subject') {
      const subj = slot.subject;
      if (typeof subj !== 'string' || !SCHEDULE_CODE_RE.test(subj)) {
        return { schedule: null, error: `Slot ${n} needs a valid subject code.` };
      }
      if (SCHEDULE_RESERVED.has(subj) || SCHEDULE_RESERVED.has(subj.toLowerCase())) {
        return { schedule: null, error: `Slot ${n} uses a reserved subject code.` };
      }
      if (validSet && !validSet.has(subj)) {
        return { schedule: null, error: `Slot ${n} uses subject "${subj}", which is not in the catalog.` };
      }
      out.subject = subj;
    } else {
      if (typeof slot.label !== 'string') {
        return { schedule: null, error: `Slot ${n} needs a label.` };
      }
      const label = slot.label.trim();
      const len = Array.from(label).length;
      if (len === 0 || len > SCHEDULE_MAX_LABEL) {
        return { schedule: null, error: `Slot ${n} needs a label of 1-${SCHEDULE_MAX_LABEL} characters.` };
      }
      if (SCHEDULE_CONTROL_RE.test(label)) {
        return { schedule: null, error: `Slot ${n} label has control characters.` };
      }
      out.label = label;
    }
    if (teacher) out.teacher = teacher;
    parsed.push({ out, day, startMin, endMin });
  }

  parsed.sort((a, b) => (a.day - b.day) || (a.startMin - b.startMin) || (a.endMin - b.endMin));
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const cur = parsed[i];
    if (prev.day === cur.day && prev.endMin > cur.startMin) {
      return {
        schedule: null,
        error: `Schedule slots overlap on ${SCHEDULE_DAY_NAMES[cur.day]} (${prev.out.start}-${prev.out.end} and ${cur.out.start}-${cur.out.end}).`,
      };
    }
  }

  return {
    schedule: {
      term: meta.term,
      sectionLabel: meta.sectionLabel,
      adviser: meta.adviser,
      room: meta.room,
      slots: parsed.map((p) => p.out),
    },
    error: null,
  };
}

function canonicalSchedule(raw) {
  const res = validateSchedule(raw);
  return res.error ? null : res.schedule;
}

function resolveCurrentSlot(schedule, now) {
  let day;
  let minutes;
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) {
      throw new TypeError('resolveCurrentSlot requires a valid Date or { day, minutes }');
    }
    day = now.getDay();
    minutes = now.getHours() * 60 + now.getMinutes();
  } else if (
    now && typeof now === 'object' && !Array.isArray(now)
    && Number.isInteger(now.day) && now.day >= 0 && now.day <= 6
    && Number.isInteger(now.minutes) && now.minutes >= 0 && now.minutes < 1440
  ) {
    day = now.day;
    minutes = now.minutes;
  } else {
    throw new TypeError('resolveCurrentSlot requires a valid Date or { day, minutes }');
  }

  if (!schedule || !Array.isArray(schedule.slots) || !schedule.slots.length) {
    return { state: 'empty', current: null, next: null, minutesLeft: null, minutesUntilNext: null, nextDay: null };
  }
  const sorted = schedule.slots
    .filter((s) => s && Number.isInteger(s.day) && typeof s.start === 'string' && typeof s.end === 'string'
      && SCHEDULE_TIME_RE.test(s.start) && SCHEDULE_TIME_RE.test(s.end))
    .map((s) => ({ slot: { ...s }, day: s.day, startMin: scheduleTimeToMinutes(s.start), endMin: scheduleTimeToMinutes(s.end) }))
    .filter((x) => x.startMin < x.endMin)
    .sort((a, b) => (a.day - b.day) || (a.startMin - b.startMin) || (a.endMin - b.endMin));

  if (!sorted.length) {
    return { state: 'empty', current: null, next: null, minutesLeft: null, minutesUntilNext: null, nextDay: null };
  }

  if (day >= 1 && day <= 5) {
    const todaySlots = sorted.filter((x) => x.day === day);
    const activeIdx = todaySlots.findIndex((x) => x.startMin <= minutes && minutes < x.endMin);
    if (activeIdx !== -1) {
      const cur = todaySlots[activeIdx];
      const nxt = todaySlots[activeIdx + 1] || null;
      return {
        state: 'active',
        current: cur.slot,
        next: nxt ? nxt.slot : null,
        minutesLeft: cur.endMin - minutes,
        minutesUntilNext: nxt ? nxt.startMin - minutes : null,
        nextDay: nxt ? day : null,
      };
    }
    const upIdx = todaySlots.findIndex((x) => x.startMin > minutes);
    if (upIdx !== -1) {
      const nxt = todaySlots[upIdx];
      return {
        state: 'upcoming',
        current: null,
        next: nxt.slot,
        minutesLeft: null,
        minutesUntilNext: nxt.startMin - minutes,
        nextDay: day,
      };
    }
  }

  const stateKind = (day === 0 || day === 6) ? 'weekend' : 'after_hours';
  for (let offset = 1; offset <= 7; offset++) {
    const candDay = (day + offset) % 7;
    const nxt = sorted.find((x) => x.day === candDay);
    if (nxt) {
      return {
        state: stateKind,
        current: null,
        next: nxt.slot,
        minutesLeft: null,
        minutesUntilNext: offset * 1440 + nxt.startMin - minutes,
        nextDay: nxt.day,
      };
    }
  }

  return { state: stateKind, current: null, next: null, minutesLeft: null, minutesUntilNext: null, nextDay: null };
}

function buildWeekGrid(schedule) {
  const empty = { boundaries: [], rows: [], cells: [], emptyCells: [] };
  if (!schedule || !Array.isArray(schedule.slots) || !schedule.slots.length) return empty;
  const validSlots = schedule.slots
    .filter((s) => s && Number.isInteger(s.day) && s.day >= 1 && s.day <= 5
      && typeof s.start === 'string' && typeof s.end === 'string'
      && SCHEDULE_TIME_RE.test(s.start) && SCHEDULE_TIME_RE.test(s.end)
      && scheduleTimeToMinutes(s.start) < scheduleTimeToMinutes(s.end))
    .slice()
    .sort((a, b) => (a.day - b.day) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  if (!validSlots.length) return empty;

  const boundarySet = new Set();
  for (const s of validSlots) {
    boundarySet.add(s.start);
    boundarySet.add(s.end);
  }
  const boundaries = [...boundarySet].sort();
  if (boundaries.length < 2) return empty;

  const idxOf = new Map(boundaries.map((b, idx) => [b, idx]));
  const rows = [];
  for (let r = 0; r < boundaries.length - 1; r++) {
    rows.push({ index: r, start: boundaries[r], end: boundaries[r + 1] });
  }

  const covered = new Set();
  const cells = [];
  for (const slot of validSlots) {
    const startIdx = idxOf.get(slot.start);
    const endIdx = idxOf.get(slot.end);
    for (let r = startIdx; r < endIdx; r++) covered.add(`${slot.day}:${r}`);
    cells.push({
      slot: { ...slot },
      day: slot.day,
      col: slot.day + 1,
      rowStart: startIdx + 2,
      rowEnd: endIdx + 2,
      rowSpan: endIdx - startIdx,
    });
  }

  const emptyCells = [];
  for (let r = 0; r < rows.length; r++) {
    for (let d = 1; d <= 5; d++) {
      if (!covered.has(`${d}:${r}`)) {
        emptyCells.push({ day: d, col: d + 1, rowStart: r + 2, rowEnd: r + 3 });
      }
    }
  }

  return { boundaries, rows, cells, emptyCells };
}

const logicAPI = {
  dayDiff, toInputValue, cleanFiles, Task, sortTasks, lookup, parseTimeWord,
  makeDate, mergeProgress, todayDate, parseDateText, WEEKDAYS, sanitizeDoc,
  clampPopoverPosition, pageFromHash, taskIdOk, STATUS_LABELS, statusChangeMessage,
  SCHEDULE_MAX_SLOTS, SCHEDULE_MAX_META, SCHEDULE_MAX_LABEL, SCHEDULE_KINDS,
  validateSchedule, canonicalSchedule, resolveCurrentSlot, buildWeekGrid,
};
Object.assign(globalThis, logicAPI);
export {
  dayDiff, toInputValue, cleanFiles, Task, sortTasks, lookup, parseTimeWord,
  makeDate, mergeProgress, todayDate, parseDateText, WEEKDAYS, sanitizeDoc,
  clampPopoverPosition, pageFromHash, taskIdOk, STATUS_LABELS, statusChangeMessage,
  SCHEDULE_MAX_SLOTS, SCHEDULE_MAX_META, SCHEDULE_MAX_LABEL, SCHEDULE_KINDS,
  validateSchedule, canonicalSchedule, resolveCurrentSlot, buildWeekGrid,
};
