#!/bin/bash
# Validates deploy/nginx-default.conf with `nginx -t`, without root and without
# touching the system config. Run locally or in CI.
set -euo pipefail
CONF="$(cd "$(dirname "$0")" && pwd)/nginx-default.conf"
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
