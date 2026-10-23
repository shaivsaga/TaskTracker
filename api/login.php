<?php
// Nginx puts Basic Auth in front of this one route only. REMOTE_USER is set by
// nginx after a successful login; refuse to run without it.
require __DIR__ . '/_session.php';
tt_require_json_post();
if (($_SERVER['REMOTE_USER'] ?? '') === '') tt_json(401, ['error' => 'Not authenticated']);
tt_revoke(tt_current_token());  // replace any old session instead of stacking them
tt_create();
tt_json(200, ['ok' => true]);
