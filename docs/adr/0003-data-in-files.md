# 3. Data lives in flat files under data/

**Decision.** The Board, Versions, sessions, uploads and transfer links are JSON or plain files under `data/`, written atomically under a lock. There is no database.

**Why.** One small class, so there is nothing to host or pay for beyond the web app. The files are easy to inspect and copy.

**Cost.** No queries, and concurrency relies on file locks. `data/` is not in git, and nginx denies it except `data/current.json`. A deploy has been checked and does not erase it.

**Atomicity, precisely.** Each individual file is replaced by writing a complete temp file in the same directory and renaming it, so a reader sees the whole old file or the whole new one; that is single-file atomicity, and it is all a rename can promise. A publishing operation touches several files (the archive, a recovery record, a snapshot, the board and the private state), and there is no multi-file transaction. What replaces one is ordered, recoverable sequencing: the archive is durable before the board can lose a definition, the board rename is the single point at which a publish becomes visible, and a recorded `data/admin/pending.json` lets the next authenticated request finish or abandon an interrupted operation instead of guessing from timestamps. See [0007](0007-subjects-and-recovery.md) for the exact order and the operator runbook. Neither claim covers power loss or a failing storage device beyond what the filesystem itself guarantees.
