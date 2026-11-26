import { state } from './state.js';
import { dom } from './dom.js';
import { subjectFor, subjectDisplayName, subjectTextColor } from './subjects.js';

const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAY_FULL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

let deps = null;
let selectedDay = null;
let fullWeekOnPhone = false;
let tickTimer = null;
let listenersBound = false;

function currentNow() {
  return deps && typeof deps.nowProvider === 'function' ? deps.nowProvider() : new Date();
}

function activeSchedule() {
  return state.isAdmin && state.previewing ? state.draftSchedule : state.publishedSchedule;
}

function activeCatalog() {
  return state.isAdmin && !state.previewing && Array.isArray(state.publishedCatalog) && state.publishedCatalog.length
    ? state.publishedCatalog
    : state.catalog;
}

function slotShortTitle(slot) {
  if (!slot) return '';
  return slot.kind === 'subject' ? (slot.subject || '') : (slot.label || '');
}

function slotAccessibleTitle(slot, cat) {
  if (!slot) return '';
  if (slot.kind !== 'subject') return slot.label || '';
  const name = subjectDisplayName(cat, slot.subject);
  return name && name !== slot.subject ? `${slot.subject} (${name})` : slot.subject;
}

function isSameSlot(a, b) {
  return !!a && !!b && a.day === b.day && a.start === b.start && a.end === b.end;
}

function onVisibilityOrPage() {
  if (typeof document === 'undefined') return;
  const calPage = document.querySelector('#page-calendar');
  if (document.hidden || (calPage && calPage.hidden) || !dom.calSchedule || dom.calSchedule.hidden) {
    stopTimer();
    return;
  }
  render();
}

function startTimer() {
  if (tickTimer || typeof setInterval !== 'function') return;
  tickTimer = setInterval(() => {
    if (typeof document !== 'undefined') {
      const calPage = document.querySelector('#page-calendar');
      if (document.hidden || (calPage && calPage.hidden) || !dom.calSchedule || dom.calSchedule.hidden) {
        stopTimer();
        return;
      }
    }
    render();
  }, 60000);
}

export function stopTimer() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

export function hasVisibleSchedule() {
  return Boolean(state.isAdmin || state.publishedSchedule);
}

export function getTitleText() {
  const sched = activeSchedule();
  return sched && sched.sectionLabel ? `Class Schedule · ${sched.sectionLabel}` : 'Class Schedule';
}

export function init(d) {
  deps = d;
  if (!listenersBound && typeof document !== 'undefined') {
    listenersBound = true;
    document.addEventListener('visibilitychange', onVisibilityOrPage);
    document.addEventListener('app:page-shown', onVisibilityOrPage);
  }
}

function buildMetaLine(sched) {
  const parts = [];
  if (sched.term) parts.push(sched.term);
  if (sched.room) parts.push(`Room ${sched.room}`);
  if (sched.adviser) parts.push(sched.adviser);
  return parts.join(' · ');
}

function renderNowStrip(sched, resolved, cat) {
  const { formatTime } = deps;
  const strip = document.createElement('div');
  strip.className = 'sched-now';
  strip.setAttribute('aria-live', 'polite');

  const mainRow = document.createElement('p');
  mainRow.className = 'sched-now-main';

  const makeBadge = (text, active) => {
    const badge = document.createElement('span');
    badge.className = 'sched-badge' + (active ? ' is-now' : '');
    badge.textContent = text;
    return badge;
  };

  if (resolved.state === 'active') {
    const cur = resolved.current;
    const title = `${slotShortTitle(cur)}${cur.teacher ? ` (${cur.teacher})` : ''}`;
    mainRow.append(
      makeBadge('NOW', true),
      document.createTextNode(`${formatTime(cur.start)}–${formatTime(cur.end)} ${title} · ${resolved.minutesLeft} min left`),
    );
    strip.appendChild(mainRow);

    const subRow = document.createElement('p');
    subRow.className = 'sched-now-sub';
    if (resolved.next) {
      const nxt = resolved.next;
      const nxtText = `${slotShortTitle(nxt)}${nxt.teacher ? ` (${nxt.teacher})` : ''}`;
      subRow.append(
        makeBadge('NEXT', false),
        document.createTextNode(`${formatTime(nxt.start)}–${formatTime(nxt.end)} ${nxtText}`),
      );
    } else {
      subRow.textContent = 'No more classes after this today';
    }
    strip.appendChild(subRow);
  } else if (resolved.state === 'upcoming') {
    const nxt = resolved.next;
    const title = `${slotShortTitle(nxt)}${nxt.teacher ? ` (${nxt.teacher})` : ''}`;
    const timing = resolved.minutesUntilNext <= 60
      ? `in ${resolved.minutesUntilNext} min (${formatTime(nxt.start)}–${formatTime(nxt.end)})`
      : `Starts at ${formatTime(nxt.start)} (${formatTime(nxt.start)}–${formatTime(nxt.end)})`;
    mainRow.append(
      makeBadge('NEXT', false),
      document.createTextNode(`${title} · ${timing}`),
    );
    strip.appendChild(mainRow);
  } else {
    mainRow.textContent = resolved.next
      ? `No more classes today · Next: ${DAY_SHORT[resolved.next.day]} ${formatTime(resolved.next.start)} — ${slotShortTitle(resolved.next)}`
      : 'No more classes today';
    strip.appendChild(mainRow);
  }

  return strip;
}

function renderWeekGridView(sched, resolved, cat) {
  const { buildWeekGrid, formatTime } = deps;
  const gridData = buildWeekGrid(sched);
  const wrap = document.createElement('div');
  wrap.className = 'sched-grid-wrap' + (fullWeekOnPhone ? ' is-phone-full' : '');

  if (!gridData.rows.length) return wrap;

  const grid = document.createElement('div');
  grid.className = 'sched-grid';
  grid.setAttribute('role', 'region');
  grid.setAttribute('aria-label', 'Weekly class schedule');

  const headers = ['Time', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  headers.forEach((label, idx) => {
    const th = document.createElement('div');
    th.className = 'sched-head' + (idx === 0 ? ' is-time-col' : '');
    th.style.gridColumn = String(idx + 1);
    th.style.gridRow = '1';
    th.textContent = label;
    grid.appendChild(th);
  });

  gridData.rows.forEach((row) => {
    const tm = document.createElement('div');
    tm.className = 'sched-time';
    tm.style.gridColumn = '1';
    tm.style.gridRow = String(row.index + 2);
    tm.textContent = `${formatTime(row.start)}–${formatTime(row.end)}`;
    grid.appendChild(tm);
  });

  gridData.emptyCells.forEach((cell) => {
    const empty = document.createElement('div');
    empty.className = 'sched-cell is-empty';
    empty.style.gridColumn = String(cell.col);
    empty.style.gridRow = `${cell.rowStart} / ${cell.rowEnd}`;
    empty.setAttribute('aria-hidden', 'true');
    grid.appendChild(empty);
  });

  gridData.cells.forEach((cell) => {
    const { slot } = cell;
    const isNow = isSameSlot(slot, resolved.current);
    const box = document.createElement('div');
    box.className = 'sched-cell'
      + (slot.kind === 'subject' ? ' is-subject' : ' is-neutral')
      + (isNow ? ' is-now' : '');
    box.style.gridColumn = String(cell.col);
    box.style.gridRow = `${cell.rowStart} / ${cell.rowEnd}`;
    box.dataset.day = String(slot.day);
    box.dataset.start = slot.start;
    box.dataset.end = slot.end;
    box.dataset.rowSpan = String(cell.rowSpan);

    if (slot.kind === 'subject') {
      const def = subjectFor(cat, slot.subject);
      if (def && def.color) {
        box.style.backgroundColor = def.color;
        box.style.color = subjectTextColor(def.color);
      }
    }

    const code = document.createElement('strong');
    code.className = 'sched-cell-title';
    code.textContent = slotShortTitle(slot);
    box.appendChild(code);

    const subText = slot.teacher || (slot.kind !== 'subject' ? `${formatTime(slot.start)}–${formatTime(slot.end)}` : '');
    if (subText) {
      const meta = document.createElement('span');
      meta.className = 'sched-cell-meta';
      meta.textContent = subText;
      box.appendChild(meta);
    }

    const a11y = [DAY_FULL[slot.day], `${formatTime(slot.start)} to ${formatTime(slot.end)}`, slotAccessibleTitle(slot, cat), slot.teacher].filter(Boolean).join(', ');
    box.setAttribute('aria-label', isNow ? `Now: ${a11y}` : a11y);
    grid.appendChild(box);
  });

  wrap.appendChild(grid);
  return wrap;
}

function renderPhoneControls(sched, resolved, cat) {
  const { formatTime } = deps;
  const frag = document.createDocumentFragment();

  const bar = document.createElement('div');
  bar.className = 'sched-phone-bar';

  const pills = document.createElement('div');
  pills.className = 'sched-day-pills';
  pills.setAttribute('role', 'group');
  pills.setAttribute('aria-label', 'Schedule day');

  for (let d = 1; d <= 5; d++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sched-day-pill' + (selectedDay === d && !fullWeekOnPhone ? ' is-active' : '');
    btn.dataset.schedPhoneDay = String(d);
    btn.textContent = DAY_SHORT[d];
    btn.setAttribute('aria-pressed', String(selectedDay === d && !fullWeekOnPhone));
    btn.addEventListener('click', () => {
      selectedDay = d;
      fullWeekOnPhone = false;
      render();
      dom.calSchedule?.querySelector(`.sched-day-pill[data-sched-phone-day="${d}"]`)?.focus();
    });
    pills.appendChild(btn);
  }

  const fullBtn = document.createElement('button');
  fullBtn.type = 'button';
  fullBtn.className = 'secondary-button sched-fullweek-btn';
  fullBtn.textContent = 'Full week';
  fullBtn.setAttribute('aria-pressed', String(fullWeekOnPhone));
  fullBtn.addEventListener('click', () => {
    fullWeekOnPhone = !fullWeekOnPhone;
    render();
    dom.calSchedule?.querySelector('.sched-fullweek-btn')?.focus();
  });

  bar.append(pills, fullBtn);
  frag.appendChild(bar);

  if (!fullWeekOnPhone) {
    const list = document.createElement('div');
    list.className = 'sched-day-list';
    const daySlots = sched.slots
      .filter((s) => s.day === selectedDay)
      .slice()
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

    if (!daySlots.length) {
      const empty = document.createElement('p');
      empty.className = 'list-empty';
      empty.textContent = `No classes scheduled for ${DAY_FULL[selectedDay]}.`;
      list.appendChild(empty);
    } else {
      daySlots.forEach((slot) => {
        const isNow = isSameSlot(slot, resolved.current);
        const card = document.createElement('div');
        card.className = 'sched-day-card' + (isNow ? ' is-now' : '');

        const tm = document.createElement('span');
        tm.className = 'sched-day-time';
        tm.textContent = `${formatTime(slot.start)}–${formatTime(slot.end)}`;
        card.appendChild(tm);

        const body = document.createElement('div');
        body.className = 'sched-day-info';
        if (slot.kind === 'subject') {
          const def = subjectFor(cat, slot.subject);
          const tag = document.createElement('span');
          tag.className = 'subject-tag';
          tag.textContent = slot.subject;
          if (def && def.color) {
            tag.style.setProperty('--tag', def.color);
            tag.style.setProperty('--tag-ink', subjectTextColor(def.color));
          }
          body.appendChild(tag);
          const fullName = subjectDisplayName(cat, slot.subject);
          if (fullName && fullName !== slot.subject) {
            const nameEl = document.createElement('span');
            nameEl.className = 'sched-day-name';
            nameEl.textContent = fullName;
            body.appendChild(nameEl);
          }
        } else {
          const lbl = document.createElement('span');
          lbl.className = 'sched-day-label';
          lbl.textContent = slot.label;
          body.appendChild(lbl);
        }
        if (slot.teacher) {
          const teacher = document.createElement('span');
          teacher.className = 'sched-day-teacher';
          teacher.textContent = slot.teacher;
          body.appendChild(teacher);
        }
        card.appendChild(body);
        list.appendChild(card);
      });
    }
    frag.appendChild(list);
  }

  return frag;
}

export function render() {
  const host = dom.calSchedule;
  if (!host || !deps) return;
  if (host.hidden) {
    stopTimer();
    return;
  }

  const sched = activeSchedule();
  const cat = activeCatalog();
  const now = currentNow();
  if (selectedDay === null) {
    const d = now.getDay();
    selectedDay = d >= 1 && d <= 5 ? d : 1;
  }

  host.replaceChildren();
  const metaLine = sched ? buildMetaLine(sched) : '';
  if (metaLine) {
    const metaEl = document.createElement('p');
    metaEl.className = 'sched-meta';
    metaEl.textContent = metaLine;
    host.appendChild(metaEl);
  }

  if (!sched || !Array.isArray(sched.slots) || !sched.slots.length) {
    stopTimer();
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = state.isAdmin && !state.previewing && state.draftSchedule
      ? 'No class schedule published yet. Use Preview or Publish to view your draft schedule.'
      : 'No class schedule has been posted yet.';
    host.appendChild(empty);
    return;
  }

  startTimer();
  const resolved = deps.resolveCurrentSlot(sched, now);
  host.appendChild(renderNowStrip(sched, resolved, cat));
  host.appendChild(renderPhoneControls(sched, resolved, cat));
  host.appendChild(renderWeekGridView(sched, resolved, cat));
}
