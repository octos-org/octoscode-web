# TUI parity implementation and acceptance

Status: integration implemented; final browser and live-provider acceptance is
in progress. Historical delivery reviews below are retained as an audit trail;
the latest checkpoint is recorded at the end. This is not a blanket parity or
soak-pass claim.

## Pinned comparison

- Web baseline: `2f23a72d8dad26777d4bc3296a3d99048c9360a1`.
- TUI behavioral reference: `0a174d95ddec2b123adb3498432e29eb13affb81`.
- Live Core candidate: `2.0.3-rc.11` (`d51601d`). The existing released-runtime
  compatibility gate remains separately pinned to rc.9 until explicitly updated.
- Architecture and independent acceptance: Codex GPT-6 Astra.
- Execution lanes: native Octos peers using Kimi K3, GLM-5.3, and DeepSeek V4
  Flash. A configured lane alone is not proof of effective model execution.

## Highest-priority product requirement

Multiple Sessions must run simultaneously, with arbitrary switching. Each
Session retains its own pending prompts, accepted turn, approvals/questions,
peers, cursor, and completion state. Selecting another Session changes the view,
not the lifetime of work. A queued prompt in A must execute after A's first turn
finishes while B is visible. A's output or decisions must never appear in B.

The baseline does not meet this requirement fully: it rejects navigation with
queued prompts and retains an observer for one acknowledged background turn, not
a complete per-Session runtime. The eight retained-connection limit is a Web
implementation limit, not a protocol limit. Core supports multiplexed sessions.

The integrated implementation uses persistent Session records sharing one
authenticated transport. Each record is keyed by endpoint, authentication epoch,
workspace, Profile and native Session identity. Runtime ownership is separate
from active selection; switching does not replace the owning queue or reducer.

## Gap inventory

| Area                          | Baseline                 | Acceptance work                                                                                                         |
| ----------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Concurrent Sessions           | Partial                  | Independent FIFO/dispatch/interaction state; focus-only switching; 12 Sessions and 3 peers without a socket per Session |
| Native peers                  | Absent                   | Server-staged open/kickoff, exact-once replay handling, scoped roster/watch/gather and close races                      |
| Goals, loops, monitors        | Absent                   | Capability-gated server snapshots and controls; stale-generation protection; background activity                        |
| Steering and queues           | Partial                  | Retained-input recovery, interrupt races, exact TUI steering semantics                                                  |
| Context and cache             | Partial                  | Authoritative context estimates, compaction lifecycle, cache diagnostics, no usage-as-context inference                 |
| Commands                      | Narrow                   | Real entry points to implemented controls; unavailable/unknown slash and bang commands remain fail-closed               |
| Sessions and transcript       | Substantial              | Preserve hydrate/replay/rollback protections; add rewind/fork and all-Session recovery                                  |
| Model and permission settings | Substantial              | Preserve effective-runtime vs Profile-default distinction and secret non-retention                                      |
| Extended tools and settings   | Missing browser controls | Read-only tools/MCP; skills and research lane management; reasoning selection; attachments                              |
| Terminal-host operations      | Browser-inapplicable     | Do not implement a browser agent loop, binary installer, or pretend local shell execution                               |

Source evidence: Web `features/session/use-octos-session.ts`,
`session-record-manager.ts`, `features/composer/turn-queue.ts`,
`features/commands/registry.ts`, and `features/supervision/WorkInspector.tsx`;
TUI `src/store.rs`, `src/model.rs`, and `src/menu/registry.rs`; Core
`crates/octos-core/src/ui_protocol.rs` and
`crates/octos-cli/src/api/ui_protocol_transport.rs`.

Second-wave audit distinguishes conversation rewind (`session/rollback`) from
workspace undo (`snapshot/restore`), and native review (`review/start`) from
diff preview. Reasoning selection must be sent on every user turn: omission
clears the stored override. Explicit attachments require authenticated upload,
queued media ownership and authenticated download; a bare path in a message is
not an attachment. Core rc.11 supports skills and research-lane management, but
does not implement MCP/tool configuration CRUD. Those mutation menus must stay
hidden.

## Execution boundaries

- Kimi K3 owns Session runtime/queue ownership and native peer lifecycle.
- GLM-5.3 owns isolated autonomy contracts, controllers, UI and unit tests.
- DeepSeek V4 Flash owns Playwright product regressions, fixtures and soak
  tooling. It must distinguish newly exposed product failures from test defects.
- Codex owns cross-feature architecture/integration, remaining gaps, and final
  acceptance. Peer self-reported success does not complete an acceptance row.

Each peer works in a fenced checkout. Provider credentials and runtime evidence
remain outside version control; workspace `.octos/` ledgers are ignored.

The 2026-09-06 native corrective round ran in the shared integration worktree
(`worktree:false`) with disjoint file ownership: K3 reviewed
Session/composer/commands, GLM-5.3 reviewed preferences/localization/theme and
the autonomy feature surface, and DeepSeek V4 Flash corrected the fixture
driver, added monitor/manual-loop browser regressions and a synthetic
native-driver smoke, and verified the E goal-generation audit facts below.
Codex-written integration code is not re-attributed to any peer; this note only
records who executed which corrective review and test work in this round. Peer
progress evidence: `native-correction-k3.md`, `native-correction-glm.md`,
`native-correction-deepseek.md` (task-owned, kept outside the web checkout).

## Acceptance gates

1. Required `pnpm check`, generated-contract verification, and pinned-Core
   smoke.
2. Playwright desktop and narrow-viewport UX, keyboard/focus and accessibility.
3. A/B/C simultaneously running with multiple queued inputs; repeatedly switch
   during start acknowledgement, tools, decisions, interruption and completion.
   Assert independent FIFO progress, exact-once submission and no cross-talk.
4. Background approvals and questions while another Session runs; responses
   target the owning Session and transport generation.
5. At least 12 Sessions and three native peers; bounded transport/listener
   counts, no eight-session wall, no replayed kickoff or stale peer
   resurrection.
6. Reconnect/hydrate every tracked Session independently; keep unsent in-memory
   inputs, reconcile accepted inputs, and never resend an ambiguous submission.
7. Separate live-provider soak: record actual model attribution, concurrent
   tool/turn evidence, gather receipts, exact rounds/duration and all failures.
   Synthetic fixture passes are not live-provider evidence.

## Transport-loss boundary

Core rc.11 aborts connection-owned work when its owner socket closes. Switching
within a live tab must not close that socket. Refresh, network loss and daemon
restart require separate recovery tests: restore durable state and explicitly
show interruption or incomplete evidence. Do not claim uninterrupted execution
across tab destruction without a server-owned execution lease. Browser-local
unsent queue survival across a full refresh needs an explicit draft/outbox
contract, not hidden persistence of prompts in connection preferences.

## Initial results (historical)

- Initial deterministic gate exposed that live Octos workspace ledgers were not
  excluded from formatting. Added `.octos/` to Git and Prettier ignores.
- With runtime files excluded, the baseline `pnpm check` passed: 317 unit and
  component tests. The separate bundled-Chromium baseline passed 35 tests.
- A real browser baseline against rc.11/DeepSeek V4 Flash passed a tool-backed
  read, final answer, refresh and durable transcript restore. No browser page
  errors or auth token in localStorage. This single-task check is not a soak.
- Three native peers started on the requested model lanes and are implementing
  changes. Their context-normalization model attribution and real tool activity
  were observed. Generic `session/status/read` incorrectly reports the primary
  model for the differently routed peers; do not treat that label as acceptance.
- Context occupancy now uses lifecycle estimates, not cumulative provider input
  usage. Scope, retry-generation and oversized-error regression tests were
  added.
- Independent Astra review and integration remain in progress.
  Concurrent-session behavior, new peer/autonomy controls, extended parity and
  soak are not accepted.

## Independent acceptance review, first delivery

The first Kimi runtime delivery was rejected despite its unit checks passing:
the old single-foreground/background-handoff path still governed execution,
including queued-navigation guards and the eight-connection limit. Candidate
adoption could clear the source queue and hydrate destination work into it. The
replacement must own complete persistent session records, not multiple
controllers sharing only a queue. Kimi is implementing the reviewed managed
transport/persistent-record migration; this row is not accepted.

The first GLM autonomy delivery was also returned for correction. Real rc11
loop/monitor/agent responses contain nullable fields that its decoders rejected.
Additional findings concerned independent async action ownership, same-session
authority changes, stale goal resurrection after clear, list-result scope and
explicit budget/argument parsing. These fixes require a second independent
review and live protocol checks.

DeepSeek's first browser-test draft contained vacuous isolation assertions,
mutable session locators and insufficient concurrent-queue coverage. Its fixture
also needed actual per-session hydration, scoped pending interactions,
consistent live/replay identities and rc11 socket-loss interruption semantics.
New controlled concurrency tests must fail against the old implementation;
running old tests repeatedly is not the requested soak.

The last complete root integration gate passed 83 client and 283 Web tests.
Initial JavaScript remains within the unchanged 350 KiB gate: deferred context
controls and conditional connection UI are code-split instead of increasing the
limit. Real-Core browser UX checks passed repeated session-search focus,
activity entry, context mode/compaction confirmation, tools and MCP status,
desktop/narrow layout, no command-to-model leakage and no auth token in
localStorage. These are bounded checks, not the multi-session/live-provider
soak.

History contracts and a candidate UI exist but are not mounted or accepted.
Independent review corrected rewind checkpoints to match Core's distinct
user-rooted thread grouping, rather than counting user messages. Workspace
restore must also check other known busy sessions in that workspace immediately
before dispatch. The final runtime integration must supply authoritative hydrate
replacement and captured mutation authority; this cannot be approximated by
changing the visible transcript alone.

## Extended settings verification

Profile skills now have narrow nullable-wire guards, installed/registry views,
and explicitly confirmed install/remove controls. Installs never send a forced
overwrite. Research lanes have separately scoped contracts and a configuration
surface that distinguishes provider identity from API style. Their mutation
receipt distinguishes persisted configuration from restart-required runtime
state; the browser never restarts the daemon automatically.

Both settings surfaces are deferred, capability-gated and keyed by authenticated
authority. Changes are locked while known work in the same Profile is running.
This is a browser-side known-work guard, not a server-wide atomic exclusion
guarantee. New credentials are not stored in browser persistence or React state;
the input is cleared on dispatch, cancellation and draft reset.
Credential-bearing mutation errors use generic uncertain-outcome text, not
fragile exact-string redaction of a possibly trimmed or escaped credential echo.
A failed attempt consumes its confirmation and requires a fresh review before
retrying.

An in-memory Profile mutation lease survives dialog unmount and Session changes
until the request settles. The composer checks that lease synchronously; closing
the dialog or pressing Escape cannot unlock a pending write. This is still a
browser-side lock, not a distributed server-wide execution lease.

The real-Core browser check passed 18 scoped RPCs, no page errors, no token in
localStorage, narrow-screen layout and confirmation cancellation. It read the
three configured research lanes and an empty skills inventory. It did not
install/remove skills, modify research lanes or restart the runtime. Mutation
contracts have deterministic tests; this is not a live mutation acceptance or a
multi-Session soak. The unchanged initial JavaScript/CSS gate passed at 356,681
and 53,362 bytes respectively.

The original browser regressions plus two new deferred Profile-mutation tests
passed together: 37 Chromium tests, no retries, 1.9 minutes. The added tests
exercise exact Profile binding, same-tick duplicate confirmation, pending-write
close/Escape protection, fresh review after credential failure, and no secret in
DOM or browser storage. They use a synthetic fixture; no actual skill or
research configuration was modified. The real-Core 18-RPC UX check was rerun
against the stable passing build and again had zero page errors.

The authenticated blob client candidate uploaded a 75-byte synthetic file to the
isolated real Core and downloaded identical content using bearer/header scope,
not auth query parameters. Its focused client suite now passes 84 tests. Image
selection/upload and thinking-effort UI candidates are separate work: their
presence does not establish queued-media ownership or end-to-end integration.

The second independent peer review still found blocking integration issues:
runtime selection/recovery paths were partly reading or dispatching through old
owners; autonomy requests could clear another operation's pending state and
retain stale data/generation across authority changes. The browser fixture also
still needed strict interaction ownership, canonical hydration and real native
peer lifecycles instead of an ordinary-session count labelled as peers. These
deliveries remain under correction, not accepted or integrated. The second GLM
delivery passed 84 focused tests but independent probes found same-tick refresh
clobbering, missing notification authority, nested resource-owner validation,
and activity-only revision invalidation; those were sent back for correction.
Native peer contract/lifecycle work was split from Kimi's Session work after
finding that the draft hook still opened a slug through foreground navigation
without a real UUID kickoff. It must use the shared background-record path.

## Integrated candidate checkpoint, 2026-09-06

All three requested native implementation peers have completed their bounded
tasks. Effective normalization reports identified Kimi K3, GLM-5.3 and DeepSeek
V4 Flash; these were real Octos peers, not Codex agents relabelled with provider
names. Codex integrated and independently corrected their deliveries. Peer
self-reported checks remain separate from root acceptance.

The old selected-only queue/interaction path, single-background-turn manager,
pending-navigation intent and eight-connection limit have been removed. One
retained record owns each Session's controller, FIFO, canonical timeline,
interaction ledger and peer lifecycle. Background fork/peer records become
selectable without stealing focus. Closing a selected peer preserves its
read-only transcript and the authenticated shell. Initial-open replay is fenced
before it can stage or dispatch peer work.

History, native review, autonomy, reasoning and explicit image controls are
mounted through captured record authority. History mutations acquire their
record/workspace lease before asynchronous command loading and reconcile only
through canonical hydration. Review uses native `review/start` with the same
turn UUID/queue ownership, not an ordinary prompt presented as a review.
Reasoning and uploaded image handles are captured at local queue admission;
rejected admission preserves the draft. Blank goal budget still means the server
default on rc.11, not unlimited execution.

Independent browser acceptance initially exposed two integration defects: empty
idle Sessions incorrectly displayed a background completion badge, and canonical
history hydration unmounted the mutation dialog before its receipt could be
shown. Both are corrected. Completion/failure now requires retained terminal
evidence; history presentation survives its own refresh while still being fenced
by authenticated transport and Session authority.

Real-provider capacity testing then exposed an ordering defect absent from the
original fixture: Core can emit a complete `assistant_persisted` segment before
later-sequenced streaming deltas for that same segment. Appending those deltas
duplicated the answer suffix and restored a running badge after completion. The
renderer now treats the canonical segment as final, settles text streams at
terminal state, and preserves exact message/turn/segment identity across
hydration. Covered buffered receipts still advance protocol ordering but cannot
replace canonical hydrated text or repeat queue effects. The new browser
regression failed the old artifact with exactly one initial hydrate; it was not
allowed to hide the defect through an automatic refresh.

A subsequent independent scope audit found two related ownership defects that
ordinary distinct-UUID concurrency did not expose. A topicless Session was
treated as a wildcard for same-base child topics, admitting foreign interaction
notifications and allowing foreign projection cursors to trigger recovery.
Incoming routing now uses exact Core-normalized base/topic scope. Native
`peer/staged` and `peer/closed` are handled explicitly: their topic describes
the child, while their full originating Session ID owns the notification. Valid
split-wire child approvals/questions now send responses using the confirmed
record's complete Session ID, not the raw base ID from the request. Ten focused
regressions failed before these fixes. Two browser regressions also failed on
the earlier artifact: the foreign request poisoned the interaction ledger and
prevented the genuine owner request from appearing. That artifact and its
successful endurance run are superseded; acceptance must rerun the fixed build.

`/gather [all | slug …]` now matches the TUI's synthesis behavior: capture the
originating record, read its scoped blackboard, compose a UTF-8-bounded prompt,
and admit it once through that record's FIFO. Switching to B during the read
does not send the synthesis to B. Empty results send no turn; differing pending
filters are visibly rejected rather than silently coalesced. The peer dialog's
separate **Refresh blackboard** action remains read-only.

Existing-model edits preserve typed inference overrides that the editor does not
expose, including explicit zero and null values. Test and Save use an immutable
snapshot. Unsupported configured fields make the affected row read-only for
editing, not unavailable for model selection. The rc.11 source separately
preserves same-address routing/QoS metadata; conservative browser edit blocking
for out-of-schema fields is a compatibility policy, not a claim that current
Core deletes those fields.

Artifact C acceptance (completed before the subsequent workflow additions):

- Full `pnpm check`: 175 client and 567 Web tests, typecheck, lint, formatting,
  repository policy, license checks, production build and deployment verifier
  passed. Generated contract verification passed separately.
- Frozen browser entry `index-gljxSFrA.js`: 355,427 B initial JavaScript and
  52,313 B CSS. The 350 KiB/80 KiB thresholds are unchanged.
- The separately pinned released rc.9 integration smoke passed against a real
  `octos serve`, with its provider fixture. It is compatibility evidence, not a
  live-provider soak.
- A real rc.11 browser extended-UX run passed 30 RPCs with zero page errors:
  thinking aliases/reset, authenticated image upload and retained draft,
  autonomy/peer reads, native-review confirmation, empty-history inspection,
  real background fork, narrow layout and no auth token in localStorage. It did
  not dispatch a model turn or native review, create autonomous jobs, or mutate
  skills/research configuration.
- The real two-turn stream-order regression also passed against this frozen
  artifact: exact canonical answers, no repeated suffix and no running labels
  after completion. This bounded check is not the capacity soak.
- The fixed-artifact browser suite passed all 55 tests without retries, skips or
  flaky results. Its independent four-round, 12-Session fixture cohort passed
  437 assertions.
- Real capacity passed 56 unique accepted browser turns: 12 ordinary Sessions
  plus three native peers, 15 simultaneous tool gates, one WebSocket and 11
  independently draining pending inputs. All browser starts reached canonical
  completion. The observed effective lanes were K3, GLM-5.3 and DeepSeek V4
  Flash; separately observed native automatic continuations were not counted as
  browser starts.
- Real busy recovery passed four accepted turns and one forced owner-socket
  loss. Core aborted the two active turns; each retained Session reconciled
  canonical history before never-sent queued work resumed. No accepted input was
  replayed, and the selected Session and draft were preserved.
- Real endurance passed 30 paced waves and 116 unique accepted browser turns.
  The wave window was 09:53:33.006–10:08:33.008 UTC on 2026-09-06 (15 minutes);
  total run time was 15 minutes 32 seconds. All browser turns completed, with
  one WebSocket and no recorded page/provider errors. Independent offline
  auditing checked raw full-scope receipts, exact lane attribution and the
  complete native blackboard body/version; all three peer results reached
  version 16. A separate read-only native gather audit also passed.

These runs were on the local Mac, not mini3. Sampled browser heap readings are
diagnostics, not a proof of an upper memory-leak bound.

## Artifact D workflow additions (accepted intermediate checkpoint)

The exhaustive [44-command comparison](tui-command-coverage.md) found additional
browser-applicable functionality. New source implements native ephemeral `/btw`,
thread/turn/remembered-approval inspection, opt-in steering, scoped historical
candidate browsing, per-Session reasoning visibility, full native goal
transitions, agent inspection/control and idle-only agent-spawn admission, plus
maintenance/self-paced/fixed-interval loop creation. These additions do not
constitute a new browser agent loop or scheduler.

The final deterministic gate passes 242 client and 766 Web tests, all required
format/policy/license/lint/type/build/deployment checks, and the unchanged
generated contract check. The first production build exceeded the initial-JS
budget (369,703 B against 358,400 B). Deferring construction of the existing
connection runtime to explicit Connect/restore, and eliminating its empty
side-effect type import, reduced initial JavaScript to 352,694 B. This uses the
same socket/recovery owner, not another connection engine. Six additional tests
cover latest-connect intent, delayed-load cancellation, unmount and error retry.
Independent runtime/steering review passed 48 focused tests.

Frozen entry: `index-BMc1_9DK.js`; HTML SHA-256:
`bfeac85610e3b4781db576f1b28ff0765fcb585f47f6f1a8d0626756ec3ec7c4`. Initial CSS
is 52,313 B; the original 350 KiB/80 KiB budgets are unchanged.

All 66 fixture browser tests passed in 195.6 seconds, with zero retries, flakes
or skips. This includes delayed side-question ownership, exact read-only
inspectors, returned steering input, goal revisions, agent controls, native loop
modes, safe historical candidates, cancellation without focus stealing, resuming
an already busy record without reopening it, and per-Session reasoning
visibility/effort. Artifact resources were identical before and after the suite.
The separate four-round, 12-Session synthetic soak passed all 437 assertions;
the pinned rc.9 Core compatibility smoke also passed. Neither is real-provider
evidence.

The first real native-workflow attempt confirmed idle/background side questions
but failed an invalid harness assumption that the first active turn must already
appear in `thread/graph/get`. Core groups persisted messages, so an in-progress
first tool can legitimately return an empty graph. The corrective run verified
that empty busy snapshot and required the exact persisted thread after
completion. The failed attempt was cleaned up and its exact turn independently
read as `errored`, not active; no goal/loop was created. It is not a passing
run.

Artifact D then passed its own live acceptance, without reusing C's results:

- 72 native-workflow assertions: idle and off-screen busy side answers, native
  thread/turn/remembered-scope reads, same-turn accepted steering,
  fresh-revision goal transitions, exact-owner fixed-interval loop
  creation/control/cleanup, cross-Session isolation and 390 px controls.
  Independent read-only acceptance checked 31 assertions plus five native reads.
  No live agent child or autonomous scheduled firing was claimed from this
  exercise.
- Short capacity: 56 accepted browser turns, ten waves, 15 simultaneous tool
  owners, one browser WebSocket and 11 FIFO prompts; all completed canonically.
- Forced busy WebSocket loss: four accepted turns correctly settled; accepted
  inputs were not replayed, and never-sent A2/A3 resumed in order after scoped
  hydration. Core aborts active socket-owned turns on disconnect; uninterrupted
  work across owner loss is **not** claimed.
- Endurance: 30 paced waves over at least 15 minutes, 116 unique accepted
  browser turns, peak 15 simultaneous owners, one browser WebSocket, zero
  recorded page or provider errors, all canonical completions. Ordinary A/B/C
  and native K3 / GLM-5.3 / DeepSeek V4 Flash waves alternated. Independent
  report validation passed; read-only blackboard verification matched all three
  exact final peer bodies and version 16. Artifact hashes remained unchanged
  throughout.

Private evidence identifiers are `browser-native-workflows-MTPPHQOI_B5117F8B`,
`browser-live-soak-MTPPJQ5G`, `browser-live-recovery-MTPPLKME_6230C4F4` and
`browser-live-soak-MTPPNUJC`. These are local-Mac results, not mini3 runs.

Language, selectable themes and Vim-style composer preferences are separately
identified browser-capable presentation work, not missing Core capabilities.
They are now being implemented under the original full browser-parity request:
English/Chinese UI, five named selectable palettes, the pinned 21-operation Vim
subset and explicit browser-only preference saving. D remains an intermediate
checkpoint: any new source must be built and accepted separately. The command
inventory deliberately makes no blanket parity claim while this work continues.

No root commit, push, deployment or installed-binary replacement has been made.

## Artifact E display/editor completion (final browser/live gates in progress)

The remaining browser-capable presentation features now have implemented routes:
runtime English/Chinese selection, five named palettes, the pinned 21-operation
Vim subset, and explicit browser-only preference saving. One stable provider
changes presentation without remounting the Session runtime. The lazy Chinese
catalog has 911 entries; 784 literal translation keys plus static label maps and
command metadata were audited. Core/model/user content, IDs, paths, protocol
values and runtime diagnostics remain original. See the precise
[command inventory](tui-command-coverage.md); UI equivalents are not claims that
every native inline command form or alias is implemented.

Corrective review added before-paint Session draft reconciliation, UTF-16-safe
caret fencing, IME/modifier/palette priority, and the first-Escape-to-Normal
rule. Local diagnostic formatting loads only when invoked; it captures its
originating record and does not create a second task or connection owner.
Clipboard writes retain the synchronous browser user gesture; both synchronous
and asynchronous failures receive a local receipt. Pending-only queues are not
described as empty.

The first display build was 345 B over the original JavaScript cap. Moving
command-only report formatting off the startup path kept the cap unchanged. A
production inspection also caught an unused side-effect CSS Module being
eliminated; the palette definitions now live in the required shared `theme.css`
and are verified in emitted CSS and actual browser computed colors. A narrow
preference trigger avoids squeezing the Workspace title to a few pixels.

The E-checkpoint `pnpm check` passed all 242 client and 955 Web tests (1,197
total), format/policy/licenses/lint/types/build/deployment checks; generated
contract verification also passed with the unchanged pin. An independent Astra
source review reran 232 focused tests and found no new blocking issue in this
delta.

Historical E entry: `index-DDbJJS7h.js`; HTML SHA-256:
`a8a3e3aeca2a5f83eb0ddb3bcfbe37fef6704c4bd6947ac8e7b50a515e0c48be`. Initial
resources are 358,099 B JavaScript and 56,968 B CSS, below the original 358,400
B / 81,920 B caps. The full 73-case browser suite and real-provider
workflow/capacity/recovery/endurance gates are being rerun on this exact build.
Earlier C/D or preliminary E results do not substitute for those final gates.

## Current checkpoint (native2221 static source; no browser or soak acceptance)

This is the authoritative current static checkpoint; the C/D/E numbers above
stay as an audit trail.

Native2221 ran the deterministic gate on the frozen Web source plus the one
already-existing 2150 multi-session E2E spec. `pnpm check` reached true exit 0
with all eight substeps passing — 1,528 unit/component tests (530 client + 998
apps/web) plus format, policy, licenses, lint, typecheck, test, build and
deploy:verify. Initial resources are 355,899 B JavaScript and 56,968 B CSS
against the unchanged 358,400 B / 81,920 B caps.

The 452-entry source manifest (447 file hashes + 5 `DELETED` markers) adds the
previously omitted existing multi-session spec relative to the 451-entry 2130
baseline: that is coverage expansion of an existing file, not new code. Its
`playwright test --list` discovered three multi-session cases; listing is source
discovery and proves no browser execution. The full fixture inventory (76 cases
across `e2e/*.spec.ts`) is a source count, not 76 executed current tests.

Generated-contract verification (`pnpm contract:verify`) and pinned-Core
integration (`pnpm integration:core`) are separate gates and are not part of
`pnpm check`; both remain missing for the current artifact.

Candidate B readiness is false: the rc11 A+ native host is a bootstrap, not
candidate B. Full real-browser acceptance — 12 Sessions plus 3 native peers on
one transport, approvals and questions, switch/reconnect, and
real-provider/endurance — remains PENDING for the current artifact. Historical
native authorship is preserved; old Codex changes are not re-attributed to
peers.
