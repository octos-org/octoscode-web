# ADR 0017: Model runtime → workspace → session and restore it safely

- Status: Superseded
- Date: 2026-08-26
- Superseded by: [ADR 0018](0018-dsh-aligned-product-shell.md)

This is the historical design record. ADR 0018 replaces its login, browser
storage, restore, recent-Workspace, and New Session decisions. Do not treat the
storage or generated-identity details below as current product behavior; only
the server-ownership motivation remains.

## Context

The first connection surface exposed endpoint, token, session id, profile id,
and cwd as equally important fields. It forgot every field on refresh and made
“New session” an arbitrary client-entered identifier. That presentation leaked
transport details, lost a user's active coding context, and obscured the durable
ownership boundary.

DeepSeek Harness has a first-class Workspace registry with a stable id,
canonical local path, and ordered session ledger. Octoscode and Octos Core have
the same useful user-level hierarchy—a workspace path containing sessions—but
Core currently exposes path-based launch and server-owned session methods, not a
browser-manageable Workspace CRUD registry. A browser may also be remote from
the filesystem, so DSH's trusted-local native directory picker is not generally
available.

## Decision

The product model is:

```text
Runtime connection
  └─ Workspace (server-confirmed canonical path)
       └─ Session (server-owned durable conversation)
```

“Workspace” is the product term; a generic “Object” would add no domain meaning.
On manual connection, Web sends the requested server path through
`launch/resolve` and follows Octoscode's profile/session decision. The returned
`workspace_root`, `active_profile_id`, and `session_id` replace the browser's
hints and become the next restore target.

Non-secret connection intent—origin, canonical path, profile hint, and last
established session—is stored in `localStorage`. The auth token and an
auto-connect marker are stored only in the current tab's `sessionStorage`.
Provider API keys remain memory-only. Refreshing a successfully connected tab
opens the exact established session directly and then performs the normal
hydrate/replay recovery. Explicit Disconnect disables auto-connect; Forget
connection removes both storage scopes.

New session is a one-step product action, not an identity form. When Core has
resolved an active profile, Web generates `<profile>:api:web-<uuid>` and invokes
the normal `session/open` path with the canonical workspace. The profile must be
part of the durable identity because follow-up methods such as hydrate carry a
session id but no separate profile hint; a raw `web-*` handle is safe only when
the connection authentication is already profile-bound. Core creates, validates,
persists, and lists the session. The browser does not keep a second session
ledger.

## Rejected alternatives

- Copy DSH's Workspace registry into browser storage. It would become a second,
  non-authoritative database and could not safely validate remote paths.
- Persist the auth token in `localStorage`. It would survive tab/browser closure
  and unnecessarily enlarge credential lifetime.
- Restore by running `launch/resolve` again. That can replace an active scratch
  session with the canonical coding session instead of restoring what the user
  was viewing.
- Keep arbitrary session-id entry as the primary New flow. It exposes protocol
  identity, encourages invalid prefixes, and does not match Octoscode's product
  language.

## Consequences

Refresh is now a recovery event rather than a logout. Workspace and session
navigation match DSH's useful hierarchy without importing its runtime or
duplicating Core state. Remote users still type or receive a server-side path; a
future directory browser or durable Workspace catalog requires an explicit Core
capability and remains server-authoritative.
