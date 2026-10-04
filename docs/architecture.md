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

| State                                                               | Owner                                                                                         |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Sessions, transcript, tasks, plans, permissions, diffs, usage       | `octos serve`                                                                                 |
| Cursor, hydrate integrity, and current server projections           | Protocol/session feature boundaries                                                           |
| Focus, selection, and expansion                                     | Browser memory                                                                                |
| Per-Session text drafts                                             | Browser memory and separate `localStorage` entries, scoped to REST-confirmed user and Session |
| Remembered server endpoint and explicitly saved display preferences | `localStorage`; no token, Session identity, or draft                                          |
| Token, auto-connect, and selected Session restore hints             | Endpoint-bound current tab (`sessionStorage`)                                                 |
| Recent Workspace paths                                              | Endpoint-bound current tab (`sessionStorage`)                                                 |
| Confirmed Session routing tuples and local recency                  | Endpoint-and-token-bound current tab; navigation only, not a catalog                          |
| Per-Session controller, FIFO, ledger, and bounded projection        | Retained in browser memory; server hydrate/replay remains authoritative                       |
| One pooled physical WebSocket                                       | Current authenticated tab; closed on refresh, loss, or Disconnect                             |
| Provider credential draft                                           | Operation-local browser memory; sent only to Core                                             |
| Saved provider credential                                           | `octos serve`; browser receives only `has_api_key`                                            |

Pairing replaces the previous connection identity and its tab-local restore
hints. Cancellation invalidates a pending claim; late replies cannot connect.
The HTML referrer policy protects pairing parameters before application code
removes them. Legacy device bearer entries are deleted when the connection gate
loads.

`SessionRecordManager` retains one executable controller/FIFO, interaction
ledger, durable cursor, and bounded timeline projection per confirmed scope:
`(endpoint, workspaceRoot, profileId, sessionId, authorityEpoch)`. The opaque
epoch separates authentication identities without putting credentials in keys.
`LazySessionRecordManager` loads this engine on the first explicit coding
Session open; authentication itself needs only the pooled transport.

Every record uses a non-owning runtime lease on that one physical WebSocket.
Validated events update their owning record whether selected or background;
selection only changes presentation. Candidate opens commit after scoped
hydrate/replay and authority checks. They never steal another record's queue.
Background forks and native peers become selectable only after confirmation.
These retained projections are not another durable transcript store.

The React hook is a composition root, not a catch-all state API. Consumers see
grouped connection, conversation, interaction, safety, work, workspace-product,
and diagnostic domains. Connection/recovery and per-record turn transitions live
in React-free controllers; overlapping refreshes use request generations so an
older response cannot overwrite newer session state. The text-draft cache evicts
the oldest insertion when a new draft reaches its 50-entry threshold; updating
an entry does not reorder it. Durable eviction is attempted separately, while
restore protects saved copies during cache rebuild. The timeline exposes when
its 200-row rendering window omits older durable history.

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
- Session switching does not wait for a turn ACK or an empty local FIFO; the
  source record keeps its queue and interactions while the destination opens. An
  unresolved turn-recovery state still blocks navigation until checked;
- native staged/closed events reach the master record's peer coordinator even in
  the background; hosting uses native identities and never changes focus;
- the composer reports the effective Session runtime model, while Settings may
  manage provider/model/route configuration and the active Profile default;
- provider keys are write-only operation arguments in the client; Core owns
  persistence and returns only a configured/not-configured projection.

Activity scans only eligible confirmed Session references while its dialog is
open. It reads `task/list` in batches of four and refreshes ten seconds after
each scan completes. Closing the dialog cancels polling; scanning never opens
Sessions. Trajectory remains scoped to the selected Session. See
[ADR 0022](adr/0022-activity-for-confirmed-sessions.md).

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
- The client does not provide detached continuation. Switching views does not
  close the shared socket, but refresh, tab close, network loss, and Disconnect
  can interrupt all connection-owned work. In-memory queues survive ordinary
  reconnect, pause during recovery, and reconcile against each Session's actual
  terminal state. Queued prompts and attachment drafts do not survive reload;
  unsent text can be restored from its separate draft storage.
- Reconnect without hydrate, replay, dedupe, session scope, and gap handling is
  not recovery.

Connection preferences persist the origin. Display preferences and unsent text
use separate durable storage. Text drafts are scoped to the server origin, the
user confirmed by REST `/api/auth/me`, and the Workspace/Profile/Session tuple.
They can survive tab closure; restoring them requires authentication and never
submits a turn. Forget attempts to remove that user's saved drafts, while an
identity change clears the active editing view. Storage failures are surfaced.
See [ADR 0021](adr/0021-user-scoped-durable-composer-drafts.md).

The token, auto-connect marker, selected Session restore hints, recent paths,
and confirmed navigation tuples remain bound to the current tab's endpoint and
token. Disconnect retains navigation memory but stops automatic reconnection;
Forget or an identity change clears it.
[ADR 0020](adr/0020-retained-sessions-on-a-shared-transport.md) records the
shared transport and retained queues that replace ADR 0019's per-owner sockets,
ACK navigation guard, and eight-connection budget.
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

The expanded parity implementation is a candidate. Passing fixtures, unit tests,
or a baseline runtime smoke is not a full parity or live-soak acceptance; see
[Feature parity](feature-parity.md) and [Testing](testing.md).
[`core-runtime.json`](../packages/client/core-runtime.json) defines the
downloadable runtime baseline (currently `v2.0.3-rc.13`).
[`contract-source.json`](../packages/client/contract-source.json) separately
pins the generated vocabulary source. Earlier rc.9/rc.11 audit evidence does not
certify later changes.

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
