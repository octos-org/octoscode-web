# Deployment contract

`octoscode-web` is a static browser client. The release archive contains the
contents of `apps/web/dist`, the Apache-2.0 license, third-party notices, and
this deployment contract. It does not contain or start an Octos runtime.

## Build and release identity

Every build emits `/octoscode-web-build.json` with:

- the Web release and exact source revision;
- the UI Protocol version;
- the exact Octos Core revision and protocol blob used by the generated
  vocabulary and checked payload fixtures;
- the exact released Core tag/revision exercised by the checksummed runtime
  smoke, including required base/onboarding capabilities and known optional
  forward methods.

Release tags must look like `v0.1.0` or `v0.1.0-rc.1`. The release workflow
repeats all checks, Chromium product tests, and the checksummed pinned-Core
runtime smoke, builds with the tag and commit, then publishes
`octoscode-web-<tag>.tar.gz` and its SHA-256 file. A tag is the release identity;
moving release tags is unsupported.

To build for an absolute subpath, set a slash-terminated base path:

```sh
OCTOSCODE_WEB_BASE_PATH=/octoscode/ pnpm build
```

Root deployments use the default `/`. A malformed base path fails the build.

## Hosting requirements

Serve the extracted directory over HTTPS and route unknown application paths
to `index.html`. Use these cache policies:

- `index.html` and `octoscode-web-build.json`: `no-cache`;
- hashed files under `assets/`: `public, max-age=31536000, immutable`;
- `LICENSE`, `THIRD_PARTY_NOTICES.md`, and `DEPLOYMENT.md`: `no-cache`.

Set at least `X-Content-Type-Options: nosniff`, a restrictive
`Referrer-Policy`, and a deployment-specific Content Security Policy. The CSP
must allow WebSocket connections to the intended Octos origins through
`connect-src`; do not use a blanket `connect-src *` in production.

`deploy/nginx.conf` is the checked root-path, same-origin reference. It ships
with the release archive and includes SPA fallback, immutable hashed-asset
caching, security headers, WebSocket proxying, and a privacy access-log format
that omits query strings. Replace its public host/origin assumptions and set
`OCTOS_APPUI_ALLOWED_ORIGINS` on Octos before production use. Its CSP assumes
the browser connects through the same `/api/` proxy; direct cross-origin WSS
requires an explicit deployment-specific `connect-src` origin. Enable its HSTS
line only after the public host is HTTPS-only.

## Octos runtime boundary

Run a compatible `octos serve` separately. The operator supplies its origin,
server-side workspace path, session id, and (when configured) auth token in the
connection surface. Same-origin reverse proxying is recommended because it
simplifies TLS, origin policy, and CSP. A cross-origin deployment requires the
Octos endpoint or reverse proxy to accept the Web application's `Origin`.

The browser client never writes the auth token to local storage. The current UI
Protocol transports it in the WebSocket URL query, so HTTPS/WSS is mandatory
outside loopback and reverse proxies must redact query strings from access
logs. Treat captured URLs as credentials.

Compatibility is capability-gated at runtime. The build manifest records the
contract verified during release, but it is not a promise that every future or
older server is compatible. Unsupported required methods or features fail
closed in the connection surface.

## Rollback and health

Keep the preceding immutable archive available. Rollback consists of serving
the preceding extracted bundle; server-owned sessions and task state are not
stored in the static deployment and are therefore unaffected. A deployment is
healthy when `index.html`, one hashed asset, and
`octoscode-web-build.json` return successfully and a browser can complete
capability negotiation with its target Octos server.
