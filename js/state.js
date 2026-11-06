// js/state.js - the app's one mutable module state (app.js split, slice 2.1).
//
// Every field below was a top-level `let`/`var` in app.js. Those declarations are deleted there on
// purpose: app.js is an ES module, so a reference that was missed throws a ReferenceError instead of
// silently reading a second copy of the state.
//
// Initial values stay literals or constructors only. `calAnchor` needs todayDate(), so it starts null
// here and app.js assigns it in one marked block at the top of the file, at module-eval time, before
// anything reads it.
//
// D6: this module imports nothing (never logic.js) and touches no DOM, no localStorage and no window at
// evaluation time, so `await import('./js/state.js')` is safe under plain Node.

export const state = {
  isAdmin: false,                 // becomes true after start()'s await checkAdmin() resolves
  publishedTasks: [],             // what the class sees
  publishedAnnouncements: [],
  progress: {},                   // taskId -> { status, movedAt }, per browser
  previewing: false,
  changedIds: new Set(),
  confirmOverlayEl: null,
  currentTask: null,
  liveBoard: null,                // set only after a successful live load of the Board
  noticeShown: false,
  dialogReturn: null,
  dialogCloseBtn: null,
  draggedCard: null,
  docTimer: null,
  toastTimer: null,
  saveTimer: null,
  calMode: 'month',
  calAnchor: null,                // set by app.js: state.calAnchor = todayDate()
  calSelected: null,
  calByDay: new Map(),
  calAgendaSig: '',
  searchQuery: '',
  classSearchQuery: '',
  justChangedId: null,
  staggerNext: false,
  statusPopoverEl: null,
  statusPopoverTask: null,
  statusPopoverIndex: 0,
  quickReturnFocus: null,
  quickPicked: { date: null, time: null },
  quickPrev: { subject: '', status: '', due: '' },
  quickChipEls: [],
  announcements: [],
  dpEl: null,
  dpState: null,
  lastSavedAt: null,
  serverVersions: [],
  clearTimer: null,
  tourIndex: -1,
  tourTimer: null,
  tourSampleStatus: 'not_started',
  activeTransfer: null,           // { token, expiresAt } on this device's clock
  transferTimer: null,
  transferBusy: false,
  transferQrOk: false,
  pendingImport: null,
};
