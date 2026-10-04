# ADR 0022: Show Activity for confirmed Sessions on demand

- Status: Accepted
- Date: 2026-10-03
- Supersedes in part:
  - [ADR 0018](0018-dsh-aligned-product-shell.md) for removal of the Activity
    navigator and all cross-Session task polling

## Context

This records the implementation at Web revision
`a5331110df1550f70183a943386bccee87df9ad7`. The client now has exact
server-confirmed Session references and retained records. Those references allow
task inspection across known Sessions without treating an unscoped
`session/list` response as a complete catalog.

ADR 0012's historical background scan remains superseded. The current surface is
an explicitly opened dialog over confirmed identities, not an always-on
server-wide activity feed.

## Decision

`/activity` opens a searchable, status-filtered task navigator. The application
supplies its eligible confirmed navigation references. Scanning requires the
server's `task/list` capability and starts only while the dialog is open.

The catalog deduplicates Session ids and reads them in batches of at most four
concurrent requests. Each result must identify the requested Session. A failure
or mismatched identity marks that Session unavailable without discarding other
results.

The dialog refreshes immediately, then schedules another refresh ten seconds
after each scan completes. Closing it, changing authority, or replacing its
inputs cancels the timer and prevents an old response from updating the view.
This is dialog-lifetime polling, not a guarantee that polling pauses when the
browser tab becomes hidden.

Scanning never opens Sessions or changes focus. Opening a result is a separate
explicit navigation action through the normal Session path. Inspection and
navigation retain their own capability and recovery checks.

Trajectory remains the selected Session's supervision view. Activity is limited
to known confirmed Sessions and does not claim complete server discovery,
cross-tab discovery, or a global stream of messages and approvals.

## Consequences

Users can find tasks in other confirmed Sessions without always-on sidebar
polling. The open dialog generates one task read per supplied Session per scan,
with bounded concurrency. Incomplete discovery and unavailable snapshots remain
visible product limits. A complete catalog still requires the server-owned
contract tracked in
[octos#2146](https://github.com/octos-org/octos/issues/2146).

## Rejected alternatives

- Restore ADR 0012's always-on scan of recently listed Sessions. It relies on a
  catalog whose effective scope is not proven.
- Discover work by opening Sessions. Read-only inspection must not mutate
  subscriptions or foreground identity.
- Present the selected Session's live stream as global Activity. It cannot
  describe other Sessions.

## Implementation evidence

- [Dialog lifetime](../../apps/web/src/features/activity/ActivityDialog.tsx)
- [Refresh and authority handling](../../apps/web/src/features/activity/use-activity-catalog.ts)
- [Bounded catalog reads](../../apps/web/src/features/activity/catalog.ts)
- [Catalog identity and concurrency checks](../../apps/web/src/features/activity/catalog.test.ts)
