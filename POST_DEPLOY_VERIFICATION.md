# Post-deploy verification

`nginx -t` proves a config *parses*. It does not prove the running host *applies* it. On
2026-10-31 the hardening config was deployed, the deploy workflow went green, and every rule in
it was inert on `dsct.dev`: `/package.json` was served, `/Tests/php/run.php` executed, and no
security header was sent. Nothing in CI could notice, because nothing in CI asked the live host
a question.

[`deploy/verify-hardening.mjs`](deploy/verify-hardening.mjs) asks those questions. It only ever
sends read-only `GET`s.

## Running it

```
node deploy/verify-hardening.mjs https://dsct.dev
```

The base URL also comes from `VERIFY_BASE_URL`. The GitHub workflow
[`.github/workflows/post-deploy-hardening.yml`](.github/workflows/post-deploy-hardening.yml)
runs it after every successful deploy, checking out the commit that was deployed and passing it
as `VERIFY_SHA` so the report names the artifact it tested. Any failed check exits non-zero and
annotates the workflow run, so a deploy that does not actually harden the host turns red instead
of going quietly green.

## What it checks

Expected codes and headers, and why each one only an applied config can produce:

| Probe | Expected | Why |
| --- | --- | --- |
| `/Api/login.php` | 404 | Azure's `wwwroot` is case-insensitive, so a case-sensitive prefix match lets the request reach PHP |
| `/Api/versions.php` | 404 | same case-varied bypass |
| `/Data/current.json` | 403 | same, on the data path |
| `/Deploy/startup.sh` | 403 | deploy scripts must not be downloadable |
| `/Tests/php/run.php` | 403 | a stale tests tree on the host must not execute PHP |
| `/Package.json` | 403 | `package.json` is denied in any casing |
| `/package.json` | 403 | same |
| `/api/login.php` | 401 + `www-authenticate: Basic` | the one route that is supposed to prompt, and must still prompt |
| `/data/current.json` | 200 | the board payload must keep loading |
| `/` | 200 + the 6 security headers | entry point |
| `/app.js` | 200 + the 6 security headers | a location with its own `add_header` does not inherit the set |
| `/data/current.json` | 200 + the 6 security headers | same, on the data location |

Advisory (reported as `WARN`, never fails the gate): `content-encoding` on `/app.js` and
`/data/current.json` (gzip), and the `Server` header not advertising an nginx version.

The header set is `strict-transport-security`, `content-security-policy`, `x-frame-options`,
`referrer-policy`, `permissions-policy` and `x-content-type-options`; `x-powered-by` must be
absent entirely.

A warning never softens a wrong status. `/data/current.json` carries an advisory on
`Cache-Control`, and a deny rule that wrongly catches that path returns 403 with no
`Cache-Control` — that is a dead board, so the status assertion wins and the check fails.

## Reading a failure

`server_tokens off` is the cleanest single signal: if the response still advertises
`nginx/1.x`, the custom config is not loaded no matter what else looks right.

If the gate fails, the config is on the host and nginx is not loading it. In order:

1. **Startup Command.** It must run `deploy/startup.sh`. The observed value is
   `/home/site/wwwroot/deploy/startup.sh; php-fpm;` — and note the `;`: php-fpm starts whatever
   `startup.sh` returns, so a non-zero exit from the script is *not* by itself a guarantee the
   app is down.
2. **`/home/LogFiles/startup-nginx-error.txt`.** Present means the last boot *refused* the
   config, and the file's single line is the reason. Fix `deploy/nginx-default.conf` and
   redeploy; do not edit the file on the host.
3. **`/home/LogFiles/startup-nginx-applied.txt`.** Present means the last boot applied the
   config *and* passed the behavioural self-check. Its second line is the SHA-256 of the
   installed file, so it can be matched against the repo. The script deletes this file at the
   start of every boot, so its absence is meaningful: it means this boot did not verify, even
   when it also did not fail.
4. **The startup log.** `startup:` lines carry the full story — which of the two reload methods
   was used, whether a probe mismatch stopped nginx, and whether a skipped check was skipped for
   a missing `curl` or a host that was not answering.

## Host checklist

Needs portal or shell access; not part of the automated gate.

- The Startup Command is set and starts with `deploy/startup.sh`.
- `/home/site/secure/htpasswd` exists. If it does not, the config applies fine and the login
  probe answers something other than 401, which is reported as a warning rather than a failure.
- The leftover `/home/site/wwwroot/tests` tree is deleted. `webapps-deploy@v3` overlays — it does
  not remove files a commit stopped shipping — so a tree like this survives every deploy.
  `POST /Tests/php/run.php → 403` proves it is unreachable, not that it is gone.
- The deployed `deploy/startup.sh` and `deploy/nginx-default.conf` match the commit being
  tested.

## The Azure lifecycle limitation

This repository cannot prove what Azure App Service does to an instance when the Startup Command
exits non-zero. What is *observed* is narrower and worse than "it comes back up clean": on
2026-10-31 `startup.sh` exited 1 and `dsct.dev` kept serving the unhardened config.

So the fail-closed path does not rely on the exit code. When a config has already been reloaded
and then fails its behavioural self-check, the script stops nginx, because that is the part of
"unavailable" a script in that position can actually cause. It does not restore the backup:
`/etc/nginx/sites-available/default.bak` is whatever was in place before the install, which on a
fresh instance can be Azure's default with no password on `api/login.php` and nothing protecting
`data/`.

## Deliberately not checked

- **The login throttle.** It needs six requests inside a minute, which would answer `429` to
  every request from the caller's IP for the rest of that minute. Running it from the verifier
  would rate-limit CI, and running it from the owner's network would rate-limit the owner. Verify
  it by reading `deploy/nginx-default.conf` and, if it must be exercised, from a throwaway
  network.
- **PHP and upload behaviour.** Those are application concerns; the verifier exists to answer one
  question, which is whether nginx is serving the rules the repo thinks it deployed.