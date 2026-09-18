# Testing and verification

Use the smallest gate that proves the change while developing, then run the
complete gate before review. A fixture pass is not live Core or model evidence.

| Gate                  | Command                                         | Proves                                                                             |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| Unit                  | `pnpm test`                                     | parsers, reducers, ownership state machines, and components                        |
| Types and lint        | `pnpm typecheck && pnpm lint`                   | package boundaries and exhaustive cases                                            |
| Repository policy     | `pnpm policy:verify`                            | UI tokens, style ownership, and ADR metadata                                       |
| Product browser       | `pnpm test:e2e`                                 | production browser behavior against the deterministic fixture                      |
| Cross-browser smoke   | `pnpm test:e2e:cross-browser`                   | Firefox/WebKit connect, send, durable history, drafts, theme and keyboard Settings |
| Fixture soak          | `node scripts/soak-fixture-e2e.mjs`             | synthetic multiplexed protocol and durable fixture contract                        |
| Live model (opt-in)   | `pnpm test:e2e:live`                            | real Core, runtime model, tools, turns, and tab restore                            |
| Generated contract    | `pnpm contract:verify`                          | Core vocabulary matches the immutable source pin                                   |
| Released Core runtime | `OCTOS_BINARY=/abs/octos pnpm integration:core` | a matching released Core completes the critical flow                               |
| Deployment            | `pnpm build && pnpm deploy:verify`              | artifact, CSP, nginx contract, and size budgets                                    |
| Complete local gate   | `pnpm check`                                    | all deterministic non-browser gates                                                |

Install Chromium once with `pnpm exec playwright install chromium`. The browser
gate defaults to bundled Chromium; opt into an installed release channel with
`OCTOSCODE_E2E_CHANNEL=chrome` or `msedge`.

Product tests build and serve a fixed production artifact through Vite preview,
not HMR. Set `OCTOSCODE_E2E_SKIP_BUILD=1` only after building the intended
`apps/web/dist` artifact. The gate owns both fixture and preview ports and
refuses to reuse an existing server. Override occupied ports with
`OCTOSCODE_E2E_FIXTURE_PORT` and `OCTOSCODE_E2E_WEB_PORT`; the fixture origin is
injected during the build. A prebuilt artifact must match the desired connection
defaults, although tests explicitly enter their fixture origin.

Install Firefox and WebKit with `pnpm exec playwright install firefox webkit`
for the small continuous smoke lane. Its separate config keeps Chromium-only
visual baselines and the Long Animation Frames gate in the main suite. The
default fixture hydrates a fixed durable transcript; smoke verifies that known
history and unsent drafts reopen. It does not prove that every newly generated
fixture response was persisted. Scenario-specific recovery tests and the real
Core gate supply that evidence. Keyboard and accessibility assertions do not
claim real VoiceOver, NVDA or physical-mobile coverage.

## Multi-Session browser gate

The fixture tracks exact Session/Profile/Workspace bindings, opened socket
membership, active turn owners, persisted messages, turns, and pending
interactions. One pooled socket may own many Sessions. A wrong profile,
workspace binding, unknown socket membership, concurrent start on one Session,
or invalid/reused turn UUID must fail admission.

The browser suites prove:

1. Confirmed Sessions survive sibling creation and refresh. Selecting a healthy
   retained record changes focus immediately without another open or hydrate.
2. A/B/C turns and timelines remain independent through rapid selection. Unsent
   per-record FIFO work drains in order even while another record is selected;
   refocusing never replays an admitted turn.
3. A held start acknowledgement does not block New Session or retained-record
   selection. Starting is not acceptance: Stop is absent and `/stop` sends no
   interrupt. Rejecting A's start leaves B selected and reports the error only
   when A is selected. A failed B candidate leaves A's source record intact.
4. With A1 accepted server-side but its reply held, A2/A3 queued, and B
   selected, loss interrupts A1. Reopen/hydrate reconciles A before ready admits
   A2; A3 starts only after A2's terminal. A1 is never sent again.
5. Approval/question payloads remain owned by their exact Session and request
   IDs. B cannot display A's request; returning to A restores it, and a response
   resolves exactly that request and produces only A's terminal.
6. Twelve browser turns plus three native peers are simultaneously active. The
   test uses the browser's `/peer` command and `peer/prepare`, then observes
   three exact `profile:local:tui#peer-slug` opens and three UUID-backed kickoff
   prompts on the same socket. Duplicate staged delivery produces no duplicate
   opens/starts. No HTTP control fabricates active peers. Closing a selected
   peer retains its read-only transcript and focus; a later disconnect recovers
   the other records without reopening that closed peer.
7. Unknown commands fail closed; `/sessions` and Activity open their actual
   product surfaces without starting a prompt or stealing Session ownership.
8. Fork, rewind, and workspace undo keep their confirmation receipts while the
   owning Session's canonical refresh is explicitly held. Fork opens and
   hydrates the exact child in the background; rewind restores the selected
   checkpoint's prompt draft; workspace undo leaves the conversation intact.
   Each mutation is sent once to its exact owner.
9. A captured native stream order—partial deltas, a full persisted segment, more
   deltas for that same segment, then terminal—keeps canonical text exact and
   settled. The next queued turn remains independent while B is selected.
   Contiguous fixture counters and an unchanged source-hydrate count prevent
   recovery from masking a live rendering failure.
10. `/gather` captures its source record, reads a filtered native blackboard,
    and queues one bounded TUI-shaped synthesis there even if B becomes selected
    while the reply is held. Duplicate invocations share one read; an empty
    result sends no model input. The panel's “Refresh blackboard” stays
    read-only.
11. A topicless Session rejects foreign-topic approvals and questions even when
    their base Session, turn, and request IDs exactly match its own. Foreign
    approval decisions and canonical terminals cannot settle the owner; a
    foreign cursor cannot trigger another hydrate or leak output. The genuine
    owner remains answerable exactly once, and its never-sent queued turn then
    drains on the same Session with a new UUID. Native peer lifecycle events
    retain their distinct originating-Session routing semantics.

The fixture's explicit acknowledgement and terminal barriers avoid using short
delays as proof of admission or concurrency. Controls include
`/__test__/turn-start/{hold-next,state,admit,release,reject,reset}`,
`/__test__/terminal/{hold-next,state,release,reset}`,
`/__test__/session-open/{reject-next,reset}`, `/__test__/disconnect`, and
`/__test__/replay-lossy`. Controls are fixture-only and are not product RPCs.

History tests use `/__test__/history/{hold-refresh,state,release,reset}` to
pause only the post-mutation canonical hydrate, not the initial history read.
The fixture's native-shaped history results model protocol state only; its
snapshot restore does not modify real workspace files.

Gather ownership tests use `/__test__/gather/{hold-next,state,release,reset}` to
hold an exact Session's native reply without staging synthetic active peers.

Topic ownership tests use `/__test__/scope/inject` only for an active synthetic
topicless approval or question probe. It sends conflicting wire frames without
changing the owner's canonical log, followed by a valid-owner warning receipt.
The later valid interaction and FIFO completion prove the owner remains usable;
no timing delay substitutes for a protocol receipt.

Socket loss records interrupted `connection_closed` terminals for every turn
owned by the lost transport and suppresses their pending success callbacks. It
must not fabricate uninterrupted completion.

## Canonical fixture hydration and synthetic soak

Browser and native-peer Sessions persist user/assistant messages and completed
turn outcomes. `session/open` replays canonical envelopes after the supplied
cursor. `session/hydrate` returns the full persisted `messages`, `turns`, and
exact pending interactions; tool envelopes are separate. It does not replay
ordinary user/assistant text as a second hydrate transcript. Messages carry
stable IDs and thread IDs matching their turns, as Core does.

A Session with no turns hydrates empty. Demo Sessions retain their static demo
transcript. `session/delete` drops the Session's stored state. The replay log is
bounded to the latest 500 events per Session. Context state uses the native
estimate fields, not billing usage presented as model-window occupancy.

Run the synthetic runner directly:

```sh
node scripts/soak-fixture-e2e.mjs --rounds 4 --sessions 4 --port 62111
```

It launches its own loopback fixture and checks shared-socket concurrent
admission, independent active hydrate, exact transcript/replay identity,
per-thread sequences, cross-scope rejection, observer isolation, reconnect
cursors, deletion, all-owner interruption, and exact interaction resolution. It
neither launches a browser nor proves the native browser peer host or live Core
behavior. Its printed assertion count describes only that synthetic run.

## Opt-in live model gate

The live gate consumes a real provider and mutates the explicitly supplied
server workspace. It creates a fresh opaque Web Session, requires the effective
runtime model to match `OCTOSCODE_LIVE_EXPECTED_MODEL` (default
`glm-5.3-flash`), performs a bounded file edit/read turn, and reloads to prove
same-tab restore and durable hydrate. It also checks a background turn while a
sibling Session is selected. It does not change or infer the Profile default.

Configure the Profile through Core and restart Octos when required before
running. Supply the server, trusted origin, token, and workspace explicitly:

```sh
OCTOSCODE_LIVE_PROXY_TARGET=http://127.0.0.1:18031 \
OCTOSCODE_LIVE_PROXY_ORIGIN=https://octoscode-web.example \
OCTOSCODE_LIVE_TOKEN='<ephemeral server token>' \
OCTOSCODE_LIVE_WORKSPACE=/absolute/path/on/server \
OCTOSCODE_LIVE_EXPECTED_MODEL=glm-5.3-flash \
pnpm test:e2e:live
```

The gate disables traces, screenshots, video, and failure-page accessibility
snapshots so a tab-scoped token cannot enter test artifacts. Do not put tokens
in proxy variables, shell history, or committed configuration.

The live gate builds `apps/web/dist` and serves it through Vite preview.
`OCTOSCODE_DEV_PROXY_TARGET` and `OCTOSCODE_DEV_PROXY_ORIGIN` configure only the
local preview proxy, not a deployed static host. The origin must be trusted by
Core; an untrusted origin is expected to fail its handshake.

Model settings need deterministic capability-gated read/edit, exact-draft
Test/Save, discovery/manual fallback, delete, Profile-default, and secret
non-retention tests. These use a fake provider; only the opt-in live gate may
spend a real credential.

## Flake triage

Do not weaken an invariant because it failed once. Re-run the smallest test on a
fixed artifact, inspect `test-results/` and `playwright-report/`, and
distinguish product ownership from incidental markup. Prefer role/text
assertions to syntax-highlighter span boundaries. CI retains Playwright failure
artifacts for seven days.
