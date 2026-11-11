// js/dom.js - the app's cached element lookups (app.js split, slice 2.2).
//
// cacheDom() runs the document.querySelector()/querySelectorAll() calls that used to sit in app.js's
// top-level `const` declarations and parks the results on `dom`. app.js calls it exactly once, at
// module-eval time, before the first use of any cached element.
//
// Importing this module touches nothing: `document` is read only inside cacheDom(), so
//   node --input-type=module -e "await import('./js/dom.js')"
// is clean with no DOM in scope (docs/p6-architecture-findings.md 4, DECISIONS.md D6).
// D6: no logic.js import, no ?v= on the js/ <-> js/ import, nothing runs at evaluation time.
//
// Deliberately NOT cached here: the elements app.js creates at run time (#confirm-* in
// ensureConfirmDialog, #notice-overlay, the due picker and the status popover). A reference to one of
// those cached at load would be null or stale; app.js keeps querying them where it uses them.

export const dom = {};

export function cacheDom() {
  dom.navItems = [...document.querySelectorAll('[data-page]')];
  dom.pages = [...document.querySelectorAll('[data-page-view]')];
  dom.breadcrumbCurrent = document.querySelector('#breadcrumb-current');
  dom.actionFeedback = document.querySelector('#action-feedback');
  dom.adminAnnounce = document.querySelector('#announce-admin');
  dom.adminEmpty = document.querySelector('#page-my-tasks .empty-state');
  dom.dialogOverlay = document.querySelector('#task-dialog-overlay');
  dom.dialog = document.querySelector('.task-dialog');
  dom.dialogClose = document.querySelector('#dialog-close');
  dom.dialogTitleInput = document.querySelector('#dialog-title-input');
  dom.dialogStatusBtn = document.querySelector('#dialog-status-btn');
  dom.dialogStatusDot = document.querySelector('#dialog-status-dot');
  dom.dialogStatusLabel = document.querySelector('#dialog-status-label');
  dom.dialogDateBtn = document.querySelector('#dialog-date-btn');
  dom.dialogDueClear = document.querySelector('#dialog-due-clear');
  dom.dialogDueHint = document.querySelector('#dialog-due-hint');
  dom.dialogDoc = document.querySelector('#dialog-doc');
  dom.dialogDelete = document.querySelector('#dialog-delete');
  dom.dialogDuplicate = document.querySelector('#dialog-duplicate');
  dom.dialogFilesField = document.querySelector('#dialog-files-field');
  dom.dialogFiles = document.querySelector('#dialog-files');
  dom.dialogAttachBtn = document.querySelector('#dialog-attach-btn');
  dom.dialogFileInput = document.querySelector('#dialog-file-input');
  dom.noteTools = [...document.querySelectorAll('.note-tool')];
  dom.toastEl = document.querySelector('#toast');
  dom.toastMessage = document.querySelector('#toast-message');
  dom.toastAction = document.querySelector('#toast-action');
  dom.saveState = document.querySelector('#save-state');
  dom.themeToggle = document.querySelector('#theme-toggle');
  dom.taskListEl = document.querySelector('#task-list');
  dom.classListEl = document.querySelector('#class-task-list');
  dom.dialogSubjectBtn = document.querySelector('#dialog-subject-btn');
  dom.dialogSubjectDropdown = document.querySelector('#dialog-subject-dropdown');
  dom.quickOverlay = document.querySelector('#quick-overlay');
  dom.quickInput = document.querySelector('#quick-input');
  dom.quickPreview = document.querySelector('#quick-preview');
  dom.announceList = document.querySelector('#announce-list');
  dom.binList = document.querySelector('#bin-list');
  dom.binStatus = document.querySelector('#bin-status');
  dom.binRefresh = document.querySelector('#bin-refresh');
  dom.binToggle = document.querySelector('#bin-toggle');
  dom.binBody = document.querySelector('#bin-body');
  dom.subjectList = document.querySelector('#subject-list');
  dom.subjectAdd = document.querySelector('#subject-add');
  dom.subjectToggle = document.querySelector('#subject-toggle');
  dom.subjectBody = document.querySelector('#subject-body');
  dom.subjectStatus = document.querySelector('#subject-status');
  dom.presetSelect = document.querySelector('#preset-select');
  dom.presetName = document.querySelector('#preset-name');
  dom.presetSave = document.querySelector('#preset-save');
  dom.presetApply = document.querySelector('#preset-apply');
  dom.presetDelete = document.querySelector('#preset-delete');
  dom.announceForm = document.querySelector('#announce-form');
  dom.announceInput = document.querySelector('#announce-input');
  dom.announceCount = document.querySelector('#announce-count');
  dom.announceTools = [...document.querySelectorAll('.announce-tool')];
  dom.publishOverlay = document.querySelector('#publish-overlay');
  dom.historyOverlay = document.querySelector('#history-overlay');
  dom.settingsOverlay = document.querySelector('#settings-overlay');
  dom.settingsOpen = document.querySelector('#settings-open');
  dom.resetForm = document.querySelector('#settings-reset-form');
  dom.resetStart = document.querySelector('#settings-reset-start');
  dom.resetInput = document.querySelector('#settings-reset-input');
  dom.resetSubmit = document.querySelector('#settings-reset-submit');
  dom.tourOverlay = document.querySelector('#tour-overlay');
  dom.tourSpot = document.querySelector('#tour-spot');
  dom.tourCard = document.querySelector('#tour-card');
  dom.tourSample = document.querySelector('#tour-sample');
  dom.transferOverlay = document.querySelector('#transfer-overlay');
  dom.importOverlay = document.querySelector('#import-overlay');
}
