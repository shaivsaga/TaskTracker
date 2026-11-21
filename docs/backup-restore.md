# Backup and restore runbook

TaskTracker stores all runtime state on disk under `data/` (which is gitignored and never in deployment artifacts):

- `data/current.json` — the live published board
- `data/versions/` — published snapshot history
- `data/uploads/` — uploaded attachments (PDF, PPTX, DOCX, JPG, PNG)
- `data/admin/` — admin recycle bin, deleted-task markers, and subject catalogue

Transient files (`data/sessions/`, `data/transfers/`, `data/.publish.lock`) are excluded from backups.

## Taking a backup

`deploy/backup.sh` acquires `data/.publish.lock` via `flock` (matching `api/publish.php` and `api/versions.php`), writes a `.tar.gz` archive plus a `.sha256` sidecar file, and verifies both checksum and archive structure before succeeding.

### Local / XAMPP (Linux or Git Bash)

```bash
bash deploy/backup.sh backup
# Writes: ./backups/tasktracker-backup-YYYYMMDD-HHMMSSZ.tar.gz (+ .sha256)
```

You can also pass explicit source and destination directories (keep the destination **outside** `data/` and outside the public web root):

```bash
bash deploy/backup.sh backup /opt/lampp/htdocs/test/data /home/markus/tt-backups
```

### Production (Azure App Service)

Run from Azure Kudu / SSH so the archive lands outside `/home/site/wwwroot`:

```bash
mkdir -p /home/site/backups
bash /home/site/wwwroot/deploy/backup.sh backup /home/site/wwwroot/data /home/site/backups
```

Download the `.tar.gz` and `.sha256` files over SSH/SFTP (never move backups into `wwwroot/` where static routes could expose them).

## Verifying an archive

```bash
bash deploy/backup.sh verify /path/to/tasktracker-backup-YYYYMMDD-HHMMSSZ.tar.gz
```

Checks:
1. SHA-256 matches the `.sha256` sidecar (if present).
2. `gzip -t` and `tar -tzf` succeed.
3. No archive entry contains `..` or an absolute path.

## Restoring from a backup

```bash
bash deploy/backup.sh restore /path/to/tasktracker-backup-YYYYMMDD-HHMMSSZ.tar.gz /path/to/data
```

Restore behaviour:
1. Verifies the archive and extracts it into a temporary staging directory first.
2. Validates `current.json` parses as JSON (when present).
3. If the target `data/` directory is non-empty, moves it aside to `data.pre-restore-YYYYMMDD-HHMMSSZ` before moving the staged directory into place.
