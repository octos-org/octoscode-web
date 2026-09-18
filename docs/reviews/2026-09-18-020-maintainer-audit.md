# 0.20 maintainer acceptance — 2026-09-18

Status: candidate integration in progress; not a release or deployment claim.
This report supersedes the historical acceptance checkpoints in
[feature parity](../feature-parity.md). The product scope is an individual or
trusted team using its own Core. The
[readiness ledger](../release-readiness-020.md) owns the final decision;
[issue review](../020-issue-review.md) separates optional work from defects and
upstream limitations.

## Correctness and security

| Observed defect                                                                                                 | Reviewed correction                                                                                                                                                                 | Evidence                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pairing persisted a bearer token, could connect after Cancel, and could reuse another identity's restore hints. | #130 removes durable token storage, clears legacy entries, cancels the claim and resets identity-scoped hints. Early referrer policy and link scrubbing also protect pairing codes. | Seven existing pairing browser journeys, delayed replies, storage inspection and exact-head CI.                                                                                               |
| Stop overwrote a newer draft.                                                                                   | #130 preserves the current edit and retains the interrupted input for its owning record.                                                                                            | Actual Core reproduction before/after, plus existing browser and ownership cases.                                                                                                             |
| A generic definitive start rejection discarded the input.                                                       | #137 restores the complete rejected turn through the existing owning-record recovery path.                                                                                          | Existing delayed-rejection browser case failed before and passed after; B's newer draft survives A's rejection. Ambiguous timeout is separately retained.                                     |
| Collision recovery could re-adopt an already terminal foreign turn and lose media/reasoning metadata.           | #112 reconciles terminal-before-reply ordering and preserves the full refused input.                                                                                                | Existing controller coverage and actual isolated rc.11 collision: a second client holds the Session, then the browser's exact queued UUID completes after the holder interrupts its own turn. |
| Handback captured obsolete state and Resume consumed the draft too early.                                       | #130/#112 resolve the actual record, recheck authority after waits, and consume only the clicked draft version.                                                                     | Both formerly skipped browser journeys now run, checking forbidden sends, exact ownership and acquire/release/start order. Driver APIs remain fixture-only evidence.                          |
| Closing a tab lost supposedly durable drafts.                                                                   | #134 uses credential-free per-Session entries scoped to endpoint and the principal confirmed by `/api/auth/me`.                                                                     | Close/new-tab/reauthenticate against actual Core, offline Forget, browser identity/storage-failure cases, full CI. No transcript or automatic resend is introduced.                           |
| Unknown recovery could leave the composer blocked indefinitely.                                                 | #133 offers explicit Continue, releasing only the local wait without claiming a terminal or resending.                                                                              | Existing controller and browser cases preserve FIFO, a new draft, exact Session identity and an unknown-outcome notice; no interrupt or fabricated stopped receipt.                           |
| Server shutdown lacked a usable gated control.                                                                  | #129 exposes the advertised stop method with confirmation and a disconnected result.                                                                                                | Dedicated fixture browser path and typed method checks. The shared live server was not stopped to prove this UI.                                                                              |

## Experience and accessibility

- #125 improves code/table space, keeps prose near 65–75 characters, retains 16
  px phone inputs and gives operational state readable space. Existing DSH
  tokens and restrained interaction feedback remain the visual baseline.
- #130 bounds the command list, reveals keyboard selection, and restores native
  textbox semantics. The original list was 1,694 px tall with its top at −853 px
  in a 1,440 × 1,000 viewport. The known axe exception was removed.
- Fleet now displays a useful empty state before Session creation and explains
  missing capabilities without misdiagnosing them as a missing model.
  Unsupported controls cannot dispatch a pretend operation.
- Connection preferences belong inside the connection card. Linux and macOS
  screenshots were inspected independently after the intentional change.
- #132 keeps primary Settings and Session settings available with the app. Model
  management loads within its stable dialog boundary, preserving Close and
  return focus even when that chunk fails. All eight final CI jobs passed.
- #53 restores each Session's reading anchor, expanded history window and
  follow-bottom state. Its existing 360-message browser case now verifies
  independent A/B positions, background output and identity cleanup. Desktop and
  390 px drawer navigation preserve the visible paragraph; deferred content
  layout is compensated once through the existing ResizeObserver.

Desktop 1,440 px and phone 390 px long-history views had no axe violations or
root horizontal overflow. Code and tables keep local horizontal scrolling.
Keyboard/focus and reduced-motion browser checks supplement this evidence; these
are not real VoiceOver/NVDA or physical-device results.

## Performance measurements and limits

Measurements use production builds in Chromium on Linux without CPU/network
throttling. They are local interaction measurements, not field INP.

- On #132's measured build, click-to-ready content dropped from 304/302 ms to
  5.3/3.8 ms for Settings/Session settings. The old Settings loading shell
  already appeared in about 4 ms; the improvement makes its controls available
  immediately. The initial connection payload remained about 228 KB of
  JavaScript. Playwright polling time was not reported as application latency.
- Against isolated rc.11, three completed Sessions retained distinct drafts and
  stable sidebar order through 18 selections, with no additional `session/open`
  request and no page error. The 66–83 ms figures include Playwright and two
  animation frames; they are not a direct rendering metric.
- A separate #112-build probe used a 360-entry Session and two other completed
  ordinary Sessions. Of thirty selections, thirteen returned to the long
  Session: correct enabled input appeared in 16.0 ms median/17.8 ms maximum;
  next animation frame was 30.7/35 ms. No switching long task or long animation
  frame exceeded 50 ms. Each Session opened/hydrated once. **That build
  remounted only 40 entries when returning**, exposing #53. These numbers do not
  establish the cost of restoring all 360 visible entries.

After #53, thirteen returns to the fully expanded 360-entry Session preserved
the same paragraph with 0 px anchor error. Click-to-selection, correct editable
draft and restored anchor measured 65.2 ms median/82.5 ms maximum. There were 13
long animation frames, maximum 88.9 ms, and 13 long tasks, maximum 83 ms;
React/Markdown remounting dominated the cost. Restoring all 360 entries costs
more than discarding the window. The separate ordinary-streaming gate still
recorded zero long frames; its 200 ms threshold does not excuse switching cost.
Four phone drawer round-trips also preserved the paragraph and 360-entry window.

Final integrated navigation remains required. JavaScript/CSS deployment budgets
have not been raised.

## Verification discipline and delivery

The review removes 26 redundant source-wiring/static-rendering test files from
the parity intake, retaining behavioral algorithms and browser coverage. A
further five newly proposed static recovery assertions were removed during #133
review. Necessary protocol/identity/race assertions remain; existing browser
cases were extended where they exposed an actual failure. No test-count or
coverage-percentage target is used.

Exact-head CI passed before merging #112, #125, #129, #130, #132, #133, #134 and
#137 into the candidate. The final combined source still requires its own
acceptance. CI now cancels obsolete runs of the same PR while keeping
main/manual runs independent.

The local auto-deployer previously activated main `9df5417` while the served
manifest reported `dev` / `unknown`. Its build container now receives the
existing revision/release variables. The next deployment must verify the
manifest and served assets; an immutable directory name alone is insufficient
evidence.

## Upstream and product boundaries

- Actual rc.11 `d7612a31` still aborts socket-owned work on disconnect. During
  an accepted tool turn, refresh restored the closure terminal but not the
  user's accepted message. Read-only hydrate/messages-page/canonical probes
  confirmed the message was absent from Core persistence; the Core log discarded
  the uncommitted row. This is recorded in
  [web #78](https://github.com/octos-org/octoscode-web/issues/78) and
  [Core #2167](https://github.com/octos-org/octos/issues/2167). No browser
  shadow transcript is substituted for missing canonical history.
- rc.11 evidence comes from an isolated instance. The shared local service is
  still rc.9. Actual durable-draft checks used its `admin` principal; multiple
  principals, token rotation and delayed identity replies are fixture evidence.
  Offline Forget uses the principal previously verified in that tab, not an
  anonymous new tab's authority to remove other users' drafts.
- Fresh-browser Session discovery awaits authoritative workspace/profile
  ownership from [Core #2146](https://github.com/octos-org/octos/issues/2146).
  Remembered tab navigation is not a complete server catalog.
- The tested rc.9/rc.11 servers do not advertise the candidate's external-driver
  contract. The corresponding UI remains capability-gated. Fixture passes do not
  establish live driver compatibility or detached execution.
- #138/Core #2409's proposed `unknown` + `running:false` recovery remains
  pending. Review reproduced a Core sampling race that returns false while the
  exact turn is active; the
  [upstream finding](https://github.com/octos-org/octos/pull/2409#issuecomment-5737184687)
  blocks automatic release based on this evidence. Manual #133 remains
  available. Absence of running work also cannot prove interrupted/completed
  outcome.
- This round's real-Core checks use a deterministic provider for ownership and
  navigation. Historical real-provider endurance results are not attributed to
  the current artifact.

Sanitized local probes, logs and screenshots are under `/tmp/octos-020/` during
this maintenance session. CI/PR links and the conclusions above are the durable
record; the temporary directory is not a published release artifact.
