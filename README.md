# octoscode-web

The focused browser client for [Octoscode](https://github.com/octos-org/octoscode)
and the Octos coding UI Protocol.

This repository is deliberately separate from
[`octos-web`](https://github.com/octos-org/octos-web). It is a coding workspace,
not the general Octos product dashboard. It is also not a second harness:
`octos serve` remains the only owner of agents, models, tools, sandboxes,
approvals, sessions, tasks, and replay.

## Status

The first vertical slice is in progress. The current app can connect to a real
`/api/ui-protocol/ws` endpoint, negotiate capabilities, open a coding session,
send `turn/start`, and inspect the incoming event stream. Durable projection,
approval, question, diff, task, and artifact surfaces follow in the MVP plan.

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
[Octoscode semantic parity contract](docs/adr/0003-octoscode-semantic-parity.md).

## Checks

```sh
pnpm check
```

## License

Apache-2.0.
