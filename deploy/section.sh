#!/usr/bin/env bash
set -euo pipefail

TT_WWWROOT="${TT_WWWROOT:-/home/site/wwwroot}"
TT_SECURE_DIR="${TT_SECURE_DIR:-/home/site/secure}"
TT_NGINX_BIN="${TT_NGINX_BIN:-nginx}"
TT_SKIP_RELOAD="${TT_SKIP_RELOAD:-0}"

if [ -z "${TT_PHP_BIN:-}" ]; then
  if command -v php >/dev/null 2>&1; then
    TT_PHP_BIN="$(command -v php)"
  elif [ -x /opt/lampp/bin/php ]; then
    TT_PHP_BIN="/opt/lampp/bin/php"
  else
    TT_PHP_BIN=""
  fi
fi

usage() {
  cat >&2 <<'EOF'
Usage:
  deploy/section.sh provision <id>
  deploy/section.sh rotate <id>
EOF
  exit 1
}

validate_id() {
  local id="${1:-}"
  if [ -z "$id" ] || [ "$id" = "a" ] || [ "${#id}" -gt 32 ]; then
    echo "Invalid section ID: '$id' (must match ^[a-z0-9][a-z0-9_-]{0,31}\$ and not be 'a')" >&2
    return 1
  fi
  case "$id" in
    [!abcdefghijklmnopqrstuvwxyz0123456789]*|*[!abcdefghijklmnopqrstuvwxyz0123456789_-]*)
      echo "Invalid section ID: '$id' (must match ^[a-z0-9][a-z0-9_-]{0,31}\$ and not be 'a')" >&2
      return 1
      ;;
  esac
}

gen_token() {
  local tok=""
  if command -v openssl >/dev/null 2>&1; then
    tok="$(openssl rand -hex 16 2>/dev/null | tr 'A-F' 'a-f' | tr -d ' \r\n\t')" || tok=""
  fi
  if [ "${#tok}" -ne 32 ]; then
    tok="$(od -An -tx1 -N16 /dev/urandom | tr 'A-F' 'a-f' | tr -d ' \r\n\t')"
  fi
  if [ "${#tok}" -ne 32 ]; then
    echo "Failed to generate 128-bit hex token" >&2
    return 1
  fi
  printf '%s' "$tok"
}

seed_board() {
  local src_board="$TT_WWWROOT/data/current.json"
  local dst_board="$1"
  local tmp_board
  tmp_board="$(mktemp "$(dirname "$dst_board")/.current.json.XXXXXX")"

  if [ -n "$TT_PHP_BIN" ] && [ -x "$TT_PHP_BIN" ]; then
    "$TT_PHP_BIN" -r '
      $src = $argv[1];
      $subjects = [];
      if (is_file($src)) {
        $d = json_decode((string)@file_get_contents($src), true);
        if (is_array($d) && isset($d["subjects"]) && is_array($d["subjects"]) && array_is_list($d["subjects"])) {
          $subjects = $d["subjects"];
        }
      }
      $out = [
        "schemaVersion" => 2,
        "revision" => 0,
        "publishedAt" => gmdate("Y-m-d\\TH:i:s\\Z"),
        "tasks" => [],
        "announcements" => [],
        "subjects" => $subjects,
        "deletedTasks" => [],
      ];
      echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    ' "$src_board" > "$tmp_board"
  elif command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("node:fs");
      let subjects = [];
      try {
        const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        if (d && Array.isArray(d.subjects)) subjects = d.subjects;
      } catch {}
      const out = {
        schemaVersion: 2,
        revision: 0,
        publishedAt: new Date().toISOString(),
        tasks: [],
        announcements: [],
        subjects,
        deletedTasks: [],
      };
      process.stdout.write(JSON.stringify(out) + "\n");
    ' "$src_board" > "$tmp_board"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c '
import datetime, json, sys
subjects = []
try:
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        d = json.load(f)
    if isinstance(d, dict) and isinstance(d.get("subjects"), list):
        subjects = d["subjects"]
except Exception:
    pass
out = {
    "schemaVersion": 2,
    "revision": 0,
    "publishedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "tasks": [],
    "announcements": [],
    "subjects": subjects,
    "deletedTasks": [],
}
sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
' "$src_board" > "$tmp_board"
  else
    local now_iso
    now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '{"schemaVersion":2,"revision":0,"publishedAt":"%s","tasks":[],"announcements":[],"subjects":[],"deletedTasks":[]}\n' "$now_iso" > "$tmp_board"
  fi

  chmod 0644 "$tmp_board"
  mv "$tmp_board" "$dst_board"
}

write_http_conf() {
  local id="$1"
  local dst="$2"
  local tmp
  tmp="$(mktemp "$TT_SECURE_DIR/.sections-http-${id}.XXXXXX")"
  printf 'limit_req_zone $binary_remote_addr zone=login_%s:10m rate=5r/m;\n' "$id" > "$tmp"
  chmod 0644 "$tmp"
  mv "$tmp" "$dst"
}

write_server_conf() {
  local id="$1"
  local tok="$2"
  local dst="$3"
  local prefix="/s/$id/$tok"
  local tmp
  tmp="$(mktemp "$TT_SECURE_DIR/.sections-server-${id}.XXXXXX")"

  cat > "$tmp" <<EOF
location = ${prefix} {
    absolute_redirect off;
    return 301 ${prefix}/;
}
location = ${prefix}/ {
    rewrite ^ ${prefix}/index.html last;
}
location = ${prefix}/index.html {
    alias ${TT_WWWROOT}/index.html;
    default_type text/html;
    add_header Cache-Control "no-cache" always;
    add_header Strict-Transport-Security "max-age=300" always;
    add_header Content-Security-Policy "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; script-src 'self' 'sha256-hgakgEjVGdLiVUqTyUxCoKPOpnq7d5ftvwYsV7jK9n8='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header X-Content-Type-Options "nosniff" always;
}
location ~* ^${prefix}/(styles\.css|app\.js|qr-draw\.js|qrcode\.js|attachments\.js|logic\.js|js/[a-z0-9-]+\.js)\$ {
    alias ${TT_WWWROOT}/\$1;
    add_header Cache-Control \$asset_cache;
    add_header Strict-Transport-Security "max-age=300" always;
    add_header Content-Security-Policy "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; script-src 'self' 'sha256-hgakgEjVGdLiVUqTyUxCoKPOpnq7d5ftvwYsV7jK9n8='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header X-Content-Type-Options "nosniff" always;
}
location ~* ^${prefix}/(assets/(?:fonts/[a-z0-9-]+\.woff2|sprites-(?:light|dark)\.svg)|favicon\.svg|favicon\.ico|apple-touch-icon\.png)\$ {
    alias ${TT_WWWROOT}/\$1;
    add_header Cache-Control \$asset_cache;
    add_header Strict-Transport-Security "max-age=300" always;
    add_header Content-Security-Policy "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; script-src 'self' 'sha256-hgakgEjVGdLiVUqTyUxCoKPOpnq7d5ftvwYsV7jK9n8='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header X-Content-Type-Options "nosniff" always;
}
location = ${prefix}/data/current.json {
    alias ${TT_WWWROOT}/data/sections/${id}/current.json;
    add_header Cache-Control "no-cache" always;
    add_header Strict-Transport-Security "max-age=300" always;
    add_header Content-Security-Policy "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; script-src 'self' 'sha256-hgakgEjVGdLiVUqTyUxCoKPOpnq7d5ftvwYsV7jK9n8='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header X-Content-Type-Options "nosniff" always;
}
location ~* ^${prefix}/(data|deploy|tests)/ {
    deny all;
}
location ~* "^${prefix}/uploads/([a-f0-9]{32}\.(pdf|jpg|png))\$" {
    alias ${TT_WWWROOT}/data/sections/${id}/uploads/\$1;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header Strict-Transport-Security "max-age=300" always;
    add_header Content-Security-Policy "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; script-src 'self' 'sha256-hgakgEjVGdLiVUqTyUxCoKPOpnq7d5ftvwYsV7jK9n8='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header X-Content-Type-Options "nosniff" always;
}
location ~* "^${prefix}/uploads/([a-f0-9]{32}\.(pptx|docx))\$" {
    alias ${TT_WWWROOT}/data/sections/${id}/uploads/\$1;
    add_header Content-Disposition "attachment" always;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header Strict-Transport-Security "max-age=300" always;
    add_header Content-Security-Policy "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; script-src 'self' 'sha256-hgakgEjVGdLiVUqTyUxCoKPOpnq7d5ftvwYsV7jK9n8='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header X-Content-Type-Options "nosniff" always;
}
location = ${prefix}/api/login.php {
    limit_req zone=login_${id} burst=3 nodelay;
    auth_basic "TaskTracker admin";
    auth_basic_user_file ${TT_SECURE_DIR}/htpasswd_${id};
    include fastcgi_params;
    fastcgi_param HTTP_PROXY "";
    fastcgi_param SCRIPT_FILENAME ${TT_WWWROOT}/api/login.php;
    fastcgi_param SCRIPT_NAME ${prefix}/api/login.php;
    fastcgi_param TT_SECTION "${id}";
    fastcgi_param REMOTE_USER \$remote_user;
    fastcgi_pass 127.0.0.1:9000;
    fastcgi_intercept_errors off;
}
location = ${prefix}/api/logout.php {
    include fastcgi_params;
    fastcgi_param HTTP_PROXY "";
    fastcgi_param SCRIPT_FILENAME ${TT_WWWROOT}/api/logout.php;
    fastcgi_param SCRIPT_NAME ${prefix}/api/logout.php;
    fastcgi_param TT_SECTION "${id}";
    fastcgi_param REMOTE_USER "";
    fastcgi_pass 127.0.0.1:9000;
    fastcgi_intercept_errors off;
}
location = ${prefix}/api/versions.php {
    include fastcgi_params;
    fastcgi_param HTTP_PROXY "";
    fastcgi_param SCRIPT_FILENAME ${TT_WWWROOT}/api/versions.php;
    fastcgi_param SCRIPT_NAME ${prefix}/api/versions.php;
    fastcgi_param TT_SECTION "${id}";
    fastcgi_param REMOTE_USER "";
    fastcgi_pass 127.0.0.1:9000;
    fastcgi_intercept_errors off;
}
location = ${prefix}/api/publish.php {
    include fastcgi_params;
    fastcgi_param HTTP_PROXY "";
    fastcgi_param SCRIPT_FILENAME ${TT_WWWROOT}/api/publish.php;
    fastcgi_param SCRIPT_NAME ${prefix}/api/publish.php;
    fastcgi_param TT_SECTION "${id}";
    fastcgi_param REMOTE_USER "";
    fastcgi_pass 127.0.0.1:9000;
    fastcgi_intercept_errors off;
}
location = ${prefix}/api/upload.php {
    client_max_body_size 12m;
    include fastcgi_params;
    fastcgi_param HTTP_PROXY "";
    fastcgi_param SCRIPT_FILENAME ${TT_WWWROOT}/api/upload.php;
    fastcgi_param SCRIPT_NAME ${prefix}/api/upload.php;
    fastcgi_param TT_SECTION "${id}";
    fastcgi_param REMOTE_USER "";
    fastcgi_pass 127.0.0.1:9000;
    fastcgi_intercept_errors off;
}
location = ${prefix}/transfer.php {
    include fastcgi_params;
    fastcgi_param HTTP_PROXY "";
    fastcgi_param SCRIPT_FILENAME ${TT_WWWROOT}/transfer.php;
    fastcgi_param SCRIPT_NAME ${prefix}/transfer.php;
    fastcgi_param TT_SECTION "${id}";
    fastcgi_pass 127.0.0.1:9000;
    fastcgi_intercept_errors off;
}
location ~* ^${prefix}/api/ {
    return 404;
}
EOF

  chmod 0644 "$tmp"
  mv "$tmp" "$dst"
}

cmd_provision() {
  local id="${1:-}"
  validate_id "$id"

  local http_conf="$TT_SECURE_DIR/sections-http-${id}.conf"
  local server_conf="$TT_SECURE_DIR/sections-server-${id}.conf"
  if [ -e "$server_conf" ] || [ -e "$http_conf" ]; then
    echo "Section '$id' is already provisioned. Use 'rotate $id' to rotate its token." >&2
    exit 1
  fi

  local sec_dir="$TT_WWWROOT/data/sections/$id"
  mkdir -p "$sec_dir" "$TT_SECURE_DIR"

  if [ ! -f "$sec_dir/current.json" ]; then
    seed_board "$sec_dir/current.json"
  fi

  local tok
  tok="$(gen_token)"
  write_http_conf "$id" "$http_conf"
  write_server_conf "$id" "$tok" "$server_conf"

  echo "Section Link: /s/$id/$tok/"
  echo "Next steps:"
  echo "  1. Create $TT_SECURE_DIR/htpasswd_$id (e.g. htpasswd -c $TT_SECURE_DIR/htpasswd_$id admin)"
  echo "  2. Run: nginx -t && nginx -s reload"
}

cmd_rotate() {
  local id="${1:-}"
  validate_id "$id"

  local server_conf="$TT_SECURE_DIR/sections-server-${id}.conf"
  if [ ! -f "$server_conf" ]; then
    echo "Section '$id' is not provisioned (missing $server_conf)." >&2
    exit 1
  fi

  local tok backup_conf
  tok="$(gen_token)"
  backup_conf="$(mktemp "$TT_SECURE_DIR/.sections-server-${id}.bak.XXXXXX")"
  cp -p "$server_conf" "$backup_conf"

  write_server_conf "$id" "$tok" "$server_conf"

  if [ "$TT_SKIP_RELOAD" != "1" ]; then
    if ! "$TT_NGINX_BIN" -t; then
      mv "$backup_conf" "$server_conf"
      echo "nginx -t failed; rolled back $server_conf" >&2
      exit 1
    fi
    if ! "$TT_NGINX_BIN" -s reload; then
      mv "$backup_conf" "$server_conf"
      echo "nginx -s reload failed; rolled back $server_conf" >&2
      exit 1
    fi
  fi

  rm -f "$backup_conf"
  echo "New Section Link: /s/$id/$tok/"
}

cmd="${1:-}"
case "$cmd" in
  provision)
    [ "$#" -eq 2 ] || usage
    cmd_provision "$2"
    ;;
  rotate)
    [ "$#" -eq 2 ] || usage
    cmd_rotate "$2"
    ;;
  *)
    usage
    ;;
esac
