# Pinned TUI command and feature coverage

This is a source inventory, **not a blanket parity acceptance result**. The
reference is octoscode `0a174d95ddec2b123adb3498432e29eb13affb81`, especially
`src/menu/registry.rs:565–1088` (all 44 canonical commands), `src/menu/types.rs`
and their dispatched handlers in `src/store.rs`. Runtime contracts below were
checked against the isolated rc11 Core source. The generated repository contract
pin remains unchanged. The [acceptance checkpoint](feature-parity.md) owns the
build, browser, native execution, and endurance results.

“Implemented” means a current Web route exists; it does not independently
certify every route's live acceptance. “Equivalent” means native behavior has a
browser presentation, but not necessarily every slash alias or inline argument.
“Partial” and “pending” identify real remaining work or acceptance still to be
completed. “Platform” identifies an actual host boundary, not a reason to
exclude ordinary browser-capable functionality. The accepted historical
checkpoint is artifact D, `index-BMc1_9DK.js`, with HTML SHA-256
`bfeac85610e3b4781db576f1b28ff0765fcb585f47f6f1a8d0626756ec3ec7c4`. Current E
source additionally implements browser language, selectable themes, the pinned
Vim composer subset, and explicit local preference saving. E's final build, full
browser suite, and real-Core soak acceptance remain pending; D's results below
must not be attributed to E.

## D validation scope

The deterministic gate passed 1,008 unit/component tests, 66 fixture-browser
tests, and 437 synthetic JSON-RPC assertions across four rounds of 12 concurrent
Sessions. The synthetic check does not exercise a browser or live Core. New
browser regressions in `e2e/native-workflows.spec.ts` and
`e2e/resume-and-reasoning.spec.ts` cover capability-off rejection, captured
Session ownership, delayed replies, drafts, native controls, historical resume,
and reasoning visibility. These are distinct from real-provider evidence.

The separate D browser/native report
`browser-native-workflows-MTPPHQOI_B5117F8B-bfeac85610e3.json` passed 72
assertions against actual rc11 Core, with unchanged built/served hashes, one
WebSocket, and no remaining owned active turns. Its bounded coverage is:

- Idle and busy `/btw`, including a reply that actually arrived after switching
  from A to B; neither aside created an ordinary turn. Ephemeral absence was
  checked in the browser timeline, not by a separate durable-history audit.
- Native thread graph and turn state while busy and after completion. An empty
  busy graph was a valid exact server result; the completed graph then contained
  one actual thread with the completed turn's messages. Narrow-screen inspector
  layout/focus checks also passed.
- Remembered approval inspection returned a valid empty scope list. The native
  result has no outer Session echo; nonempty row ownership/rendering is covered
  by deterministic tests, not this empty live receipt.
- Opt-in steering returned `steered:true` for the exact already accepted turn,
  without another start. Rejection, fallback-UUID, ambiguous-send, and repeated
  dropped-input recovery branches remain deterministic evidence, not claims
  about branches exercised by this live run.
- A disposable busy Session's one-token goal was created, paused, resumed,
  stopped, and cleared. Each transition used a fresh read and omitted budget
  replacement. A fixed loop with an 86,400-second interval was created, paused,
  resumed, and deleted before firing.

There was **no live native agent-spawn/child workflow**, no live agent
status/artifact/control exercise, and no live maintenance/self-paced loop
creation or firing in that report. Those implemented paths have deterministic
coverage. Historical resume and independent reasoning-display visibility also
have deterministic browser coverage, not separate live acceptance in this
72-assertion report. The bounded run does not certify long-duration endurance or
every command below; see the acceptance checkpoint for those separate results.

## E source: local presentation preferences, acceptance pending

The previously pending browser-capable preference scope is now implemented in
source, not excluded from parity:

- **Language:** `/lang` or `/language` opens preferences; the supported English
  and Chinese argument forms select browser UI text directly. A cold Chinese
  catalog contains 911 source-string entries; the audit covered all 784 literal
  translation calls plus command metadata and static label maps. English is the
  fallback. No locale is written to Core, model settings, prompts, or server
  configuration. Server/model/user prose, protocol diagnostics, identifiers and
  paths remain canonical. Compact timestamp units and the relative `now` label
  remain untranslated presentation details.
- **Themes:** `/theme` opens explicit selection of Terminal, Codex, Claude,
  Slate, and Solarized. Terminal is the browser-default adaptation and follows
  the browser's light/dark appearance; named palettes also change code syntax
  colors. This is selectable presentation, not automatic color-scheme styling
  presented as complete theme support.
- **Vim:** `/vimmode` and `/vim-mode` toggle the pinned TUI's 21 composer
  operations: `h`, `l`, `j`, `k`, `0`, `$`, `w`, `b`, `e`, `G`, `gg`, `x`, `dd`,
  `dw`, `cc`, `i`, `a`, `A`, `I`, `o`, and `O`. Insert/Normal editing uses DOM
  UTF-16 coordinates without splitting Unicode scalar values. This is the pinned
  editing subset, not full Vim, Visual mode, or arbitrary keymap remapping; mode
  changes do not start or interrupt server work.
- **Save:** changes apply immediately; `/saveconfig`, `/save-config`, or Save
  browser preferences explicitly persist only the versioned theme/language/Vim
  display record in this browser. No credential, draft, transcript, Session
  identity, or server launch configuration enters that record. Saving native TUI
  launch configuration remains a separate host operation.

All seven preliminary preference-browser cases passed on their unchanged build,
including actual palette/code colors, two busy Sessions with queued text and
images, localized approvals/questions, Vim and explicit-only saving. A
Playwright name-lookup discrepancy was resolved in the harness by selecting the
dialog through its visible heading while independently asserting its exact name
in Chromium's native accessibility tree. These preliminary probes do not certify
the final E source; see the acceptance checkpoint for its separate frozen build
and full validation results.

## All native commands

| Native command and aliases                            | Current source coverage (E acceptance pending)   | Web route or precise boundary                                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/ps`, `/tasks`                                       | Implemented                                      | Scoped process/task summary messages; work inspector and task details provide related deeper inspection.                                                                                    |
| `/stop`, `/interrupt`, `/esc`                         | Implemented                                      | Owning record's native interrupt; no focus reassignment.                                                                                                                                    |
| `/help`, `/?`, `/commands`                            | Equivalent                                       | Searchable command palette; native help-topic arguments are not all mapped.                                                                                                                 |
| `/activity`, `/act`                                   | Implemented                                      | Activity navigator, confirmed sessions, task inspection.                                                                                                                                    |
| `/copy`, `/yank`                                      | Implemented                                      | Last assistant reply to browser clipboard.                                                                                                                                                  |
| `/exit`, `/quit`                                      | Platform/equivalent                              | Native process exit becomes Disconnect or closing the browser tab; cannot kill the server.                                                                                                  |
| `/onboard`, `/setup`, `/wizard`                       | Equivalent                                       | Connection/onboarding and model setup; credential-bearing inline forms are not command history.                                                                                             |
| `/login`, `/auth`                                     | Equivalent                                       | Explicit authentication/onboarding UI; no browser-side server identity provider.                                                                                                            |
| `/add-model`, `/provider`, `/providers`, `/add_model` | Equivalent                                       | Model settings test/save/delete/select flows, including lossless configured-value preservation.                                                                                             |
| `/model`                                              | Implemented                                      | Runtime and configured model selectors.                                                                                                                                                     |
| `/sessions`, `/ss`                                    | Implemented                                      | All confirmed persistent records, arbitrary selection while work continues. Not historical discovery.                                                                                       |
| `/undo`, `/snapshots`                                 | Implemented                                      | Native snapshot listing and explicitly confirmed restore.                                                                                                                                   |
| `/peer`                                               | Implemented                                      | Native preparation, persistent background peer hosting, close and peer inspection.                                                                                                          |
| `/gather [all\|slug…]`                                | Implemented                                      | Native blackboard read followed by bounded synthesis in captured master's FIFO. “Refresh blackboard” remains read-only.                                                                     |
| `/research`, `/lanes`                                 | Equivalent                                       | Research lane settings; direct native inline subcommands need explicit mappings.                                                                                                            |
| `/status`                                             | Implemented                                      | Scoped runtime status summary message; trajectory/work inspector provides related details.                                                                                                  |
| `/cost`, `/usage`                                     | Equivalent                                       | Scoped usage/cost in work inspector; billing input is not context occupancy.                                                                                                                |
| `/context`, `/ctx`, `/compact`, `/compress`           | Implemented                                      | Context read/state/clear and explicitly confirmed compact.                                                                                                                                  |
| `/btw`, `/aside`                                      | Implemented; bounded native validation           | Typed out-of-band ephemeral answer, independent of turn FIFO; delayed A-to-B ownership covered in fixture and live browser.                                                                 |
| `/profiles`, `/profile`                               | Partial/platform                                 | Create/use exists through onboarding and confirmed launch. Native disk enumeration, machine default and deletion require host profile APIs not provided by the pinned remote contract.      |
| `/dock`, `/ag`                                        | Equivalent panel; aliases absent                 | `/agents` opens the roster, status, output, artifact and terminal controls. `/dock` and `/ag` themselves are not registered Web aliases.                                                    |
| `/resume [search]`                                    | Implemented; deterministic validation            | Captured workspace/profile picker, explicit confirmation, authoritative open/hydrate and nonempty history; bare unverified IDs are disabled. Retained busy owners resume without reopening. |
| `/rewind`, `/backtrack`                               | Implemented/equivalent                           | Native rollback plus exact prior user-text prefill; numeric inline shortcut is not automatically equivalent to opening the picker.                                                          |
| `/theme`                                              | Implemented in E source; acceptance pending      | Explicit Terminal/Codex/Claude/Slate/Solarized selection; Terminal follows browser appearance. No server theme or launch-config write.                                                      |
| `/lang`, `/language`                                  | Implemented in E source; acceptance pending      | English/Chinese browser UI selection and lazy Chinese catalog; model/user/server content and protocol values remain canonical. No Core language write.                                      |
| `/thinking`, `/think`                                 | Equivalent; deterministic validation             | Per-Session reasoning-display visibility and separate future-turn effort controls; visibility does not alter captured model effort. Native display-toggle inline grammar is not mapped.     |
| `/scrollmode`, `/scroll-mode`                         | Platform/equivalent                              | Terminal native versus mouse-captured pinned scrolling maps to browser scrolling/follow behavior, not terminal escape sequences.                                                            |
| `/saveconfig`, `/save-config`                         | Implemented E local analogue; acceptance pending | Explicitly saves only browser display preferences. Native TUI launch config is not written. Credentials remain restricted to documented tab storage, never localStorage.                    |
| `/steer`, `/steer-mid-turn`, `/steermode`             | Implemented; bounded native validation           | Explicit per-Session opt-in; default inputs stay FIFO. Captured active-turn steering and deterministic returned-input/ambiguity protections; unsupported steering stays queued.             |
| `/vimmode`, `/vim-mode`                               | Implemented in E source; acceptance pending      | Insert/Normal composer editing with the pinned 21-operation subset, Unicode-safe DOM offsets, and no new server task owner. Not a full Vim implementation.                                  |
| `/statusline`, `/status-line`                         | Platform; native save absent                     | Terminal decoration; pinned TUI explicitly rejects SaveStatusLine as unwired.                                                                                                               |
| `/title`                                              | Platform; native save absent                     | Terminal title composition, not `session/title/set`; native SaveTerminalTitle is unwired.                                                                                                   |
| `/keymap`, `/keys`                                    | Platform/equivalent                              | Terminal shortcut diagnostics can become browser shortcut help; pinned SaveKeymap is unwired, not implemented remapping.                                                                    |
| `/permissions`, `/permission`                         | Implemented; bounded native validation           | Read-only remembered approval-scope inspector; profile/network controls remain available separately. Live empty-list receipt; deterministic nonempty exact-owner rows.                      |
| `/mcp`                                                | Implemented within runtime capability            | Inventory/status is available. Native menus contain gated config operations, but current Core lacks those advertised remote CRUD methods.                                                   |
| `/tools`, `/tool-settings`                            | Implemented within runtime capability            | Tool inventory/status; same runtime capability boundary for gated configuration.                                                                                                            |
| `/skills`, `/skill`                                   | Implemented/equivalent                           | Installed/registry search and confirmed install/remove; native inline grammar is not automatically implemented.                                                                             |
| `/task`                                               | Equivalent                                       | Task output and artifact list/read through TaskDetail; exact artifact selector command may require a route.                                                                                 |
| `/threads`, `/thread`                                 | Implemented; bounded native validation           | Typed native graph inspector with captured authority; accepts bare, `graph`, or `graph-get`. Valid busy-empty and completed one-thread results verified against actual Core.                |
| `/turn state [UUID]`                                  | Implemented; bounded native validation           | Typed native lifecycle inspector; bare/state/state-get without UUID requires a confirmed active turn. Explicit UUID uses `state` or `state-get`; invalid arguments fail closed.             |
| `/review`, `/code-review`                             | Implemented                                      | Native idle-session review/start, exact UUID ownership, no browser reviewer loop.                                                                                                           |
| `/agents`, `/agent`                                   | Implemented controls; deterministic validation   | List/output/status, artifact list/read, interrupt/close, and idle-only native spawn-prompt form. No live child/control acceptance claimed; inline subcommands remain unsupported.           |
| `/goal`                                               | Implemented controls; bounded native validation  | Get/set/clear and fresh-read pause/resume/stop controls; transitions do not reset budget. Newer goal notifications cancel stale writes. Inline subcommands remain unsupported.              |
| `/loop`                                               | Implemented controls; partial live validation    | Confirmed maintenance, self-paced and fixed-interval creation plus lifecycle controls. Only fixed creation/pause/resume/delete was exercised live; inline native shorthand is not mapped.   |

## Implemented native contracts and remaining syntax limits

- **Aside:** `session/btw {session_id, question, topic?}` returns
  `{session_id, answer, model?}`. The TUI sends one independent pending request
  per Session, not a queued turn. Core uses a restricted context-snapshot call
  with no tools and no durable conversation mutation. `btw_busy` is an error,
  not queued work. See TUI `store.rs:3544` and Core `ui_protocol.rs:3068`.
- **Thread graph:** `thread/graph/get {session_id, at?}` requires
  `state.thread_graph.v1`; returns the captured Session, cursor, thread rows
  (`thread_id`, `root_seq`, optional root client message/turn ID,
  `message_seqs`, status) and orphan message sequences. Web reads the current
  snapshot; it does not expose the optional historical `at` selector. See TUI
  `store.rs:2007`.
- **Turn inspection:** `turn/state/get {session_id, turn_id}` requires
  `state.turn_state_get.v1`. Render lifecycle, optional timestamps/thread and
  committed sequences; do not expose arbitrary opaque context as trusted UI.
  Native `/turn state` without a UUID uses the actual active turn or refuses.
- **Historical resume:** `session/list {cwd?}` has an additive negotiated
  workspace-cwd feature. Core `ui_protocol.rs:3134` explicitly notes that
  project scoping also depends on `appui.sessions_in_cwd`. With that flag
  disabled, supplying cwd is not proof that each returned row belongs to the
  workspace. Selection must retain explicit profile/workspace context and
  confirm through the existing scoped open/hydrate path; listing alone is not
  ownership. The TUI wraps raw list IDs unchanged (`store.rs:3191`), and legacy
  Core listings can strip their original profile/channel. Never infer a full
  identity by prepending the current profile to a bare catalog ID. Already
  confirmed IDs or explicit full IDs with matching encoded profile can be
  resumed after confirmation; ambiguous bare rows require identity resolution,
  not silent binding. Empty hydrate of a row advertised as historical must not
  be reported as successful history resumption.
- **Steering:** handwritten AppUI `turn/steer` takes
  `{session_id, expected_turn_id, input:[{kind:"text",text}]}` and returns
  `{turn_id,steered}`. True means the existing active turn consumed/buffered the
  input; false means Core already started a new server-minted UUID. Default
  Enter remains FIFO. Never steer before admission, past pending drafts, after
  local interrupt, or by dropping attachments/reasoning metadata unsupported by
  this method. `turn/steer_dropped` returns ordered text before terminal; only
  exact retained local matches may be restaged, count-exact and
  replay-idempotent. Ambiguous sent requests are not automatically replayed. See
  TUI `store.rs:699` and `12857`, Core `api/ui_protocol_transport.rs:319` and
  `22352`.
- **Agent operations:** `agent/status/read`, `agent/artifact/list`,
  `agent/artifact/read`, `agent/interrupt`, and `agent/close` all capture
  `{session_id,agent_id}`; artifact read selects exactly one `artifact_id` or
  `path`. Use actual capability gates and scoped typed result validation.
  `/agents spawn N prompt` is not a new RPC: while idle the TUI submits
  `Spawn N agent(s) to accomplish in parallel: prompt` as a normal master turn.
  See TUI `store.rs:2144–2259`, `model.rs:382–475`, `locales/en.yml:590`.
- **Goal transitions:** TUI first refreshes `session/goal/get`, then sends
  `session/goal/set` with the freshly confirmed objective, omitted token budget,
  and explicit `transition_actor:"user"`: pause sets status `paused`, resume
  sets `active`, and stop sets `complete`. The TUI's action enum is a local
  classifier marked `serde(skip)`, not an extra JSON field. Clear is distinct.
  Do not create a replacement goal from a stale cached objective. See TUI
  `store.rs:2308` and `2501` and the goal-read result handler.
- **Loop creation:** mode `self_paced` has a prompt and no interval; mode
  `fixed_interval` has a positive interval in seconds; mode `maintenance` may
  have an empty prompt so Core reads its native maintenance instruction file.
  Bare native `/loop` means maintenance, not list. Web `/loop` opens controls
  with Maintenance selected by default and requires explicit Create; it does not
  silently create work or substitute self-paced mode. Fixed intervals use the
  native whole-number/unit grammar, including its millisecond-to-whole-second
  conversion, within the pinned Core range of 60–86,400 seconds. See TUI
  `autonomy.rs:535–632`, `store.rs:2377`.
- **Remembered approvals:** `approval/scopes/list {session_id}` returns
  `{scopes:[{session_id,scope,scope_match,decision,turn_id?}]}`. This is an
  inspection action, not response/revocation. Pinned TUI scopes-clear is itself
  explicitly an unwired disabled action (`menu/providers.rs:6433`).

The controls above do not claim full native inline grammar parity. For example,
`/agents spawn N prompt`, `/goal pause`, `/loop every 5m prompt`, and numeric
`/rewind` remain unsupported inline forms; use the corresponding confirmed Web
controls. Native aliases not registered in the Web registry, such as `/dock` and
`/ag`, also remain unavailable. `/thinking` opens effort and visibility
controls; supported effort arguments do not imply support for native display
toggle arguments. Help topics and research/skill/task selector subcommands
retain the limits in the table. Unknown, unavailable, or malformed commands must
fail closed rather than become model prompts.

## Non-command feature audit and honest exclusions

Native streaming transcript, reasoning, tool lifecycle, explicit approvals and
questions, scoped background attention, queues, arbitrary session switching,
native peers, context/cache, model/permission settings, history operations and
images have Web implementations. Their acceptance remains tied to exact artifact
and test evidence, not this inventory.

Browser-capable presentation preferences—language, selectable themes, and the
pinned Vim-style composer subset—are now implemented in E source, with explicit
browser-only saving. Their final E acceptance remains pending; they are not
excluded from parity or described as server limitations. Independent per-Session
reasoning visibility (native `menu/providers.rs:518`) is now implemented and
deterministically browser-tested, separately from model effort. Source-level
presentation coverage does not erase the inline-syntax and technical-output
qualifications in this inventory.

The native `@` picker scans the host filesystem directly (`src/file_picker.rs`);
the browser cannot silently scan the remote cwd or read bare paths. Explicit
file selection/upload translates image attachment (four images, 20 MiB each);
arbitrary remote file discovery needs a supported server contract. Native
launch-config writes, profile-disk management, terminal title/statusline and
process exit are genuine host boundaries; the implemented browser display save
is distinct. The pinned TUI explicitly has no voice playback or video UI
(`store.rs:11703`); those are not missing TUI parity. Temperature/top-p editors
are also absent from the pinned TUI, though Core accepts those fields: preserve
existing configured values without inventing new inference-editor scope.

Finally, server runtime controls are not browser simulations: no local agent
loop, no fake monitor scheduler, no synthetic peer completion, no durable
browser transcript store, and no promise that work survives rc11 connection
ownership loss. A reloaded tab loses never-sent in-memory drafts; Core owns
canonical history and recovery.

## Web-only control surface (not a native command)

`/monitor` is not part of the pinned TUI's canonical command set: the reference
consumes monitor lifecycle notifications but exposes no `/monitor` slash
command. Web registers it as a capability-gated control.

| Web command | Coverage                                  | Route and capability boundary                                                                                                                                                                                                                                                                                         |
| ----------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/monitor`  | Implemented in source; acceptance pending | List/create/pause/resume/delete through captured Session authority, gated on the `monitor/create` or `monitor/list` method plus the `coding.autonomy.v1` and `coding.monitor_runtime.v1` features. Core owns monitor scheduling; the browser hosts no scheduler, and no completed live monitor acceptance is claimed. |
