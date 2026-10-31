#!/bin/bash
SRC=/home/site/wwwroot/deploy/nginx-default.conf
DST=/etc/nginx/sites-available/default
MARKER=/home/LogFiles/startup-nginx-error.txt
OK_MARKER=/home/LogFiles/startup-nginx-applied.txt

# OK_MARKER is a claim about THIS boot. Clear the previous boot's claim up front, before any path
# below can skip the self-check, so a boot that verified nothing cannot be read as one that did.
# Only a fully checked install recreates it (see the end of this script).
rm -f "$OK_MARKER" 2>/dev/null

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
  # The applied marker is a claim about the LAST startup; a failed one must not leave the
  # previous boot's claim standing next to this boot's error marker.
  rm -f "$OK_MARKER" 2>/dev/null
  exit 1
}

# Roll back BEFORE failing. 1faf82b put the restore after this call while also making
# nginx_failed exit 1, so the restore became dead code and a rejected config stayed on
# disk for any later nginx start to load.
#
# Only safe while nginx has NOT loaded the new config: there the previous file is still what nginx
# is serving, so rewriting DST makes disk and memory agree again. A restore that does not complete
# must never be reported as one that did - the operator has to know which of the two files is on
# disk - so cp's own message is kept, next to the failure that made the restore necessary.
restore_and_fail() {
  local reason="$1" err
  if [ -f "$DST.bak" ]; then
    if err=$(cp -p "$DST.bak" "$DST" 2>&1); then
      echo "startup: restored the previous nginx config from $DST.bak" >&2
    else
      echo "startup: RESTORE FAILED (original failure: $reason): $err" >&2
      echo "startup: $DST was NOT restored; inspect it before nginx next starts" >&2
    fi
  else
    echo "startup: no previous config to restore; $DST holds the rejected config" >&2
  fi
  nginx_failed "$reason"
}

# A fatal failure AFTER a successful reload cannot be rolled back the way the earlier ones can, so
# it gets its own containment. nginx is already serving the new config: restoring $DST.bak would
# rewrite disk while memory kept the very config that just failed - the silent divergence this
# exists to prevent - and $DST.bak may itself be Azure's unprotected default, which must never be
# put back in front of users on a guess. Stop nginx instead: the failed config stops being served,
# and both files stay on disk so what was refused, and what the previous one was, remain visible.
#
# Confirmed by the 2026-10-31 incident: on the host `startup.sh` exited 1 and the site KEPT
# SERVING the unhardened config, so exiting non-zero is not containment on its own - the startup
# command there is `/home/site/wwwroot/deploy/startup.sh; php-fpm;`, and `;` runs php-fpm whatever
# startup.sh returns. Azure's process lifecycle cannot be proven from this repo (see
# POST_DEPLOY_VERIFICATION.md), so this does the part that is provable: make nginx stop.
#
# A stop command's exit status is no more evidence than startup.sh's was. `nginx -s stop` returns 0
# whenever the signal was delivered, which is not the same as the process being gone, so the log
# below may only claim containment after checking the process itself. Which of the three outcomes
# happened is always one of the three lines: stopped, still running, or unverifiable.
contain_and_fail() {
  local stop_tries=0 pgrep="${TT_PGREP_PROBE:-pgrep}"
  echo "startup: FAIL-CLOSED: nginx is already serving the rejected config; stopping it" >&2
  nginx -s stop 2>/dev/null || service nginx stop 2>/dev/null || true
  if ! command -v "$pgrep" >/dev/null 2>&1; then
    # Claiming a stop that was never observed is the same class of mistake as trusting exit 1, so
    # say the check could not run rather than report containment the script cannot stand behind.
    echo "startup: CONTAINMENT UNVERIFIED: no pgrep on this host, so whether nginx stopped is unknown" >&2
  else
    while [ "$stop_tries" -lt 5 ] && "$pgrep" -x nginx >/dev/null 2>&1; do
      stop_tries=$((stop_tries + 1))
      sleep 1
    done
    if "$pgrep" -x nginx >/dev/null 2>&1; then
      echo "startup: CONTAINMENT INCOMPLETE: nginx is STILL RUNNING and still serving the rejected config" >&2
    else
      echo "startup: nginx stopped; it is no longer serving the rejected config" >&2
    fi
  fi
  echo "startup: the rejected config remains on disk at $DST; $DST.bak was NOT restored" >&2
  nginx_failed "$1"
}

# DST.bak has to outlive every check that can still reject the new config, so it is kept past
# the reload and the behavioural self-check below and dropped only when those pass. Until
# 26d440d it was removed the moment `nginx -t` succeeded, which left the reload failure path
# with nothing to restore - the reload runs against the file that was just installed, so it
# is exactly the check most likely to need the old copy back.
if [ -f "$SRC" ]; then
  # A backup that fails stops the install here, before $SRC overwrites $DST: without a copy of the
  # config that is in place there is nothing to roll back to, and the later "no previous config"
  # would report a failed backup as a destination that never held one.
  if [ -f "$DST" ]; then
    cp -p "$DST" "$DST.bak" || nginx_failed "could not back up $DST to $DST.bak; $DST left untouched"
  fi
  cp "$SRC" "$DST" || restore_and_fail "could not copy $SRC to $DST"
  if ! nginx -t; then
    restore_and_fail "new config invalid"
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

# `service nginx reload` needs a service manager App Service containers do not always have,
# so signal the running master directly first and keep the service call as the fallback.
reload_nginx() {
  nginx -t || return 1
  nginx -s reload 2>/dev/null && return 0
  service nginx reload 2>/dev/null && return 0
  return 1
}

# A reload that fails leaves nginx not loading the config that was just installed, so it rolls
# back like any other rejection instead of trusting a swap that did not happen.
reload_nginx || restore_and_fail "final nginx test or reload failed"

# `nginx -t` only proves the file parses. These probes prove the rules are live on this host.
probe() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:8080$1" 2>/dev/null
}

if ! command -v curl >/dev/null 2>&1; then
  echo "startup: curl unavailable; applied the config without the behavioural self-check" >&2
else
  answered=0
  tries=0
  while [ "$tries" -lt 5 ]; do
    code=$(probe /index.html)
    if [ -n "$code" ] && [ "$code" != "000" ]; then answered=1; break; fi
    tries=$((tries + 1))
    sleep 2
  done

  if [ "$answered" != "1" ]; then
    echo "startup: nginx is not answering on 127.0.0.1:8080; the behavioural self-check was skipped" >&2
  else
    # A miss here means the rules are not live. `deny all` answers 403 whether or not the file
    # exists, so these depend on the config alone and are fatal.
    for check in "/Data/current.json:403" "/package.json:403" "/Tests/php/run.php:403"; do
      path=${check%:*}
      want=${check#*:}
      got=$(probe "$path")
      if [ "$got" != "$want" ]; then
        # The reload above already succeeded, so this is the one rejection with no safe rollback.
        contain_and_fail "self-check: $path returned $got, expected $want"
      fi
    done
    # Advisory: the login page needs /home/site/secure/htpasswd to exist, which is host state
    # rather than config, so a miss is reported and does not stop the site.
    login=$(probe /api/login.php)
    if [ "$login" != "401" ]; then
      echo "startup: WARNING: /api/login.php returned $login, expected 401 (check /home/site/secure/htpasswd)" >&2
    fi
    mkdir -p "$(dirname "$OK_MARKER")" 2>/dev/null
    {
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) nginx config applied and self-checked"
      echo "sha256 $(sha256sum "$DST" | cut -d' ' -f1)"
    } > "$OK_MARKER" 2>/dev/null
    echo "startup: nginx config applied and self-checked" >&2
    # Only a verified install drops the backup: when the self-check was skipped the previous
    # config stays on disk as the operator's rollback copy.
    rm -f "$DST.bak" 2>/dev/null
  fi
fi
