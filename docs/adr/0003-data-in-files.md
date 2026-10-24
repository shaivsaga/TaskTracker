# 3. Data lives in flat files under data/

**Decision.** The Board, Versions, sessions, uploads and transfer links are JSON or plain files under `data/`, written atomically under a lock. There is no database.

**Why.** One small class, so there is nothing to host or pay for beyond the web app. The files are easy to inspect and copy.

**Cost.** No queries, and concurrency relies on file locks. `data/` is not in git, and nginx denies it except `data/current.json`. A deploy has been checked and does not erase it.
