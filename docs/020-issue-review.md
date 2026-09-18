# Issue review for 0.20 — 2026-09-18

An open issue is a report or proposal to evaluate, not an automatic release
requirement. This review compares its user outcome with the current candidate,
existing browser coverage and supported Core contracts. It does not claim that
the candidate is already deployed or that every proposed feature shipped.

The audited parity baseline is
[PR #130](https://github.com/octos-org/octoscode-web/pull/130), merged at
`20ef2f2`. All eight CI jobs passed on its submitted head. The shared local Core
runs rc.9; a separately built rc.11 (`d7612a31`) is used for isolated
collision/recovery checks. Source availability is not deployment evidence.

## User outcomes to retain

| Issue | Current outcome and remaining scope                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1    | Method/feature vocabulary is generated; complete payload schemas still depend on Core #1835. Keep the narrow validated boundaries until an authoritative replacement exists.                                                         |
| #3    | Activity lists tasks from known sessions. A complete bounded cross-session snapshot depends on Core #2122; Fleet is not that snapshot.                                                                                               |
| #21   | Slash completion, session-tree navigation and Alt shortcuts work. A global action search remains an optional enhancement; slash completion is not a global Command-K palette.                                                        |
| #53   | Retained records preserve execution state. Returning to a session still jumps to the latest message; preserve reading position as a concrete UX outcome without prescribing React Activity or ViewTransition.                        |
| #56   | Same-tab retained sessions work. Cross-tab watch/takeover needs its own evidence and Core authority; Web Locks alone cannot authorize a turn. #112 covers shared-server collision handling, not every proposed takeover interaction. |
| #57   | Jump to latest works. Full conversation search is unimplemented; unused progress CSS is not a delivered feature. Track search by its reading outcome, not by a specific highlighting API.                                            |
| #62   | Sidebar status and attention handle known sessions; Fleet manages peers. A separate global triage page is optional and must not duplicate the existing state owner.                                                                  |
| #78   | Revalidated on isolated rc.11: refresh interrupts the connection-owned turn and the UI restores its explicit terminal error. The accepted user message still disappears; investigate persistence separately before closing.          |
| #83   | A fresh browser cannot discover a complete authorized server session catalog. Deep links and same-tab records help recovery but do not replace Core #2146.                                                                           |

## Completed scopes and declined implementation prescriptions

| Issue | Maintainer decision                                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #22   | README already has light/dark screenshots. A public hosted playground is outside this self-hosted release scope.                                                                   |
| #23   | Visual baselines, keyboard/focus journeys and Firefox/WebKit smoke are present. Real assistive-technology speech output has not been verified; do not claim it from axe or WebKit. |
| #54   | Keep the modal implementation while its nested approval/review focus behavior passes. Replacing it with platform elements is not an independent release requirement.               |
| #55   | Decoder property tests exist. Add generated state-machine sequences only for a concrete coverage gap, not to expand test counts.                                                   |
| #58   | Split responsibilities when coupling causes an actual maintenance problem. An arbitrary file-length gate would encourage more indirection and is not a delivery criterion.         |
| #63   | Judge rendering by measurements. React Compiler adoption is not required; first-click settings latency was fixed directly in #132.                                                 |
| #65   | Do not add Stryker or a mutation-score threshold without an identified benefit. Improve assertions that missed a real defect.                                                      |
| #67   | Do not bundle a VoiceOver CI project with autonomous test-healing tools. Keep the actual AT verification limit explicit; fix concrete accessibility failures when found.           |
| #69   | The maintenance workflow owns issue freshness. A CI keyword heuristic cannot establish that a user outcome was delivered.                                                          |

Closing a proposal as not planned does not mean its implementation shipped.
Remaining UX enhancements belong in the backlog with observable acceptance
criteria. Reproducible correctness, credential, authority or primary-navigation
failures retain priority regardless of their issue age.

## Browser findings from this review

- Three completed sessions on isolated rc.11 switched 18 times in 66–83 ms
  including automation and two animation frames. No `session/open` was sent on
  reselection, sidebar order stayed stable, and each draft stayed with its
  session. This small-session result is not a long-history performance claim.
- DOM instrumentation measured the first Settings/Session settings dialogs at
  304/302 ms despite module downloads taking 1–5 ms. #132 loads these common
  panels with the authenticated app: the same measurement became 5.3/3.8 ms,
  with 253 additional bytes in the initial connection bundle. No preload helper
  or new unit-test layer was added.
- #130 removes 20 redundant source-string/static-render test files while
  retaining protocol, algorithm, identity and browser coverage. Its two formerly
  skipped handback journeys are active. Fixture evidence remains distinct from a
  Core capability that the local server does not advertise.

Release decisions continue to follow the
[readiness ledger](release-readiness-020.md).
