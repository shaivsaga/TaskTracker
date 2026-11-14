# TaskTracker subjects, recovery and notice implementation plan

> **For agentic workers:** Read `.plan/pr40-41-source.md` first. Execute task-by-task using the existing authorized implementation workflow, with behavioral red/green checks and review. This revision is a planning deliverable only: it does not authorize resuming implementation in this pass.

**Goal:** Finish the approved notice, subject-catalog/preset and persistent recycle-bin behavior without expanding product scope.

**Architecture:** Keep vanilla JS, PHP, JSON files, the existing endpoints, the public `data/current.json` board, local admin drafts and device-local progress. Add one private admin-state file and a narrowly scoped pending-operation record for recoverable public/private writes; do not introduce a database or general transaction framework.

**Tech Stack:** Existing browser APIs, Node test/CDP harness, PHP file locking and same-directory rename; no new dependencies.

**Spec:** `.plan/pr40-41-source.md` (approved product decisions; this document resolves implementation details, not feature scope).

## Global constraints

- Work only in `C:/xampp/tt-overnight/wt/roadmap-inspection`; no feature implementation during this planning pass. Later implementation still has no commit, merge, push or deployment authorization.
- Preserve the existing README edits removing CSV/charts and adding future multi-section support. Do not rewrite history or existing public artifacts.
- No multi-section system, personal to-dos, timetable, upload deletion, CSV/charts, framework, bundler or dependency additions.
- No secret or production/student/runtime-data inspection or mutation. Migration operations below are an operator runbook, exercised only with synthetic sandboxes during development.
- Narrow approved API/PHP, draft, transfer and board-contract changes are in scope. Keep the existing API route surface; no nginx change is needed for the selected design. Preserve headers, CSP inline-script bytes, five asset stamps, module caching and line endings.
- Do not change device progress keys or entry shape. Extend the draft envelope, not task identity or personal progress. No server-side student progress store beyond the already-existing expiring opt-in Transfer mechanism.
- No private presets/bin records in public board snapshots or Transfer. Published subject definitions necessarily are public.
- No automatic bin expiry. Permanent deletion removes the selected bin record and reserves its identity; it does not scrub history, checkpoints, uploads or other copies.
- Tests below are proposed acceptance criteria, NOT claims that the features already work. Existing passing checks do not establish unimplemented guarantees.

## Review focus

1. Same-count stale publishes and marker rollback: revisions, not task count or timestamp, decide conflicts (P2, V02).
2. Interruption between archiving, snapshot, public rename and private finalization: only the public rename commits visibility (P2, V03).
3. Delayed Undo/import after a newer permanent deletion: re-check latest verified authority at execution, never restore a captured marker set (P3/P5, V06).
4. Empty live boards versus 404/cache/offline responses: only a validated successful authoritative board may authorize cleanup (P3, V07).
5. Catalog-only edits and old metadata-free snapshots/transfers: keep identity, preserve catalog and never import revision/deletion authority (P4/P5, V09).

---

## 1. Verdict and evidence ledger

The former four-step plan correctly retained draft/Publish separation, stable subject codes, private persistent presets/bin, ID-only published deletion authority, same-ID bin restore, new-ID historical recovery, generic examples and the approved exclusions. Its material gaps were executable schemas, revision ownership, all replacement/Undo paths, multi-file failure ordering, published-ID provenance, migration activation and genuinely independent runtime proof.

Evidence inspected at worktree HEAD `1d842c70e3a69597be24ec0b57d99d470b6a4c93`:

- Graph-first query located `loadPublished`, `deleteTask`, publish and calendar consumers. Shared graph provenance was `2026-11-09T13:05:34Z d7d4cb49… C:/xampp/tt-overnight/wt/class-filters`, NOT this worktree. Graph line numbers are navigation hints only; all references below were verified in actual target source. No shared graph refresh was performed.
- `app.js:80-97,162-188`: normalization accepts a task array, 404 fabricates an empty board, cache fallback clears `liveBoard`, and cleanup happens after an early return for an open task. `app.js:102-112` misses legacy zero-to-positive notice changes.
- `js/tasks.js:167-206,285-295`: save returns no success status; draft load rebuilds only tasks/announcements; pruning deletes progress for absent IDs; delete removes locally before any server archive. Shared delete callers include cards, rows, Past and dialog (`247,425,612,1286`). Status Undo is separate (`439-446`); cover it too.
- `js/publish.js:67-108,194-199,251-300,344-347`: snapshots/diff omit catalogs and base revision; history/discard Undo call the same replacement function; publish rewrites inline images before POST. Clear-board keeps live announcements in PHP and must retain that behavior.
- `api/publish.php:64-99,102-158`: lock serializes writers but there is no expected revision. Notice comparison excludes title/notes, uses seconds and can repeat the same stamp. Snapshot is written first, public rename second, pruning third. A crash can leave a snapshot not reflected live. This is NOT a multi-file atomic transaction.
- `api/versions.php:19-50`: destructive history actions share the publish lock; GET can see a partially written snapshot and skip it. Retention/clear-history cannot serve as the indefinite recycle bin or deletion authority.
- `logic.js:80-100,198-231`: task ID survives Task reconstruction, personal status is deliberately not serialized, changedAt is not a Task field; keep notice stamps on raw authoritative board data. `closedAt` is a separate persisted task field, not permanent deletion.
- `js/transfer.js:80-85,207-241,271-295` and `api/_validate.php:24-74`: both rebuild draft envelopes as tasks/announcements only; import Undo reinstates an old progress object. Client draft inclusion is silently size-limited today. `app.js:640-655` starts board and incoming-transfer loads concurrently.
- Subjects are hardcoded at `js/tasks.js:1033-1036`; dropdown is built once at `1318-1325`. Consumers: `app.js:282-285,303-348`, `js/quick-add.js:135-137,196-198`, `js/calendar.js:53-80`; palette/CSS variables are at `styles.css:317-332`. Catalog changes must invalidate calendar agenda signatures as well as rebuild selectors/render tags.
- `api/_session.php:99-114` enforces sessions; `deploy/nginx-default.conf:110-142,189-242` denies private data and non-allowlisted API paths. `.htaccess` alone does not protect nginx. Keep action routing on `versions.php`.
- `.gitignore:1-11` ignores runtime data/config. `docs/adr/0003-data-in-files.md:3-7` records prior deploy preservation, but `.github/workflows/main_tasktracker.yml:82-126` packages/deploys without an explicit persistence proof. Current live storage durability across deployment is **unverified in this planning pass**; do not turn the historical ADR statement into fresh evidence.
- PHP sandbox copies real API scripts into temp storage and seeds its own session (`tests/php/e2e_lib.php:25-64`). Requests always add an admin cookie (`75-89`); unauthenticated tests need an explicit helper option. Existing PHP checks exercise stamps, clear-board and lock refusal (`tests/php/run.php:164-170,198-246`), not crash recovery or revision CAS.
- Browser audit is real Chromium/CDP but its API routes return `200 {}` (`tests/e2e/audit.mjs:86-117`). That cannot prove persistence/authentication. Reuse the browser driver with a real isolated PHP origin for feature scenarios; keep static geometry tests separately.

Observed baseline during this review: `C:/xampp/php/php.exe tests/php/run.php` exited 0, including actual sandbox HTTP publishes/version deletes and lock refusal; `node --test tests/logic.test.js tests/audit-harness.test.js` passed 26/26. Neither proves the new contracts. Two read-only scout jobs failed before investigation with provider insufficient balance; the review was completed inline, not represented as independently reviewed.

## 2. Smallest coherent state model

### 2.1 Authoritative public board

`data/current.json`, schema 2:

```text
{schemaVersion:2, revision:int>=1, operationId:32-lowercase-hex,
 publishedAt:int epoch-seconds, tasks:TaskDefinition[],
 announcements:Announcement[], subjects:Subject[],
 deletedTasks:[{id:string, deletedAt:int epoch-seconds}]}
Subject = {code:string, name:string, color:"#rrggbb", active:boolean}
TaskDefinition = existing id/title/notes/subject/dueDate/dueTime/files/closedAt fields;
                 changedAt:int epoch-seconds is supplied only by the server.
```

- Public revision is a server-owned monotonically increasing safe integer. A successful publish OR marker-only permanent deletion increments it exactly once. It is not a snapshot filename, wall-clock time, private revision or imported value. Fail closed at JS safe-integer exhaustion rather than wrapping.
- `operationId` identifies the last public commit for interruption/retry resolution; it carries no credentials or task content. `publishedAt` changes only for Publish (marker-only operations retain it). Use revision for ordering even within the same second.
- `deletedTasks` is the complete server-owned grow-only set of **previously published** task IDs and first permanent-deletion time. No title, subject, notes or status. Incoming publish/import/history values never replace, truncate or add to it. No live task may share a marked ID.
- Task IDs already in storage remain byte-identical. New tasks/recovery use `crypto.randomUUID()` (36 safe characters); PHP generates recovery IDs with random bytes when it owns the operation. Reject duplicate task IDs. For new writes use the existing safe ASCII selector/object-key grammar with max 64 bytes and reject `__proto__`; legacy 65-100-character progress-only keys stay readable, not publishable. Check any legacy server task outside the safe write contract during migration; do not silently rename it.
- Subject code is immutable once created: 1-32 ASCII letters/digits/underscore/dot/hyphen, first character alphanumeric; reject magic object keys (`__proto__`, `prototype`, `constructor`). Preserve legacy code spelling. New UI-created codes uppercase; never normalize existing task.subject on load. Name: trimmed nonempty UTF-8, max 100 characters. Color: exactly six hex digits after `#`, normalize lowercase; boolean `active` is required. Reject duplicate codes, malformed objects and control characters. At most 300 catalog entries for writes; migration must report a larger legacy catalog rather than discard it. Never drop a referenced code; retired definitions remain displayable.
- Blank subject remains allowed. Unknown legacy/imported codes get a visible neutral retired definition (name=code, color=#c3c7d6, active=false) during explicit normalization/preview, not task reassignment. Publish requires every nonblank task code to resolve in its submitted catalog.
- Existing task limits remain 300 tasks, 100 announcements, 10 attachments/task, 500-character title, 32-byte subject, validated dates/times and upload metadata. Server ignores forged changedAt. Preserve existing supported task fields; do not opportunistically introduce lossy task whitelisting or body externalization.

### 2.2 Private persistent admin state

Runtime only: `data/admin/state.json`:

```text
{schemaVersion:1, revision:int>=1, initialized:true,
 presets:[{id:32-hex, name:string, subjects:Subject[], updatedAt:seconds}],
 bin:[{binId:32-hex, task:TaskDefinition, subjects:Subject[],
       archivedAt:seconds, source:"draft-delete"|"publish-removal",
       everPublished:boolean, archiveKey:sha256}],
 retiredDraftIds:[{id:string, deletedAt:seconds}],
 lastOperation:null|{id:32-hex, requestHash:sha256, kind:string,
                     publicRevision:int, adminRevision:int,
                     result:{presetId?:string,binId?:string,deletedBinId?:string}}}
```

- Public current board owns live catalog/markers; private state owns named presets, bin content and unpublished identity reservations. A preset is an independent reusable catalog copy, NOT the authoritative live catalog.
- Private revision increments on actual private mutations; archive-only safety writes also advance it. Under the common lock, never replace private state with a browser-supplied whole object.
- Bin stores the complete supported definition plus its relevant subject definition(s), never device status/movedAt. Distinct content for the same task ID may have distinct records so archiving a draft cannot destroy the previously published version. `archiveKey` hashes task ID + canonical definition + subject metadata; retrying the same archive reuses its record. A later server-proven publication upgrades `everPublished`, never downgrades it.
- Prove `everPublished` from current board, an existing server bin record or validated server snapshots, never from client flags/import. Migration includes retained server history provenance. If no server evidence remains, treat an archive as unpublished; do not fabricate a public cleanup marker.
- `retiredDraftIds` is a private identity reservation for permanently deleted **never-published** tasks. It is necessary to prevent reusing those identities without incorrectly authorizing student cleanup. It is not returned in the public deletion feed; it contains no task copy. Admin recovery paths consult it. Progress for such an ID is not purged by server authority.
- Preset names: trimmed 1-100 characters, unique case-insensitively; IDs stable on rename, catalog changes validated exactly as publishing. No automatic preset/bin expiration or cap that drops old records. Bound individual action bodies to the existing 4 MiB input ceiling; edits replace one preset/record, not the entire store.
- Bin restore is deliberately non-consuming: return the record to draft and retain the server safety copy, with UI text stating this. This avoids a second cross-browser transaction merely to remove the only safe copy before localStorage succeeds. Only explicit confirmed permanent deletion removes a bin record. This is an implementation choice, not a claim that Publish consumes/restores records automatically.

Runtime `data/admin/pending.json` is a single in-flight publication/permanent-deletion recovery record, not history:

```text
{schemaVersion:1, operationId, requestHash, kind,
 oldPublicRevision, oldPublicHash, targetPublicRevision, targetPublicHash,
 snapshotId:null|string, finalAdminState:AdminState}
```

Only the commit helper writes it. It contains private content and must be protected like state/backups. No generic transaction API or worker service.

### 2.3 Draft, checkpoints, cache and progress

- Keep `class_tasks_progress` exactly `id -> {status, movedAt}`; `movedAt` remains epoch **milliseconds**, with existing merge/tie behavior. Never publish or archive it. Bin restore therefore reattaches the device's existing status by the unchanged ID.
- Extend `class_tasks_draft` to `{schemaVersion:2, tasks, announcements, subjects, baseRevision:int|null}`. `null` means no confirmed publishing base: allow editing but require online reconciliation before Publish. Task/announcement content stays local until Publish. Save/load/checkpoint/history/import/discard use the same content serializer, not separate lossy envelope builders.
- Checkpoint stays `{at:epoch-ms, ...draftContent}` in newest-20 storage. Content is restorable; `baseRevision` captured in it is historical evidence, NOT authorization to write now.
- Published cache stores the full normalized public board. It permits display, not a fresh deletion decision. A validated cached schema-2 board supplies only a non-authorizing revision/marker high-water expectation: reject a network response below it or missing its markers, but do not purge from that cache. Session `verifiedBoard`/`verifiedDeletedIds` are populated only by a validated successful network schema-2 board or publish response; later valid boards may add but never remove known markers. No cache-only boot purge; legacy network boards are display-only until migration.
- Imported/snapshot base revision is never adopted. Replacing content keeps the receiving draft's existing base; if no confirmed base, leave null. Fetching a newer board does NOT silently advance an edited draft's base. On conflict show the newer board and require explicit review/rebase (existing preview/discard/restore mechanisms plus a clear confirmation), then set the base to that reviewed revision. Never silently retry stale content over a newer board.
- Task.changedAt remains separate raw public metadata; `Task.toJSON()` must not start exporting device status or trusting change stamps.
- `dueDate` is a local calendar date `YYYY-MM-DD`; dueTime `HH:mm`; not epoch/UTC conversions. Announcement `createdAt`, checkpoint `at`, closedAt and movedAt retain current millisecond conventions. publishedAt/changedAt/archivedAt/updatedAt/deletedAt use integer epoch seconds.

### 2.4 Wire boundaries

Keep `api/publish.php` and `api/versions.php`; both require `tt_require_admin()` and JSON POST for mutations.

```text
POST publish.php:
 {schemaVersion:2, operationId, baseRevision, tasks, announcements, subjects,
  note?, clearBoard?:{confirm:"CLEAR BOARD", expectedCount:int}}
 -> 200 {current:PublicBoard, adminRevision:int, operationId}

GET versions.php                              -> {versions:[...existing public snapshots...]}
GET versions.php?view=admin                   -> {adminRevision, presets,
 binSummaries:[{binId,taskId,title,subject,archivedAt,source,everPublished}],
 retiredDraftIds, currentRevision}
GET versions.php?view=bin&id=<binId>          -> {adminRevision, record}
POST versions.php action:
 {action, operationId, baseAdminRevision, ...actionFields}
 actions = preset-save {preset:{id?:...,name,subjects}}, preset-delete {presetId},
           bin-archive {task,subjects}, bin-restore {binId},
           bin-permanent-delete {binId,confirm:"DELETE PERMANENTLY",baseRevision}
 -> {operationId,adminRevision,...result}
 preset-save -> {preset}; preset-delete -> {presetId};
 bin-archive -> {binId}; bin-restore -> {task,subjects,requiresNewId:boolean};
 bin-permanent-delete -> {deletedBinId,current:PublicBoard}
```

- `bin-restore` is authenticated read/validation; still consult current public/private reservations under lock. It does not consume a record or change live state. If permanently reserved, return `requiresNewId:true`, never a permit to publish that identity.
- Keep existing `{id}`/`{all:true}` history-deletion POST forms readable; they only delete history, never bin/presets/markers. Dispatch new `action` forms before legacy parsing, reject mixed/unknown forms. History deletes and reads recover pending state under the same lock.
- Public actions ignore no authority ambiguously: reject supplied `deletedTasks` or private-state fields in schema-2 publish; server supplies markers from current. Missing schema/base/catalog on old publish gets 409 `refresh_required`, not silent metadata reset. Return structured conflict code + latest revision; leave local draft intact. Invalid data 422, malformed request 400, missing auth 401, wrong method/type 405/415, lock unavailable 503, storage failure 500.
- All private reads are no-store and authenticated, including summaries and recovery responses. Do not embed private state in HTML or boot scripts. Admin UI is not an authorization boundary. No new nginx route is needed; internal `_board.php` remains blocked by the existing API allowlist.
- Transfer keeps outer `{v:1,progress,draft?}` for compatibility; draft may carry schemaVersion:2/subjects. Both PHP and client validators explicitly preserve/validate those fields. Whitelist-strip deletion authority, private state and imported base revision; none reaches the import candidate. Legacy metadata-free drafts use receiving catalog, synthesizing retired unknown codes during preview. Old receivers will drop new metadata: advertise that updated clients are required for catalog-preserving round trips; do not claim backward fidelity.

## 3. Persistence protocol: ordered safety, not multi-file atomicity

### 3.1 Reused mechanism and commit point

Create `api/_board.php` for the shared lock/read/validate/archive/commit/recovery functions used by publish and versions. Reuse `data/.publish.lock` and its bounded 5-second fail-closed wait. Every admin-state writer, history writer/read and publish operation takes this lock and resolves pending state before proceeding. Validate all stored state; unreadable existing files are errors, never empty defaults.

Use complete-length writes to a unique same-directory temp file, flush/check close, then rename. Snapshot files are also temp+rename, not partially visible direct final-file writes. Check every prerequisite write; only post-commit best-effort history retention is allowed to fail without undoing success. Do not reuse session `tt_write()` as proof of multi-file durability.

**Single public commit point: rename of the complete new `current.json`.** Static readers see either complete old board or complete new board. Private records may be safely ahead (extra archive copies) or awaiting finalization, but must never be missing recoverable data when the public board loses tasks.

### 3.2 Publish ordering under the lock

1. Recover pending operation. Check exact replay receipt before CAS. Validate schema, baseRevision == current revision, unique IDs/catalog, forbidden identities and clear intent/count. Client request never owns deletion markers.
2. Compute removed set from server live tasks minus submitted IDs, regardless of why content changed. Merge **every** removed live definition and subject metadata into private bin, `everPublished=true`. Preserve existing draft archives, presets and reservations. Atomically save this archive-only private state **before** preparing any public replacement. Failure here returns 500 with live board unchanged; caller draft remains intact.
3. Compute server-stamped new board and its immutable public snapshot. Carry all current markers; do not copy them from historical input. Prepare final private state/receipt with archive merges and any proven-publication upgrades. Atomically write `pending.json`, then write the new public snapshot atomically. Snapshot contains public fields + note only, never private state. Keep any existing clear-board backup safety until new protocol tests prove it redundant; do not depend on ordinary history retention for bin safety.
4. Write and rename new `current.json` (revision+1, operationId). Before this rename any failure leaves old live board intact. Extra archives are harmless; provisional snapshots are not committed history and recovery removes/excludes the recorded provisional snapshot.
5. Atomically write final private state, then remove pending record, then apply normal history retention. If finalization fails after public commit, return an explicit `committed_recovery_pending` error with operationId/revision (not “nothing changed”). Block further admin mutations until recovery succeeds. Student public board is already complete; archive-only state plus pending retain all recoverable content.
6. Only return ordinary 200 once final state is persisted. Cache/save failures on the browser cannot retroactively negate a server commit; report the exact local failure, do not claim unsaved local state was saved.

### 3.3 Recovery and retry

- Before serving admin data/mutations, inspect pending under lock. If current revision/operationId/hash matches its target, the public commit happened: finish the recorded private finalization idempotently, then remove pending. Never replace newer private data: no later admin writer was allowed past pending.
- If current revision AND content hash exactly match the recorded old state, the public commit did not happen: retain archive-only safety state; remove only that operation's provisional snapshot and pending record. Failure to remove it blocks further admin operations until recovery succeeds. Do **not** roll public content forward after telling a caller a pre-commit publish failed. Safe redundant archives may remain. Legacy activation uses old revision 0 and the exact legacy-file hash (or explicit absent-file sentinel for a pristine installation).
- Any other current state/hash or invalid pending is corruption/external intervention: fail closed with a recovery error; retain files for operator recovery. Do not guess which state is newer from timestamps.
- Private-only actions (archive/preset) have a single-file commit and private revision receipt; no pending record needed. Permanent deletion uses the same public/private protocol when it adds a public marker; see below.
- Client generates one operationId per intent and holds the same body/base for transport retries. Private state stores the latest operation receipt + canonical request hash. Exact latest replay returns the existing result without another revision/archive; same token/different body is 409. Older superseded replay cannot be safely recognized indefinitely: stale base returns 409, requiring refresh, not duplicate mutation. This bounded receipt is intentionally NOT an unbounded operation-log feature.
- Lost response means **outcome unknown**, not failed. Re-fetch and retry the same operation; if superseded, display conflict/review. Never auto-generate a new ID and blindly retry a destructive intent.
- Concurrent requests: one lock orders actual writes; CAS under that lock rejects the loser when both start from the same revision. Publish merges the newest locked private store rather than a stale client copy. Private edits require baseAdminRevision; permanent deletion requires both bases.
- Marker-only permanent deletion keeps public tasks/catalog/announcements and publishedAt unchanged, increments public revision, adds marker first at public commit, then deletes the selected private bin record in finalization. Before public commit the record still exists; after it, pending still contains recovery material until finalization. Other records/history with that ID become new-ID-only recovery sources.
- For never-published bin records, permanent deletion atomically removes the selected record and adds private retiredDraftIds in the same private-state replacement; no public marker/revision is invented. It still checks current board is absent under the common lock.
- A permanent-delete request while that ID is published returns 409 with no marker, bin removal or draft alteration. Admin must remove it through a successful Publish first, then explicitly confirm deletion. A local draft is not proof of absence live.
- Process interruption and checked write/rename failures are covered by this protocol. Power-loss/storage-device durability depends on filesystem guarantees; use available flush/fsync for files, but do not claim portable directory-fsync or full storage failure atomicity. Backups remain required; validate same-directory replacement semantics on the deployment filesystem before activation.

## 4. Lifecycle transition contract

For every local transition below: compute candidate state first, apply current verified deletion filtering, persist successfully, then replace visible in-memory state/render and offer success/Undo. `saveTasks` must return boolean; no success toast after localStorage failure. Progress and draft are separate localStorage keys, not an atomic pair: persist filtered progress first, draft second; on partial failure report it, retain the before-content for retry and never restore purged marked progress to “roll back.” Server bin supplies durable task recovery where required.

### L1 Save/load and notices

- Any device reads its local progress; only a session-authorized admin edits drafts. Load legacy envelopes without changing IDs/status. Load public board/catalog for students; admin preview uses draft catalog, never published catalog mutation.
- A valid HTTP 200 board or valid successful publish response establishes deletion authority. HTTP 404, invalid/truncated JSON, revision regression, failed fetch and cache fallback allow no new cleanup. Process markers even with tasks=[] and even while a task dialog is open, before the current early return. Then apply filtered progress to all displayed task objects.
- On first visit save a quiet notice baseline. Dismissal advances baseline; pending overlay defers acknowledgement. One notice per visit. Compare raw server stamps: missing ID is new; existing zero to positive is updated; unchanged stamp is quiet. Invalid/offline loads do not acknowledge changes.
- Server comparison covers title, notes, dueDate, dueTime, subject and attachment id/name/size. Normalize absent/null optional empty values and CRLF to LF; compare attachment metadata canonically so request object-key order or attachment-list reorder alone is not an edit. Notes formatting changes are meaningful; do not introduce an HTML equivalence engine. Ignore status, changedAt and private/editor metadata. For a meaningful edit/new task use max(time(), oldChangedAt+1); unchanged legacy missing/zero stamp stays stable (no republish spam).

### L2 Explicit task deletion and Undo

- All card/row/dialog/Past delete controls call the single async `deleteTask(task)` path; status/close-to-Past is NOT deletion. Require admin and editable draft membership.
- Archive complete definition/catalog through bin-archive first; if offline/auth/write/CAS fails, task remains in draft and no “deleted” success. After confirmed archive, persist draft removal; if storage fails, leave/restore local task and report archive saved but draft not removed. Never delete progress for ordinary removal.
- Undo revalidates latest session authority at click time and restores same ID/status only if not permanently reserved. If now forbidden, offer clearly labelled new-ID recovery instead; never silently transfer old progress. Keep server archive safety copy and state that in UI.

### L3 Publish and clear-board

- Admin, online reviewed base and valid complete schema required. Ordinary, old-snapshot, imported-draft and clear-board publishing all use the same server removed-set/archive protocol; no special route may bypass it.
- Clear-board retains typed `CLEAR BOARD`, expectedCount AND baseRevision. It removes tasks only, carries live announcements, includes draft catalog for subject-only changes and retains all markers. A bare empty publish over nonempty live board stays refused.
- Student task/catalog visibility changes only at public commit. On failure before commit, old live board and recoverability remain; local candidate stays available. On ambiguous/post-commit failure, resolve operation, not speculative rollback. Inline-image uploads before POST can leave unused uploads after a refused publish: do not delete them; do not show a publish-success toast or lose the usable rewritten draft.
- On success adopt the returned authoritative board/markers and revision, preserve any newer local edits made while the request was in flight (or disable draft-changing controls during the request). Rebase only the exact submitted draft to the returned revision. No stale closure may overwrite later draft state.

### L4 Snapshot/checkpoint restore, discard and their Undo

- Admin previews the selected content; restore always changes draft only. Use one async `restoreDraft(content)` for history, checkpoints, discard and Undo. It retains the receiver's publishing base/authority, not the source's old revision/markers.
- Before replacing a draft, bin-archive outgoing draft-only definitions that would otherwise lose their only copy. Call bin-archive sequentially per lost definition, updating baseAdminRevision from each response; all must succeed before local replacement. Partial failure leaves the original draft intact plus any safe extra archives. Published omissions are additionally guaranteed archived at later Publish. Discard/import Undo must not bypass this preservation rule. No extra batch endpoint is required.
- Restore catalog from schema-2 source; legacy source without catalog retains receiving catalog and adds neutral retired unknown definitions during preview. Neither replaces private presets or current markers. Discard explicitly uses current published tasks/announcements/catalog; before-content supports Undo under the same rules.
- For each source task with a publicly marked OR privately reserved ID, preview “Recovered copy — new ID; previous device progress will not carry over.” Generate a new ID for that selected task only, label title `[Recovered copy] ` (truncate original to retain total <=500), reset closedAt/changedAt and do not copy/re-key any old progress. Unmarked IDs stay byte-identical. A changed ID colliding with live/draft/marked IDs is regenerated/rejected, not used to retag another task.
- If same-ID bin restore collides with an existing draft task, show a preview comparing that one task and require explicit replace/cancel; archive displaced content first. Do not silently overwrite or duplicate IDs. New-ID mappings are fixed for one candidate/retry/Undo, not regenerated on every render.
- Failure leaves original content usable and archived copies intact; no published effect until a later successful Publish.

### L5 Subject editor and named presets

- Admin edits the draft catalog, never live catalog in-place. Code changes mean explicit new subject creation, not rewriting every task. Rename/color/retire preserve task.subject. Retired subjects display on existing tasks but are unavailable for new assignments (current task's retired selection remains visible).
- Preset CRUD writes only private state with private CAS. Save/delete/rename survives reload; failure retains the editor input and shows no success. Applying a preset is a local content operation: show added/changed/retired subjects and affected task counts first, cancel leaves draft unchanged, confirm replaces active choices while retaining omitted referenced definitions as retired. Never retag tasks.
- Palette uses the ten existing hex colors. Native color input and editable #RRGGBB field share validated state; invalid typed text remains an inline error, cannot be saved/applied/published. Use validated CSS custom properties via style.setProperty; no arbitrary CSS/class/HTML concatenation.
- Compute sRGB relative luminance and choose whichever of #000000/#ffffff has greater WCAG contrast (>=4.5:1 for solid six-digit colors). Derive text locally, do not store user-provided foreground strings. Palette/custom choices work in light/dark tags and calendar dots, not urgency colors.
- Draft save/load, preview, checkpoints, restore, discard, transfer and diff all carry subjects. `diffDraft` exposes `subjectsChanged`; total is positive for catalog-only edits so Publish is enabled even with unchanged/no tasks. Preset saving alone is not an unpublished catalog edit until applied.
- Rebuild dropdown/quick-add choices on catalog changes; search supports stable code and editable display name; rendering uses published catalog for student surfaces and draft catalog for admin/preview. Include catalog identity in calendar invalidation so color/name-only edits repaint.

### L6 Bin browsing, restoration and permanent deletion

- Every fetch/action is server-authenticated and no-store. Summaries are private; selected record fetch supplies task+subject snapshot. Reload shows previously archived records independent of draft device/history retention.
- Restore prepares/persists a draft candidate before success, keeps original ID and local progress when unreserved, and remains invisible to students until Publish. Keep server copy as documented in 2.2. Later publish need not rewrite unchanged progress.
- Permanent deletion requires explicit confirmation, current bin record/private revision, and server proof ID is absent live at the locked public revision. Remove selected bin record only, not snapshots/uploads/other copies. A proven published ID receives an indefinite public marker; draft-only reservation remains private. Other copies of the identity can thereafter only recover as labelled new tasks.
- If another admin publishes it first, deletion conflicts and leaves all copies/authority unchanged. If deletion commits first, concurrent/stale publishing of old ID conflicts. UI must reconcile an existing draft copy rather than silently remove/retag it; Publish rejects it until user chooses new-ID recovery or removes it.

### L7 Transfer/import and import Undo

- Existing expiring bearer transfer transport remains; it is not admin authorization. Student may merge progress; replacing draft requires current admin session. Never transmit private presets/bin/reservations or server deletion authority.
- Coordinate incoming transfer with board sync (current startup races them). Before applying import fetch a fresh authoritative board; fail/defer import apply while offline rather than importing potentially banned progress without authority. Admin draft import also fetches private reservations. Preview merger/new-ID recovery, archive outgoing draft-only losses, then persist candidate. Filter marked progress BOTH before and after merge and before writing.
- Import Undo restores captured content, not captured authority; it fetches/reuses current session authority and filters again. Status Undo, deletion Undo, checkpoint Undo and discard Undo use the same guard. A deletion marker learned after the Undo snapshot wins even if incoming movedAt is newer. Never re-key removed ID progress onto a recovered task.
- Existing `mergeProgress` newest-wins/tie-local semantics remain for all unmarked IDs. Preserve progress unrelated to current live tasks: absence alone authorizes nothing. If a cleanup write fails, keep filtered memory and pending error/retry; do not claim saved cleanup or reintroduce stale entries from another closure.
- Transfer stays <=1 MiB request and 5000 progress entries; draft <=2000 tasks/200 announcements remains a transport limit, not permission to publish >300/100. Include catalog in existing draft inclusion-size calculation; report progress-only transfer explicitly if draft cannot fit (no silent catalog loss). Keep TTL 600 seconds. No deletion-marker arrays in transfers, so indefinite marker growth cannot exhaust the transfer envelope.

## 5. File ownership, interfaces and dependency order

All paths below are exact intended ownership; names marked new do not exist at the inspected baseline. Do not spread a second implementation across app.js and modules. Shared-file editing must be serialized; independent behavioral case design may run concurrently. Do not repeat the former blanket “one job at a time” restriction for genuinely disjoint read-only work.

### P1 — Notice behavior, independently shippable logic (no deployment here)

**Own:** `app.js`, new `js/update-notice.js`, `api/publish.php`, new `api/_board.php`, new `tests/update-notice.test.js`, `tests/php/run.php`, `tests/php/e2e_lib.php`.

**Interfaces:** `selectNoticeChanges(tasks, seen) -> [{id,isNew}]` pure; raw stamp input stays outside Task reconstruction. PHP `tt_stamp_tasks(incoming, live, nowSeconds) -> stampedTasks` compares fields in L1, never accepts changedAt authority. P2 reuses it.

- [ ] Add behavioral tests for quiet first baseline, zero-to-positive, dismissal, unchanged republish and each meaningful field; run and observe the relevant baseline failure before implementation.
- [ ] Implement helper plus actual sandbox endpoint cases including two same-second edits; unchanged normalized content preserves stamp.
- [ ] Run `node --test tests/update-notice.test.js` and `C:/xampp/php/php.exe tests/php/run.php`; require named cases passing without skipped endpoint coverage. Browser notice-overlay dismissal check is completed in P6.

### P2 — Locked persistence, revisions, private API and recovery

**Own:** `api/_board.php`, `api/publish.php`, `api/versions.php`, `api/_validate.php`, new CLI-only `api/migrate-subjects.php`, `tests/php/run.php`, `tests/php/e2e_lib.php`. No deploy config changes; private runtime files are created only by runtime/sandbox, never committed. The migration script requires PHP_SAPI=cli before any work; it is not added to nginx's API allowlist.

**Interfaces:** `tt_board_lock(dataDir)`, `tt_recover_pending(dataDir)`, `tt_read_board(dataDir)`, `tt_read_admin(dataDir)`, `tt_archive_records(admin, records, source, publishedEvidence) -> newAdmin`, `tt_commit_board(dataDir, oldBoard, nextBoard, archiveAdmin, finalAdmin, snapshotNote|null) -> committedResult`; validators share Subject and safe-ID rules. Endpoint contract is section 2.4. Helpers return new values/errors, not browser-owned authority.

- [ ] Extend the sandbox to copy new helpers, omit cookie on request, copy transfer.php when needed and expose deterministic write/rename/interruption barriers only inside the copied sandbox. Update `tt_e2e_publish` to supply schema/catalog/current base/operationId for normal cases so existing per-field failure assertions still reach their intended validators; explicit legacy/stale/malformed-request cases bypass that convenience and post raw JSON. Prefer a sandbox-generated wrapper/instrumentation over production HTTP/debug knobs; any implementation test seam must be injectable server-side and inaccessible from request parameters. Do not chmod-based pretend-fail tests on Windows.
- [ ] Add failing V02/V03/V04/V05 cases before endpoint changes. Add two PHP server processes sharing ONE temp data directory for actual interleaving; the current single built-in server alone cannot prove concurrent CAS. Child process barriers must identify the exact write boundary.
- [ ] Implement schemas, one shared lock, recovery and action routing. Missing real seed must fail safely; use synthetic setup only. Preserve existing validation/auth/history semantics and protect every action/read before file access.
- [ ] Prove precommit failures leave current bytes unchanged, removed live definitions durable before public rename, restart recovery matches commit point, exact replay is idempotent, stale requests cannot strip markers/presets/new catalog, and history deletion cannot destroy bin/authority.
- [ ] Run `C:/xampp/php/php.exe tests/php/run.php` with no sandbox skips. Record per-failpoint state/results, not just suite exit. Stop on unresolved recovery state rather than relaxing validation.

### P3 — Draft/identity/progress transitions

**Depends:** P2 wire contract. **Own:** `app.js`, `js/tasks.js`, `js/publish.js`, `js/transfer.js`, `js/state.js`, `js/util.js`, `index.html`, `styles.css`, `logic.js` only for explicitly shared ID/definition handling, new `js/recovery.js`, new `tests/deletion-progress.test.js`. This task owns the functional admin bin list, record preview, restore, confirmation and permanent-delete controls.

**Interfaces:** `filterDeletedProgress(progress, deletedIds) -> newProgress`; `prepareRecoveredDraft(content, forbiddenIds, makeId) -> {content,recovered}` pure and preserves unmarked IDs; `archiveDraftLosses(beforeContent,nextContent) -> Promise<void>` uses P2 archive contract; `restoreDraft(content) -> Promise<boolean>` orchestrates preservation, candidate validation/save and rendering; `saveTasks() -> boolean`; `acceptAuthoritativeBoard(board) -> boolean` validates monotonic public authority and performs cleanup even for empty tasks before UI deferral; `initRecoveryUI(deps)` follows existing injected-module initialization and binds real private-bin requests. Keep authority in current session state, not Undo payloads.

- [ ] Add failing V05-V08 cases for same-ID restore status, new-ID recovery, all delayed Undo closures, missing/offline/empty boards, concurrent import startup and storage failures. Exercise actual exported behavior/module flows, not source text.
- [ ] Route every explicit delete through archive-first async path; fix dialog close/callers so pending/failure does not destroy the task. Cover replacement loss through history/checkpoint/discard/import/Undo, not only delete buttons.
- [ ] Replace absence pruning; process authority before app.js's open-dialog early return. Normalize all progress writes/restores through the shared filter. Block stale base adoption and implement conflict review without silent overwrite.
- [ ] Update snapshot/restore and save result handling; serialize candidate schemas once. Do not turn this into a wholesale module split or migrate status format.
- [ ] Run `node --test tests/deletion-progress.test.js tests/logic.test.js` and sandbox tests; browser end-to-end proof follows in P6.

### P4 — Catalog/preset editing and all subject consumers

**Depends:** P2 catalog/private API, P3 draft serializer. **Own:** new `js/subjects.js`, new generic `subjects.example.json`, `app.js`, `js/tasks.js`, `js/quick-add.js`, `js/calendar.js`, `js/tour.js`, `js/publish.js`, `js/state.js`, `index.html`, `styles.css`, new `tests/subjects.test.js`.

**Interfaces:** `validateSubjects(raw) -> Subject[]|error`, `subjectTextColor(hex) -> '#000000'|'#ffffff'`, `applyPresetCatalog(current,preset,referencedCodes) -> Subject[]`, `subjectFor(code,scope) -> Subject|null`, `styleSubject(element,definition)`, `renderSubjectChoices()`; init/dependency injection follows existing modules. `diffDraft()` adds `subjectsChanged`; `snapshot()` includes versioned draft content, not private store or authority.

- [ ] Add failing V09/V10 cases: replace choices without retagging, retire referenced codes, catalog-only diff, palette/custom hex rejection/contrast and both rendering scopes.
- [ ] Implement catalog editor/private named preset CRUD and explicit preview/apply. Replace hardcoded real-code mapping with generic tracked `subjects.example.json` (`{schemaVersion:1,subjects:Subject[]}`); preserve palette values without class-specific comments/examples. Tour sample text/tag (`js/tour.js:120,127`) also becomes generic, not an undeclared real-code lookup. The example is an explicit installation input, never an automatic configured-site fallback. Seed real runtime privately BEFORE removing the legacy code source at activation, never paste it into new tracked fixtures.
- [ ] Update tags, dropdown rebuilding, quick-add token detection/suggestions, search and calendar dots/agenda invalidation. Do not leave a compatibility SUBJECTS map exporting stale class-specific data.
- [ ] Use existing dialogs/buttons/focus patterns; add new modal selectors to focus trapping and Escape precedence. Keyboard can reach palette, picker, hex, preview and confirmation controls; restore focus to a visible opener. Keep invalid input actionable.
- [ ] Run `node --test tests/subjects.test.js tests/deletion-progress.test.js tests/update-notice.test.js`; P6 proves actual rendered controls and persistence.

### P5 — Transfer validation and complete round trips

**Depends:** P3/P4 content contracts. **Own:** `js/transfer.js`, `api/_validate.php`, `transfer.php` only if response/body error handling requires it, `js/publish.js`, new `tests/transfer-contract.test.js`, `tests/php/run.php`, `tests/php/e2e_lib.php`.

**Interfaces:** `validateTransfer(p)` returns `{progress,draft}` preserving validated catalog; PHP `clean_payload(p)` uses matching catalog validation. `buildTransferPayload()` excludes authority/private state and reports omitted oversized draft. Import apply/Undo call P3 reconciliation, not raw array replacement.

- [ ] Add failing V06/V09/V11 cases using distinct sending/receiving device stores, actual PHP create/fetch and actual browser import, not validator output echo.
- [ ] Verify save/reload -> checkpoint -> restore -> Publish -> server history -> restore -> Transfer -> import retains catalog/task code/color/name/active. Legacy input without catalog cannot reset current configuration/base/markers.
- [ ] Exercise private field injection, stale base values, >5000 progress, byte-boundary 1 MiB payloads and >300 transport-valid draft Publish refusal. Test exact limits and one-over, not merely nonempty responses.
- [ ] Run `node --test tests/transfer-contract.test.js tests/deletion-progress.test.js tests/subjects.test.js` and PHP sandbox suite.

### P6 — Integrated isolated browser proof and migration documentation

**Depends:** P1-P5. **Own:** `tests/e2e/audit.mjs`, `tests/audit-harness.test.js`, `tests/nginx-conf.test.js` only for narrowly required internal-helper/private-path guards, `tests/php/e2e_lib.php`, `tests/e2e/capture.mjs` only for intentional fixture adaptation, `tests/e2e/fixture-board.json`, `tests/e2e/README.md`, README, `docs/adr/0003-data-in-files.md`, new `docs/adr/0007-subjects-and-recovery.md`, `docs/adr/README.md`; `.gitignore` only if a newly chosen private path falls outside already-ignored data (not planned).

**Interfaces:** add audit `--php <executable>`/real-sandbox mode using a generated isolated docroot, real API/data plus synthetic session. Reuse CDP/viewport/isolation helpers. Test router/static front must enforce private-data denial; label that separately from deployed nginx proof. Do not run the whole repo under an unguarded PHP static server and call private files protected.

- [ ] Extend browser harness so functional feature scenarios run actual PHP endpoints, restart the PHP process while preserving synthetic storage and use separate browser contexts for admin/student. Static 200{} API stubs remain geometry-only and cannot satisfy functional assertions. Fixture catalog/examples must be generic.
- [ ] Execute every V check below with named assertion output and no required-browser/PHP skips. Verify localStorage contents and server files independently of UI toasts; after restart and reload inspect persistence, not just in-memory state.
- [ ] Record preservation of README edits, inline scripts/CSP, asset stamps and intentional golden changes. Use supported capture tooling only; never hand-edit or blindly bless goldens. Remove obsolete incidental source-wording tests if changed code invalidates them; replace their behavioral value rather than pin new wording. Do not weaken security/integrity guards.
- [ ] Document section 7's operator runbook in ADR/README, describe actual shipped behavior only, and keep future multi-section deferred. Correct ADR 0003's overbroad atomic wording to distinguish single-file atomic replacement from recoverable multi-file ordering.
- [ ] Run final stable checks sequentially: `node --test tests/*.test.js`; `C:/xampp/php/php.exe tests/php/run.php`; `node tests/e2e/check.mjs`; `node tests/e2e/design-lint.mjs`; `node tests/e2e/audit.mjs --require-browser --php C:/xampp/php/php.exe --port 8138` (new option must be implemented and tested in this task). On Windows expand test file globs via the supported runner if the shell does not; do not mistake the known npm wrapper failure for product failure.
- [ ] Review affected paths/security/JS independently when provider capability is available; no completion claim from unavailable review jobs. Record observed evidence and unverified deployment boundaries. Stop without commit/push/deploy.

## 6. Requirement-to-verification checklist

All boxes are intentionally open: acceptance checks for later implementation. P labels own code; V labels are named behavioral scenario groups, not existing tests falsely claimed to exist.

- [ ] **V01 / notices (P1/P6):** HTTP publish title-only, notes-only, deadline date/time, subject and attachment add/remove/rename/size changes each advance changedAt; two edits in one second strictly advance. Identical canonical republish and attachment reorder preserve stamp. Browser baseline is quiet, legacy zero -> positive yields one Updated item, dismissal survives reload, invalid/offline loads do not acknowledge.
- [ ] **V02 / stale state (P2/P3):** Two admins read revision R with same task count; one changes catalog/tasks or permanently deletes, second posts R. Expect 409, latest current bytes/markers/bin/presets unchanged. Missing old-client schema/base/catalog gets refresh-required. Forged snapshot/import marker arrays cannot clear/add authority. Two real PHP processes sharing sandbox yield one successful CAS write, not two blind successes.
- [ ] **V03 / failure and recovery (P2/P6):** Inject short write/rename failure and kill at archive-save, pending-save, snapshot-save, pre-current-rename and post-current-rename/pre-final-state boundaries. Before public commit expect unchanged live bytes, no ordinary success, retained draft and all old recoverable copies. After commit expect complete new board + archives and pending; restart finalizes private state without republishing. Exact retry produces no duplicate record/revision; superseded retry conflicts. Lost response shows unknown outcome then resolves accurately. History pruning/clear cannot remove bin/markers. Fail lock acquisition -> 503 and zero writes.
- [ ] **V04 / privacy (P2/P6):** No-cookie/expired-cookie private summary, record, preset CRUD/archive/restore/delete requests get 401 with no private contents or mutation. Unknown action/type/body errors do not touch files. Try direct normal/mixed-case/encoded private state/pending/temp/backup paths and internal helper URL: deny/404, never JSON bodies. Public board/history/Transfer contain no private fields. PHP router proof and nginx rule tests are distinct; real nginx HTTP proof is required at later operator activation, not inferred from PHP built-in server.
- [ ] **V05 / every recovery route (P2/P3/P6):** Explicit delete from card, list, dialog and Past first archives; failed archive leaves task in draft. Ordinary omission, partial old-snapshot publish and typed clear-board archive EACH removed live definition plus its display subject before disappearance. Clear after deleting all server history remains recoverable. Reload/restart, restore bin to draft, publish: same ID and exact preexisting device status/movedAt survive; unaffected task content/IDs untouched. Conflicting draft-ID restore requires replace/cancel preview; restoration remains draft-only.
- [ ] **V06 / permanent identity authority (P2/P3/P5/P6):** Reject permanent delete while ID live, with unchanged state. After successful removal, confirm permanent deletion removes selected bin record, publishes only ID/time marker and never unlinks history/uploads. Snapshot/checkpoint/import/Undo recovery uses labelled new ID with not_started/no inherited movedAt; unrelated task IDs unchanged. Draft-only permanent deletion reserves privately, creates no public marker, and cannot authorize student purge. Old clients cannot republish reserved identity; admin reads/Publish guard private reservations. Delayed status/delete/import/discard/history Undo after a newly learned marker cannot reinsert its progress, even with newer incoming timestamp.
- [ ] **V07 / sync authority (P3/P6):** Valid revisioned HTTP 200 with tasks=[] + marker deletes exactly marked progress, preserves absent-but-unmarked entries, including during open task dialog. 404, offline/cache-only boot, malformed board, decreasing revision or lost-marker response delete nothing and do not advance authority. Successful sync then import/Undo reapplies latest marker filter. localStorage failure is reported and retried without false Saved/Published/Restored claims.
- [ ] **V08 / local failure boundaries (P3/P6):** Reject draft save after server archive: task remains usable locally and bin durable, no deleted-success toast. Fail draft restore save: prior draft stays visible; bin source remains. Fail second key write during import: report partial local persistence, never reintroduce a filtered ID. Auth expiry/CAS conflicts retain editor/draft input. Simulate newer local edits during Publish and ensure response cannot overwrite them.
- [ ] **V09 / catalog lifecycle (P4/P5/P6):** Create stable code, rename, recolor and retire; existing task keeps code/color association, retired code displays but is excluded from new choices. Preset CRUD survives server restart; preview cancel changes nothing; apply replaces active choices without task reassignment. Save/reload/checkpoint/history/discard plus their Undo and supported Transfer preserve names/colors/active. Subject-only diff enables Publish and students change only after commit, including empty-board catalog Publish. Legacy envelopes preserve current catalog and expose unknown codes as retired, never generic-reset.
- [ ] **V10 / custom colors and keyboard (P4/P6):** Each existing palette color, #000000, #ffffff and mid-luminance custom colors select the higher-contrast ink >=4.5:1. Reject #fff, alpha, CSS strings, missing # and nonhex on client AND PHP; one malformed catalog rejects whole apply/publish. Real browser tests Tab/Shift-Tab, Enter/Space, Escape, focus return and visible labels for editor/presets/bin/confirmation; palette/picker/hex all work, errors announced. Inspect computed tag foreground/background and calendar dots in both themes at 320/375/768/1280; assert actual viewport innerWidth and no clipped controls. No urgency-based subject color regression.
- [ ] **V11 / migration/limits/privacy examples (P2/P5/P6):** Synthetic legacy install has IDs/progress/unused subject choices preserved after backup/seed/activation. Missing/invalid/duplicate seed fails without changing current; rerun initialization never replaces configured state with generic example. Simulated artifact replacement excludes data and preserves private state; deployment durability still requires operator proof. Transfer at byte/count limits accepts supported catalog; one-over rejects/reports draft omission, never silently strips subjects. Generate >5000 retained published markers and a response >4 MiB: cleanup/Publish still work because marker arrays are not posted/transferred, and no 300-task/5000-progress cap truncates markers. Record size/runtime/memory cost, no invented constant-bound storage claim.
- [ ] **V12 / scope and integrity (P6):** Preserve task IDs (except labelled forbidden-ID recovery), local status format, README edits, CSP inline bytes, five stamps and module caching. Generic tracked examples/fixtures contain no actual runtime configuration; runtime files absent from artifact/commit. No dependencies, data/history rewrite, uploads deletion, future features, merge/push/deploy. Existing tests and browser errors/CSP checks stay accounted for; all new functional controls exercise real endpoints, not fake success.

## 7. Executable migration and recovery boundaries

These are future operator steps, NOT performed by this planning pass or feature-development tests.

1. **Quiesce and back up:** stop admin writes/old endpoints for activation; students may continue reading the old board. Under the common lock, make a coherent private backup of current board, versions, admin state if any, and the complete existing subject code/name/color configuration including unused choices from the deployed source. Do not inspect/copy secrets into logs or Git. Verify backup checksums/JSON parse and restore into an isolated clone. Each admin device should export/back up local draft/checkpoints/progress separately; the server cannot back up device-local state.
2. **Seed explicitly, once:** capture legacy subject definitions BEFORE replacing hardcoded source; map existing CSS palette to the same hex colors. Place validated runtime-only `data/admin/subjects-seed.json` (`{schemaVersion:1,subjects:Subject[]}`) through trusted operator file access. Never embed actual values in tracked migration scripts. A new empty installation may explicitly copy the generic example catalog; an existing installation with no seed is an actionable setup failure, not an automatic sample fallback. A schema-2 existing catalog is authoritative and must not be overwritten by seed.
3. **Validate before activation:** detect ID/schema violations/duplicate codes, missing referenced subjects, corrupted current/snapshots and catalog >300 entries. Preserve all valid choices, including unused/retired. For a referenced code absent from configuration, show/report the neutral retired definition for explicit migration review rather than retagging tasks. Build target schema-2 board + initial private state (including an Initial configuration private preset) and server-known history provenance using synthetic-dry-run code paths. Abort on validation/backup failure; preserve source files. Do not create an empty board to conceal unreadable legacy state.

   Implement `api/migrate-subjects.php --check --seed <private-seed.json> --backup-dir <private-directory>` and `--apply` with the same arguments, using P2 validators/lock/commit recovery. `--check` validates and prints only counts, schema/revision and validation errors (no task/subject contents); it writes nothing. `--apply` revalidates under lock, creates/verifies the coherent backup before mutation, then initializes once; existing initialized state returns already-initialized without replacement. Reject backup paths under a publicly served location unless inside the existing protected data tree; never follow arbitrary request paths because there is no HTTP mode. Nonzero exit on missing seed, backup failure, invalid existing state or unresolved pending; print committed-recovery-pending distinctly after a public commit. Sandbox tests execute the actual CLI twice and verify no reset.

   Operator commands after safe private file provisioning (not run in this pass):
   `php api/migrate-subjects.php --check --seed data/admin/subjects-seed.json --backup-dir data/admin/backups/pre-subjects`
   then the same command with `--apply` replacing `--check`. New empty installs may explicitly pass `--seed subjects.example.json`. Recovery uses the same CLI `--recover` mode to resolve pending under lock; it never replaces authority with an old backup. Manual coherent-backup restoration is restricted to the pre-activation boundary in step 7.
4. **Activate with the same recovery protocol:** under lock install private state and versioned board through the tested commit helper, initialized flag, revision=1 only for true legacy activation, unchanged task IDs/definitions/stamps/progress. Initialization retries use receipt/pending recovery. Existing initialized state is loaded, never reset on deploy; missing initialized private state beside a schema-2 board fails closed pending restore. Do not restore/import old marker authority from snapshots. Remove/quarantine seed after successful validation into private backup storage, not public files.
5. **Persistence/security preflight:** retain runtime under the deployment's persistent data location already used by the app; validate the actual filesystem mount/replacement behavior and artifact exclusion with an operator-controlled redeploy/restart before relying on it. Git ignore and the historical ADR are not sufficient proof. If data is not durable, activation is blocked until persistent storage is configured; no extra infrastructure is provisioned by this plan. Check exact/mixed-case private URLs with no auth on the deployed web server, and no-store on authenticated reads; never expose backup or pending files.
6. **Refresh and smoke:** require admins/returning clients to refresh; old writes get refresh-required. Confirm public catalog/empty-marker board, private preset/bin reload, subject-only publish and isolated sample restore/recovery on staging. Do not make destructive production sample deletions to satisfy tests. Existing already-open old JS can still apply its obsolete absence-pruning behavior to local progress; server CAS cannot fix code already running in a browser. Once erased, progress is unrecoverable unless that device has its own backup/transfer. Never promise seamless old-client behavior.
7. **Recover failed activation:** before any new marker/bin mutations, stop writes and restore the coherent backup/code pair if activation did not commit; use pending recovery if it did. After schema-2 use begins, do not roll back to an old writer that can overwrite metadata, bin state or markers. Keep the new write guard/recovery logic, repair forward, or remain read-only. Restore task/catalog content from backup by a NEW reviewed draft/publish, unioning current authority, never by replacing current.json with an old snapshot. Back up latest state before repair.
8. **Irreversible effects:** confirmed deletion removes that bin record, permanent identity reservations persist indefinitely, and authorized device cleanup erases those local progress entries. Historical/upload copies remain; recovery creates a new-ID task, not the old status. Backups can recover content but must not undo deletion authority. No history rewriting or secure-erasure claim.

### Retained-marker growth

Current limits are input/transport bounds: publish 4 MiB/300 tasks/100 announcements (`api/publish.php:13,28,50`), Transfer 1 MiB (`transfer.php:5,108-111`), 5000 progress and 2000 draft tasks/200 announcements (`api/_validate.php:27,45`), and client draft-inclusion threshold 700000 JS string units (`js/transfer.js:84`). None is an authority-retention limit.

Do not echo deletedTasks back in Publish, include it in Transfer, cap it at 300/5000 or prune it with version retention. Public GET/normalization, private persistence and generated response/snapshot sizing must accept a growing complete marker list independently of task input limits. Serialization and memory are O(retained markers + bin contents); indefinite retention is not physically infinite storage. V11 measures beyond current caps; monitor/backup capacity operationally, fail safely on write exhaustion and preserve old current/bin, rather than silently dropping markers. Pagination/compaction/new services are not added speculatively.

## 8. Decisions and remaining prerequisites

No settled product decision needs reconfirmation. This plan selects: existing endpoint action routing; separate public/private revisions; public rename commit point plus one private pending record; archive-before-removal; non-consuming bin restore safety copy; private never-published identity reservations; explicit conflict review; and six-digit custom hex with computed black/white ink. They implement existing requirements without adding user features.

Genuinely unresolved product decisions: **none identified**. Operational prerequisites before activation: private legacy seed/coherent backup, proven persistent deployment storage/rename semantics, and real nginx unauthorized-fetch checks. These are evidence/setup gates, not requests to expand scope or reconfirm behavior.

## 9. Planning-pass stop condition

This pass ends after revising this document and checking it against the approved source and requested lifecycle/verification list. Do not resume P1-P6 here. README and all feature code remain untouched. No new runtime contracts, UI or recovery guarantees are claimed implemented.
