# octoscode-web

The focused browser client for [Octoscode](https://github.com/octos-org/octoscode)
and the Octos coding UI Protocol.

This repository is deliberately separate from
[`octos-web`](https://github.com/octos-org/octos-web). It is a coding workspace,
not the general Octos product dashboard. It is also not a second harness:
`octos serve` remains the only owner of agents, models, tools, sandboxes,
approvals, sessions, tasks, and replay.

## Status

The first product slice is usable against a current Octos server. It negotiates
capabilities, hydrates durable transcript state, resumes with a cursor, detects
projection gaps and lossy replay, reconnects with backoff, preserves the FIFO
prompt contract, renders typed approvals and structured user questions, and
shows settled GFM with lazy syntax highlighting. It also exposes server-confirmed
per-session permission profiles and authoritative diff previews discovered from
typed coding events. The supervised-work surface renders the server's live plan,
runtime policy stamp, task lifecycle, cursor-safe output, cancellation, and
paged task artifacts. The workspace sidebar lists, creates, switches, and
permanently deletes server-owned sessions while preserving a draft per session;
it also exposes safe session-file metadata. Runtime usage combines the typed
status snapshot with live model cost and context-window updates. On narrower
screens, the supervision surface remains available as a keyboard-dismissible
drawer. When a server-side workspace path is supplied, startup follows
Octoscode's `launch/resolve` contract: resume is automatic, activation is
confirmed, cross-profile folders offer the same explicit choice, and a server
with no profile points to canonical onboarding.

## Run locally

Requirements: Node.js 22+ and pnpm 11.

```sh
pnpm install
pnpm dev
```

Run an Octos server separately and enter its origin (for example
`http://127.0.0.1:50080`), auth token, server-side workspace path, and session
id in the connection panel. A browser cannot spawn or auto-provision the Octos
binary, so the server must already be running.

For UI development without a local Octos data directory, run the narrow AppUI
fixture in a second terminal. It serves only the protocol methods used by the
current product slice and includes a Markdown/code transcript:

```sh
pnpm mock:server
```

## Repository shape

```text
apps/web          React product shell and feature UI
packages/client   React-free JSON-RPC/WebSocket client
docs/adr          architectural decisions and rejected alternatives
```

The intentionally small workspace leaves room for a generated protocol package
and reusable UI primitives when those boundaries are proven. It does not start
with DSH's full plugin graph or octos-web's product surface.

Read [the architecture](docs/architecture.md), [the MVP](docs/mvp.md), and the
[DSH evaluation](docs/adr/0002-dsh-evaluation.md) before expanding the package
graph. Web interaction behavior follows the
[Octoscode semantic parity contract](docs/adr/0003-octoscode-semantic-parity.md),
while product structure and visual language follow the
[DSH reference decision](docs/adr/0004-dsh-product-and-visual-reference.md).
Reconnect and hydrate follow the
[durable session decision](docs/adr/0005-durable-session-recovery.md).
Permission and diff review follow the
[coding safety surfaces decision](docs/adr/0007-coding-safety-surfaces.md).
Plans, tasks, output, and artifacts follow the
[supervised work decision](docs/adr/0008-supervised-work-surfaces.md).
Session navigation, safe file metadata, and usage follow the
[workspace session decision](docs/adr/0009-workspace-session-surfaces.md).
Pre-session repository launch follows the
[workspace launch decision](docs/adr/0010-server-resolved-workspace-launch.md).
Versioned artifacts follow the
[static release decision](docs/adr/0011-versioned-static-releases.md) and the
[deployment contract](docs/deployment.md).
Copied or adapted third-party portions are listed in
[the notices](THIRD_PARTY_NOTICES.md).

## Checks

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

The Playwright product suite starts the checked mock AppUI server and Web app,
then exercises launch resolution, durable session switching, a live turn,
responsive supervision, and WCAG 2/2.1 A/AA axe checks. CI runs it in a separate
Chromium job and retains traces and screenshots when it fails.

A top-level render boundary replaces white screens with a safe reload path and
a copyable diagnostic capped at 4 KB. Query-token and bearer-shaped values are
redacted before display; no auth token is persisted for crash reporting.

## Releases

A SemVer-like `v*` tag runs the full check and Chromium E2E gates before GitHub
publishes a versioned static archive and SHA-256 file. Each build contains
`octoscode-web-build.json`, which records its Web revision and the exact Octos
Core protocol contract covered by the fixtures. See the
[deployment contract](docs/deployment.md) before hosting or embedding it.

## License

Apache-2.0.
