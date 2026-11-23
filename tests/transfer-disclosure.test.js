import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = undefined;
globalThis.window = undefined;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { state } = await import('../js/state.js');
const {
  MAX_DRAFT_TRANSFER_BYTES,
  prepareTransferPayload,
  buildTransferPayload,
} = await import('../js/transfer.js');

test('prepareTransferPayload excludes admin draft by default and requires explicit opt-in', () => {
  const sampleDraft = { schemaVersion: 2, tasks: [{ id: 't1', title: 'Draft task' }], announcements: [], subjects: [] };
  const byDefault = prepareTransferPayload({
    activeSection: 'a',
    progressData: { t1: { status: 'done', movedAt: 100 } },
    draft: sampleDraft,
    isAdmin: true,
    includeDraft: false,
  });
  assert.equal(byDefault.ok, true);
  assert.equal(byDefault.draftIncluded, false);
  assert.equal(byDefault.payload.draft, undefined);

  const optedIn = prepareTransferPayload({
    activeSection: 'b',
    progressData: { t1: { status: 'done', movedAt: 100 } },
    draft: sampleDraft,
    isAdmin: true,
    includeDraft: true,
  });
  assert.equal(optedIn.ok, true);
  assert.equal(optedIn.draftIncluded, true);
  assert.equal(optedIn.payload.section, 'b');
  assert.deepEqual(optedIn.payload.draft, sampleDraft);

  const nonAdmin = prepareTransferPayload({
    activeSection: 'a',
    progressData: {},
    draft: sampleDraft,
    isAdmin: false,
    includeDraft: true,
  });
  assert.equal(nonAdmin.ok, true);
  assert.equal(nonAdmin.draftIncluded, false);
  assert.equal(nonAdmin.payload.draft, undefined);
});

test('prepareTransferPayload explicitly refuses opted-in drafts at or above 700 KB instead of silently omitting them', () => {
  const hugeDraft = {
    schemaVersion: 2,
    tasks: [{ id: 't1', title: 'Big notes', notes: 'x'.repeat(MAX_DRAFT_TRANSFER_BYTES) }],
    announcements: [],
    subjects: [],
  };
  const refused = prepareTransferPayload({
    activeSection: 'a',
    progressData: { t1: { status: 'in_progress', movedAt: 50 } },
    draft: hugeDraft,
    isAdmin: true,
    includeDraft: true,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.payload, undefined);
  assert.equal(refused.draftIncluded, false);
  assert.ok(refused.draftBytes >= MAX_DRAFT_TRANSFER_BYTES);
  assert.match(refused.error, /too large/i);
  assert.match(refused.error, /limit is/i);

  const prevAdmin = state.isAdmin;
  const prevProgress = state.progress;
  try {
    state.isAdmin = true;
    state.progress = { a1: { status: 'done', movedAt: 1 } };
    const defaultBuild = buildTransferPayload('a');
    assert.equal(defaultBuild.section, 'a');
    assert.equal(defaultBuild.draft, undefined);
  } finally {
    state.isAdmin = prevAdmin;
    state.progress = prevProgress;
  }
});
