# 0.20 readiness ledger

[Program #124](https://github.com/octos-org/octoscode-web/issues/124) started
2026-09-18 after the owner transferred ongoing execution to the maintainer.
Scope: individuals and trusted teams using their own Core. The goal is a useful,
correct and maintainable release, not a prescribed number of PRs, features or
tests. Execution follows the [maintenance workflow](maintenance-workflow.md).

## Current baseline

- Released version: `v0.10.0`.
- Deployed and main revision at intake: `c79d85b7` (#122, cross-tab-close
  drafts).
- Parity candidate: [#105](https://github.com/octos-org/octoscode-web/pull/105),
  intake head `c5839d09`; collision follow-up:
  [#112](https://github.com/octos-org/octoscode-web/pull/112), `6061b773`.
- Both candidate CI runs pass, but #105 skips two chat-handover cases. That
  evidence does not establish complete parity or release readiness.
- The local Core source includes typed turn-collision disclosure, but does not
  advertise the candidate's `session/driver/*` contract. Peer control-seat
  acceptance must distinguish fixture behavior from the supported live server.

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
