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
| Recovery      | Hydrate, cursor resume, dedupe, replay-loss detection, gap repair, reconnect, and explicit uncertain or interrupted state.  |

The expanded candidate also exposes capability-gated native peers and gather,
agents/goals/loops/monitors, context/cache/compaction, snapshot undo,
rewind/fork, native review, tool/MCP inventory, skills, and research lanes.
`/thinking` captures per-Session reasoning effort in new queued turns; `/images`
explicitly uploads up to four supported images, each at most 20 MiB. These
controls do not imply full TUI parity or a passed live soak; acceptance is
tracked in [Feature parity](feature-parity.md).

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
The Web therefore does not project that list as a catalog. A new tab can reopen
an exact saved conversation link after authenticating, but cannot browse a
complete server Session directory until the scoped catalog tracked in
[octos#2146](https://github.com/octos-org/octos/issues/2146) lands.

## Session navigation and running turns

Each confirmed Session retains one controller, FIFO, interaction ledger, cursor,
and bounded transcript projection in the current tab. Several Sessions may run
simultaneously, and switching or creating a Session is independent of another
Session's queued prompts or pending start acknowledgement. The source queue
drains on its own terminal events, not on selection. Returning selects that
retained projection; reconnect still requires authoritative hydrate/replay.

Approvals and questions remain attached to their exact Session and generation. A
background waiting badge does not resolve them in the selected Session.
Running/waiting states take precedence over retained terminal evidence; an empty
or metadata-only Session has no completed-work badge. Candidate open failure
leaves the source view intact. Stop and other mutations still require their own
current authority and readiness checks. A fresh unambiguous `activate` decision
opens automatically; `cross_profile` and `no_profile` remain explicit choices.

All retained Sessions share one physical authenticated WebSocket. The old
eight-owner-connection cap and ACK navigation guard no longer govern this
candidate. Native peers use server-staged identities and the same record engine;
hosting a background master's peer does not change focus. **Refresh blackboard**
reads Profile-wide peer results. `/gather [all|slug…]` additionally composes a
bounded synthesis prompt in the originating master's FIFO, not an invented
browser agent fleet.

Core rc11 still interrupts connection-owned work on transport loss. Refresh, tab
close, network/proxy loss, and manual **Disconnect** are not detached
continuation. Ordinary reconnect preserves in-memory queues but suspends
dispatch until each record is rehydrated and reconciled; a failed/interrupted
turn is not blindly resubmitted. Reload loses queued prompts and image drafts.
Disconnect retires records but keeps confirmed navigation refs. **Forget
server** or changing endpoint/token identity clears those refs, recent Workspace
paths, and tab-scoped drafts. The rc9 pinned runtime baseline is unchanged; the
rc11 parity candidate needs its own acceptance evidence.

Unsent composer drafts survive ordinary refresh in the current tab, bound to the
same server, sign-in and exact Session. They are browser editing state, not
server transcript history, and are never automatically submitted on restore.
Pending queued messages are still tab-runtime state and are not restored after a
full reload. Storage failures preserve in-memory editing and show a warning; an
older persisted draft can remain when the browser refuses an update or deletion.
Forgetting reports failure if the browser refuses to clear saved data. The tab
retains at most 50 nonempty drafts. At capacity it keeps the current input and
existing drafts, and asks the user to send or clear the input before switching;
it never silently evicts an earlier draft.

The tab title counts unseen background responses that complete or need input.
General Settings offers an explicit desktop-notification opt-in. Notifications
contain generic status text, not prompts, file paths or output; replaying
history does not notify again. A hidden current Session uses explicit turn
terminal events, never the disappearance of a local queue, to detect completion.

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
require an Octos restart; it is not a Session-scoped choice. The inspected rc11
AppUI contract supports typed per-model `temperature`, `top_p`,
`context_window`, reasoning defaults, and compatibility hints. Neither the
pinned TUI nor Web offers an editor for those overrides. Web preserves known
configured values when editing a provider and blocks edits it cannot preserve
safely. The separate `/thinking` control captures per-turn reasoning.
`/activity` searches confirmed Sessions; tool/MCP, skills/research, context,
history, and peer controls open scoped product panels rather than a raw RPC
console.

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

The current self-hosted slice has bounded recovery and execution guarantees. The
expanded product is an acceptance candidate, not a blanket parity pass. Fixture
results and limited real-Core checks must remain distinct from the
multi-Session/native-peer live soak. Broader parity also depends on explicit
Core contracts rather than more client-side inference:

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
[ADR 0019](adr/0019-tab-session-navigation-and-background-turn-ownership.md) for
the historical, superseded per-owner-connection/ACK guard,
[ADR 0018](adr/0018-dsh-aligned-product-shell.md), and the
[ADR index](adr/README.md) for the decisions behind the current product.
