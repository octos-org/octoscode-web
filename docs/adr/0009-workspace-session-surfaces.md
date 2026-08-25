# ADR 0009: Keep workspace sessions server-owned

Status: accepted

## Context

Octoscode's `/resume` flow lists durable sessions and hydrates the selected
ledger. Its session switcher preserves unsent drafts per session rather than
pretending that client state is runtime state. The Web sibling needs the same
meaning without importing octos-web's global stores or turning a browser into
a filesystem host.

The implemented wire shapes were checked against Octos Core revision
`04cb5596ec0935926d2e8afdd0826bfa18e0c4bb` and its
`crates/octos-core/src/ui_protocol.rs` blob
`853140d45c3e59e1c4ab2e4445c0282dbb09a8bc`. Session navigation, draft, and
usage presentation semantics follow Octoscode revision
`dab1de823cdb5db9587c09fc91c2e7e744f251c9`.

## Decision

The React-free client owns narrow decoders and request helpers for
`session/list`, `session/delete`, and `session/files.list`. A workspace `cwd` is
sent to `session/list` only when `session.workspace_cwd.v1` was negotiated.
Creating a session opens a new explicit id. Switching reconnects to the same
server and opens the selected durable session; the application keeps one
unsent composer draft per session id.

The current Web transport owns one active foreground connection. It therefore
refuses create or switch while a foreground turn or queued prompt is active,
instead of silently orphaning work. Octoscode TUI can supervise background
work across sessions; matching that multi-session runtime behavior remains a
separate parity item and must not be simulated with duplicate client state.

Core has no archive RPC. `session/delete` is presented as permanent deletion,
requires a second inline confirmation, and is unavailable for the active
session. `session/files.list` rows are server-owned output handles: the UI
shows filename and size but does not expose the returned host path or imply an
arbitrary repository browser.

Usage starts from the typed `session/status/read` snapshot. Live input/output
tokens, session cost, model, and context-window values come only from
`progress/updated` metadata whose kind is `token_cost_update`. Malformed values
fail closed.

## Consequences

Web and TUI sessions refer to the same durable server ledgers, and an unsent
draft survives a normal session round trip. Workspace scoping cannot be sent
accidentally to a server that did not negotiate it. The UI remains honest
about permanent deletion and about the limited file contract. Foreground
multi-session supervision is visible as an explicit remaining limitation
rather than hidden behind optimistic navigation.
