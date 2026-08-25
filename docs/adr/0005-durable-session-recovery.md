# ADR 0005: Treat reconnect and hydrate as one invariant

Status: accepted

## Context

A reconnecting WebSocket is not a recovered coding session. The browser can
miss durable events, replay the same envelope twice, receive another session's
topic, or resume after the server has evicted part of its replay window. A UI
that silently keeps rendering in any of those states is unsafe for coding work.

The authoritative Octos contract provides the pieces as a set:

- `session/open.after` with a durable `UiCursor`
- `session/hydrate` gated by `state.session_hydrate.v1`
- canonical `projection/envelope.v2`
- explicit `protocol/replay_lossy`

## Decision

Every initial connection and reconnect performs an authoritative hydrate.
Reconnect additionally opens the session with the last known cursor. Incoming
notifications are bounded and buffered while hydrate is in flight, then folded
after the hydrate snapshot commits.

The application projection boundary:

- accepts only the selected session/topic;
- deduplicates and enforces monotonic sequence numbers per thread;
- rejects missing cursors and cursor-stream changes;
- turns a sequence gap or `protocol/replay_lossy` into another hydrate;
- suppresses legacy message/tool/terminal rendering when v2 is negotiated;
- restores pending approvals, questions, and active-turn state from hydrate;
- pauses prompt submission until the projection is healthy.

The transport retries with bounded exponential backoff. The recovery state is
visible in the product UI instead of being hidden behind a generic connection
spinner.

## Consequences

Current Octos servers that do not negotiate both durable features fail closed
instead of running a deceptively functional, non-recoverable coding UI. The
narrow TypeScript hydrate decoder remains handwritten until Octos publishes a
generated contract and golden fixtures; malformed results are rejected.
