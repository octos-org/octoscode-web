# 0.20 integration audit — 2026-09-18

This is a review of the v0.10 parity candidate, not a declaration that 0.20 has
shipped. The intake heads were main `c79d85b7`, #105 `c5839d09`, and #112
`6061b773`. The product scope remains individuals and trusted teams using their
own Core. Findings come from source review, protocol probes, production builds,
real browser interactions and inspected screenshots.

## Bugs addressed in the candidate

| Finding                                                                                             | Change                                                                                                                         | Evidence and limits                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| #114: pairing saved bearer tokens in localStorage                                                   | Remove device token persistence and its checkbox; delete legacy entries                                                        | Existing connection tests and seven pairing browser journeys; storage inspected with synthetic credentials                              |
| Cancel could connect after a delayed pairing reply                                                  | Abort the claim and ignore its late result                                                                                     | Delayed-response browser reproduction now creates no socket and saves no token                                                          |
| Pairing reused an earlier identity's restore hints                                                  | Pass the new identity through the existing connection reset                                                                    | Same-origin token replacement and cross-origin replacement; refresh does not open the former Session                                    |
| Pairing code could enter initial resource referrers                                                 | Set the HTML referrer policy before resources load; scrub partial links too                                                    | Initial resource requests and canceled/partial pairing links inspected                                                                  |
| #123: Stop replaced a newer unsent draft                                                            | Leave the current draft intact and retain the interrupted prompt for the owning record                                         | Reproduced before and verified after against the real local Core; no repository changes requested from the model                        |
| Control handback captured first-render state; Resume lost the restored draft                        | Resolve the queued turn's record, recheck authority after waits, send the clicked draft and consume only its unchanged version | Two existing handback browser cases enabled with corrected idle-seat fixtures; current live Core does not implement the driver contract |
| #127: command list exceeded the viewport and textarea used an invalid role                          | Bound the suggestion list, reveal the selected option, preserve native textbox semantics and keyboard list access              | Before: 1694px list with top at -853px in a 1440×1000 viewport; remove the known-role exception from browser acceptance                 |
| #128: Fleet was blank before Session creation and misreported absent capabilities as missing models | Keep the routed empty state visible; show the actual capability limitation and hide unavailable start controls                 | Browser reproduction plus the real Core capability inventory; existing peer observation remains available                               |

## Experience changes

The connection preferences action now belongs to the connection card instead of
an unstyled button outside the page layout. The 390px connection and preferences
views were inspected; neither overflows horizontally. Existing DSH tokens and
input sizes are retained.

PR #125 is reviewed independently for wider code/table space, readable prose,
phone input sizing and visibility of operational state. Its incoming design must
not hide an external-holder explanation behind model text truncation. These
changes are kept in that PR to avoid conflicting implementations.

## Verification quality

Twenty redundant wiring/SSR files are removed without replacement. They assert
source spelling, static markup or React behavior already exercised by retained
algorithm tests and active browser journeys. The additional walkthrough wiring
file failed solely because a now-unused import disappeared; actual handback and
Fleet behavior are verified in the browser. Protocol, identity, ordering and
recovery tests remain.

The two handback `fixme` cases are active. Their fixture now represents an idle
external binding instead of inventing a running turn, and the assertions check
zero forbidden sends, preserved drafts, acquire/release/start order and a single
accepted submission. This establishes the frontend contract against the fixture;
it does not establish compatibility with an unavailable live Core method.

## Remaining integration work

- #112: reconcile terminal-before-collision-reply ordering and retain the full
  refused prompt, including media and reasoning selection. Update its old base
  without losing newer #105 fixes.
- #66 / #122: actual close-tab testing disproved the claimed durable-draft
  behavior. The localStorage write uses a helper requiring a tab-only connection
  envelope. Replace that path with credential-free storage scoped to a verified
  principal; never copy the envelope or token into durable storage.
- Handback refusal currently restores text only. Extend the existing recovery
  payload to preserve the complete unsent turn rather than introducing another
  upload/cache mechanism.
- #103: React's dependency update needs refreshed licenses. Against main it also
  adds about 29 KB of initial JavaScript and exceeds the existing budget.
  Recheck after the parity connection-shell split; do not raise the budget to
  pass CI.
- Finish integrated navigation, long-session performance, phone, keyboard,
  recovery and post-deployment checks on the exact final revision.

Local audit evidence is in `/tmp/octos-020/`. That temporary directory is useful
for this maintenance session, not a durable release artifact. CI runs, PRs and
this report carry the lasting conclusions; no bearer token is included in the
recorded artifacts. Release readiness remains governed by the maintenance
workflow and its outcome ledger on main.

## Integration evidence

The combined 27-case browser acceptance run passes after integrating #125. The
full check passes with 227,968 B initial JavaScript and 65,108 B initial CSS.
The open command list has no axe violations. The Linux and Darwin connection
screenshot baselines are refreshed after inspecting the intentional
credential-checkbox removal and in-card preferences placement. Darwin was
generated and rerun on a separate macOS machine, with its full check passing. CI
must pass on the submitted revision before merging.
