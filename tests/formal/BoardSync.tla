---- MODULE BoardSync ----
EXTENDS Integers, FiniteSets

CONSTANTS
  Tasks,
  Admins,
  MaxRev,
  BugDropMarkerCheck,
  BugFreshOpOnRetry,
  BugSkipBaseCheck

VARIABLES
  srvRev,
  srvTasks,
  srvMarkers,
  srvLastOpId,
  srvLastOpRev,
  srvPending,
  srvPendingOp,
  srvPendingOldRev,
  srvPendingTargetRev,
  srvPendingTasks,
  admBase,
  admDraft,
  admOp,
  admPhase,
  stuRev,
  stuMarkers,
  stuProgress,
  erasedProgress,
  nextOp,
  bugAcceptedDrop,
  bugFalseRetryFailure,
  bugStaleOverwrite

vars == <<
  srvRev, srvTasks, srvMarkers, srvLastOpId, srvLastOpRev,
  srvPending, srvPendingOp, srvPendingOldRev, srvPendingTargetRev, srvPendingTasks,
  admBase, admDraft, admOp, admPhase,
  stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
  bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
>>

Init ==
  /\ srvRev = 1
  /\ srvTasks = Tasks
  /\ srvMarkers = {}
  /\ srvLastOpId = 0
  /\ srvLastOpRev = 0
  /\ srvPending = "none"
  /\ srvPendingOp = 0
  /\ srvPendingOldRev = 0
  /\ srvPendingTargetRev = 0
  /\ srvPendingTasks = {}
  /\ admBase = [a \in Admins |-> 1]
  /\ admDraft = [a \in Admins |-> Tasks]
  /\ admOp = [a \in Admins |-> 0]
  /\ admPhase = [a \in Admins |-> "idle"]
  /\ stuRev = 1
  /\ stuMarkers = {}
  /\ stuProgress = Tasks
  /\ erasedProgress = {}
  /\ nextOp = 1
  /\ bugAcceptedDrop = FALSE
  /\ bugFalseRetryFailure = FALSE
  /\ bugStaleOverwrite = FALSE

(* Recover an interrupted commit under tt_board_lock (api/_board.php tt_recover_pending) *)
RecoverPending ==
  /\ srvPending # "none"
  /\ IF srvPending = "post_rename" THEN
       /\ srvLastOpId' = srvPendingOp
       /\ srvLastOpRev' = srvPendingTargetRev
       /\ srvPending' = "none"
       /\ srvPendingOp' = 0
       /\ srvPendingOldRev' = 0
       /\ srvPendingTargetRev' = 0
       /\ srvPendingTasks' = {}
     ELSE
       /\ srvPending' = "none"
       /\ srvPendingOp' = 0
       /\ srvPendingOldRev' = 0
       /\ srvPendingTargetRev' = 0
       /\ srvPendingTasks' = {}
       /\ UNCHANGED <<srvLastOpId, srvLastOpRev>>
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, admBase, admDraft, admOp, admPhase,
       stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

(* Admin removes a task from private draft *)
AdminEditDropTask(a, t) ==
  /\ admPhase[a] = "idle"
  /\ t \in admDraft[a]
  /\ admDraft' = [admDraft EXCEPT ![a] = @ \ {t}]
  /\ admOp' = [admOp EXCEPT ![a] = 0]
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvLastOpRev,
       srvPending, srvPendingOp, srvPendingOldRev, srvPendingTargetRev, srvPendingTasks,
       admBase, admPhase, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

(* Admin starts a publish submit (js/publish.js) *)
AdminStartPublish(a) ==
  /\ admPhase[a] = "idle"
  /\ nextOp <= 4
  /\ admOp' = [admOp EXCEPT ![a] = nextOp]
  /\ admPhase' = [admPhase EXCEPT ![a] = "inflight"]
  /\ nextOp' = nextOp + 1
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvLastOpRev,
       srvPending, srvPendingOp, srvPendingOldRev, srvPendingTargetRev, srvPendingTasks,
       admBase, admDraft, stuRev, stuMarkers, stuProgress, erasedProgress,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

(* Server handles publish normally when no pending crash and valid revision/markers *)
ServerPublishCommit(a) ==
  /\ srvPending = "none"
  /\ admPhase[a] = "inflight"
  /\ srvRev < MaxRev
  /\ (admDraft[a] \cap srvMarkers) = {}
  /\ IF srvLastOpId = admOp[a] /\ admOp[a] # 0 THEN
       (* Exact transport retry replays stored receipt *)
       /\ admBase' = [admBase EXCEPT ![a] = srvRev]
       /\ admOp' = [admOp EXCEPT ![a] = 0]
       /\ admPhase' = [admPhase EXCEPT ![a] = "idle"]
       /\ UNCHANGED <<
            srvRev, srvTasks, srvMarkers, srvLastOpId, srvLastOpRev,
            srvPending, srvPendingOp, srvPendingOldRev, srvPendingTargetRev, srvPendingTasks,
            admDraft, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
            bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
          >>
     ELSE IF ~BugSkipBaseCheck /\ admBase[a] # srvRev THEN
       (* Stale base refused with 409 stale_base *)
       /\ admPhase' = [admPhase EXCEPT ![a] = "conflict"]
       /\ UNCHANGED <<
            srvRev, srvTasks, srvMarkers, srvLastOpId, srvLastOpRev,
            srvPending, srvPendingOp, srvPendingOldRev, srvPendingTargetRev, srvPendingTasks,
            admBase, admDraft, admOp, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
            bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
          >>
     ELSE
       (* Commit succeeds *)
       /\ bugStaleOverwrite' = (bugStaleOverwrite \/ (admBase[a] # srvRev))
       /\ srvRev' = srvRev + 1
       /\ srvTasks' = admDraft[a]
       /\ srvLastOpId' = admOp[a]
       /\ srvLastOpRev' = srvRev + 1
       /\ admBase' = [admBase EXCEPT ![a] = srvRev + 1]
       /\ admOp' = [admOp EXCEPT ![a] = 0]
       /\ admPhase' = [admPhase EXCEPT ![a] = "idle"]
       /\ UNCHANGED <<
            srvMarkers, srvPending, srvPendingOp, srvPendingOldRev, srvPendingTargetRev, srvPendingTasks,
            admDraft, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
            bugAcceptedDrop, bugFalseRetryFailure
          >>

(* Server crashes AFTER current.json rename and BEFORE admin/state.json finalize (tt_fault post-current-rename) *)
ServerPublishCrashPostRename(a) ==
  /\ srvPending = "none"
  /\ admPhase[a] = "inflight"
  /\ admBase[a] = srvRev
  /\ srvRev < MaxRev
  /\ (admDraft[a] \cap srvMarkers) = {}
  /\ srvLastOpId # admOp[a]
  /\ srvRev' = srvRev + 1
  /\ srvTasks' = admDraft[a]
  /\ srvPending' = "post_rename"
  /\ srvPendingOp' = admOp[a]
  /\ srvPendingOldRev' = srvRev
  /\ srvPendingTargetRev' = srvRev + 1
  /\ srvPendingTasks' = admDraft[a]
  /\ admPhase' = [admPhase EXCEPT ![a] = "needs_retry"]
  /\ UNCHANGED <<
       srvMarkers, srvLastOpId, srvLastOpRev,
       admBase, admDraft, admOp, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

(* Server crashes BEFORE current.json rename (tt_fault pre-current-rename) *)
ServerPublishCrashPreRename(a) ==
  /\ srvPending = "none"
  /\ admPhase[a] = "inflight"
  /\ admBase[a] = srvRev
  /\ srvRev < MaxRev
  /\ (admDraft[a] \cap srvMarkers) = {}
  /\ srvLastOpId # admOp[a]
  /\ srvPending' = "pre_rename"
  /\ srvPendingOp' = admOp[a]
  /\ srvPendingOldRev' = srvRev
  /\ srvPendingTargetRev' = srvRev + 1
  /\ srvPendingTasks' = admDraft[a]
  /\ admPhase' = [admPhase EXCEPT ![a] = "needs_retry"]
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvLastOpRev,
       admBase, admDraft, admOp, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

(* Admin retries publish after crash/timeout *)
AdminRetryPublish(a) ==
  /\ admPhase[a] = "needs_retry"
  /\ srvPending = "none"
  /\ IF BugFreshOpOnRetry THEN
       (* Bug in js/publish.js:353: fresh operationId on retry bypasses tt_receipt replay *)
       /\ nextOp <= 4
       /\ IF srvLastOpId = admOp[a] /\ admOp[a] # 0 THEN
            (* Retry with fresh opId hits stale_base instead of replaying receipt! *)
            /\ bugFalseRetryFailure' = TRUE
            /\ admPhase' = [admPhase EXCEPT ![a] = "conflict"]
            /\ admOp' = [admOp EXCEPT ![a] = nextOp]
            /\ nextOp' = nextOp + 1
          ELSE
            /\ admOp' = [admOp EXCEPT ![a] = nextOp]
            /\ nextOp' = nextOp + 1
            /\ admPhase' = [admPhase EXCEPT ![a] = "inflight"]
            /\ UNCHANGED bugFalseRetryFailure
     ELSE
       (* Fixed js/publish.js: keeps the same operationId across retries for this draft *)
       /\ admPhase' = [admPhase EXCEPT ![a] = "inflight"]
       /\ UNCHANGED <<admOp, nextOp, bugFalseRetryFailure>>
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvLastOpRev,
       srvPending, srvPendingOp, srvPendingOldRev, srvPendingTargetRev, srvPendingTasks,
       admBase, admDraft, stuRev, stuMarkers, stuProgress, erasedProgress,
       bugAcceptedDrop, bugStaleOverwrite
     >>

(* Admin rebases after 409 stale_base (js/publish.js #publish-rebase) *)
AdminRebase(a) ==
  /\ admPhase[a] = "conflict"
  /\ srvPending = "none"
  /\ admBase' = [admBase EXCEPT ![a] = srvRev]
  /\ admDraft' = [admDraft EXCEPT ![a] = @ \ srvMarkers]
  /\ admOp' = [admOp EXCEPT ![a] = 0]
  /\ admPhase' = [admPhase EXCEPT ![a] = "idle"]
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvLastOpRev,
       srvPending, srvPendingOp, srvPendingOldRev, srvPendingTargetRev, srvPendingTasks,
       stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

(* Permanent deletion of an unpublished task adds a deletion marker (api/versions.php bin-permanent-delete) *)
ServerPermanentDelete(t) ==
  /\ srvPending = "none"
  /\ srvRev < MaxRev
  /\ t \in Tasks \ srvTasks
  /\ t \notin srvMarkers
  /\ srvRev' = srvRev + 1
  /\ srvMarkers' = srvMarkers \cup {t}
  /\ UNCHANGED <<
       srvTasks, srvLastOpId, srvLastOpRev,
       srvPending, srvPendingOp, srvPendingOldRev, srvPendingTargetRev, srvPendingTasks,
       admBase, admDraft, admOp, admPhase,
       stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

(* Student fetches live authoritative board and applies nextAuthority + filterDeletedProgress *)
StudentFetchAuthoritative ==
  /\ srvRev >= stuRev
  /\ stuMarkers \subseteq srvMarkers
  /\ stuRev' = srvRev
  /\ stuMarkers' = srvMarkers
  /\ stuProgress' = stuProgress \ srvMarkers
  /\ erasedProgress' = erasedProgress \cup (stuProgress \cap srvMarkers)
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvLastOpRev,
       srvPending, srvPendingOp, srvPendingOldRev, srvPendingTargetRev, srvPendingTasks,
       admBase, admDraft, admOp, admPhase, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

(* Corrupted/regressed response where a previously known marker disappeared (tests js/recovery.js:70) *)
StudentReceiveDroppedMarkerBoard ==
  /\ stuMarkers # {}
  /\ IF BugDropMarkerCheck THEN
       (* Bug in js/recovery.js:70: seen seeded with knownIds so dropped-marker check never fires *)
       /\ bugAcceptedDrop' = TRUE
       /\ stuRev' = stuRev + 1
     ELSE
       (* Fixed js/recovery.js: refuses any board missing a previously known deletion marker *)
       /\ UNCHANGED <<bugAcceptedDrop, stuRev>>
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvLastOpRev,
       srvPending, srvPendingOp, srvPendingOldRev, srvPendingTargetRev, srvPendingTasks,
       admBase, admDraft, admOp, admPhase, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugFalseRetryFailure, bugStaleOverwrite
     >>

Done ==
  /\ srvPending = "none"
  /\ UNCHANGED vars

Next ==
  \/ RecoverPending
  \/ \E a \in Admins, t \in Tasks : AdminEditDropTask(a, t)
  \/ \E a \in Admins : AdminStartPublish(a)
  \/ \E a \in Admins : ServerPublishCommit(a)
  \/ \E a \in Admins : ServerPublishCrashPostRename(a)
  \/ \E a \in Admins : ServerPublishCrashPreRename(a)
  \/ \E a \in Admins : AdminRetryPublish(a)
  \/ \E a \in Admins : AdminRebase(a)
  \/ \E t \in Tasks : ServerPermanentDelete(t)
  \/ StudentFetchAuthoritative
  \/ StudentReceiveDroppedMarkerBoard
  \/ Done

Spec == Init /\ [][Next]_vars

(* Invariants *)
NoDeletedResurrection == (srvTasks \cap srvMarkers) = {}
NoUnverifiedProgressErase == erasedProgress \subseteq srvMarkers
ClientRejectsDroppedMarker == ~bugAcceptedDrop
IdempotentPostCommitRetry == ~bugFalseRetryFailure
NoStaleOverwrite == ~bugStaleOverwrite
====
