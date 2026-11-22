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
  srvPending,
  srvPendingOp,
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
  srvRev, srvTasks, srvMarkers, srvLastOpId, srvPending, srvPendingOp,
  admBase, admDraft, admOp, admPhase,
  stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
  bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
>>

Init ==
  /\ srvRev = 1
  /\ srvTasks = Tasks
  /\ srvMarkers = {}
  /\ srvLastOpId = 0
  /\ srvPending = "none"
  /\ srvPendingOp = 0
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

RecoverPending ==
  /\ srvPending # "none"
  /\ IF srvPending = "post_rename" THEN
       /\ srvLastOpId' = srvPendingOp
       /\ srvPending' = "none"
       /\ srvPendingOp' = 0
     ELSE
       /\ srvPending' = "none"
       /\ srvPendingOp' = 0
       /\ UNCHANGED srvLastOpId
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, admBase, admDraft, admOp, admPhase,
       stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

AdminEditDropTask(a, t) ==
  /\ admPhase[a] = "idle"
  /\ t \in admDraft[a]
  /\ admDraft' = [admDraft EXCEPT ![a] = @ \ {t}]
  /\ admOp' = [admOp EXCEPT ![a] = 0]
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvPending, srvPendingOp,
       admBase, admPhase, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

AdminStartPublish(a) ==
  /\ admPhase[a] = "idle"
  /\ nextOp <= 4
  /\ admOp' = [admOp EXCEPT ![a] = nextOp]
  /\ admPhase' = [admPhase EXCEPT ![a] = "inflight"]
  /\ nextOp' = nextOp + 1
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvPending, srvPendingOp,
       admBase, admDraft, stuRev, stuMarkers, stuProgress, erasedProgress,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

ServerPublishCommit(a) ==
  /\ srvPending = "none"
  /\ admPhase[a] = "inflight"
  /\ srvRev < MaxRev
  /\ (admDraft[a] \cap srvMarkers) = {}
  /\ IF srvLastOpId = admOp[a] /\ admOp[a] # 0 THEN
       /\ admBase' = [admBase EXCEPT ![a] = srvRev]
       /\ admOp' = [admOp EXCEPT ![a] = 0]
       /\ admPhase' = [admPhase EXCEPT ![a] = "idle"]
       /\ UNCHANGED <<
            srvRev, srvTasks, srvMarkers, srvLastOpId, srvPending, srvPendingOp,
            admDraft, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
            bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
          >>
     ELSE IF ~BugSkipBaseCheck /\ admBase[a] # srvRev THEN
       /\ admPhase' = [admPhase EXCEPT ![a] = "conflict"]
       /\ UNCHANGED <<
            srvRev, srvTasks, srvMarkers, srvLastOpId, srvPending, srvPendingOp,
            admBase, admDraft, admOp, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
            bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
          >>
     ELSE
       /\ bugStaleOverwrite' = (bugStaleOverwrite \/ (admBase[a] # srvRev))
       /\ srvRev' = srvRev + 1
       /\ srvTasks' = admDraft[a]
       /\ srvLastOpId' = admOp[a]
       /\ admBase' = [admBase EXCEPT ![a] = srvRev + 1]
       /\ admOp' = [admOp EXCEPT ![a] = 0]
       /\ admPhase' = [admPhase EXCEPT ![a] = "idle"]
       /\ UNCHANGED <<
            srvMarkers, srvPending, srvPendingOp,
            admDraft, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
            bugAcceptedDrop, bugFalseRetryFailure
          >>

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
  /\ admPhase' = [admPhase EXCEPT ![a] = "needs_retry"]
  /\ UNCHANGED <<
       srvMarkers, srvLastOpId,
       admBase, admDraft, admOp, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

ServerPublishCrashPreRename(a) ==
  /\ srvPending = "none"
  /\ admPhase[a] = "inflight"
  /\ admBase[a] = srvRev
  /\ srvRev < MaxRev
  /\ (admDraft[a] \cap srvMarkers) = {}
  /\ srvLastOpId # admOp[a]
  /\ srvPending' = "pre_rename"
  /\ srvPendingOp' = admOp[a]
  /\ admPhase' = [admPhase EXCEPT ![a] = "needs_retry"]
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId,
       admBase, admDraft, admOp, stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

AdminRetryPublish(a) ==
  /\ admPhase[a] = "needs_retry"
  /\ srvPending = "none"
  /\ IF BugFreshOpOnRetry THEN
       /\ nextOp <= 4
       /\ IF srvLastOpId = admOp[a] /\ admOp[a] # 0 THEN
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
       /\ admPhase' = [admPhase EXCEPT ![a] = "inflight"]
       /\ UNCHANGED <<admOp, nextOp, bugFalseRetryFailure>>
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvPending, srvPendingOp,
       admBase, admDraft, stuRev, stuMarkers, stuProgress, erasedProgress,
       bugAcceptedDrop, bugStaleOverwrite
     >>

AdminRebase(a) ==
  /\ admPhase[a] = "conflict"
  /\ srvPending = "none"
  /\ admBase' = [admBase EXCEPT ![a] = srvRev]
  /\ admDraft' = [admDraft EXCEPT ![a] = @ \ srvMarkers]
  /\ admOp' = [admOp EXCEPT ![a] = 0]
  /\ admPhase' = [admPhase EXCEPT ![a] = "idle"]
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvPending, srvPendingOp,
       stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

ServerPermanentDelete(t) ==
  /\ srvPending = "none"
  /\ srvRev < MaxRev
  /\ t \in Tasks \ srvTasks
  /\ t \notin srvMarkers
  /\ srvRev' = srvRev + 1
  /\ srvMarkers' = srvMarkers \cup {t}
  /\ UNCHANGED <<
       srvTasks, srvLastOpId, srvPending, srvPendingOp,
       admBase, admDraft, admOp, admPhase,
       stuRev, stuMarkers, stuProgress, erasedProgress, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

StudentFetchAuthoritative ==
  /\ srvRev >= stuRev
  /\ stuMarkers \subseteq srvMarkers
  /\ stuRev' = srvRev
  /\ stuMarkers' = srvMarkers
  /\ stuProgress' = stuProgress \ srvMarkers
  /\ erasedProgress' = erasedProgress \cup (stuProgress \cap srvMarkers)
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvPending, srvPendingOp,
       admBase, admDraft, admOp, admPhase, nextOp,
       bugAcceptedDrop, bugFalseRetryFailure, bugStaleOverwrite
     >>

StudentReceiveDroppedMarkerBoard ==
  /\ stuMarkers # {}
  /\ IF BugDropMarkerCheck THEN
       /\ bugAcceptedDrop' = TRUE
       /\ stuRev' = stuRev + 1
     ELSE
       /\ UNCHANGED <<bugAcceptedDrop, stuRev>>
  /\ UNCHANGED <<
       srvRev, srvTasks, srvMarkers, srvLastOpId, srvPending, srvPendingOp,
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

NoDeletedResurrection == (srvTasks \cap srvMarkers) = {}
NoUnverifiedProgressErase == erasedProgress \subseteq srvMarkers
ClientRejectsDroppedMarker == ~bugAcceptedDrop
IdempotentPostCommitRetry == ~bugFalseRetryFailure
NoStaleOverwrite == ~bugStaleOverwrite
====
