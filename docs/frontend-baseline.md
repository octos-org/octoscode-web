# Frontend interaction baseline

This is a coding workspace for sustained reading, writing, and supervising work.
The design should be quiet, predictable, and responsive. The existing DSH visual
tokens, React components, and CSS Modules remain the foundation.

## Reference and scope

The September 2026 audit used [TasteSkill](https://www.tasteskill.dev/), its
[redesign skill](https://github.com/Leonxlnx/taste-skill/blob/main/skills/redesign-skill/SKILL.md),
and the audit/preservation sections of
[design-taste-frontend](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md).
The latter explicitly excludes dense product UI. Its marketing presets, animated
heroes, decorative imagery, and typography swaps are not requirements here. The
applicable baseline is `DESIGN_VARIANCE: 3`, `MOTION_INTENSITY: 3`, and
`VISUAL_DENSITY: 5`: a predictable work surface, restrained feedback, and room
for both prose and technical details.

Component patterns studied on 21st.dev:

- [Prompt Kit input with actions](https://21st.dev/@ibelick/components/promt-input-with-actions/prompt-input-with-suggestions):
  keep editing, contextual actions, and send in one stable surface.
- [Tool Invocation](https://21st.dev/@Alwurts/components/tool-invocation): a
  concise state header with opt-in detailed output.
- [Conversation](https://21st.dev/@vercel-crawled/components/conversation):
  bound the scroll region and make return-to-latest an explicit action.

These are interaction references. This change does not copy their implementation
or install another design system. Existing DSH attribution remains in
`THIRD_PARTY_NOTICES.md`. Small new arrows and menu icons extend the existing
16px, 1.5-stroke SVG family, as requested by the project owner.

## User journeys

| Journey             | Required behavior                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect             | Default to this page's origin; allow a custom server; Enter submits; address errors stay next to the field. Never persist credentials embedded in an address.   |
| Open first project  | Show the path field directly, focus it, start on Enter, and label the exit as Change server.                                                                    |
| Add another project | Keep recent projects available; focus the useful field; preserve progress during creation.                                                                      |
| Write               | Focus the desktop composer after navigation; keep multiline shortcuts; IME confirmation must not send.                                                          |
| Wait                | Display a current activity label throughout the active foreground turn, including the interval after a tool finishes. Approval/question controls take priority. |
| Queue               | Show each queued message, its order, and a remove action. Remove only undispatched local messages.                                                              |
| Stop                | Keep Stop available for an interruptible turn. Hide an empty Queue action; show it once there is text to queue.                                                 |
| Read details        | Tools and reasoning start collapsed. Expand with pointer, Enter, or Space. Completion must not close a user's disclosure or move its heading out of view.       |
| Read history        | Incoming content must not pull the reader back to the end. Back to latest resumes following.                                                                    |
| Navigate on a phone | Keep header, scroll region, and composer inside the viewport. Open sessions in a focus-contained drawer; Escape returns focus to its trigger.                   |
| Sort sessions       | Last opened and Least recently opened must reorder actual rows by confirmed tab-local opening time, with stable ties and missing dates last.                    |
| Lose connection     | Resume the existing recovery policy on both error and close. Retain failed background activity and queued message order.                                        |
| Leave active work   | A browser leave warning protects active work from accidental refresh/close. It does not promise detached execution.                                             |

Additional recovery and keyboard acceptance rules:

- A missing start acknowledgment or missing hydrate entry cannot establish that
  a turn never ran. Unknown status pauses sending, retains pending prompts, and
  exposes a capability-gated status check with truthful failure states.
- A saved conversation link from an empty browser shows its target after
  authentication and requires an explicit open action. It carries no credential
  and must match the server-confirmed workspace/profile/session before
  selection.
- Only the topmost modal handles Tab and Escape. Closing a review above an
  approval must preserve that approval and must not interrupt its turn.
- After approval or question completion, typing continues in the desktop
  composer. Mobile focus returns to the composer surface without forcing the
  software keyboard. Settings closes back to its trigger.
- At 320 × 480, actual control rectangles must fit the viewport, including long
  unbroken Unicode queues and multiline drafts; document width alone is not a
  sufficient overflow check. Settings sections must scroll to their final
  action.
- Disconnect and Forget remain reachable while a turn is uncertain. With pending
  work, an explicit confirmation explains the loss of the local queue and
  possible interruption. Cancel preserves the connection and queued prompts.

## Visual and motion rules

- Use `theme.css` semantic tokens in both light and dark themes. Preserve one
  blue interaction accent; reserve status colors for real runtime state.
- Use the platform font stack and the existing code font stack. Prose is bounded
  to approximately 65 characters; code and data can use the wider transcript.
- Prefer whitespace and simple surfaces. Status labels should explain what is
  happening; implementation vocabulary belongs in diagnostics.
- Feedback is approximately 120ms; surface entrances approximately 180ms. Drawer
  motion uses transform and opacity. Native disclosure size transitions are
  limited to a deliberate user toggle and degrade to instant behavior.
- No per-row entrance delays in navigation, no repeated transcript entrance
  effects on streaming updates, no invented token-by-token animation.
- Honor `prefers-reduced-motion` for every animation and transition, including
  pseudo-elements and state-specific selectors.
- Keep input text at least 16px on phones and preserve safe-area padding.
  Compact controls should remain keyboard accessible with visible focus.

## Acceptance evidence

Use deterministic browser tests for adverse event ordering, keyboard behavior,
queue cancellation, resize/scroll behavior, and accessibility. Use isolated Core
integration for the actual pinned protocol. Use real model turns to check event
timing and state convergence; fixture success alone cannot establish that.

Inspect screenshots before updating baselines and state why each changes. Keep
the initial JavaScript budget at 353 KiB (the existing #89 budget) and initial
CSS at 80 KiB. Do not raise budgets merely to accommodate a feature. A passing
pixel comparison, LoAF threshold, or axe scan is evidence for that check, not a
claim that the entire product is deliverable.
