# ADR 0012: Background session activity

## Status

Accepted, with broader activity-navigator parity still planned.

## Context

Octoscode keeps multiple session views in memory and its `/activity` navigator
aggregates task and run truth across them. A browser connection subscribes to
one opened session's live projection, so treating that stream as global would
silently hide background work.

## Decision

The workspace controller reads `task/list` for at most the 20 most recently
listed sessions, with four concurrent requests and a ten-second foreground-tab
poll. Each sidebar row shows running, failed, completed, unknown, or unavailable
state from the server result. The scan is read-only: it never opens a session,
changes the foreground subscription, or infers task state from transcript text.

Unknown task states fail visibly as `Needs review`; a per-session RPC failure is
shown as `Unavailable` and does not erase the session list. Switching sessions
continues to use the explicit Octoscode-compatible open/hydrate path.

## Consequences

- Users can see that another coding session is still running before switching.
- Polling supplies cross-session truth without inventing a global notification
  contract that Core does not provide.
- This is not yet full `/activity` parity: searchable cross-session messages,
  plans, approvals, recent changes, and detailed task navigation need a bounded
  server snapshot or explicit multi-session subscription contract.
