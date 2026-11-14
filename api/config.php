<?php
// Server tuning, not secrets. Secrets live in .env, which is never committed: keep
// this file free of credentials, because it is tracked so the values production
// actually runs with are reviewable instead of living only on the host.
//
// keep_versions       board snapshots kept per publish (api/_board.php); one snapshot is
//                     about the size of the board (roughly 7 KB today), so 100 is under 1 MB
// max_upload_mb       per-file limit (api/upload.php rejects anything outside 1..12)
// max_upload_total_mb total size of data/uploads/ after which uploads are refused
return [
    'keep_versions' => 100,
    'max_upload_mb' => 10,
    'max_upload_total_mb' => 2048,
];
