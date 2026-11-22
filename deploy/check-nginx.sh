#!/bin/bash
# Validates deploy/nginx-default.conf with `nginx -t` (both bare and with a
# provisioned dummy section), without root and without touching the system config.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONF="$SCRIPT_DIR/nginx-default.conf"
SECTION_SH="$SCRIPT_DIR/section.sh"
command -v nginx >/dev/null || { echo "nginx is not installed"; exit 2; }
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
cp /etc/nginx/mime.types /etc/nginx/fastcgi_params "$T/"
# The wrapper mirrors the directives Azure's own nginx.conf already sets in the http
# context. Without them this check passed while the host failed with
# `[emerg] "gzip" directive is duplicate` (2026-10-31): a directive the wrapper did not
# declare was already owned by the real http context, so a config the host rejects looked
# clean here. Add any directive the host is observed to set, or this check drifts again.
cat > "$T/nginx.conf" <<CONFIG
pid $T/nginx.pid;
error_log $T/error.log;
events {}
http {
  access_log off;
  gzip on;
  include $T/mime.types;
  include $CONF;
}
CONFIG
nginx -t -c "$T/nginx.conf" -p "$T" -e "$T/error.log"

mkdir -p "$T/wwwroot/data" "$T/secure"
printf '{"subjects":[]}\n' > "$T/wwwroot/data/current.json"
if command -v bash >/dev/null 2>&1; then
  TT_WWWROOT="$T/wwwroot" TT_SECURE_DIR="$T/secure" TT_SKIP_RELOAD=1 bash "$SECTION_SH" provision b >/dev/null
else
  TT_WWWROOT="$T/wwwroot" TT_SECURE_DIR="$T/secure" TT_SKIP_RELOAD=1 sh "$SECTION_SH" provision b >/dev/null
fi
printf 'admin:$apr1$testtest$abcdefghijklmnopqrstuv\n' > "$T/secure/htpasswd_b"
sed "s|/home/site/secure/sections-|$T/secure/sections-|g" "$CONF" > "$T/nginx-default-sections.conf"
cat > "$T/nginx-sections.conf" <<CONFIG
pid $T/nginx.pid;
error_log $T/error.log;
events {}
http {
  access_log off;
  gzip on;
  include $T/mime.types;
  include $T/nginx-default-sections.conf;
}
CONFIG
nginx -t -c "$T/nginx-sections.conf" -p "$T" -e "$T/error.log"
