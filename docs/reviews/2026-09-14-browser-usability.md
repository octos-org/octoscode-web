# Browser usability audit — 2026-09-14

This second pass exercised everyday operations in bundled Playwright Chromium:
long Chinese/code drafts, eight queued prompts, approvals, multi-question forms,
Settings, nested dialogs, and keyboard focus. Viewports were 320×480, 390×844,
and 1280×720. The earlier visual and accessibility checks had missed several
operational failures because a document can report the correct width while
clipping its descendants.

## Reproduced failures and repairs

| Finding                                                             | Browser evidence before the repair                                                                                                                                                                                                | Result after the repair                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long queued prompts pushed the mobile composer outside the screen   | At 320px, the textarea was 766px wide at x=13; removal buttons started at x=735. `documentElement.scrollWidth` remained 320. Clicking the eighth removal through Playwright's automatic scrolling shifted the textarea to x=−459. | Textarea x=13, width=294; removal buttons x=263, width=32. Removing the eighth prompt preserves the input's position. The queue scrolls independently.                                                                                                                                                                                                      |
| Mobile Settings could not scroll to its connection actions          | At 320×480, the dialog was 456px high, while its tabpanel was 736px high with no internal scroll range. Copy diagnostics started at y=621 and Disconnect at y=786. Ancestor scrolling could also hide the close button.           | The flex content can shrink; its tabpanel owns scrolling. Diagnostics, connection actions, Models editor fields, cancellation, and the fixed close button remain reachable. Dialog sizing follows the dynamic viewport.                                                                                                                                     |
| Closing a diff review also interrupted its underlying approval      | Five Tab presses stayed on Refresh. One Escape closed the review and sent a `turn/interrupt` RPC for the pending approval. Both dialogs handled the same document-level keyboard event.                                           | Only the top modal handles keyboard events and restores focus. Tab reaches the review controls, file summaries, and native scroll region. The first Escape sends no interrupt and restores Review diff focus; a second Escape on the approval retains the intended stop action.                                                                             |
| Model deletion confirmation lacked its own focus boundary           | The confirmation used a plain dialog element inside Settings, outside the shared modal behavior.                                                                                                                                  | It uses the modal stack, initially focuses Cancel, contains Tab, and closes independently with Escape. While busy, Escape does not dismiss it. An IME composition Escape is preserved for the input method.                                                                                                                                                 |
| Resolving an approval or question lost the desktop editing position | `activeElement` became BODY. Typing a follow-up without clicking left the textarea empty.                                                                                                                                         | The remounted desktop composer receives focus; direct keyboard typing reaches the draft. The one-time focus guard waits until its animation frame actually runs, including under React StrictMode. Closing Settings instead restores its original trigger. Mobile restores a non-editing composer focus target to avoid forcing the software keyboard open. |

## Checks and evidence

- [settings-mobile.spec.ts](../../e2e/settings-mobile.spec.ts): two tests at
  320×480 and 390×844. Actual wheel scrolling, diagnostic copying, button
  bounds, Models form editing/cancellation, and focus restoration passed.
- [modal-stack.spec.ts](../../e2e/modal-stack.spec.ts): four tests at 320px and
  1280px. Keyboard traversal, counted interrupt RPCs, layered Escape behavior,
  IME Escape, and provider-confirmation focus passed on a separate Vite server
  at port 45179. The collapsed-file Shift+Tab assertion checks return to the
  summary; it does not establish coverage for every hidden descendant or native
  scroll-container arrangement.
- Independent scripts in `/tmp/octos-ux-v2/`: `edge.mjs`, `desktop-edge.mjs`,
  `approval-review.mjs`, `audit.mjs`, and `settings-focus.mjs`. Their JSON
  reports include element rectangles, focus samples, and observed interrupt
  requests. Repeat runs overwrite those reports with the latest results; the
  original failure measurements are preserved in the table above.
- Existing related UI unit tests passed (13 assertions/tests reported by
  Vitest). The client decoder change passed 77 client tests, including immediate
  request dispatch, synchronous notification delivery, and rejection of
  malformed responses. Type checking and targeted lint passed.
- The separate real Core protocol gate passed against rc.9 (`5ea9878`): launch,
  session open/hydration, configuration, permissions, supervision, and status.
  Log: `/tmp/octos-client-lazy-core.log`. That gate did not start a model turn.

Evidence saved in the local worktree:

- [Settings at 320px, scrolled to connection actions](evidence/2026-09-14/settings-mobile-320.png)
- [Eight queued prompts and a long Chinese draft at 320px](evidence/2026-09-14/queue-mobile-320.png)
- [Diff review above a pending approval at 320px](evidence/2026-09-14/approval-review-mobile-320.png)

## Scope limits

Browser interactions used the local mock server, with fixture credentials only.
WebSocket fixtures supplied held turns, a valid diff preview, long approval
text, and three structured questions. No real model, provider credential, or
production conversation was used for these browser probes. Mobile checks used
viewport emulation; they do not verify an operating system's software keyboard,
Safari behavior, or physical touch-device performance. Whole-project release
status belongs to the final integrated checks in the
[follow-up audit](2026-09-14-followup-audit.md).
