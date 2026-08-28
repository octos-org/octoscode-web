# Architecture

octoscode-web is a presentation client for the Octos AppUI/UI Protocol. It
shares interaction semantics with the Octoscode TUI while leaving all runtime
authority in `octos serve`.

## System boundary

```text
┌──────────────────────────┐
│ Browser                  │
│                          │
│  React product UI        │
│          ↓               │
│  feature projections     │
│          ↓               │
│  React-free client       │
└────────────┬─────────────┘
             │ JSON-RPC / WebSocket
             │ /api/ui-protocol/ws
┌────────────▼─────────────┐
│ octos serve              │
│                          │
│ protocol + session ledger│
│ agents · tools · models  │
│ sandbox · tasks · replay │
└──────────────────────────┘
```

Octoscode TUI and octoscode-web are sibling clients. Neither invokes the other.
The Web app does not own agents, models, tools, plugin execution, sandboxing,
approvals, sessions, tasks, or replay.

## Package direction

```text
apps/web  ──depends on──▶  packages/client
  React                    no React dependency
  views                    transport
  feature state            frame validation
  projections              command helpers
```

`packages/client` owns wire mechanics and strict decoders for implemented
protocol slices. It must remain usable without React or browser presentation
state.

`apps/web` owns the product shell, feature projections, ephemeral view state,
and rendering. Product features stay in focused directories with colocated
presentation. The application must not grow a global god store, catch-all
bridge, or raw protocol event bus.

## State ownership

| State                                                         | Owner                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| Sessions, transcript, tasks, plans, permissions, diffs, usage | `octos serve`                                                        |
| Cursor, hydrate integrity, and current server projections     | Protocol/session feature boundaries                                  |
| Drafts, focus, selection, and expansion                       | Browser memory                                                       |
| Remembered server endpoint                                    | `localStorage`; the only durable browser preference                  |
| Token, auto-connect, and selected Session restore hints       | Endpoint-bound current tab (`sessionStorage`)                        |
| Recent Workspace paths                                        | Endpoint-bound current tab (`sessionStorage`)                        |
| Confirmed Session routing tuples and local recency            | Endpoint-and-token-bound current tab; navigation only, not a catalog |
| Retained acknowledged-turn owner transports                   | Current live tab; closed on refresh, loss, or Disconnect             |
| Provider credential draft                                     | Operation-local browser memory; sent only to Core                    |
| Saved provider credential                                     | `octos serve`; browser receives only `has_api_key`                   |

The selected-session orchestration boundary converts validated protocol
notifications into feature-specific actions. A committed `session/open` may add
its exact Workspace/Profile/Session routing tuple to tab navigation, but durable
state remains reconstructible from server hydrate/replay. Retained background
owner sockets preserve execution lifetime; they do not preserve a second copy of
transcript or Session state.

The React hook is a composition root, not a catch-all state API. Consumers see
grouped connection, conversation, interaction, safety, work, workspace-product,
and diagnostic domains. Connection/recovery and foreground-turn transitions live
in React-free controllers; overlapping refreshes use request generations so an
older response cannot overwrite newer session state. Ephemeral per-session
drafts use a 50-entry LRU, and the timeline exposes when its 200-row rendering
window omits older durable history.

## Interaction authority

Octoscode defines what commands and user actions mean. The browser may change
their presentation but not their state transition:

- slash and bang commands resolve before prompt dispatch;
- unknown or unavailable commands fail closed;
- prompt queueing and interrupt retain TUI semantics;
- approval decisions preserve request, session, and deny scope;
- workspace resolution validates the server path/profile decision, while New
  Session uses a fresh opaque Web identity;
- an unambiguous fresh Web `activate` follows the server-resolved Profile
  automatically, while `cross_profile` and `no_profile` remain explicit;
- a server-acknowledged local turn may retain its owner transport during Session
  navigation; pending local prompts block, while a dispatching start retains one
  latest-wins navigation intent and releases it only after the exact ACK;
- the composer reports the effective Session runtime model, while Settings may
  manage provider/model/route configuration and the active Profile default;
- provider keys are write-only operation arguments in the client; Core owns
  persistence and returns only a configured/not-configured projection.

DeepSeek Harness supplies the audited browser-product and visual reference. Its
Cordis host, agent runtime, and full plugin graph are not part of this system.
See [ADR 0002](adr/0002-dsh-evaluation.md) and
[ADR 0004](adr/0004-dsh-product-and-visual-reference.md).

## Browser constraints

- A browser cannot start `octos serve`; standalone use requires an existing
  local or remote server.
- WebSockets cannot attach an authorization header, so current query-token
  transport requires HTTPS/WSS and query-redacting logs outside loopback.
- Workspace paths refer to the server host and remain subject to server root
  policy.
- Authentication is separate from work selection. Inside the shell the product
  hierarchy is Workspace → Session, with Chat and Trajectory scoped to the
  selected Session.
- Per-server Workspace recents and server-confirmed Session routing tuples are
  bounded, tab-scoped navigation memory, not a durable catalog. Multiple tuples
  can share one Workspace path. Current `session/list` results carry no
  effective Workspace/Profile scope, so they are not used as a product catalog;
  only a successful exact open can add a Session row until Core exposes
  Workspace/SessionRef.
- Background continuation is transport-bound on Core rc.9. A server-acknowledged
  local turn may keep its owner socket while another Session is selected in the
  same live tab. Refresh, tab close, network loss, and Disconnect close that
  socket and terminate a still-running turn.
- Reconnect without hydrate, replay, dedupe, session scope, and gap handling is
  not recovery.

Only the connection origin is remembered durably. A successful connection binds
the token, auto-connect marker, active Workspace/Profile/Session restore hints,
recent Workspace paths, and confirmed Session routing tuples to that endpoint
and token in the current tab. Disconnect retains that navigation memory but
stops automatic reconnection; Forget or an identity change clears it. Closing
the tab leaves the origin but clears that working context. See
[ADR 0019](adr/0019-tab-session-navigation-and-background-turn-ownership.md) and
[ADR 0018](adr/0018-dsh-aligned-product-shell.md) for the current boundary.
[ADR 0017](adr/0017-workspace-session-and-connection-memory.md) is the
superseded historical restore design. Durable detached turn ownership remains a
Core contract tracked in
[octos#2167](https://github.com/octos-org/octos/issues/2167).

Detailed wire and compatibility rules live in
[Protocol integration](protocol.md).

## Extension boundary

Octos runtime plugins and skills stay server-side. A future browser extension
surface may contribute presentation such as tool renderers, panels, commands, or
artifact viewers. It must not load arbitrary remote code by default or create
another agent/service container in the browser.

New feature presentation uses colocated CSS Modules and shared theme tokens. The
legacy application stylesheet has a checked, non-growing line budget and is a
migration surface, not a place to append another feature. Repository policy also
rejects raw feature colors, inline JSX styles, retired token prefixes, and
sub-11px text.

## Verification layers

| Layer                   | Responsibility                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| Unit tests              | Parsers, reducers, queues, command rules, and feature rendering.                                              |
| Playwright              | Launch decisions, background turns, exact Session switching/persistence, responsive behavior, and WCAG gates. |
| Contract gate           | Generated vocabulary matches the immutable Core source/blob pin.                                              |
| Real-Core gate          | A checksummed released Core completes the browser-critical transport flow.                                    |
| Deployment verification | Static artifact identity, contents, base path, and hosting assumptions.                                       |

An application error boundary contains unexpected React failures, offers a safe
reload, and produces a bounded diagnostic with query tokens and bearer-shaped
credentials redacted. It does not add a remote crash collector or persist
connection credentials.

## Where to continue

- Change protocol behavior: [Protocol integration](protocol.md)
- Change supported product behavior: [Product scope](product.md)
- Host the static build: [Deployment contract](deployment.md)
- Understand a durable choice: [ADR index](adr/README.md)
