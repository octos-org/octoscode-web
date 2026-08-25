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
paged task artifacts. Session switching and workspace product surfaces follow
in the MVP plan.

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
Copied or adapted third-party portions are listed in
[the notices](THIRD_PARTY_NOTICES.md).

## Checks

```sh
pnpm check
```

## License

Apache-2.0.
