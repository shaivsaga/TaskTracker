# TaskTracker

A shared class task board where each Section publishes its own tasks and announcements while students track their own progress locally in the browser.

## Language

**Section**:
An independent class cohort with its own Board, Draft, Subjects, Uploads, History, Recycle Bin, and Admin credentials. Section A is the primary Section at the root URL; additional Sections live at unlisted sub-paths.
_Avoid_: Class, tenant, workspace, group

**Section ID**:
The stable, short identifier for a Section (e.g. `a`, `b`) used to scope server data and browser storage. It never changes when a Section Link is rotated.
_Avoid_: Token, slug, code

**Section Link**:
The unlisted, rotatable sub-path URL containing a high-entropy secret token that grants read access to a non-root Section.
_Avoid_: Invite link, passcode, reader grant

**Owner**:
The operator who administers the host, provisions Sections, and holds Admin credentials in every Section.
_Avoid_: Superadmin, root

**Officer**:
A Section-scoped Admin who can edit and publish only their assigned Section's Board.
_Avoid_: Assigner, class president, sub-admin, moderator
