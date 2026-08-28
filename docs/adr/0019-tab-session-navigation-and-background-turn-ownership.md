# ADR 0019: Keep confirmed Session navigation and acknowledged turns alive

- Status: Accepted
- Date: 2026-08-28
- Supersedes in part:
  - [ADR 0009](0009-workspace-session-surfaces.md), where it forbids Session
    navigation during every active turn
  - [ADR 0018](0018-dsh-aligned-product-shell.md), where it limits tab memory to
    Workspace paths and exposes only the current Session
  - [ADR 0010](0010-server-resolved-workspace-launch.md), where it requires a
    confirmation step for an unambiguous fresh `activate` result

The server-ownership, incomplete-catalog, staged-candidate, and explicit
cross-Profile/onboarding decisions in those ADRs remain in effect.

## Context

A coding product needs to let a person start work in one Session, move to
another, and return without losing either conversation. Grouping every Session
under its Workspace is also the primary navigation model inherited from the DSH
product reference. Showing only the currently open Session made a normal
coding-harness workflow undiscoverable and made two Sessions in the same
directory appear to replace one another.

Core rc.9 still cannot supply a trustworthy server-wide Workspace/Session
catalog. An unscoped or administrative `session/list({cwd})` can lose the target
Profile or ignore the requested cwd without echoing its effective scope. The
browser therefore cannot treat those rows as authoritative or invent titles and
history from local state. It does, however, receive an exact `session/open`
result after every successful open. That result is enough to remember a routing
reference without claiming catalog completeness.

Turn lifetime creates a separate constraint. In Core rc.9, a foreground turn is
owned by the WebSocket that started it. Closing that transport aborts the turn
with `connection_closed`; a terminal notification is not a transport-release
barrier because Core may still perform persistence, task, goal, or accounting
tail work. Ordinary candidate switching therefore cannot disconnect the owner
socket of a server-acknowledged local turn.

Conversely, a browser-local queued prompt has not become server work, and a
`turn/start` request without its acknowledgement has ambiguous ownership. Those
states cannot be detached safely by presentation code.

## Decision

After a staged Session candidate has opened, hydrated, and committed, the
browser records only this server-confirmed routing tuple plus a local recency
timestamp:

```text
(workspace_root, active_profile_id, session_id, last_opened_at)
```

The references are bounded, bound to the exact endpoint and token identity, and
stored in the current tab's `sessionStorage`. They populate Workspace → Session
navigation and allow exact reopen after switching or refreshing. Multiple
Sessions may share one `workspace_root`; their Profile and Session identities
keep them distinct. The browser does not store Session titles, prompts,
transcripts, model output, permissions, tasks, or any other durable projection.
This is confirmed navigation memory, not a catalog, and it never implies that
all server Sessions are present.

The active Workspace/Profile/Session remains the same tab's refresh target.
Changing the endpoint or token clears the old identity's confirmed Session
references, recent paths, and drafts. **Forget server** does the same.
**Disconnect** stops automatic reconnection and closes live transports but keeps
the current tab's navigation references so the same identity can reconnect.

When a locally started turn has received the server's `turn/start`
acknowledgement, Session navigation uses a two-phase owner handoff:

1. observe the exact old `(Workspace, Profile, Session, turn)` before opening a
   candidate;
2. connect, open, validate, and hydrate the candidate on an isolated transport;
3. atomically focus the candidate while retaining the acknowledged turn's owner
   transport;
4. project that background turn's running, waiting, completed, or failed status
   on its Session row.

Candidate cancellation or failure rolls back the handoff without disconnecting
the old foreground transport. Events from a retained background transport update
only its status; the newly selected Session obtains conversation truth from its
own hydrate/replay stream. A terminal event updates status but does not release
the rc.9 owner transport. Explicit connection cleanup or transport loss does.

The compatibility manager retains at most eight live owner transports. At that
limit, focusing a Session whose exact owner is already retained performs an
atomic reclaim/exchange and remains available. Opening a new target without a
reclaimable owner fails closed with an actionable Disconnect/reconnect message.
The Web app never uses terminal state, age, or LRU pressure to close an owner:
Core rc.9 has no quiesced signal proving that post-terminal tail work and
Session scope cleanup are finished.

Navigation remains blocked while the selected Session has browser-local pending
prompts or while `turn/start` is still awaiting acknowledgement. This is a
safety boundary, not a claim that queued work should remain foreground-only
forever; a future per-Session queue/runtime contract can remove it.

A fresh opaque Web Session whose `launch/resolve` result is an unambiguous
`activate` automatically binds the resolved Profile and opens. `resume` remains
automatic. `cross_profile` still requires the user to select the intended
Profile, and `no_profile` still requires onboarding or the truthful TUI
fallback.

## Lifecycle boundary

Background continuation is guaranteed only while the same browser tab and its
owner WebSocket stay alive. Refresh, tab close, network or proxy loss, and
manual **Disconnect** close that socket; Core rc.9 then terminates a still-live
turn and may interrupt work after its terminal notification but before Core has
finished its tail cleanup. Confirmed Session references can survive a same-tab
refresh, but execution ownership cannot. A future Core-owned detached-turn lease
or explicit quiesced signal is required for durable background execution across
transport loss. The Core contract and stale-connection scope-eviction bug are
tracked in [octos#2167](https://github.com/octos-org/octos/issues/2167).

## Rejected alternatives

- Use `session/list` as the sidebar catalog. Its rc.9 response does not prove
  Workspace/Profile scope and can place a valid Session under the wrong object.
- Persist complete Session rows or transcript summaries in the browser. That
  creates a stale second database and weakens hydrate/replay authority.
- Disconnect the active owner socket immediately after candidate commit. On rc.9
  that aborts a still-running turn and can discard post-terminal tail work.
- Allow navigation while a prompt is queued locally or a start acknowledgement
  is unresolved. The new view could neither prove which work was server-owned
  nor continue the local FIFO safely.
- Keep the extra “Activate coding” confirmation for a fresh unambiguous Web
  Session. It asks the user to confirm a Profile decision the server has already
  resolved and adds no safety boundary.

## Consequences

The sidebar now behaves like a coding harness: it can show and reopen every
Session this tab has confirmed, including multiple conversations in one
directory, while remaining honest about incomplete discovery. A server-accepted
turn can continue when the user creates or selects another Session in the same
live tab.

The compatibility cost is a bounded set of retained WebSockets and an explicit
pending/dispatching navigation gate. It does not provide durable detached work,
cross-tab Session discovery, or a server catalog. Those capabilities require a
Core SessionRef catalog and server-owned turn lease rather than more browser
inference.
