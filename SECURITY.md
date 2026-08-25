# Security policy

## Supported versions

Security fixes target the latest published release and `main`. Pre-release
builds may change protocol compatibility, but credential handling and
server-owned safety boundaries are never considered experimental.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for
[`octos-org/octoscode-web`](https://github.com/octos-org/octoscode-web/security/advisories/new).
Do not open a public issue for an unpatched vulnerability and do not include
auth tokens, API keys, server URLs containing query credentials, transcripts,
or private repository content in a report.

Include the affected Web revision or release, Octos Core version, browser, a
minimal reproduction, and the security impact. If private reporting is not
available to your account, contact an Octos organization owner and ask for a
private channel before sending sensitive details.

## Security boundary

octoscode-web is a static client. `octos serve` owns authentication, profiles,
models, tools, permissions, approvals, workspaces, sessions, tasks, and durable
replay. Reports about those server-side controls belong in the
[`octos`](https://github.com/octos-org/octos) repository unless the Web client
misrepresents or bypasses them.

The browser keeps connection and model credentials in memory only. The current
UI Protocol may carry an auth token in the WebSocket query, so non-loopback
deployments must use HTTPS/WSS and access logs must omit query strings. See
[`deployment contract`](docs/deployment.md) for production requirements and
[`protocol integration`](docs/protocol.md) for client-side trust boundaries.
