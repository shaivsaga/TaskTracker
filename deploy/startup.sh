#!/bin/bash
SRC=/home/site/wwwroot/deploy/nginx-default.conf
DST=/etc/nginx/sites-available/default
MARKER=/home/LogFiles/startup-nginx-error.txt

# A failed nginx config leaves the site on Azure's default config, which has no
# password on api/ and no rules protecting data/. Make that impossible to miss.
nginx_failed() {
  {
    echo "################################################################"
    echo "# startup: NGINX CONFIG FAILED. $1"
    echo "# The site is running WITHOUT the TaskTracker rules (admin login, data/ protection)."
    echo "# Fix deploy/nginx-default.conf and redeploy."
    echo "################################################################"
  } >&2
  mkdir -p "$(dirname "$MARKER")" 2>/dev/null
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" > "$MARKER" 2>/dev/null
}
if [ -f "$SRC" ]; then
  cp -p "$DST" "$DST.bak" 2>/dev/null
  cp "$SRC" "$DST"
  if ! nginx -t; then
    nginx_failed "new config invalid, restoring previous"
    [ -f "$DST.bak" ] && cp -p "$DST.bak" "$DST"
  else
    rm -f "$MARKER" 2>/dev/null
  fi
else
  nginx_failed "$SRC not found, keeping existing config"
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
