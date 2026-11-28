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

function formatGridTime(hhmm) {
  const [hRaw, mRaw] = String(hhmm || '').split(':');
  const h24 = Number(hRaw);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mRaw}`;
}

function slotDisplayTitle(slot, cat) {
  if (!slot) return '';
  if (slot.kind !== 'subject') return slot.label || '';
  return subjectDisplayName(cat, slot.subject) || slot.subject || '';
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
    const title = slotDisplayTitle(cur, cat);
    mainRow.append(
      makeBadge('NOW', true),
      document.createTextNode(`${formatTime(cur.start)}–${formatTime(cur.end)} ${title} · ${resolved.minutesLeft} min left`),
    );
    strip.appendChild(mainRow);

    const subRow = document.createElement('p');
    subRow.className = 'sched-now-sub';
    if (resolved.next) {
      const nxt = resolved.next;
      const nxtText = slotDisplayTitle(nxt, cat);
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
    const title = slotDisplayTitle(nxt, cat);
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
      ? `No more classes today · Next: ${DAY_SHORT[resolved.next.day]} ${formatTime(resolved.next.start)} — ${slotDisplayTitle(resolved.next, cat)}`
      : 'No more classes today';
    strip.appendChild(mainRow);
  }

  return strip;
}

function renderWeekGridView(gridData, resolved, cat) {
  const { formatTime } = deps;
  const wrap = document.createElement('div');
  wrap.className = 'sched-grid-wrap' + (fullWeekOnPhone ? ' is-phone-full' : '');

  if (!gridData.rows.length) return wrap;

  const grid = document.createElement('div');
  grid.className = 'sched-grid';
  grid.setAttribute('role', 'region');
  grid.setAttribute('aria-label', 'Weekly class schedule');

  const headers = ['Time', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
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
    tm.textContent = `${formatGridTime(row.start)} – ${formatGridTime(row.end)}`;
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

    const titleText = slotDisplayTitle(slot, cat);
    const titleEl = document.createElement('strong');
    titleEl.className = 'sched-cell-title';
    titleEl.textContent = titleText;
    box.appendChild(titleEl);

    const a11y = [DAY_FULL[slot.day], `${formatTime(slot.start)} to ${formatTime(slot.end)}`, titleText].filter(Boolean).join(', ');
    box.setAttribute('aria-label', isNow ? `Now: ${a11y}` : a11y);
    grid.appendChild(box);
  });

  const footerRow = gridData.rows.length + 2;
  const footLbl = document.createElement('div');
  footLbl.className = 'sched-foot is-time-col';
  footLbl.style.gridColumn = '1';
  footLbl.style.gridRow = String(footerRow);
  footLbl.textContent = 'Official Time';
  grid.appendChild(footLbl);

  (gridData.officialTime || []).forEach((ot) => {
    const cell = document.createElement('div');
    cell.className = 'sched-foot';
    cell.dataset.officialDay = String(ot.day);
    cell.style.gridColumn = String(ot.day + 1);
    cell.style.gridRow = String(footerRow);
    if (ot.start && ot.end) {
      cell.textContent = `${formatGridTime(ot.start)} – ${formatGridTime(ot.end)}`;
      cell.setAttribute('aria-label', `${DAY_FULL[ot.day]} official time: ${formatTime(ot.start)} to ${formatTime(ot.end)}`);
    } else {
      cell.textContent = '—';
      cell.setAttribute('aria-label', `${DAY_FULL[ot.day]}: no scheduled classes`);
    }
    grid.appendChild(cell);
  });

  wrap.appendChild(grid);
  return wrap;
}

function renderPhoneControls(sched, resolved, cat, officialTime) {
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
          const chip = document.createElement('span');
          chip.className = 'subject-tag';
          chip.textContent = slot.subject;
          if (def && def.color) {
            chip.style.setProperty('--tag', def.color);
            chip.style.setProperty('--tag-ink', subjectTextColor(def.color));
          }
          body.appendChild(chip);
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
        card.appendChild(body);
        list.appendChild(card);
      });
      const dayOt = (officialTime || []).find((o) => o.day === selectedDay);
      if (dayOt && dayOt.start && dayOt.end) {
        const otRow = document.createElement('p');
        otRow.className = 'sched-day-official';
        otRow.textContent = `Official time: ${formatGridTime(dayOt.start)} – ${formatGridTime(dayOt.end)}`;
        otRow.setAttribute('aria-label', `${DAY_FULL[selectedDay]} official time: ${formatTime(dayOt.start)} to ${formatTime(dayOt.end)}`);
        list.appendChild(otRow);
      }
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
  const gridData = deps.buildWeekGrid(sched);
  host.appendChild(renderNowStrip(sched, resolved, cat));
  host.appendChild(renderPhoneControls(sched, resolved, cat, gridData.officialTime));
  host.appendChild(renderWeekGridView(gridData, resolved, cat));
}
