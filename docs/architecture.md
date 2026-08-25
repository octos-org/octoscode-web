# Architecture

## Runtime ownership

```text
Browser
  octoscode-web
    presentation + local view state
    JSON-RPC client + projection reducers
          |
          | WebSocket /api/ui-protocol/ws
          v
  octos serve
    AppUI contract, session ledger, replay
    agent loop, models, tools, sandbox, approvals, tasks
```

Octoscode TUI and octoscode-web are sibling clients. Neither client calls the
other and neither owns the runtime.

## Dependency direction

`apps/web` depends on `packages/client`. The client package has no React
dependency and owns only transport mechanics: URL construction, JSON-RPC
correlation, frame validation, and typed command helpers for the slice already
implemented.

The application owns projection and UI state. A protocol notification is
converted into a feature-specific action before it reaches React. Durable
session orchestration lives in one feature boundary (`useOctosSession` plus a
React-free integrity reducer), not in the visual shell. We will not repeat
octos-web's bridge → global event bus → compatibility store → projection store
chain.

## Protocol source of truth

The authoritative contract lives in `octos-core`:

- `crates/octos-core/src/app_ui.rs`
- `crates/octos-core/src/ui_protocol.rs`

The Rust TUI consumes those types directly. A browser cannot. The target is a
generated, versioned TypeScript contract emitted by the Octos repository. Until
that exists, the client defines only the narrow request/result slice it uses
and checks it against an exact Core revision and contract-blob fixture in
`packages/client/tests/fixtures`. Safety-bearing permission enums fail closed;
display-only diff status, source, file-status, and line-kind labels remain
forward compatible after their surrounding structure is validated.

The client must fail closed on malformed JSON-RPC frames, advertise requested
features during the WebSocket handshake, and render controls from the server's
accepted capabilities rather than from build-time assumptions.

Permission profiles and diff previews remain server-owned state. The Web app
uses `permission/profile/list` before enabling any mutation, submits only a
selection advertised for the active session, and treats the set response as
authoritative. It discovers preview ids only from typed approval or file
mutation fields, then reads the proposal-time snapshot with `diff/preview/get`.
It never computes a replacement git diff in the browser or scrapes ids from
tool prose.

## Browser constraints

- A browser cannot spawn `octos serve`; standalone use requires an existing
  local or remote server.
- Browser WebSocket APIs cannot attach an `Authorization` header. The current
  Octos endpoint accepts `?token=` plus repeated `ui_feature` parameters. This
  is a transitional transport limitation; tokens are kept only in memory.
- The workspace path is a path on the server host. The server validates it
  against its configured roots.
- Reconnect is incomplete without cursor replay, hydrate, dedupe, gap repair,
  and `protocol/replay_lossy`. The app must implement that set as one invariant,
  not add a blind reconnect loop.

## Extension boundary

Octos runtime plugins and skills stay server-side. A future browser extension
API may contribute only presentation elements such as tool renderers, panels,
commands, and artifact viewers. It must not load arbitrary remote code by
default or create a second agent/service container in the browser.
