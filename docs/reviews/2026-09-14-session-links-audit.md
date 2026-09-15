# Saved conversation links and session discovery audit

Date: 2026-09-14. Core source and binary: `v2.0.3-rc.9`,
`5ea987813de4fd2afdd1d78f2106ad2868f0d923`.

## Finding and product behavior

The workspace shell already wrote a `?s=` bookmark containing the exact
`[workspaceRoot, profileId, sessionId]` tuple. Its consumer only searched the
current tab's known-session map. A new browser has no such map, so a valid saved
link could never open its target. An early selection-sync effect could also
replace or remove the unresolved link before it was consumed.

A saved reference can open persisted history without a server catalog. It must
be treated as untrusted navigation intent until the authenticated server opens
and hydrates the exact target. The confirmation panel shows the connected server
and saved workspace, with the technical profile/session identity in a collapsed
disclosure. **Open conversation** uses the existing staged candidate path;
**Dismiss link** abandons only the reference. Opening the panel sends no request
and opening a session sends no prompt.

An exact saved reference requires `session/open` to echo the same profile,
session ID, and canonical workspace path. A missing or changed workspace echo
rejects the candidate before hydration or committing navigation. Fresh workspace
creation retains the existing ability to accept a server-canonicalized path.

The panel explicitly explains that a missing conversation may open an empty
session. This is necessary Core behavior, not a generic warning: `session/open`
creates previously unknown session state. A preflight `session/hydrate` cannot
reliably distinguish deleted history from a session whose workspace binding has
not yet been re-established after a Core restart.

## Pinned Core contract

The fixed revision's relevant sources are:

- `crates/octos-core/src/ui_protocol.rs`, around lines 3110–3138: `session/list`
  accepts only optional `cwd`; its response wraps opaque rows.
- `crates/octos-cli/src/api/ui_protocol_transport.rs`, around lines 5602–5620
  and 24102–24152: WebSocket authentication freezes `connection_profile_id`;
  `session/list({cwd})` resolves its store using that identity. An
  admin/unscoped connection does not gain a profile when it later opens a
  profile-specific session.
- `crates/octos-cli/src/api/handlers.rs`, around lines 543–576: list rows
  contain `id`, `message_count`, optional `title`, `updated_at`, and
  `last_prompt`. They do not echo a workspace/profile scope. Flag-off servers
  may silently ignore `cwd`; flag-on unscoped listing can fail or inspect the
  wrong namespace. Method advertisement alone does not prove correct scope.
- `crates/octos-core/src/ui_protocol.rs`, around lines 3290–3390:
  `session/snapshot` returns status/files/tasks; `session/workspace.get` returns
  workspace contracts, not a canonical path; `session/title.set` changes a
  server title but there is no corresponding scoped title getter in
  open/hydrate.
- `crates/octos-cli/src/api/ui_protocol_transport.rs`, around lines 19010–19039:
  hydrate's storage lookup uses a runtime workspace hint. Reopening with the
  explicit tuple restores that binding after restart.

Server-owned titles exist in list metadata, but cannot safely populate this
workspace sidebar through the rc.9 unscoped list response. This change adds no
client title database, transcript cache, or fabricated catalog. The display
remains limited to confirmed navigation references.

The local deployment was inspected read-only. The `18032` Web virtual host
forwards `/api/` to the existing Core upstream and preserves `Host`; it does not
inject a profile header. A UI-selected profile therefore cannot be assumed to
change WebSocket authentication scope. No deployed configuration was modified.

## Real isolated Core verification

Two temporary `octos serve --solo --no-network` instances used independent
workspace/data directories and a loopback provider fixture returning `OK`. They
negotiated `auxiliary.rest_to_ws.v1` in addition to the required Web features so
the list methods were actually advertised. No production tokens, real model
requests, deployment state, or user conversations were used.

1. Bootstrap a temporary profile and fixture model through the existing
   onboarding RPC sequence.
2. Open an exact profile/workspace/session tuple and complete a real Core turn.
   Hydrate returns one persisted user message, one persisted assistant message,
   and a completed turn.
3. Close the first socket. In the first run, connect through a fresh socket. In
   the second run, also stop and restart Core with the same temporary data and
   workspace before connecting.
4. Reopen the exact tuple and hydrate. Both runs return the same two persisted
   messages with the original message IDs and timestamps.
5. Probe list and nonexistent-session behavior without touching a real user
   session.

Observed results:

| Probe                                                      | Result                                         |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `session/list({})` under the test admin connection         | Empty list                                     |
| `session/list({cwd})`, even after exact profile open       | `cwd_runtime_unavailable`; active profile null |
| Fresh socket hydrate while Core remains running            | Existing two messages returned                 |
| Fresh socket hydrate after Core restart, before exact open | `unknown_session` despite persisted history    |
| Exact tuple open + hydrate after Core restart              | Original two messages returned                 |
| Never-existing ID hydrate before open                      | `unknown_session`                              |
| Never-existing ID open + hydrate                           | Open succeeds, empty session returned          |

Sanitized evidence:
[Fresh connection](evidence/2026-09-14/session-discovery.json) and
[Core restart](evidence/2026-09-14/session-discovery-cold.json). The temporary
Core processes stopped and their state directories were removed. These
completed-turn checks do not prove continued execution across socket loss.

## Validation and limits

The link parser, confirmation/copy panels, General settings, and staged
workspace guard passed 41 relevant unit tests, Web TypeScript checking, and
targeted oxlint. Tests include strict schema/length/control-character checks,
Unicode/Windows/UNC paths, credential removal when copying a link, HTML
escaping, pending/error states, and candidate rejection before hydrate when
workspace scope differs. The integrated App passed all seven Chromium checks in
`e2e/session-links.spec.ts`: empty-storage browser confirmation and exact
reopen, failed open with explicit retry, invalid-link dismissal without an open
RPC, wrong-workspace rejection before hydrate, clipboard pending/success,
clipboard refusal with selected read-only fallback, and diagnostics-copy
refusal/retry. The transcript comparison waits for the asynchronous code
renderer in both browsers, so it compares the same rendered state.

The General settings copy action appears only for a server-confirmed reference.
It reports **Copied** only after the clipboard promise resolves. Clipboard
refusal shows a focused, selected read-only link for manual copying. The
confirmation surface was inspected in the browser:
[Saved conversation preview](evidence/2026-09-14/saved-conversation-preview.png).
A matching same-tab bookmark uses the existing restore exactly once; a rejected
restore retains authentication and returns to workspace selection without a
second link-open attempt. A different incoming link takes precedence over the
previous tab selection: authentication restores first, and the target waits for
its explicit open action if it is not a known reference. An additional
integrated browser test checks that no request opens the previous selection in
that flow. Whole-repository checks are recorded by the follow-up product audit.

The link contains a server filesystem path and profile/session identifiers; it
contains no auth credential or conversation content. It does not confer access.
It also does not discover conversations for which the user has no saved link or
confirmed tab reference. The user must connect to the server that owns the saved
conversation; the legacy three-field link itself carries no server identity. A
complete cross-browser history catalog still needs a trustworthy server-owned
SessionRef listing contract.
