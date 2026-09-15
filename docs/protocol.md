# Protocol integration

This document is the working guide for the boundary between octoscode-web and
Octos Core. The authoritative Rust contract lives in:

- `crates/octos-core/src/app_ui.rs`
- `crates/octos-core/src/ui_protocol.rs`

The browser client must not become a second protocol authority.

## Connection and capability negotiation

The React-free client connects to `/api/ui-protocol/ws`, validates JSON-RPC
frames, correlates responses, and requests Web features during the handshake.
The application enables a method only after the server accepts or advertises it.
Missing optional capabilities reduce the interface; they do not trigger a
best-effort wire guess.

The generic request primitive is private. Every public method with a structured
result applies a fail-closed decoder before returning. Cold receipt decoders
load asynchronously without deferring the authority-sensitive RPC dispatch; live
event decoders remain synchronous. Request timeouts and disconnects move their
ids into a bounded quarantine so a valid late server response is ignored instead
of reported as an unrelated protocol error. Method and feature names exported by
Core come from the generated contract index; only the isolated CLI AppUI
extensions (including onboarding, Profile configuration, peer prepare/gather,
context, inventory, skills, and research lanes) remain isolated handwritten
contracts until Core exports them.

Browser WebSockets cannot attach an `Authorization` header. The current Core
endpoint accepts `?token=` and repeated `ui_feature` parameters. Tokens remain
in tab-scoped `sessionStorage` so a refresh can reconnect without placing the
credential in durable cross-tab storage. They must travel over HTTPS/WSS outside
loopback and must be excluded from diagnostics and access logs.

## Durable projection invariant

A reconnecting socket is not a recovered session. Recovery is complete only when
the client treats these behaviors as one invariant:

1. Open or hydrate the intended session scope.
2. Resume from the last durable cursor.
3. Deduplicate replayed envelopes.
4. Reject events from another session scope.
5. Repair detectable gaps from server truth.
6. Fail closed when the server reports lossy replay.

Notifications become feature-specific actions before reaching React. The app
does not route raw frames through a global event bus or duplicate durable state
across compatibility and projection stores.

Settled assistant output is rendered as safe GFM. Streaming text stays plain
until persistence so repeated deltas do not continually reparse an unbounded
Markdown tree.

## Server-owned coding state

- Permission controls are populated by `permission/profile/list`; the set
  response is authoritative.
- Diff preview ids come only from typed approval or mutation fields. The app
  reads proposal-time snapshots through `diff/preview/get` and never substitutes
  a browser-computed git diff.
- Plans, policy, tasks, output, cancellation, and artifacts use the advertised
  status and task methods. Output cursors are byte offsets; reads are bounded.
- A successfully committed `session/open` may add its exact
  `(workspace_root, active_profile_id, session_id)` tuple to bounded,
  identity-bound tab navigation. rc.9 `session/list` rows are not projected
  because the response proves neither Workspace nor Profile scope. Confirmed
  refs are not a server catalog and contain no transcript or projection data.
- Context, cost, and effective runtime-model usage merge typed progress metadata
  with the latest server status snapshot.

## Turn ownership during Session navigation

The rc11 candidate uses one physical pooled WebSocket for all confirmed
Sessions. One `SessionRecord` per full endpoint/Workspace/Profile/Session/auth
epoch owns its controller, FIFO, interactions, cursor, and bounded timeline.
Selection does not close a socket, reset a queue, or wait for another turn's
ACK. Candidate open/hydrate commits only while its captured scope, transport,
and generation remain current; rejected candidates cannot replace a live record.

Every record receives its own admitted events, including background approvals,
questions, and canonical terminals. Terminal handling advances only that
record's FIFO. Reconnect suspends all record leases, rehydrates them through the
single new transport, and reconciles sent versus unsent work before drain.
Changing authentication retires the old semantic authority. Page reload does not
restore browser-local pending prompts or attachment drafts.

Core rc11 still couples interactive execution to the accepting connection.
Closing it interrupts connection-owned work; ordinary teardown persists a
`connection_closed` terminal. A daemon restart likewise requires fresh hydrate
and cannot be presented as continuous detached execution. A terminal event is
not permission to close the shared transport while other work may remain. This
supersedes ADR 0019's ACK navigation guard and eight retained-owner-socket
budget, not Core's execution-lifetime boundary. The separately pinned rc9
baseline is unchanged by rc11 candidate testing.

Native peer `peer/staged` and `peer/closed` events route to the retained master
record even while backgrounded. The coordinator binds one peer manager to that
record, buffers bounded events during its typed factory load with a transport
fence, and opens the server-supplied full peer identity without selecting it.
Kickoff uses the peer record's ordinary FIFO/native turn UUID; enqueue alone is
not a server receipt. Existing peer history or uncertain dispatch is not
automatically kicked off again after recovery. Close invalidates pending host
work and retires only the matching peer, preserving an honest selected view.

`peer/gather` itself is a Profile-scoped read. **Refresh blackboard** remains
read-only. The candidate `/gather [all|slug…]` composes the pinned TUI's bounded
64 KiB UTF-8 synthesis prompt and admits it to the originating master record's
ordinary FIFO. Empty results create no turn; a busy master queues synthesis.
Selection changes do not redirect it, while authority/recovery changes prevent
late dispatch. This acceptance correction still needs its browser verification;
a successful blackboard read alone does not prove synthesis.

The model served by a Session runtime and the active Profile default are
different projections. The composer reports only the former. Settings uses
independently capability-gated Profile operations:

- `profile/llm/list` without `session_id` reads the configured primary and
  fallbacks. Its rows contain provider/model/route metadata and `has_api_key`,
  never the secret value.
- `profile/llm/catalog` supplies canonical families, models, and routes.
- `profile/llm/test` probes the exact draft route/model and supplied or
  Core-owned credential.
- `profile/llm/fetch_models` asks Core to discover model ids for the draft
  provider and route. An empty result or `provider_unavailable` is not treated
  as proof that the credential is invalid; manual model-id entry remains
  available.
- `profile/llm/upsert` saves a tested configuration and may make it the Profile
  primary.
- `profile/llm/delete` removes an exact family/model/route tuple.
- `profile/llm/select` changes the Profile default among configured entries.

Capabilities are evaluated per operation: a server that advertises only list
still gets a useful read-only page, while unavailable mutation or discovery
controls remain absent. The API key remains transient form state in the open
editor and is passed as an operation argument; it never enters published
controller state or browser storage. Omitting it reuses a key already saved by
Core. Core owns persistence and returns only the redacted `has_api_key`
projection; the client does not assert that the server-side store is encrypted.
A dedicated server-side credential contract is tracked in
[octos#2163](https://github.com/octos-org/octos/issues/2163).

Save performs Test and Upsert from one immutable draft so the two requests
cannot diverge across an await. Responses are accepted only for the current
transport/Profile authority, and reflected credential-shaped errors are redacted
before publication. The inspected rc11 AppUI model selection accepts typed
`temperature`, `top_p`, `context_window`, `reasoning_effort`, and `model_hints`.
Upsert replaces the complete inference configuration: null and omission both
mean inherit, not retain the prior value. Web preserves known configured values
on existing edits and blocks edits containing unsupported configuration; it does
not provide an inference editor absent from the pinned TUI. `max_output_tokens`
is gateway-owned and rejected by this RPC, not an additional model-selection
field. Per-turn reasoning is a separate `turn/start.reasoning_effort` contract,
captured in each queued prompt. This rc11 runtime observation does not change
the repository's generated Core contract pin.

Profile changes affect every Session on that Profile and may require an Octos
restart. They are not treated as a Session override; that missing Core contract
is tracked in [octos#2148](https://github.com/octos-org/octos/issues/2148),
while upsert/delete runtime invalidation is tracked separately in
[octos#2164](https://github.com/octos-org/octos/issues/2164). Provider-aware
model discovery is tracked in
[octos#2165](https://github.com/octos-org/octos/issues/2165).

## Workspace launch and onboarding

For a path-based launch, the client requests capabilities before opening a
session. It calls `launch/resolve` only when both the method and
`session.workspace_cwd.v1` are available. The result chooses a Profile; it does
not identify an existing Session. New Session and Add workspace keep a neutral
`web-<uuid>` launch intent until that Profile is resolved, then open a fresh
`<profile>:api:web-<uuid>` Session. An unambiguous fresh `activate` follows that
resolved Profile automatically; `cross_profile` and `no_profile` remain
explicit. Existing confirmed sidebar rows bypass launch resolution and open
their exact server identity and Profile. The Web client never aliases or
overwrites Octoscode TUI's `<profile>:local:tui#coding` conversation.

This profile-bearing Web id is a compatibility requirement, not proof that Core
has one unified Session resolver. Current Core can accept a raw id with an
explicit Profile during `session/open` and then route hydrate/status elsewhere;
the server-side identity split is tracked in
[octos#2162](https://github.com/octos-org/octos/issues/2162).

On `no_profile`, the browser offers solo onboarding only when Core advertises
the complete method set:

- `profile/local/create`
- `profile/llm/catalog`
- `profile/llm/test`
- `profile/llm/upsert`

Families, models, and routes come from Core. A credential must pass the provider
test before the selection is saved, and the API key exists only in the live
form/request closure. `requested_id` is only a request: Core's returned
`profile_id` is authoritative and may be normalized or collision-suffixed.
Partial failure retains both that returned id and its original request so a
retry does not duplicate it. Older servers show `octoscode onboard` instead.

These onboarding names currently come from the CLI AppUI transport rather than
exported Core constants. They are isolated in
`packages/client/src/onboarding.ts` behind strict bounded decoders until Core
exports them in the generated contract.

## Contract artifacts

Two machine-readable pins answer different questions:

| File                                   | What it proves                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/client/contract-source.json` | Generated method, feature, notification, and protocol vocabulary matches an immutable Core source revision and Git blob. |
| `packages/client/core-runtime.json`    | A checksummed released `octos` binary completes the browser-critical runtime flow.                                       |

Payload decoders remain deliberately narrow and fixture-checked until Core emits
a complete machine-readable schema. Permission enums and other safety-bearing
values fail closed. Display-only labels may remain forward compatible after
their surrounding structure is validated.

## Compatibility gates

Verify the source contract:

```sh
pnpm contract:verify
```

After intentionally changing the immutable source pin:

```sh
pnpm contract:update
```

Review the generated diff. Do not treat a source pin as proof that an unreleased
binary was executed.

Exercise the released runtime baseline:

```sh
OCTOS_BINARY=/absolute/path/to/pinned/octos pnpm integration:core
```

The integration rejects a binary whose release and commit do not match
`core-runtime.json`. It starts an isolated `octos serve` and covers health,
negotiation, no-profile launch, provider catalog/test/save through a local
OpenAI-compatible fixture, exact TUI session open, hydrate, permissions,
supervision, and status without making an external model turn.

Unit fixtures provide deterministic parser and reducer coverage. Playwright
provides browser product coverage. Neither replaces the pinned real-Core gate.
The expanded rc11 parity implementation is still an acceptance candidate;
passing any one of these layers does not establish a full native-peer live soak
or complete TUI parity. See [Feature parity](feature-parity.md).

## Related decisions

- [ADR 0003: Octoscode semantic parity](adr/0003-octoscode-semantic-parity.md)
- [ADR 0005: Durable session recovery](adr/0005-durable-session-recovery.md)
- [ADR 0007: Coding safety surfaces](adr/0007-coding-safety-surfaces.md)
- [ADR 0010: Server-resolved workspace launch](adr/0010-server-resolved-workspace-launch.md)
- [ADR 0013: Generated Core contract index](adr/0013-generated-core-contract-index.md)
- [ADR 0014: Pinned Core runtime smoke](adr/0014-pinned-core-runtime-smoke.md)
- [ADR 0015: Solo Web onboarding](adr/0015-solo-web-onboarding.md)
- [ADR 0019: Tab Session navigation and background turn ownership](adr/0019-tab-session-navigation-and-background-turn-ownership.md)
