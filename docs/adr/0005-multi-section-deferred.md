# 5. Multi-section design (deferred, not built)

**Status.** Considered and deferred. Nothing here is built yet.

**Goal.** A second section (B) with its own board and its own assigner, using the same Subjects, while section A keeps its progress and board.

**Design.**
- A stays at the short address. B gets a long random address (about 128 bits), unlisted, which can be rotated if it leaks. There is no shared read passcode, because anyone who has it can forward it.
- Each section has its own server folder, so one section's page never loads another's board.
- Each section has its own admin login. The owner's login works in every section, with a read-only overview of last published time and task count.
- Browser storage is per domain, so A's saved progress is kept. A keeps today's storage keys. B's keys get a section prefix (progress, draft, cached board, view settings).

**Known gap.** While A is at the short address, B's classmates can read A's board by typing it. This is accepted until A moves to a random address.

**Cost.** Publish, upload, versions, transfer and login all need a section parameter, and the rate-limit client-IP question must be settled first.
