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

Plans, runtime policy, task lifecycle, output, and artifacts are projections of
server-owned work. The Web client uses the advertised `session/status/read`,
`task/list`, `task/output/read`, `task/cancel`, `task/artifact/list`, and
`task/artifact/read` methods plus `plan/updated`, `task/updated`, and
`task/output/delta`. Output cursors are byte offsets: durable replay is
deduplicated against the last read cursor, gaps fail closed, and large output
or artifact bodies are read in bounded pages. The raw protocol inspector stays
available as folded diagnostics, not as the primary product surface.

Workspace navigation is also server-authoritative. `session/list` may be
scoped by `cwd` only after `session.workspace_cwd.v1` is negotiated. Creating a
session means opening a new explicit id; switching closes the current protocol
connection and reopens the selected durable session against the same server.
The browser preserves only unsent per-session drafts. It never copies runtime
state across sessions. `session/files.list` is rendered as safe server-owned
output metadata, not treated as a general repository filesystem API.

Core exposes permanent `session/delete`, but no archive RPC. The product names
that action truthfully, requires an inline second confirmation, and never
offers it for the active session. Live context and cost come from typed
`token_cost_update` progress metadata and are merged with the latest
`session/status/read` usage snapshot.

For a path-based first launch, the Web client requests
`config/capabilities/list` before opening a session. It calls `launch/resolve`
only when the method and `session.workspace_cwd.v1` are both advertised. A
`resume` decision opens the exact Octoscode coding identity
`<profile>:local:tui#coding`; `activate` and `cross_profile` require the same
user choices as the TUI launch menu; `no_profile` points to `octoscode onboard`.
An older server without the capability falls back to the explicitly entered
session id. A reconnect before the user chooses repeats resolution instead of
silently opening that fallback session.

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
