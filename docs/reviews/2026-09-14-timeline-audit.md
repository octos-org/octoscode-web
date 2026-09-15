# Timeline interaction audit — 2026-09-14

Scope: notification folding, hydrated transcript presentation, tool/reasoning
disclosures, and the feedback between tool completion and the next response.

## Confirmed causes and changes

- **Thinking remained live after completion (#81).** Folding settled only
  successful canonical terminals, matched streaming IDs instead of entry kinds,
  and allowed late deltas to reopen completed entries. Legacy and failed
  terminals left active entries untouched. All terminal outcomes now settle
  entries by turn identity; known terminal turns reject late assistant and
  reasoning fragments. Later runtime review retained legal post-terminal tool
  progress for background work without reopening the foreground turn. Hydrated
  terminal states establish the same text barrier without adding a visible
  terminal row for every historical turn.
- **Canonical text could become duplicated and live again.** Core explicitly
  documents persistence overtaking queued progress in
  `octos-cli/src/api/ui_protocol_ledger.rs`,
  `projection_v2_assistant_segment_index`. The browser unconditionally appended
  these late fragments. Persisted assistant segments now retain their canonical
  text, attachments, and settled status, including when coalesced with a
  hydrated message ID.
- **Tool-to-response gaps lost all feedback (#82).** The previous App condition
  suppressed the activity indicator forever once any reasoning or tool existed
  in the turn. `timelineActivity` reports current running activity and a waiting
  state after tools finish. A Chromium run reproduced the missing status after
  `tool_end` before the App integration was changed.
- **Hydration exposed tool output as ordinary system prose.** Tool transcript
  rows now use compact disclosures. An unambiguous same-turn output match merges
  the replay card into the transcript position and preserves the full output.
  Ambiguous matches are retained rather than silently discarded. The additional
  browser-side 500-character truncation was removed; the server's preview bound
  and the scrollable disclosure control presentation size.
- **Streaming controlled the reader's expansion state.** Thinking and tools now
  start collapsed, and native disclosure state survives streaming and
  completion. Explicit chevrons, keyboard focus rings, scoped activity glyphs,
  and reduced motion behavior replace mismatched CSS Module/global selectors and
  automatic entry movement. Empty assistant rows and “No output yet”
  placeholders no longer appear as messages. Assistant prose is constrained to
  68ch.

## Verification

- Timeline unit/SSR tests: **28 passed**. Cases include all terminal outcomes,
  legacy completion, nonstandard entry IDs, independent turns, late persisted
  suffixes, hydrated identity reconciliation, late reasoning, background child
  completion, output reconciliation, and the complete activity lifecycle.
- Existing session tests: **107 passed**. Web TypeScript compilation, scoped
  lint, and repository CSS/token policy checks passed.
- `e2e/timeline-interactions.spec.ts` drives ten deterministic streamed turns in
  Chromium through the actual application. It covers the tool-to-answer gap,
  empty persisted preambles, late fragments, terminal settlement, user
  expansion, Enter/Space keyboard operation, and reduced-motion styling.
  **Passed all ten turns in 5.3 seconds** against development port 44174 /
  fixture port 54080. The browser test caught a specificity error in the
  reduced-motion override; the corrected selector now disables the running glyph
  animation, verified through computed CSS. Evidence screenshot:
  `/tmp/octos-timeline-results/timeline-interactions-keep-91246-t-across-ten-streamed-turns/timeline-completed.png`.

## Remaining limits

The prior live audit's stuck-reasoning trace is retained in
`/tmp/ocw-audit/dom-6-settled.json`; this change covers demonstrated code paths,
but does not claim ten live model turns reproduced that intermittent transport
race. The new ten-turn browser test deliberately controls the event order.

Hydrated tool messages currently carry no `tool_call_id`, so a unique textual
match is the only conservative merge available. Ambiguous/partial previews can
still produce two collapsed disclosures. Missing history or in-flight state from
Core cannot be reconstructed from timeline presentation alone. Background child
hydration deduplication and attachment ownership outside persisted assistant
messages are outside this patch.

## Real Core verification

Three additional browser turns ran against the local Core through an isolated
development proxy on port 45174, using `glm-5.3-flash`, from 17:37:32 to
17:38:08 UTC. The session was newly created for this audit. All three prompts
explicitly prohibited file modifications; the only tool observed was `read_file`
for the first twelve lines of this repository's README.

| Turn                      | Time to terminal | Result                                           |
| ------------------------- | ---------------: | ------------------------------------------------ |
| Exact short text          |           8.10 s | Correct marker, completed, zero live disclosures |
| Read README and summarize |          14.48 s | Correct marker, completed, zero live disclosures |
| Short follow-up           |           6.60 s | Correct marker, completed, zero live disclosures |

- The real tool finished only **2 ms** after it started. Another **7,325 ms**
  elapsed before the next reasoning fragment. All **34 DOM samples** within that
  gap showed “Preparing next step…”; none showed an unexplained silent running
  state.
- The follow-up's `assistant_persisted` arrived **86 ms before** its final
  `assistant_delta`. The canonical answer remained correct and unduplicated, and
  all thinking blocks settled after the terminal.
- No console errors or page errors were observed. No “No output yet” rows
  appeared. Reader-opened disclosures stayed open across the following turn. The
  live tool phase was too short to open while running, so preservation across
  running-to-completed is verified by the deterministic browser test, not
  claimed from the 2 ms live tool interval.
- Remaining upstream behavior is visible: first output takes 6–8 seconds, and
  the answer fragments arrive in a short burst near completion. A 2 ms tool
  execution also cannot yield a human-perceptible running card. These timings
  were observed on the wire, rather than introduced by rendering.

Sanitized samples and event timing metadata are in
`/tmp/octos-live-three-turns/report.json`; screenshots are `readme-settled.png`,
`plain-settled.png`, and `followup-settled.png` in that directory. Credentials
were read into memory from the prior authorized audit; no token or authenticated
WebSocket URL was written to these artifacts. This bounded run sampled 1.5
seconds after each terminal and does not establish an absence of every
intermittent or background-task race.
