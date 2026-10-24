#!/bin/bash
# Validates deploy/nginx-default.conf with `nginx -t`, without root and without
# touching the system config. Run locally or in CI.
set -euo pipefail
CONF="$(cd "$(dirname "$0")" && pwd)/nginx-default.conf"
command -v nginx >/dev/null || { echo "nginx is not installed"; exit 2; }
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
cp /etc/nginx/mime.types /etc/nginx/fastcgi_params "$T/"
cat > "$T/nginx.conf" <<CONFIG
pid $T/nginx.pid;
error_log $T/error.log;
events {}
http {
  access_log off;
  include $T/mime.types;
  include $CONF;
}
CONFIG
nginx -t -c "$T/nginx.conf" -p "$T" -e "$T/error.log"
