# 7. Deletion authority, the private recycle bin and the migration boundary

**Status.** Shipped in code and covered by the PHP sandbox suite. Activation on a live install additionally requires the operator steps at the end of this file.

**Decision.** A publish is authorised by a public revision, not by how many tasks it contains. Deleting a task is a two-step, archive-first operation. Permanent deletion is an explicit, confirmed act that leaves one id/time marker and never reuses the identity.

## Public board, schema 2

`data/current.json`:

```
{schemaVersion: 2, revision, operationId, publishedAt,
 tasks: [...], announcements: [...], subjects: [...],
 deletedTasks: [{id, deletedAt}]}
```

- `revision` is server-owned and increases by exactly one per successful publish or marker-only permanent deletion. It is what a client must match to publish, so a stale write is refused even when the task count is unchanged.
- `operationId` identifies the last commit. A retried transport request that repeats the same id and the same body is a replay and returns the recorded result; the same id with a different body is a conflict.
- `deletedTasks` is the complete, grow-only set of permanently deleted *previously published* ids. It is never accepted from a client, never truncated by a publish, and never pruned with history. A live task may never reuse a marked id.

## Private state, schema 1

`data/admin/state.json` holds the named presets, the recycle bin, never-published identity reservations and the last operation receipt. It is runtime-only, denied by nginx, and never embedded in HTML.

A bin record keeps the full task definition plus its subject definition, its source (`draft-delete` or `publish-removal`), an `archiveKey` (content hash, so a retry reuses the record instead of duplicating it) and `everPublished`, which is proved by the server from the live board or an existing proven record and can only upgrade to true.

## Ordering, not a multi-file transaction

A publish runs under the one lock every writer and admin reader takes:

1. resolve any recorded pending operation;
2. archive every removed live definition (with `everPublished: true`) and save that private state;
3. write `data/admin/pending.json`;
4. write the public snapshot by temp-and-rename;
5. **rename the new `current.json` - this is the only point at which the publish becomes visible**;
6. write the final private state and delete the pending record;
7. apply ordinary history retention (best effort).

A failure before step 5 leaves the old board byte-identical, removes the provisional snapshot and tells the caller nothing changed. A failure after step 5 returns `committed_recovery_pending`: the board *is* live, the private half is finished by the next authenticated request, and retrying would duplicate work.

## Identity rules

- Deleting a draft archives it first; a failed archive means the task is not deleted.
- Restoring is non-consuming: the server keeps its copy, and the draft stays private until Publish. A device's own progress for that id therefore reappears unchanged.
- Permanent deletion is refused while the id is live. For a previously published id it adds one marker and removes only the selected record; history, snapshots and uploads are untouched. For a never-published id it reserves the id privately, with no public marker.
- Any later recovery of a permanently deleted identity is a labelled new copy with a new id and no inherited progress.

## Migration, once, with a backup

```
php api/migrate-subjects.php --check --seed data/admin/subjects-seed.json --backup-dir data/admin/backups/pre-subjects
php api/migrate-subjects.php --apply --seed data/admin/subjects-seed.json --backup-dir data/admin/backups/pre-subjects
php api/migrate-subjects.php --recover
```

- `--check` validates the seed, the board, snapshots and every task id, then prints counts only and writes nothing.
- `--apply` revalidates under the lock, writes and verifies a coherent backup (board, snapshots, private state), then initialises once: schema 2, revision 1, an initial-configuration preset, and every task id, definition and stamp preserved. An already initialised installation is reported and never replaced.
- `--recover` resolves an interrupted operation under the lock. It never restores an old backup over newer authority.
- A backup directory outside the protected `data/` tree is refused, and an invalid seed aborts without changing anything.

## Operator prereqs before activation

1. Quiesce admin writes; keep students reading. Take a coherent private backup of the board, versions and any admin state, and export each admin device's draft, checkpoints and progress separately - the server cannot back those up.
2. Provide the real subject seed privately (never in git). A new empty install may deliberately copy `subjects.example.json`.
3. Run `--check`, then `--apply`.
4. Confirm the deployment's `data/` is genuinely persistent across a redeploy, and that `data/admin/` is not reachable over HTTP.
5. Require admins and returning clients to refresh: a pre-schema publish is answered `refresh_required`, and an already-open old client can still apply its obsolete local pruning to its own progress. That status cannot be recovered if it is erased.

**Cost.** Two revisions must be tracked (public and private) instead of one, `data/admin/` holds real content and needs the same care as `data/versions/`, and the marker list grows forever - it is never echoed back in a publish or a transfer, so its growth cannot exhaust those bodies, but storage monitoring remains an operator concern.

## Independent review, and what it changed

A read-only review by a separate model (Cheap Agent research worker, not the author) found three
gaps that the test suite did not catch, all now fixed:

1. **Authority from a failed response.** A refused publish stored the 409 body's `current` board and
   the review step adopted it directly, so a non-success body with plausible markers could have
   become deletion authority. The step now re-reads the board with a fresh successful request and
   adopts only that; `acceptAuthority` is never called with a failure body.
2. **Status Undo ignored a later marker.** `restoreProgress` wrote the captured entry back with no
   check, so a deletion proved after the toast appeared could be undone. It now re-checks
   `mustRecoverAsNewId` at click time and refuses.
3. **Restore bypassed the labelled-copy rule.** `restoreDraft` rebuilt the draft verbatim, so a
   checkpoint, history version, transfer or Undo could reintroduce a permanently deleted id as
   itself. It now runs `prepareRecoveredDraft`, so such a task returns as a labelled new copy with no
   inherited progress, and says so.

Exercising the discard path in a browser also exposed a missing dependency (`archive` never reached
`publish.init`), which threw on the first draft-only replacement. It is wired now, and the restore
fails closed with a message if the recycle bin is unavailable instead of throwing.

The review was not a human or Codex reviewer: treat it as a second model's inspection, not a sign-off.
