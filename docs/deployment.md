# Deployment contract

`octoscode-web` is a static browser client. The release archive contains the
contents of `apps/web/dist`, the Apache-2.0 license, adapted-source notices,
generated production dependency licenses, and this deployment contract. It does
not contain or start an Octos runtime.

## Build and release identity

Every build emits `/octoscode-web-build.json` with:

- the Web release and source-revision fields (local builds intentionally use
  `dev` / `unknown`; the release workflow injects the exact tag and commit);
- the UI Protocol version;
- the exact Octos Core revision and protocol blob used by the generated
  vocabulary and checked payload fixtures;
- the exact released Core tag/revision exercised by the checksummed runtime
  smoke, including required base/onboarding capabilities and known optional
  forward methods.

Release tags must look like `v0.1.0` or `v0.1.0-rc.1`. The release workflow
repeats all checks, Chromium product tests, and the checksummed pinned-Core
runtime smoke, builds with the tag and commit, then passes the exact archive to
a separate publish job. The publish job produces GitHub build-provenance
attestations and refuses to replace an existing release. It publishes
`octoscode-web-<tag>.tar.gz` and its SHA-256 file. A tag is the release
identity; moving release tags is unsupported.

To build for an absolute subpath, set a slash-terminated base path:

```sh
OCTOSCODE_WEB_BASE_PATH=/octoscode/ pnpm build
```

Root deployments use the default `/`. A malformed base path fails the build.

## Hosting requirements

Serve the extracted directory over HTTPS and route unknown application paths to
`index.html`. Use these cache policies:

- `index.html` and `octoscode-web-build.json`: `no-cache`;
- hashed files under `assets/`: `public, max-age=31536000, immutable`;
- `LICENSE`, `THIRD_PARTY_NOTICES.md`, `THIRD_PARTY_LICENSES.md`, and
  `DEPLOYMENT.md`: `no-cache`.

Set at least `X-Content-Type-Options: nosniff`, a restrictive `Referrer-Policy`,
and a deployment-specific Content Security Policy. The CSP must allow WebSocket
connections to the intended Octos origins through `connect-src`; do not use a
blanket `connect-src *` in production.

`deploy/nginx.conf` is the checked root-path, same-origin reference. It ships
with the release archive and includes SPA fallback, immutable hashed-asset
caching, security headers, WebSocket proxying, and a privacy access-log format
that omits query strings. Replace its public host/origin assumptions and set
`OCTOS_APPUI_ALLOWED_ORIGINS` on Octos before production use. Its CSP assumes
the browser connects through the same `/api/` proxy; direct cross-origin WSS
requires an explicit deployment-specific `connect-src` origin. Enable its HSTS
line only after the public host is HTTPS-only.

The reference enables compression, hides the nginx version, bounds request
bodies, and uses a CSP with no inline script/style allowance. Settled code
highlighting is converted from Shiki's closed inline-style vocabulary to static
classes. Remote transcript images are blocked, so `img-src` does not grant
arbitrary HTTPS origins. CI runs both the semantic deployment verifier (against
comment-stripped configuration) and `nginx -t`.

## Octos runtime boundary

Run a compatible `octos serve` separately. The connection gate asks for its
origin and, when configured, an auth token. Workspace selection happens after
authentication: New Session chooses a known Workspace, while Add workspace
accepts a path on the server host and creates a fresh Web Session. Session
identity is never an operator-facing login field. Same-origin reverse proxying
is recommended because it simplifies TLS, origin policy, and CSP. A cross-origin
deployment requires the Octos endpoint or reverse proxy to accept the Web
application's `Origin`.

Current Core responses do not report whether a `session/list({cwd})` request was
honored or silently served from the legacy profile-global store. Core rc.9 can
also lose the target Profile on an unscoped/admin known-path list and scan
`_main` instead. octoscode-web therefore does not use those rows as a Workspace
catalog, regardless of `appui.sessions_in_cwd`; the authoritative replacement is
tracked in [octos#2146](https://github.com/octos-org/octos/issues/2146).

The browser writes only the server endpoint to `localStorage`. It binds the auth
token, auto-connect marker, active Session/Workspace/Profile restore hints, and
recent Workspace paths to that endpoint in the current tab's `sessionStorage`.
Refresh can restore the active Session; closing the tab leaves only the
endpoint. Provider API keys are never persisted in browser storage. The current
UI Protocol transports the auth token in the WebSocket URL query, so HTTPS/WSS
is mandatory outside loopback and reverse proxies must redact query strings from
access logs. Treat captured URLs as credentials.

Compatibility is capability-gated at runtime. The build manifest records the
contract verified during release, but it is not a promise that every future or
older server is compatible. Unsupported required methods or features fail closed
in the connection surface.

## Rollback and health

Keep the preceding immutable archive available. Rollback consists of serving the
preceding extracted bundle; server-owned sessions and task state are not stored
in the static deployment and are therefore unaffected. A deployment is healthy
when `index.html`, one hashed asset, and `octoscode-web-build.json` return
successfully and a browser can complete capability negotiation with its target
Octos server.
