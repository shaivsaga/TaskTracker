---
name: verify-board-sync
description: Formally verify TaskTracker's Board publish, crash recovery, stale-base conflict, and deletion-authority protocol using TLC (TLA+) and real PHP+JS trace replay. Use whenever changing publish, crash recovery, optimistic revision checks, deletion markers, or recycle-bin permanent delete.
---

# Verify Board Sync Protocol

TaskTracker promises that no stale admin overwrites a newer board, no crash mid-publish leaves an unrecoverable split state, retrying an interrupted publish replays cleanly, and no permanently deleted task identity comes back or erases unverified student progress.

## Coverage record

Check whether your diff touches any of these files or functions. If it does, run this verification before finishing.

- `api/_board.php`: `tt_commit_board`, `tt_recover_pending`, `tt_receipt`, `tt_board_lock`
- `api/publish.php`: revision guard (`stale_base`), `operationId` receipt gate, forbidden-identity gate
- `api/versions.php`: `bin-permanent-delete`, `bin-restore`
- `js/store.js`: `fetchBoard`, `acceptAuthority`, `applyDeletionAuthority`, `adoptAuthoritativeBoard`, `replaceDraft`
- `js/publish.js`: `createPublishIntent`, `#publish-form` submit, `#publish-rebase`
- `js/recovery.js`: `nextAuthority`, `filterDeletedProgress`, `prepareRecoveredDraft`

Last confirmed in sync at commit: `667c455` (move this forward only after confirming `tests/formal/BoardSync.tla` still describes the code at the new commit).

## Properties verified

1. `NoDeletedResurrection`. A permanently deleted task id never reappears on `data/current.json`.
2. `NoUnverifiedProgressErase`. Student device progress is erased only for task ids the server proved deleted.
3. `ClientRejectsDroppedMarker`. `js/recovery.js` `nextAuthority()` refuses any board missing a previously proven deletion marker.
4. `IdempotentPostCommitRetry`. Retrying the same publish intent after a `committed_recovery_pending` crash reuses `operationId` and replays the server receipt without a false `stale_base` conflict.
5. `NoStaleOverwrite`. An admin whose `baseRevision` trails `current.json` never overwrites the newer board without rebasing.

## Bounds and assumptions

- `Tasks = {t1, t2}`, `Admins = {a1, a2}`, `MaxRev = 3`, up to 4 operation ids (`155,917` states generated, `39,662` distinct states, depth 18).
- Assumes single-host atomic `rename()` and `flock()` under `data/.publish.lock`.
- Does not model multi-section routing, upload garbage collection, or browser localStorage quota exhaustion.

## Run the check

1. Run the TLA+ model checker (uses Java if installed, otherwise Docker `eclipse-temurin:21-jre-alpine`, with SHA-256 pinned `tla2tools.jar` v1.8.0):

```sh
bash tests/formal/run-tlc.sh BoardSync.cfg
```

2. Run the real PHP + JS trace replay suite:

```sh
REQUIRE_PHP=1 node --test tests/board-sync-replay.test.js
```

3. Read every TLC result and visualize counterexamples or state transitions with the pstack `/statechart` skill.

## Real bug vs modeling error

1. If TLC fails, read the shortest counterexample trace through `/statechart`.
2. Replay the exact step sequence against the real code in `tests/board-sync-replay.test.js`.
3. If the real code reproduces the failure, it is a real product bug. Fix the product code, never weaken the invariant.
4. If the real code prevents the step because of an intentional protocol change, update `tests/formal/BoardSync.tla`, verify all three negative controls (`BugDropMarkerCheck`, `BugFreshOpOnRetry`, `BugSkipBaseCheck`) still fail, and advance the sync commit above.
