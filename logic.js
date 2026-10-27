/* Pure logic for TaskTracker: dates, the Task model, sorting, progress merging and
   the quick-add parsers. Moved out of app.js unchanged so tests can load it without a browser.
   Loaded as a plain script before app.js: no modules, no build step.
   Nothing here touches the page, except Task.fromJSON, which needs the browser's
   document and sanitizeDoc (defined in app.js) and is therefore not covered by the Node tests. */

// --- Date helpers (calendar days, local time) ---
function dayDiff(date) {
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((start(date) - start(new Date())) / 86400000);
}
function toInputValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Attached files live on the server (data/uploads); a task only keeps {id, name, size}.
const FILE_ID_RE = /^[a-f0-9]{32}\.(pdf|pptx|docx|jpg|png)$/;
function cleanFiles(list) {
  return (Array.isArray(list) ? list : [])
    .filter((f) => f && typeof f.id === 'string' && FILE_ID_RE.test(f.id) && typeof f.name === 'string' && Number.isFinite(f.size))
    .slice(0, 10)
    .map((f) => ({ id: f.id, name: f.name.slice(0, 120), size: Math.max(0, Math.floor(f.size)) }));
}

// --- Task Data Model (Feature 1) ---
class Task {
  constructor(opts = {}) {
    this.title = opts.title === undefined ? 'New Task' : String(opts.title);
    if (this.title === '') this.title = 'New Task';

    this.dueDate = opts.dueDate instanceof Date ? opts.dueDate : undefined;
    this.dueTime = typeof opts.dueTime === 'string' ? opts.dueTime : undefined;

    this.status = opts.status !== undefined ? String(opts.status) : 'not_started';
    this.movedAt = typeof opts.movedAt === 'number' ? opts.movedAt : 0;

    this.id = opts.id !== undefined ? String(opts.id) : Math.random().toString(36).substring(2, 12);

    this.notes = typeof opts.notes === 'string' ? opts.notes : '';

    this.subject = typeof opts.subject === 'string' ? opts.subject : '';

    this.closedAt = typeof opts.closedAt === 'number' ? opts.closedAt : 0;

    this.files = Array.isArray(opts.files) ? opts.files : [];

  }

  getDueDateDisplay() {
    if (!this.dueDate) return '';
    const diff = dayDiff(this.dueDate);
    const full = this.dueDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
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
    const d = new Date(this.dueDate);
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

  // Past = closed by the admin, or more than 7 days past its due date.
  isExpired() {
    const ts = this.getDueTimestamp();
    return !!ts && Date.now() - ts.getTime() > 7 * 86400000;
  }

  isPast() { return this.closedAt > 0 || this.isExpired(); }

  getPastLabel() { return this.closedAt > 0 ? 'Closed' : 'Expired'; }

  getDueShort() {
    if (!this.dueDate) return 'Someday';
    const sameYear = this.dueDate.getFullYear() === new Date().getFullYear();
    if (this.dueTime) {
      const date = this.dueDate.toLocaleDateString('en-US', sameYear
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' });
      return `${date} · ${this.getTimeLabel()}`;
    }
    return this.dueDate.toLocaleDateString('en-US', sameYear
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  getDueHint() {
    if (!this.dueDate) return '';
    const diff = dayDiff(this.dueDate);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    if (this.isOverdue()) {
      if (diff === 0) {
        const mins = Math.max(1, Math.floor((Date.now() - this.getDueTimestamp().getTime()) / 60000));
        return mins < 60 ? `${mins} min overdue` : `${Math.floor(mins / 60)} hr overdue`;
      }
      const days = -diff;
      return days >= 14 ? '2+ weeks overdue' : days >= 7 ? '1 week overdue' : `${plural(days, 'day')} overdue`;
    }
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

  // Card and list text: the countdown, capitalised, plus the time whenever the task has one.
  getDueLabel() {
    if (!this.dueDate) return 'Someday';
    const base = this.dueTime && dayDiff(this.dueDate) === 0 && !this.isOverdue() ? 'today' : this.getDueHint();
    const lead = base === 'today' || base === 'tomorrow' ? `due ${base}` : base;
    const text = lead.charAt(0).toUpperCase() + lead.slice(1);
    return this.dueTime ? `${text} · ${this.getTimeLabel()}` : text;
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

// "3pm", "3:30pm", "15:30" -> "HH:MM" (or null)
function parseTimeWord(w) {
  let m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/i.exec(w);
  if (!m) {
    // Shorthand: 1159pm -> 11:59pm, 315pm -> 3:15pm, 930am -> 9:30am
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

// today, tmr, fri, 10/5, 10/5/2026, oct 5, 5 oct 2026, 2026-10-05
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

// Per task, the entry with the newer movedAt wins. A tie keeps the local one.
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

const logicAPI = {
  dayDiff, toInputValue, cleanFiles, Task, sortTasks, lookup, parseTimeWord,
  makeDate, mergeProgress, todayDate, parseDateText, WEEKDAYS
};
Object.assign(globalThis, logicAPI);
export {
  dayDiff, toInputValue, cleanFiles, Task, sortTasks, lookup, parseTimeWord,
  makeDate, mergeProgress, todayDate, parseDateText, WEEKDAYS
};
