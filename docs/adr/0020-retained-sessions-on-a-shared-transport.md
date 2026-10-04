# ADR 0020: Retain Session execution state on one shared transport

- Status: Accepted
- Date: 2026-10-03
- Supersedes in part:
  - [ADR 0019](0019-tab-session-navigation-and-background-turn-ownership.md) for
    per-owner sockets, the eight-connection budget, ACK-dependent navigation,
    and the prohibition on switching with queued prompts
  - [ADR 0018](0018-dsh-aligned-product-shell.md) for opening each candidate on
    an isolated physical connection
  - [ADR 0005](0005-durable-session-recovery.md) where projection scope is
    described as the selected Session rather than each retained Session

## Context

This records the implementation at Web revision
`a5331110df1550f70183a943386bccee87df9ad7`; it does not introduce new runtime
behavior. The earlier owner-socket design preserved acknowledged turns, but
coupled navigation to a foreground FIFO, a pending start ACK, and a connection
budget. The current client retains executable Session records on one shared
authenticated WebSocket.

## Decision

`SessionRecordManager` retains a controller, FIFO, interaction ledger, cursor,
and timeline projection for each confirmed
`(endpoint, workspaceRoot, profileId, sessionId, authorityEpoch)` scope. Records
use non-owning leases on the pooled transport. Selection changes the visible
record; each record continues to receive its own scoped events and drain its own
queue.

New candidates open and hydrate on that transport. Commit checks the captured
scope, transport, and authentication epoch. Failure or cancellation preserves
the source view. Selecting an existing record does not reopen an in-flight
dispatch. Native peers use server-supplied identities and the same record
engine; hosting a peer in the background does not select it.

Pending start acknowledgements and local queued prompts do not block normal
navigation. An unresolved turn-recovery state still blocks switching and
creation until the user checks its status. This protects ambiguous dispatch
evidence; it is distinct from waiting for an ordinary start ACK.

Reconnect recovers the pooled transport once, then reopens and hydrates each
record with its own replay cursor. Dispatch pauses during reconciliation.
Approvals, questions, terminal events, and queue advancement stay scoped to the
owning record. Authentication changes and explicit Disconnect retire records.
Queued prompts and attachment drafts are in-memory state and do not survive a
page reload.

The client has no detached-execution guarantee. Refresh, tab close, transport
loss, or Disconnect can interrupt connection-owned work. Terminal events do not
authorize closing the shared socket. The upstream ownership contract remains
tracked in [octos#2167](https://github.com/octos-org/octos/issues/2167).

ADR 0019's confirmed, tab-scoped navigation tuples and fresh activation behavior
remain in effect. Neither retained records nor the tuples are a complete server
Session catalog.

## Consequences

Users can switch while another Session is starting, queued, running, or waiting
for input, without the old eight-owner limit. One connection failure can affect
several Sessions, so per-record recovery and authentication fencing are
essential. Retained records consume browser memory; removal requires lifecycle
cleanup rather than treating a view switch as disposal.

This records implemented ownership, not a new compatibility or live-soak
certification. The downloadable runtime baseline is defined by
[`core-runtime.json`](../../packages/client/core-runtime.json); historical
acceptance evidence remains in [Feature parity](../feature-parity.md).

## Rejected alternatives

- Keep a socket for every acknowledged turn and retain the old navigation cap.
  This preserves an obsolete ownership constraint in the product.
- Reuse one foreground controller for every view. That mixes queues and pending
  interactions across Sessions.
- Assume a remembered Session id preserves execution after transport loss.
  Server hydrate restores durable facts, not unsent browser work.

## Implementation evidence

- [Record manager](../../apps/web/src/features/session/session-record-manager.ts)
- [Session composition and navigation](../../apps/web/src/features/session/use-octos-session.ts)
- [Concurrent queues and interaction isolation](../../apps/web/src/features/session/session-record-concurrency.test.ts)
- [Fifteen records on one transport](../../apps/web/src/features/session/session-record-capacity.test.ts)
- [Turn-recovery navigation checks](../../apps/web/src/features/session/use-octos-session.recovery.test.ts)
