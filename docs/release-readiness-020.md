# 0.20 readiness ledger

[Program #124](https://github.com/octos-org/octoscode-web/issues/124) started
2026-09-18 after the owner transferred ongoing execution to the maintainer.
Scope: individuals and trusted teams using their own Core. The goal is a useful,
correct and maintainable release, not a prescribed number of PRs, features or
tests. Execution follows the [maintenance workflow](maintenance-workflow.md).

## Current baseline

- Released version: `v0.11.0` (2026-10-18, promoted from `v0.11.0-rc.3`).
- Release candidate: `v0.20.0` (main `8241a61` plus the release PR only).
- Core runtime and UI Protocol contract pins: Octos `v2.0.3` (`fca32c4`);
  verified against real `octos serve` and the GLM live gate (see
  [core-runtime.json](../packages/client/core-runtime.json)).
- Deployed service tracks main; deployed build revision `577e3f6` matches main
  and its build manifest records the `v2.0.3` baseline.
- Program issue: [#124](https://github.com/octos-org/octoscode-web/issues/124).

## Acceptance outcomes

| Area                       | Required evidence before readiness                                                                                                                     | Intake state                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Core functionality         | Current capability-to-surface mapping; supported actions work, absent capabilities are hidden or explained; TUI semantics preserved                    | Review #105 / #112                                      |
| Connection and identity    | Connect, pairing, cancellation, disconnect, forget and identity changes preserve scope; no durable bearer-token storage or token-bearing artifacts     | #114 and pairing fixes required                         |
| Conversation ownership     | Send, queue, stop, approvals, external-client activity and session changes affect the correct turn; drafts and attachments survive legitimate recovery | Stop draft loss reproduced; handover gaps found         |
| Recovery                   | Completed history survives refresh; unknown turn status is truthful; reconnect does not duplicate accepted work or lose queued work                    | Revalidate against retained-record design               |
| Navigation and performance | Prompt response to session/model/settings actions; latest selection wins; representative long history and multiple completed sessions remain usable    | Recheck on candidate, including Core/RPC time           |
| Accessibility              | Keyboard-only primary flows, visible focus, modal isolation, return focus, readable themes, phone fit and reduced motion; axe plus manual checks       | Browser audit in progress                               |
| Visual and UX quality      | Coherent DSH tokens, readable transcript, clear state hierarchy, actionable errors and cancellation; screenshots inspected                             | Candidate connect preferences button lacks layout/style |
| Verification               | Useful boundary/race tests and real browser flows; no skipped critical shipping journeys, redundant source-string gate or unsupported live claim       | Two handover cases and redundant tests need work        |
| Delivery                   | Exact-head CI, matching deployed artifact, post-deploy behavior checks, current docs and honest limitations                                            | Pending integration                                     |

## Confirmed work at intake

1. #105 pairing defaults to persistent bearer storage despite the repository
   credential rule; tracked in
   [#114](https://github.com/octos-org/octoscode-web/issues/114).
2. Canceling a pending pairing request does not prevent a late reply from
   connecting. Pairing can also retain an earlier identity's Session restore
   hints. These are reproduced with synthetic credentials in a real browser;
   they must be corrected before integration.
3. Stopping a reply overwrites a newer unsent draft with the interrupted prompt.
   Reproduced on the candidate production build against the real local Core;
   tracked in [#123](https://github.com/octos-org/octoscode-web/issues/123).
4. The control-seat handback callback captures initial render state, and Resume
   chat reads an already-consumed draft slot. The existing skipped browser
   scenarios need truthful fixture setup and observable assertions.
5. #112's collision recovery can re-adopt a turn whose terminal event already
   arrived and can drop attachment metadata. These are implementation review
   findings to address during its integration.
6. Main's #122 draft persistence must survive the candidate's new shell and
   retained Session-record architecture.
7. Remove the first identified batch of duplicate wiring/SSR tests only while
   retaining the corresponding algorithm and active browser coverage. Do not
   replace them with another redundant test layer.

The first audit's local evidence is under `/tmp/octos-020/`, including inspected
production/candidate screenshots and the real-Core Stop draft reproduction. This
ledger records intake, not completed fixes; subsequent PRs must update the
outcome and evidence as each item is resolved.

## Candidate progress — 2026-09-18

The tables above preserve intake findings. They are not the current unresolved
bug list. [PR #130](https://github.com/octos-org/octoscode-web/pull/130) merged
into the parity branch after eight passing CI jobs, 27 combined browser cases,
real-Core Stop verification, and separately generated Linux/macOS screenshots.
It fixes the pairing identity/security paths, Stop draft loss, command list
geometry/ARIA, handback recovery and Fleet capability presentation, and removes
20 redundant test files. Issues close only after integration into main.

PR #125's reviewed visual changes are also in the parity branch. Further
integration covers #112 collision/media recovery, the corrected principal-scoped
durable drafts, #129 capability-gated server shutdown, and #132 first-click
settings latency. The audited common settings implementation reduces actual
click-to-dialog latency from about 300 ms to 4–5 ms without changing budgets.

On isolated rc.11, three completed sessions survived 18 reselections without
reopening, reordering or mixing drafts. Long-history and final deployed-artifact
acceptance are still required. Refresh now restores the explicit connection
closure terminal; missing accepted input is being traced at the Core persistence
boundary. The shared local service remains rc.9 and is not evidence that the
rc.11 integration has been deployed.

The [issue outcome review](020-issue-review.md) separates stale implementation
proposals, optional UX improvements and real upstream limits. This candidate
progress is not a 0.20 release declaration.

## Reconciliation — 2026-10-18

The intake tables above are preserved as history. Every intake item has since
been resolved and shipped through `v0.11.0`; the evidence below is current as of
main `577e3f6` against real Octos `v2.0.3`.

Intake "confirmed work" outcomes:

1. Pairing bearer storage (#114): fixed via
   [#130](https://github.com/octos-org/octoscode-web/pull/130); issue closed.
2. Pairing late-reply and identity-hint retention: fixed in #130.
3. Stop draft loss (#123): fixed in #130 with real-Core verification; issue
   closed.
4. Control-seat handback and consumed draft slot: fixed in #130; the formerly
   skipped browser scenarios now run — `e2e/` contains zero `test.skip`/
   `test.fixme`.
5. #112 collision re-adoption and attachment metadata: addressed in #112/#130;
   covered by `e2e/peer-control.spec.ts` and the canonical recovery suite.
6. #122 draft persistence in the shipped shell: shipped; drafts survive refresh
   and are covered by unit and browser tests.
7. Redundant test removal: #130 removed 20 redundant test files; the suite has
   no source-string gates.

Acceptance-row evidence status:

- Core functionality, connection/identity, conversation ownership, verification,
  delivery: enforced every push by the eight required CI checks (contract,
  check, 4 e2e shards, cross-browser, real-Core integration); 672 client unit
  tests; capability gating keeps unsupported controls hidden.
- Recovery: completed-turn history survives refresh — live-verified against real
  `octos serve` v2.0.3 by the GLM gate (real-model turn with tools, reload, full
  restore, background-turn survival). Known upstream limitation: an interrupted
  **in-flight** turn's rows are dropped by Core's context ledger before the
  client can reconnect
  ([octos#2831](https://github.com/octos-org/octos/issues/2831), tracked as
  [#78](https://github.com/octos-org/octoscode-web/issues/78)); the client's
  degraded rendering (Turn stopped notice, prompt kept as local draft) is the
  designed behavior, not a web defect.
- Navigation and performance: JS/CSS/CLS/LoAF budgets gate CI; settings
  first-click latency fixed (#132). The long-history multi-session acceptance
  was rerun against real `octos serve` v2.0.3 on 2026-10-18
  (`e2e-live/long-history-reselect.spec.ts`): three sessions with real-model
  turns survived 18 reselection cycles and per-session reloads with no
  reordering, no cross-session marker mixing, and correct selected-session
  restore.
- Accessibility: WCAG and axe gates run in CI across Chromium/Firefox/WebKit.

Completion-rule assessment: no known web-side reproducible P0/P1 remains in the
shipping scope; the one open P1 (#78) is blocked upstream (octos#2831) and
documented as an upstream limitation. Remaining before a 0.20 declaration:
absorb whatever octos#2831 changes on the Core side. The takeover lock flow
gained full browser coverage on 2026-10-19 (`e2e/tab-lock.spec.ts`: second-tab
banner, dispatch gate, take-over steal and loss notification, both directions).

Synthetic regression tooling stays green (`scripts/soak-fixture-e2e.mjs`, 181
assertions), which remains fixture-contract evidence only.

## Release verification — 2026-10-29

The 0.20 candidate is main `8241a61` plus the release PR; next-version feature
PRs are excluded. The readiness rows are closed as follows:

- Core functionality, identity, conversation ownership, recovery, accessibility,
  performance and delivery are enforced by the exact-head required CI matrix,
  real-Core integration and deployment verification.
- The real-model live gate and long-history reselection acceptance remain green
  on the pinned Core. Browser coverage includes keyboard, mobile, dark mode,
  approval, settings and multi-Session recovery, with zero skipped critical
  journeys.
- Post-stop interrupted-prompt durability was verified twice against
  `octos-main-ce2c99bc`: stop the turn, refresh, and the user prompt remains in
  the timeline. The live-refresh variant intentionally remains `test.fixme`
  pending [octos#2881](https://github.com/octos-org/octos/issues/2881); #78
  stays open for that remaining disconnect-path defect and is not counted as
  shipped.
- Manifest versions and changelog are `0.20.0`. The release is published only
  after the release PR's required checks pass and its merge commit is tagged.

## Completion rule

No known reproducible P0/P1 bug or unresolved credential/identity boundary may
remain in the shipping scope. No primary action may depend on an unavailable
Core capability without a clear gate. All advertised shipping flows must have
appropriate verified evidence and no skipped critical browser gate. Required
checks and deployment verification must pass for the final revision.

Upstream-only limitations and optional enhancements can remain documented.
Issues proposing a particular technology (compiler, animation API, storage
engine or test framework) are evaluated by their user outcome and current
relevance; their existence does not make that technology a release requirement.
