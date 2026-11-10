/**
 * js/bin.js - the admin recycle bin.
 *
 * Server-owned and private: every read and action is an authenticated no-store request, and the
 * list survives a reload, a restart and the device's own draft/history retention.
 *
 * Deliberate safety rules:
 *   - Restoring is non-consuming: the server keeps its copy, and the draft is private until Publish.
 *   - Restoring an id that is permanently deleted produces a *labelled new copy*, never the old
 *     identity, and never carries the old device progress.
 *   - Restoring onto an existing draft id asks for an explicit replace and archives the displaced
 *     content first; nothing is overwritten silently.
 *   - Permanent deletion is armed before it acts, and its public effect is one id/time marker.
 */

import { state } from './state.js';
import { dom } from './dom.js';
import { API } from './util.js';
import { RECOVERED_PREFIX } from './recovery.js';

let deps = null;
let rows = [];
let armed = null;          // { binId, action } - one armed row at a time
let busy = false;

export function init(d) {
  deps = d;
  dom.binRefresh.addEventListener('click', () => { load(); });
  dom.binList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-bin-action]');
    if (!btn) return;
    onAction(btn.dataset.binAction, btn.dataset.binId, btn);
  });
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function say(message) {
  dom.binStatus.textContent = message;
}

const label = (r) => `${r.subject ? r.subject + ' · ' : ''}${r.title || r.taskId}`;

export async function load() {
  if (!state.isAdmin) return;
  say('Loading…');
  try {
    const res = await fetch(`${API.versions}?view=admin`, { cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error('unavailable');
    if (typeof data.adminRevision === 'number') state.adminRevision = data.adminRevision;
    rows = Array.isArray(data.binSummaries) ? data.binSummaries : [];
    render(data);
  } catch (e) {
    say('The recycle bin cannot be loaded right now.');
  }
}

function render(data) {
  dom.binList.textContent = '';
  armed = null;
  if (!rows.length) {
    say('Nothing in the recycle bin.');
  } else {
    say(`${rows.length} saved ${rows.length === 1 ? 'task' : 'tasks'}. A restored task goes into your draft; students see it only after you publish.`);
  }
  const reserved = new Set((data && Array.isArray(data.retiredDraftIds) ? data.retiredDraftIds : []).map((r) => r && r.id).filter(Boolean));
  for (const row of rows) {
    const li = el('li', 'history-item');
    const head = el('div', 'history-head');
    head.appendChild(el('span', 'history-label', label(row)));
    const detail = el('p', 'history-detail',
      `${row.everPublished ? 'Was published' : 'Never published'} · ${row.source === 'draft-delete' ? 'deleted draft' : 'removed from the board'}`);
    const actions = el('div', 'history-bar');
    const restore = el('button', 'secondary-button', 'Restore');
    restore.type = 'button';
    restore.dataset.binAction = 'restore';
    restore.dataset.binId = row.binId;
    restore.setAttribute('aria-label', `Restore ${row.title || row.taskId} into the draft`);
    const remove = el('button', 'text-button', 'Delete permanently');
    remove.type = 'button';
    remove.dataset.binAction = 'delete';
    remove.dataset.binId = row.binId;
    remove.setAttribute('aria-label', `Delete ${row.title || row.taskId} permanently`);
    // A reserved identity cannot come back as itself; say so before the click, not after.
    if (reserved.has(row.taskId)) {
      const note = el('span', 'history-label', 'Comes back as a new copy');
      head.appendChild(note);
    }
    actions.append(restore, remove);
    head.appendChild(detail);
    li.append(head, actions);
    dom.binList.appendChild(li);
  }
}

async function onAction(action, binId, btn) {
  if (busy) return;
  if (armed && (armed.binId !== binId || armed.action !== action)) { armed = null; render({}); }
  if (action === 'restore') return restore(binId, btn);
  if (action === 'delete') {
    if (!armed || armed.binId !== binId) {
      armed = { binId, action };
      btn.textContent = 'Delete permanently?';
      say('Press again to delete this copy for good. Its id is never reused.');
      btn.focus();
      return;
    }
    return permanentDelete(binId, btn);
  }
}

async function restore(binId, btn) {
  busy = true;
  try {
    const out = await deps.adminAction('bin-restore', { binId });
    if (!out.ok) { say(out.status === 404 ? 'That copy is no longer in the recycle bin.' : 'Could not load that copy.'); return; }
    const record = out.data || {};
    let task = record.task;
    const subjects = Array.isArray(record.subjects) ? record.subjects : [];
    if (!task || typeof task.id !== 'string') { say('That copy is unreadable.'); return; }

    if (record.requiresNewId) {
      task = { ...task, id: deps.newId(), title: RECOVERED_PREFIX + String(task.title || task.id).slice(0, 500 - RECOVERED_PREFIX.length) };
      delete task.closedAt;
      delete task.changedAt;
      say('Restored as a new copy: the original id was permanently deleted, so its old progress does not carry over.');
    }

    const collision = deps.myTasks.find((t) => String(t.id) === String(task.id));
    if (collision) {
      if (!armed || armed.binId !== binId) {
        armed = { binId, action: 'restore' };
        btn.textContent = 'Replace draft task?';
        btn.focus();
        say('A draft task already uses this id. Press again to replace it; the current draft version is archived first.');
        return;
      }
      const archived = await deps.archive(collision);
      if (!archived.ok) { say('Could not archive the draft task, so nothing was replaced.'); return; }
      const at = deps.myTasks.indexOf(collision);
      if (at !== -1) deps.myTasks.splice(at, 1);
    }

    deps.myTasks.push(deps.Task.fromJSON(task));
    if (!deps.saveTasks()) { say('Restored in memory, but this device would not save it.'); return; }
    deps.renderAllTasks();
    armed = null;
    await load();
    if (subjects.length === 0) say('Restored into your draft. Publish to show it to the class.');
    btn.focus();
  } catch (e) {
    say('Cannot reach the server right now; the copy is still in the recycle bin.');
  } finally {
    busy = false;
  }
}

async function permanentDelete(binId, btn) {
  busy = true;
  try {
    const out = await deps.adminAction('bin-permanent-delete', {
      binId,
      confirm: 'DELETE PERMANENTLY',
      baseRevision: state.verifiedRevision,
    });
    if (!out.ok) {
      say(out.code === 'still_published'
        ? 'That task is still on the class board. Publish without it first.'
        : out.code === 'stale_base'
          ? 'The board changed since this page loaded. Reload before deleting permanently.'
          : 'Could not delete that copy.');
      render({});
      return;
    }
    const board = out.data && out.data.current;
    if (board && deps.acceptAuthority) deps.acceptAuthority(board);
    await load();
    say('Deleted for good. The id stays reserved, and uploaded files or older history copies are untouched.');
    dom.binRefresh.focus();
  } catch (e) {
    say('Cannot reach the server right now; nothing was deleted.');
  } finally {
    busy = false;
  }
}
