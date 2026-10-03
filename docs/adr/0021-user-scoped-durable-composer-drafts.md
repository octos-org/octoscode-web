# ADR 0021: Persist unsent text separately from Session history

- Status: Accepted
- Date: 2026-10-03
- Supersedes in part:
  - [ADR 0018](0018-dsh-aligned-product-shell.md) where only the endpoint may
    survive tab closure
  - [ADR 0019](0019-tab-session-navigation-and-background-turn-ownership.md)
    where changing credentials clears drafts without distinguishing the local
    editing view from another user's durable copy

## Context

This records existing behavior at Web revision
`a5331110df1550f70183a943386bccee87df9ad7`. Unsent composer text is user editing
state, and losing it on tab closure is avoidable. Server transcript authority
does not require discarding that text, but restoration must distinguish server
users, Workspaces, Profiles, and Sessions.

## Decision

After authentication, the browser resolves the user id through REST
`/api/auth/me`. The WebSocket identity method only echoes a Profile and is not
used as the draft principal.

Each text draft occupies a separate `localStorage` entry under the server origin
and REST-confirmed user id, keyed by the exact Workspace/Profile/Session tuple.
Values contain draft text; their keys contain routing identity. They contain no
auth token or connection envelope. Display preferences and connection
preferences use separate storage.

After authenticating again and opening the same Session, the same user can
restore the draft, including after a token rotation. Restoration never submits a
turn. Without a confirmed principal, edits use the tab's scoped draft storage
and memory; the UI does not claim they are saved across tab closure.

Disconnect preserves saved drafts. Changing endpoint or token clears the active
editing view and tab navigation without deleting another user's saved text.
Forget removes the confirmed user's draft scope and reports cleanup failure. The
tab remembers the principal so Forget can attempt cleanup after an offline
reload.

Saving empty text removes its entry. The in-memory cache uses a 50-entry
threshold: inserting a new nonempty draft at capacity evicts the oldest
insertion, while updating an existing entry does not reorder it. The eviction
callback attempts to remove the corresponding durable copy. Restore suppresses
that deletion while rebuilding the cache so it does not delete another tab's
saved drafts. Storage validation also bounds the combined key/text size.

Failed storage writes or deletions leave editing available and report an unsaved
or cleanup state. An older durable value can remain if the browser rejects a
write. An unreadable scope is not cleared as a side effect of eviction.

This persistence covers unsent text only. Pending FIFO entries, attachment
drafts, live controllers, and execution ownership do not survive a page reload.
Server transcript, tasks, approvals, and model output remain server-owned.

## Consequences

Unsent text can survive closing a tab and can be restored in another tab for the
same authenticated user. It remains local browser data, not cross-device
synchronization. Draft text and routing identifiers persist beyond the tab's
lifetime, so Forget, failed-cleanup reporting, and identity isolation are part
of the storage contract. The cache's insertion threshold can evict older drafts;
it must not be documented as a guarantee to retain every unsent draft forever.

## Rejected alternatives

- Keep every draft in memory or tab storage only. That loses text when the tab
  closes.
- Key durable drafts by token or Profile alone. Token rotation would lose
  access, and a Profile is not a verified user identity.
- Restore drafts as queued turns. Saved editing state is not permission to send.
- Store the connection token beside drafts. Credentials retain their existing
  tab-only lifetime.

## Implementation evidence

- [Draft persistence and principal lookup](../../apps/web/src/features/session/durable-session-drafts.ts)
- [Insertion order and validation](../../apps/web/src/features/session/session-draft-cache.ts)
- [Restore and editing integration](../../apps/web/src/app/App.tsx)
- [Forget and identity changes](../../apps/web/src/app/ConnectionGate.tsx)
- [Cache eviction checks](../../apps/web/src/features/session/session-draft-cache.test.ts)
- [Durable eviction checks](../../apps/web/src/features/session/durable-session-drafts.test.ts)
