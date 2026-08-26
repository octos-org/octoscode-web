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

## Supported surface

| Area          | Current behavior                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Launch        | Server-resolved workspace resume, activation, cross-profile choice, and explicit fallback session.                         |
| Onboarding    | Capability-gated solo profile/provider setup with catalog data, test-before-save, transient credentials, and TUI fallback. |
| Conversation  | Durable transcript, FIFO prompts, interrupt, slash/bang command resolution, safe GFM, and highlighted code.                |
| Decisions     | Typed approvals plus single-select, multi-select, and free-text questions.                                                 |
| Coding safety | Server-confirmed permission profiles and proposal-time diff previews.                                                      |
| Supervision   | Live plan, runtime policy, task lifecycle, bounded output, cancellation, and paged artifacts.                              |
| Workspace     | Session list/create/switch/delete, per-session drafts, safe file metadata, and responsive work inspector.                  |
| Activity      | Bounded recent-session task scan and searchable, filterable `/activity` navigator.                                         |
| Usage         | Model, context-window, token, and cost projections from typed server state.                                                |
| Recovery      | Hydrate, cursor resume, dedupe, replay-loss detection, gap repair, reconnect, and safe crash recovery.                     |

Transcript rows are a bounded browser rendering projection, not the durable
history store. When older rows fall outside that window the first visible row
states how many were omitted and points back to server hydrate. Model-authored
remote images render as alt text rather than making an automatic cross-origin
request; explicit links remain user-initiated.

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
- Expose a bounded Core activity snapshot for complete multi-session parity
  ([tracking issue #3](https://github.com/octos-org/octoscode-web/issues/3)).

These are upstream contract boundaries, not invitations to add compatibility
stores or a second event dialect. See the [ADR index](adr/README.md) for the
decisions behind the current product.
