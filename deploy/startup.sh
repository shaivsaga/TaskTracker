#!/bin/bash
SRC=/home/site/wwwroot/deploy/nginx-default.conf
DST=/etc/nginx/sites-available/default
MARKER=/home/LogFiles/startup-nginx-error.txt

# A failed nginx config would leave the site on Azure's default config, which has
# no password on api/ and no rules protecting data/. Treat it as fatal: log loudly,
# write the marker, and exit non-zero so the site does not come up unprotected.
nginx_failed() {
  {
    echo "################################################################"
    echo "# startup: NGINX CONFIG FAILED. $1"
    echo "# Refusing to start: the site would run WITHOUT the TaskTracker rules (admin login, data/ protection)."
    echo "# Fix deploy/nginx-default.conf and redeploy."
    echo "################################################################"
  } >&2
  mkdir -p "$(dirname "$MARKER")" 2>/dev/null
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" > "$MARKER" 2>/dev/null
  exit 1
}
if [ -f "$SRC" ]; then
  cp "$SRC" "$DST" || nginx_failed "could not copy $SRC to $DST"
  if ! nginx -t; then
    nginx_failed "new config invalid"
  fi
  rm -f "$MARKER" 2>/dev/null
else
  nginx_failed "$SRC not found"
fi

# PHP upload limits (the defaults are 2M per file and 8M per request).
INI_SRC=/home/site/wwwroot/deploy/php-uploads.ini
INI_DST=/usr/local/etc/php/conf.d/zz-tasktracker.ini
if [ -f "$INI_SRC" ] && [ -d "$(dirname "$INI_DST")" ]; then
  cp "$INI_SRC" "$INI_DST"
  pkill -USR2 php-fpm 2>/dev/null
else
  echo "startup: PHP ini not installed (source or target missing)" >&2
fi

nginx -t && service nginx reload || nginx_failed "final nginx test or reload failed"
