#!/bin/bash
# Repeatable, lock-safe backup and restore for TaskTracker's runtime data/ directory.
#
# Usage:
#   bash deploy/backup.sh backup [data_dir] [out_dir]
#   bash deploy/backup.sh verify <archive.tar.gz>
#   bash deploy/backup.sh restore <archive.tar.gz> [target_data_dir]
#
# Defaults:
#   data_dir / target_data_dir: <repo_root>/data
#   out_dir:                    <repo_root>/backups  (outside data/ so backups never nest)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CMD="${1:-}"

usage() {
  cat <<'EOF'
Usage:
  bash deploy/backup.sh backup [data_dir] [out_dir]
  bash deploy/backup.sh verify <archive.tar.gz>
  bash deploy/backup.sh restore <archive.tar.gz> [target_data_dir]
EOF
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

verify_archive() {
  local archive="$1"
  [ -f "$archive" ] || { echo "Archive not found: $archive" >&2; return 1; }

  local sum_file="${archive}.sha256"
  if [ -f "$sum_file" ]; then
    local expected actual
    expected="$(awk '{print $1}' "$sum_file")"
    actual="$(sha256_file "$archive")"
    if [ "$expected" != "$actual" ]; then
      echo "Checksum mismatch for $archive (expected $expected, got $actual)" >&2
      return 1
    fi
  fi

  gzip -t "$archive"

  local entry
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    case "$entry" in
      /*|../*|*/../*|*/..)
        echo "Unsafe archive entry rejected: $entry" >&2
        return 1
        ;;
    esac
  done < <(tar -tzf "$archive")
}

cmd_backup() {
  local data_dir="${1:-$ROOT_DIR/data}"
  local out_dir="${2:-$ROOT_DIR/backups}"

  [ -d "$data_dir" ] || { echo "Data directory not found: $data_dir" >&2; exit 1; }
  mkdir -p "$out_dir"

  local stamp archive sum_file tmp_archive
  stamp="$(date -u +%Y%m%d-%H%M%SZ)"
  archive="$out_dir/tasktracker-backup-${stamp}.tar.gz"
  sum_file="${archive}.sha256"
  tmp_archive="$(mktemp "$out_dir/.backup-tmp-XXXXXX.tar.gz")"
  trap 'rm -f "$tmp_archive"' EXIT

  local -a items=()
  for name in current.json versions uploads admin sections; do
    if [ -e "$data_dir/$name" ]; then
      items+=("$name")
    fi
  done

  if [ "${#items[@]}" -eq 0 ]; then
    echo "Nothing to back up in $data_dir (no current.json, versions, uploads, admin, or sections)." >&2
    exit 1
  fi

  # Acquire the same publish lock file used by api/publish.php and api/versions.php
  # so a backup never captures a half-written board or mid-prune snapshot directory.
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$data_dir/.publish.lock"
    if ! flock -w 5 9; then
      echo "Could not acquire publish lock at $data_dir/.publish.lock within 5s" >&2
      exit 1
    fi
    tar --exclude='sections/*/sessions' --exclude='sections/*/transfers' -czf "$tmp_archive" -C "$data_dir" "${items[@]}"
    flock -u 9
    exec 9>&-
  else
    tar --exclude='sections/*/sessions' --exclude='sections/*/transfers' -czf "$tmp_archive" -C "$data_dir" "${items[@]}"
  fi

  mv "$tmp_archive" "$archive"
  trap - EXIT

  local hash
  hash="$(sha256_file "$archive")"
  printf '%s  %s\n' "$hash" "$(basename "$archive")" > "$sum_file"

  verify_archive "$archive"

  local count bytes
  count="$(tar -tzf "$archive" | wc -l | tr -d ' ')"
  bytes="$(wc -c < "$archive" | tr -d ' ')"
  echo "BACKUP OK: $archive ($bytes bytes, $count entries, sha256:$hash)"
}

cmd_restore() {
  local archive="${1:-}"
  local target_dir="${2:-$ROOT_DIR/data}"

  [ -n "$archive" ] || { usage >&2; exit 1; }
  verify_archive "$archive"

  local parent_dir stage_dir
  parent_dir="$(dirname "$target_dir")"
  mkdir -p "$parent_dir"
  stage_dir="$(mktemp -d "$parent_dir/.restore-stage-XXXXXX")"
  trap 'rm -rf "$stage_dir"' EXIT

  tar -xzf "$archive" -C "$stage_dir"

  if [ -f "$stage_dir/current.json" ]; then
    if command -v node >/dev/null 2>&1; then
      node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$stage_dir/current.json"
    elif command -v php >/dev/null 2>&1; then
      php -r "if (json_decode(file_get_contents(\$argv[1]), true) === null && json_last_error() !== JSON_ERROR_NONE) exit(1);" "$stage_dir/current.json"
    fi
  fi

  if [ -d "$target_dir" ] && [ -n "$(ls -A "$target_dir" 2>/dev/null)" ]; then
    local pre_backup
    pre_backup="${target_dir}.pre-restore-$(date -u +%Y%m%d-%H%M%SZ)"
    mv "$target_dir" "$pre_backup"
    mv "$stage_dir" "$target_dir"
    trap - EXIT
    echo "RESTORE OK: $target_dir (previous data preserved at $pre_backup)"
  else
    rm -rf "$target_dir"
    mv "$stage_dir" "$target_dir"
    trap - EXIT
    echo "RESTORE OK: $target_dir"
  fi
}

case "$CMD" in
  backup)
    shift
    cmd_backup "$@"
    ;;
  verify)
    shift
    [ -n "${1:-}" ] || { usage >&2; exit 1; }
    verify_archive "$1"
    echo "VERIFY OK: $1"
    ;;
  restore)
    shift
    cmd_restore "$@"
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
