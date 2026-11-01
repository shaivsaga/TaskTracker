# P4 — HSTS risk analysis for dsct.dev

**Worktree:** `TT-ov-briefs` @ `ov/owner-briefs` (origin/main `2222eb4`) · **Date:** 2026-11-01
**Documentation only — no config was edited.** Any proposed diff below is for the owner to apply.

## 1. Evidence from the repo

### 1.1 Which hostnames serve the app

- README.md:7 — **Live site: https://dsct.dev** (apex only).
- `deploy/nginx-default.conf:33` — `server_name example.com www.example.com;` is a **placeholder**.
  The config is the single server block on `listen 8080` behind Azure's front end, so it serves
  whatever Host arrives; no repo file claims `www.dsct.dev` or any subdomain.
- `deploy/verify-hardening.mjs:24` and `.github/workflows/post-deploy-hardening.yml:31` probe only
  `https://dsct.dev`.
- `tests/php/run.php:64-67` uses `dsct.dev` only as a Host-header fixture.
- No `azurewebsites.net`, `scm.` or `*.dsct.dev` reference exists anywhere in the repo (grepped).

**Unresolvable from the repo:** whether `www.dsct.dev` or any other subdomain exists in DNS and,
if so, whether it serves valid HTTPS. That is a portal/DNS fact, not a repo fact.

### 1.2 Where HTTP→HTTPS redirect happens

The repo nginx **only listens on 8080 (plain HTTP)** — no `listen 443`, no TLS material in the
config. README.md:110 states "HTTPS Only is turned on" (an Azure App Service portal setting), and
the audit observed `http://dsct.dev/ → 301` to HTTPS live on 2026-10-30. Conclusion: TLS
termination and the HTTP→HTTPS redirect are **platform-side (Azure)**; nginx never sees plain
HTTP from the public internet. This means HSTS is the only client-side guarantee that the
interceptable first hop (the plain-HTTP request before the 301) stays protected.

### 1.3 Current HSTS state and rationale

- `deploy/nginx-default.conf:80` sets `add_header Strict-Transport-Security "max-age=300" always;`
  at server level, **repeated verbatim in five locations** that declare their own `add_header`
  (lines 96, 119, 153, 166, 176) because nginx does not inherit `add_header` into such locations.
- The config's own comment (lines 77-78): *"HSTS deliberately starts at 300s to leave a rollback
  window. Raise it to max-age=31536000 and add includeSubDomains once HTTPS is confirmed good."*
- Rollback story at 300 s: if HSTS causes harm (e.g. a hostname with broken TLS), every browser's
  remembered policy expires within 5 minutes of its last response. At 31536000 s (1 year) the
  policy is sticky for a year; unwinding means waiting, per-browser `chrome://net-internals`
  clearing, or sending `max-age=0` — which only helps browsers that visit the (HTTPS) site again.
- `deploy/verify-hardening.mjs:29` asserts HSTS with `/max-age=\d+/` — it matches **any** value, so
  a staged raise will not break the gate, and the gate today cannot distinguish 300 from a year.
- **Status correction (supersedes the sources cited here at the time of writing):** the
  "0/15 / hardening not in effect" reading in `POST_DEPLOY_VERIFICATION.md` and
  `HARDENING_GATE_REVIEW_2026-10-31 §E` predates the hotfix — that header text was committed at
  09:49Z on 2026-10-31. PR #28 (`f88b83c`) then loaded the config, and the CI post-deploy
  verifier has passed against the live host since: run `41191712557`, conclusion **success**,
  `workflow_run` on headSha `2222eb4`, 2026-10-31T10:11Z. The verifier exits non-zero on any
  failed probe, so dsct.dev **is sending** `Strict-Transport-Security: max-age=300` today.
  `max-age=300` is an *observed* value; the raise below changes a live header rather than
  activating a dormant one.

## 2. Risks

### Raising `max-age` now

1. **The header is not confirmed live.** Raising a value on a header the host is not even sending
   optimises a control whose activation has not yet been observed. First milestone is the host fix
   (duplicate-gzip → `startup.sh` passes `nginx -t` → `verify-hardening.mjs` 15/15 green).
2. **Wrong-value risk with no observation loop.** The verifier's HSTS regex accepts any
   `max-age=\d+`; a fat-fingered value (e.g. `315360000` — ten years) would pass every gate.
3. **TLS coverage unproven per hostname.** HSTS upgrades *all* HTTP navigation to the exact host
   it was received on. If any hostname serving users (apex, `www.`, a staging subdomain) lacks a
   valid cert, HSTS turns a soft redirect into a hard lockout for affected visitors.
4. **A long max-age removes the 5-minute rollback window** the current 300 s was chosen to
   preserve. The 60-day admin session cookie raises the cost of a lockout: the cookie is
   `Secure`-gated, so an HTTP-only user path simply dead-ends.

### `includeSubDomains` / `preload` without evidence

- `includeSubDomains` applies the policy to **every** subdomain of dsct.dev, including ones this
  repo has never mentioned (mail, staging, legacy, `www`). No repo evidence establishes that
  inventory. Enabling it blind can silently break sibling services whose existence is only known
  outside this repository.
- `preload` additionally requires (per the HSTS preload program) `max-age ≥ 31536000` **and**
  `includeSubDomains` on the apex, HTTPS on **every** subdomain of the zone (including bare
  subdomains that don't resolve), and a list submission whose removal takes months. The repo
  contains **zero evidence** about subdomain coverage — preload is not merely premature, it is
  irreversible on a human timescale.
- The audit's own recommendation (§3.2) — `max-age=31536000; includeSubDomains` — assumed a
  level of verification that POST_DEPLOY_VERIFICATION §2 has since shown did not happen.

## 3. Recommended policy (staged)

Keep the 300 s rollback window until the host is *observed* hardened, then raise in steps, each
step conditioned on the verifier passing. Do not add `includeSubDomains` or `preload` until the
owner answers the subdomain question in §5.

| Stage | Trigger | Policy |
|---|---|---|
| 0 (now) | — | `max-age=300` (unchanged; currently not observed live anyway) |
| 1 | `node deploy/verify-hardening.mjs https://dsct.dev` passes 15/15 after a deploy | `max-age=86400` (1 day) |
| 2 | Stage 1 green for one week of deploys + QA | `max-age=604800` (1 week) |
| 3 | Stage 2 clean | `max-age=2592000` (30 days) |
| 4 | Owner confirms subdomain inventory and per-host HTTPS | `max-age=31536000; includeSubDomains` |
| 5 | Owner explicitly opts into preload submission | `; preload` appended (submit dsct.dev) |

Each raise is a one-token change in the six HSTS lines; roll back by moving back down one stage —
browsers take the lower max-age on next visit, so a downward move is a staged unwind, not a reset.

**Proposed Stage-1 diff** (owner applies; do not edit until Stage 1's trigger fires):

```diff
--- a/deploy/nginx-default.conf
+++ b/deploy/nginx-default.conf
@@ # applies to all six lines: server block (line 80) and the five repeated
   # location copies (lines 96, 119, 153, 166, 176)
-    add_header Strict-Transport-Security "max-age=300" always;
+    add_header Strict-Transport-Security "max-age=86400" always;
```

Optionally tighten the verifier at the same time so the gate guards the value it now guards:

```diff
--- a/deploy/verify-hardening.mjs
+++ b/deploy/verify-hardening.mjs
@@ -29,1
-  ['strict-transport-security', /max-age=\d+/],
+  ['strict-transport-security', /max-age=\d+/],   // stage N: pin the expected max-age here
```

(The second change is optional; its value is that a wrong raise becomes a red check instead of a
silent one. Keep it in sync with the stage table.)

## 4. What does NOT need deciding today

- Whether to enable gzip/CSP etc. — those are the Phase 0–1 items already in the tree.
- Redirect placement — the Azure-side 301 is correct and needs no repo change (nginx has no TLS).

## 5. DECISION NEEDED FROM OWNER

1. **Subdomain inventory:** list every hostname under `dsct.dev` that exists in DNS (including
   `www` and any staging/service subdomains) and confirm whether each serves valid HTTPS or
   resolves to nothing. This is the gate for `includeSubDomains` (Stage 4) and answers whether the
   app is truly reachable from only one hostname.
2. **Approve the staged max-age raise** (§3) or set a different final ceiling; state who runs
   `verify-hardening.mjs` and records each stage transition.
