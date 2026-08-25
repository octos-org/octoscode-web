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
generated, versioned TypeScript contract emitted by the Octos repository and
verified against golden wire fixtures. Until that exists, this repository only
defines the narrow request fields it sends and treats all unrecognized payload
fields as `unknown`.

The client must fail closed on malformed JSON-RPC frames, advertise requested
features during the WebSocket handshake, and render controls from the server's
accepted capabilities rather than from build-time assumptions.

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
