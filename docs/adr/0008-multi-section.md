# 8. Multi-section routing, storage, and auth

**Status.** Accepted (supersedes [ADR 0005](0005-multi-section-deferred.md)). Plan only — not yet implemented.

We support additional operator-provisioned Sections (starting with Section B, expandable to C/D later) without adding accounts, a database, a build step, or migrating Section A's live data. Each non-root Section is served from an unlisted sub-path `/s/<id>/<token>/` backed by a stable Section ID (`b`), with its own `data/sections/<id>/` directory, its own `htpasswd` file, and its own nginx login rate-limit zone.

## Considered Options

- **Unlisted sub-path `/s/<id>/<token>/` + per-section `htpasswd` (chosen):** keeps nginx static serving (ETag/304) for boards and uploads, keeps `index.html` and relative `API` paths unchanged, isolates admin cookies by `SCRIPT_NAME` path, lets the client read the stable Section ID from the URL offline with zero extra network calls, and delegates section authorization to nginx with zero PHP role-map logic.
- **Same URL (`dsct.dev`) + `#invite=<token>` → `HttpOnly` Reader Grant cookie + PHP role map:** hides the token from bookmarks and allows active-reader revocation, but breaks static board/upload serving for B, requires PHP auth on every read/attachment, needs an invite-exchange endpoint and owner switcher UI, and introduces cross-tab collisions.
- **Separate subdomains (`b.dsct.dev`):** isolates `localStorage` automatically, but requires per-section DNS/TLS/Azure custom-domain changes and makes token rotation touch DNS.
- **Migrating Section A into `data/sections/a/`:** symmetric on disk, but forces a risky live migration of A's board, snapshots, uploads, and admin state for no user-visible benefit.

## Consequences

- **Section A stays untouched:** `data/`, root URL, `localStorage` keys, and all 14 golden screenshots remain byte-identical.
- **Secrets stay out of git:** host-only wildcard nginx includes (`/home/site/secure/sections-http-*.conf` and `/home/site/secure/sections-server-*.conf`) hold live tokens, `htpasswd_<id>` paths, and per-section `limit_req_zone` rules. Missing files pass `nginx -t` cleanly in CI.
- **No forged section switching:** PHP reads `$_SERVER['TT_SECTION']` set exclusively by nginx `fastcgi_param` (never query params or HTTP headers).
- **Rotation preserves student progress:** changing `<token>` invalidates the old Section Link (page, board, API, uploads all return 404) via `nginx -s reload`, while browser storage stays keyed by the stable Section ID (`b_*`).
- **Accepted trade-offs:** the token appears in B's address bar/bookmarks; while A stays at the root URL, B's students can still view A by visiting `dsct.dev`; there is no in-app cross-section switcher (the Owner opens each Section in its own tab).
