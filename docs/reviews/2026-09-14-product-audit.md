# Product and interaction audit, 2026-09-14

This records the first pass. The [follow-up audit](2026-09-14-followup-audit.md)
adds targeted turn recovery, saved conversation links, nested-dialog fixes, and
further narrow-screen and keyboard evidence. Its results supersede the remaining
items explicitly addressed there.

The inherited green tests did not establish a usable coding workflow. This pass
reviewed the handoff, application shell, composer, navigation, timeline fold,
transport recovery, client decoders, workspace creation, and browser tests.
Three parallel agents examined connection, timeline, and runtime behavior; their
fixes were integrated and cross-reviewed in a local branch.

The working baseline is [frontend-baseline.md](../frontend-baseline.md). Source
references are recorded there. The focus is task completion, readable state,
stable layout, and predictable controls.

## Findings and implemented changes

| Priority | Finding                                                                                 | Result                                                                                                               |
| -------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| P1       | Late progress could reopen completed Thinking or corrupt persisted text.                | Settle all appropriate stream entries at terminal boundaries; canonical persistence wins over delayed deltas.        |
| P1       | The first tool permanently disabled the foreground waiting indicator.                   | Current-phase activity remains visible between tool completion and the next model output.                            |
| P1       | A transport error followed by close could miss the reconnect path.                      | Reconnect on both status paths after an established connection.                                                      |
| P1       | A queued prompt promoted during recovery could remain active without ever being sent.   | Resume undispatched work after recovery, preserving FIFO and the server's active turn.                               |
| P1       | IME candidate confirmation could dispatch a prompt.                                     | Ignore composition/keyCode 229 before handling composer commands.                                                    |
| P1       | Mobile stacked navigation plus a 720px minimum chat height pushed input off screen.     | Single viewport workspace with a session drawer and bounded internal scroll.                                         |
| P2       | Lost background owners vanished from the activity display.                              | Retain bounded failure records without consuming live owner slots.                                                   |
| P2       | Queued prompts blocked navigation but had no removal control.                           | Ordered queue with per-message cancellation before dispatch.                                                         |
| P2       | Every localhost deployment defaulted to a fixture port.                                 | Default to current origin; retain explicit configuration and offer Use this page for old saved values.               |
| P2       | Invalid addresses could be saved while typing, before submit validation.                | Validate both at submission and at the persistence boundary.                                                         |
| P2       | First-time users had to open an empty chooser, then find Add workspace.                 | Direct focused path entry for an empty recent-project list.                                                          |
| P2       | Creation could be dismissed with Escape/backdrop while its Cancel button was disabled.  | Dismissal and button rules now agree during in-flight creation.                                                      |
| P2       | Tool completion closed details the user was reading; raw hydrate output was duplicated. | Reader-controlled native disclosure; conservative merge of provably matching output; keep ambiguous output.          |
| P2       | Extra 180px bottom padding and asynchronous Markdown growth destabilized reading.       | Observe rendered content size; follow only at the tail; deliberate detail expansion detaches follow.                 |
| P2       | Navigation entrance fades briefly made session text unreadable.                         | Remove per-row entrance animation; reserve motion for the drawer transition.                                         |
| P2       | Sorting existed as a controlled prop with a no-op handler and no menu actions.          | Explicit Last opened/Least recently opened controls sort the actual Session rows.                                    |
| P2       | Refresh/close silently interrupted socket-owned active work.                            | Native leave warning while work is active; remove it after completion. Detached execution remains a Core limitation. |

Cross-review caught and corrected a new resize-follow issue before delivery: a
long tool disclosure moved its title from y=70 to y=43 under a y=52 viewport
edge. It also identified the need to preserve legitimate background tool events
after the foreground terminal. These cases are recorded in the focused
reports/tests.

## Evidence and test limits

- `e2e/onboarding.spec.ts`: address validation, no unwanted socket creation,
  authentication guidance, IME, focus, and in-flight creation.
- `e2e/workspace-ux.spec.ts`: Chinese composition, multiline input, queue
  removal, actual beforeunload dismissal, phone viewport, drawer focus/axe,
  reading history, disclosure position, and actual multi-Session sort order.
- `e2e/timeline-interactions.spec.ts`: ten controlled streamed turns, including
  delayed progress and terminal/persisted reordering, native keyboard
  disclosure, and reduced motion.
- [Runtime report](2026-09-14-runtime-audit.md): reconnect/queue/failure
  regressions and the isolated pinned Core integration check.
- [Timeline report](2026-09-14-timeline-audit.md): folding invariants, tool
  output matching limits, and real-model evidence when available.

Fixture events deliberately cover adverse ordering, but they are not a
substitute for actual Core event behavior. Three real browser turns against rc.9
and `glm-5.3-flash` completed in 8.10s, 14.48s, and 6.60s, with no page or
console errors, duplicate answers, or lingering live entries. The README turn
also exercised persistence arriving 86ms before the final delta and a 7.325s
post-tool wait; the waiting label remained visible in all 34 samples.

Reviewed screenshots are in the [evidence index](evidence/2026-09-14/README.md).
The connection, first-workspace, and session-reply visual baselines were updated
after inspection: form validation/actions, direct path entry, the bounded
transcript, and composer spacing intentionally changed. The approval baseline
remains unchanged. Browser tests now use Playwright's installed Chromium,
matching the documented setup without requiring a separate Chrome installation.

## Remaining delivery risks

1. **Refreshing active work is not detached execution.** The leave warning
   reduces accidental loss; it cannot keep an owner WebSocket alive after
   navigation.
2. **Server-wide session discovery is incomplete.** The sidebar uses confirmed
   tab-local references. Admin-scoped rc.9 `session/list` cannot prove the
   correct workspace/profile. Cross-browser discovery needs an authoritative
   scope contract or a separately verified import flow. Generic session IDs also
   remain less useful than server-owned conversation titles.
3. **Eight retained owners is a Web policy, not a Core connection limit.** Safe
   eviction still needs a quiescence/release contract; completion alone is not
   sufficient to prove all background events have drained.
4. **The Core integration smoke does not execute a model turn.** Real browser
   turns add evidence, but do not cover every provider, flaky network, or race.
5. **App and session coordination remain large.** Scroll and queued-prompt UI
   now have feature boundaries, but a large structural rewrite is not justified
   as a substitute for completing and testing the user workflow.
6. **A previously acknowledged turn missing entirely from hydrate remains
   uncertain.** The controller conservatively waits rather than resending work
   that may have executed. An explicit query/recovery flow needs separate
   implementation and verification; this was not reproduced as a live failure.
7. **Model latency and event cadence remain observable.** Real first output took
   approximately 6–8 seconds, with final text arriving in a short burst. The UI
   explains the wait but does not synthesize progress or change provider
   latency. The production entry also has only 739 bytes of JavaScript budget
   headroom after this pass, so future eager additions require care.

The handoff's statement that rc.9 lacks a turn-state query is incorrect:
`turn/state/get` already exists. It does not itself solve owner release or
scoped session discovery. The inherited handoff is historical context, not a
verified contract.

## Final integration checks

The local branch is `fix/workspace-interaction-audit`; no deployment or Core
configuration was changed.

- `pnpm check`: passed formatting, repository policy, dependency notices, lint,
  both TypeScript projects, 56 client tests, 319 Web tests, production build,
  and deployment-output verification.
- Initial production JavaScript: **359,709 bytes** against the unchanged
  **360,448-byte** budget. Initial CSS: **66,478 bytes**, below **81,920
  bytes**. Optional coding, onboarding, and supervision response decoders load
  on demand; notifications remain synchronously validated and requests dispatch
  at the same point as before. Public client exports and malformed-response
  rejection are covered by the client tests.
- `pnpm contract:verify`: passed against pinned Core contract
  `04cb5596ec0935926d2e8afdd0826bfa18e0c4bb`.
- `OCTOS_BINARY=/home/shu/.octos/bin/octos node scripts/verify-core-integration.mjs`:
  passed again after decoder splitting, including negotiation, profile
  catalog/test/save, exact Session open, hydrate, permissions, supervision, and
  status in isolated temporary state. This gate does not call a model.
- `OCTOSCODE_E2E_WEB_PORT=54175 OCTOSCODE_E2E_FIXTURE_PORT=55082 pnpm test:e2e`:
  **58 passed**, including product navigation/recovery, models, onboarding,
  workspace interaction, ten controlled turns, accessibility, performance, and
  four visual comparisons. The measured worst long animation frame was
  **117.2ms** against the unchanged **200ms** threshold.
- After the final sorting correction, `pnpm check` passed again with the counts
  above. All **10 affected workspace-interaction and visual tests** also passed,
  including the strengthened three-Session ordering check.
- A separate Chromium pass against the **production build** verified first
  connection/workspace, Markdown and highlighted code, permission list/set,
  Trajectory/status, actual task output, and configured Models. All **38 static
  resource responses were HTTP 200**, with no page/console errors or failed
  requests. The coding, onboarding, supervision, Markdown, and code-rendering
  chunks were each observed loading successfully. This used the deterministic
  fixture and the final build; it did not send a model request.

Final cross-review found that the first version of the sorting repair only
changed the selected option: the registry already returned recency order, so
"Original order" was identical within a workspace. The replacement option is
"Least recently opened", with explicit ascending timestamp order and real
multi-Session DOM assertions. This limitation was caught by code review despite
the earlier selected-state-only browser test passing.
