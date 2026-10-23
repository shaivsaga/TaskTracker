<?php
// POST only. Revokes the session on the server, then clears the cookie.
// Always answers 200, so logging out with an already-expired session still works.
require __DIR__ . '/_session.php';
tt_require_json_post();
tt_revoke(tt_current_token());
tt_cookie('', 1);
tt_json(200, ['ok' => true]);
