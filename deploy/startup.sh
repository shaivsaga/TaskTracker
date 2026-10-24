#!/bin/bash
SRC=/home/site/wwwroot/deploy/nginx-default.conf
DST=/etc/nginx/sites-available/default
if [ -f "$SRC" ]; then
  cp -p "$DST" "$DST.bak" 2>/dev/null
  cp "$SRC" "$DST"
  if ! nginx -t; then
    echo "startup: new nginx config invalid, restoring previous" >&2
    [ -f "$DST.bak" ] && cp -p "$DST.bak" "$DST"
  fi
else
  echo "startup: $SRC not found, keeping existing nginx config" >&2
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

nginx -t && service nginx reload
