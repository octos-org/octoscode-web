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
result applies a fail-closed decoder before returning, and shared cursor/string
primitives come from one decoder module. Request timeouts and disconnects move
their ids into a bounded quarantine so a valid late server response is ignored
instead of reported as an unrelated protocol error. Method and feature names
exported by Core come from the generated contract index; only the isolated CLI
onboarding extension remains handwritten until Core exports it.

Browser WebSockets cannot attach an `Authorization` header. The current Core
endpoint accepts `?token=` and repeated `ui_feature` parameters. Tokens remain
in memory, must travel over HTTPS/WSS outside loopback, and must be excluded
from diagnostics and access logs.

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
- Session navigation uses server-owned lists and identities. Switching sessions
  closes the foreground subscription and opens the selected durable session.
  Only unsent drafts are browser state.
- Context, cost, and model usage merge typed progress metadata with the latest
  server status snapshot.

## Workspace launch and onboarding

For a path-based launch, the client requests capabilities before opening a
session. It calls `launch/resolve` only when both the method and
`session.workspace_cwd.v1` are available. Resume opens the exact Octoscode
identity `<profile>:local:tui#coding`; activation and cross-profile cases retain
the TUI's explicit choices.

On `no_profile`, the browser offers solo onboarding only when Core advertises
the complete method set:

- `profile/local/create`
- `profile/llm/catalog`
- `profile/llm/test`
- `profile/llm/upsert`

Families, models, and routes come from Core. A credential must pass the provider
test before the selection is saved, and the API key exists only in the live
form/request closure. Partial failure retains the created profile id so a retry
does not duplicate it. Older servers show `octoscode onboard` instead.

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

## Related decisions

- [ADR 0003: Octoscode semantic parity](adr/0003-octoscode-semantic-parity.md)
- [ADR 0005: Durable session recovery](adr/0005-durable-session-recovery.md)
- [ADR 0007: Coding safety surfaces](adr/0007-coding-safety-surfaces.md)
- [ADR 0010: Server-resolved workspace launch](adr/0010-server-resolved-workspace-launch.md)
- [ADR 0013: Generated Core contract index](adr/0013-generated-core-contract-index.md)
- [ADR 0014: Pinned Core runtime smoke](adr/0014-pinned-core-runtime-smoke.md)
- [ADR 0015: Solo Web onboarding](adr/0015-solo-web-onboarding.md)
