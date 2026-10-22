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
nginx -t && service nginx reload
