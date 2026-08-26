# ADR 0004: DSH product and visual reference

- Status: Accepted
- Date: 2026-08-26

## Context

Octoscode-web needs the behavior of Octoscode and a coherent browser product
language. DeepSeek Harness (DSH) already demonstrates a high-quality coding
workspace shell and is MIT licensed.

The source audited for this decision is DSH revision
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. Relevant references include its
`ui-theme`, `ui-layout`, `ui-sidebar`, `ui-conversation`, `ui-primitives`, and
Web styling standard.

## Decision

Use two explicit sources of truth:

- Octoscode owns command, queue, turn, approval, question, session, capability,
  and AppUI wire semantics.
- DSH owns the primary product-structure and visual reference for the browser:
  semantic theme tokens, three-column workspace, sidebar hierarchy, centered
  transcript width, right-aligned user bubbles, floating capsule composer,
  composer takeover for blocking approvals/questions, detail rail, focus
  visibility, reduced motion, and component-local styling.

The Web client may copy or adapt DSH UI source under MIT. Copied or substantial
adapted portions must identify the DSH revision and preserve its copyright and
license through `THIRD_PARTY_NOTICES.md`.

This supersedes ADR 0002 only where that ADR described DSH as design research
for a later phase. It does not reverse the runtime boundary: we still do not
adopt DSH's Cordis graph, harness, session model, agent runtime, tool runtime,
or host API.

## Consequences

Visual similarity to DSH is intentional. Behavioral similarity to DSH is not a
goal when it conflicts with Octoscode. A copied component must receive native
Octos AppUI state and commands rather than importing a DSH runtime service.
