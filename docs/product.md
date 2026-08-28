# Product scope

octoscode-web is the browser sibling of the Octoscode TUI. It gives coding work
a focused Web workspace while preserving Octoscode's command and state
semantics. Octos Core remains the runtime and source of durable truth.

## Product principles

1. **Same action, same meaning.** Launch, commands, prompt queueing,
   interruption, approvals, questions, and session transitions follow Octoscode
   rather than inventing a second browser dialect.
2. **The server owns work.** Sessions, permissions, diffs, plans, tasks,
   artifacts, cost, and replay are projections of `octos serve` state.
3. **Capabilities are runtime truth.** Optional controls appear only when the
   connected server advertises them. Safety-bearing ambiguity fails closed.
4. **Recovery is a product invariant.** Reconnect includes hydrate, cursor
   replay, deduplication, session scoping, and gap handling.
5. **A focused surface wins.** The app does not inherit the voice, home,
   learning, Studio, slides, sites, admin, or cloud shell from `octos-web`.
6. **Behavior from Octoscode, product language from DSH.** DeepSeek Harness is
   the audited visual and browser-product reference, not the runtime base.
7. **Authentication is not work selection.** Connecting identifies an Octos
   server; Workspace and Session choices happen inside the product shell.

## Supported surface

| Area          | Current behavior                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Connection    | Origin/token authentication gate, durable origin only, same-tab selected-Session restore, and Settings disconnect/forget.   |
| Navigation    | Workspace/Session sidebar with search, tab-confirmed Session refs, grouped or flat views, create, switch, and Settings.     |
| Onboarding    | Capability-gated solo profile/provider setup with catalog data, test-before-save, transient credentials, and TUI fallback.  |
| Conversation  | Session-local Chat with durable transcript, FIFO prompts, interrupt, commands, safe GFM, and highlighted code.              |
| Trajectory    | Session-local plan, runtime policy, task lifecycle, bounded output, cancellation, and paged artifacts.                      |
| Decisions     | Typed approvals plus single-select, multi-select, and free-text questions.                                                  |
| Coding safety | Server-confirmed permission/network choices beside the composer, dangerous-access acknowledgement, and diff review.         |
| Models        | Effective Session runtime status in the composer; capability-gated provider configuration and Profile defaults in Settings. |
| Workspace     | Server-confirmed path, same-cwd multi-Session switch/create, per-Session drafts, and tab-scoped navigation memory.          |
| Usage         | Context-window, token, and cost projections from typed server state.                                                        |
| Recovery      | Hydrate, cursor resume, dedupe, replay-loss detection, gap repair, reconnect, and safe crash recovery.                      |

Transcript rows are a bounded browser rendering projection, not the durable
history store. When older rows fall outside that window the first visible row
states how many were omitted and points back to server hydrate. Model-authored
remote images render as alt text rather than making an automatic cross-origin
request; explicit links remain user-initiated.

The connection gate asks only which Octos server to authenticate to. Inside the
product, the user-facing hierarchy is **Workspace → Session**. Workspace is the
coding object: it groups durable Sessions by a path on the Octos server. There
is no separate generic “Object” type or browser-owned session database. The
selected Session owns its Chat and Trajectory views and its permission control.
The composer also reports the model served by that Session's runtime; it does
not present a Session-only model override.

Current Core builds do not expose a complete server-wide Workspace/Session
catalog. The browser remembers a bounded list of recent server paths and the
minimal `(workspace_root, active_profile_id, session_id)` references that this
tab has successfully opened. A local last-opened timestamp orders those rows. It
does not cache Session titles, prompts, transcripts, model output, or other
durable projections. Multiple confirmed Sessions may share one Workspace path
without replacing each other.

Those rows remain incomplete navigation memory. Core rc.9 can silently ignore
the requested cwd and loses the target Profile for some unscoped/admin
`session/list({cwd})` calls; its response does not echo either effective scope.
The Web therefore does not project that list as a catalog. A new tab cannot
discover older server Sessions until the authoritative object model and scoped
SessionRef tracked in
[octos#2146](https://github.com/octos-org/octos/issues/2146) land.

## Session navigation and running turns

A locally started turn becomes safe to move behind another Session only after
Core acknowledges `turn/start`. The Web stages and hydrates the destination,
then retains the exact old owner WebSocket while the new Session becomes the
foreground view. The old Session row continues to show running, waiting,
completed, or failed status; returning to it reconstructs conversation truth
from server hydrate/replay rather than from a browser transcript copy.

Browser-local pending prompts still belong to the selected Session's FIFO, and a
start request without its acknowledgement has unresolved ownership. Either state
blocks create/switch until it settles. A fresh unambiguous `activate` decision
for a Web Session opens automatically; `cross_profile` and `no_profile` remain
explicit product decisions.

The rc.9 compatibility layer retains at most eight live owner connections.
Reopening an already retained Session reclaims its exact connection and still
works at the limit. A new target is refused at the limit with an explicit
Disconnect/reconnect recovery path; the product never silently evicts a terminal
owner because Core has not proved its tail work quiesced.

This rc.9 compatibility behavior lasts only inside the same live tab. Refresh,
tab close, network or proxy loss, and manual **Disconnect** close the owner
WebSocket and terminate a still-running turn; even a terminal owner may still be
finishing Core tail cleanup. Disconnect keeps the current tab's confirmed
Session references for a later reconnect. **Forget server** or changing
endpoint/token identity clears those references, recent Workspace paths, and
in-memory drafts. Durable execution across transport loss requires a future
server-owned turn lease.

Settings opens from the bottom of the sidebar. General shows the active server
and Workspace and provides Disconnect and Forget server. Models distinguishes
the Session runtime model from the active Profile default. It reads Core's
configured primary and fallback models and, when the corresponding methods are
advertised, can add, edit, test, discover, save, select, or delete a
provider/model/route entry. The editable route fields are label, base URL,
credential environment name, and protocol. Provider discovery supplies model id
suggestions; it does not remove the manual model-id path.

The provider API-key field is write-only. Its value exists only in the current
open editor and request, and is sent to Core for Test, Fetch models, or Save.
Core owns the saved credential and returns only `has_api_key`; the Web does not
retrieve it or claim anything about Core's storage encryption. Leaving the field
blank for a configured route preserves and reuses the Core-owned key. Save tests
the exact draft before mutating the Profile, and Delete requires confirmation.

Changing the Profile default affects every Session using that Profile and can
require an Octos restart; it is not a Session-scoped choice. The current AppUI
configuration contract does not persist `temperature`, `top_p`, token limits,
context limits, or reasoning controls, so Settings does not present inert
controls for them. Runtime architecture, raw capabilities, boundary
explanations, session files, and global Activity do not occupy the product
navigation.

## Deliberate non-goals

- Running an agent, model, tool, sandbox, plugin, or durable store in the
  browser.
- Importing the DSH/Cordis host runtime or the old `octos-web` application.
- Voice, camera, smart home, Learn, Studio, slides, sites, or administration.
- PTY terminal emulation, a full code editor, or a general repository filesystem
  API.
- Loading arbitrary third-party JavaScript into the client.
- Guessing unsupported capabilities or reconstructing server truth from prose.

## Forward work

The current product slice is release-gated and usable. Broader parity depends on
explicit Core contracts rather than more client-side inference:

- Generate request, result, and event payload types from a machine-readable Core
  schema
  ([tracking issue #1](https://github.com/octos-org/octoscode-web/issues/1)).
- Add a persistent Core Workspace/Session object model with globally addressable
  descriptors ([octos#2146](https://github.com/octos-org/octos/issues/2146)).
- Make durable Session policy/full-access administration and Session-scoped
  model choice explicit Core contracts
  ([octos#2147](https://github.com/octos-org/octos/issues/2147),
  [octos#2148](https://github.com/octos-org/octos/issues/2148)).

These are upstream contract boundaries, not invitations to add a transcript
store or a second event dialect. See
[ADR 0019](adr/0019-tab-session-navigation-and-background-turn-ownership.md),
[ADR 0018](adr/0018-dsh-aligned-product-shell.md), and the
[ADR index](adr/README.md) for the decisions behind the current product.
