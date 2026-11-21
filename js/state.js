// js/state.js - the app's cross-module mutable state.
//
// Only fields genuinely shared across multiple modules live here. Single-module timers, handles,
// and UI flags stay private inside their owning module.
//
// D6: this module imports nothing (never logic.js) and touches no DOM, no localStorage and no window at
// evaluation time, so `await import('./js/state.js')` is safe under plain Node.

export const state = {
  isAdmin: false,                 // becomes true after start()'s await checkAdmin() resolves
  publishedTasks: [],             // what the class sees
  publishedAnnouncements: [],
  progress: {},                   // taskId -> { status, movedAt }, per browser
  previewing: false,
  currentTask: null,
  liveBoard: null,                // set only after a successful live load of the Board
  searchQuery: '',
  classSearchQuery: '',
  classSubjectFilter: '',
  classStatusFilter: '',
  justChangedId: null,
  statusPopoverEl: null,
  announcements: [],
  verifiedRevision: 0,            // highest public revision this session proved with a real response
  verifiedDeletedIds: [],         // ids the server proved permanently deleted; grow-only
  adminRevision: 0,               // last private revision the server reported
  catalog: [],                    // the subject definitions this view renders with
  draftSubjects: [],              // admin: the catalogue being edited (published only on Publish)
};
