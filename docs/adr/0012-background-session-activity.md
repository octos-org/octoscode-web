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
The `/activity` command and header control open a searchable task navigator with
the TUI's `all`, `running`, `failed`, and `done` filters. A row inspects a task
in the current session or explicitly switches to its owning session.

Unknown task states fail visibly as `Needs review`; a per-session RPC failure is
shown as `Unavailable` and does not erase the session list. Switching sessions
continues to use the explicit Octoscode-compatible open/hydrate path.

## Consequences

- Users can see, search, and filter work in another coding session before
  switching.
- Polling supplies cross-session truth without inventing a global notification
  contract that Core does not provide.
- This is not yet full `/activity` parity: cross-session messages, plans,
  approvals, and recent changes need a bounded server snapshot or explicit
  multi-session subscription contract.
