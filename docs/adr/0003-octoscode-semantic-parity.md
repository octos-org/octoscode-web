# ADR 0003: Octoscode semantic parity

## Status

Accepted.

## Context

Octoscode-web is another client for Octoscode, not a separate coding product.
A visual imitation of the TUI is insufficient if identical user actions create
different commands, queue behavior, approval decisions, or session outcomes.

The interaction audit for this decision used octoscode revision
`dab1de823cdb5db9587c09fc91c2e7e744f251c9` and its canonical command registry,
composer, store, and capability-gating paths.

## Decision

Octoscode is the behavioral source of truth. Given the same negotiated server
capabilities and user intent, the TUI and Web client must emit the same AppUI
command and apply the same state transition.

The parity contract includes:

- Enter submits; Shift+Enter, Ctrl+J, and Alt+Enter insert a newline.
- A prompt submitted during an active turn joins a FIFO queue by default. Each
  item starts as its own turn only after the prior turn settles.
- Mid-turn steering is opt-in, capability-gated, and may never jump ahead of a
  queued prompt. It is not implemented until the Web client can meet all three
  conditions.
- Slash and bang commands are resolved before prompt dispatch. Unsupported
  commands fail visibly and are never sent to the model as text.
- `/activity` opens a searchable, status-filtered cross-session task navigator;
  its scan is read-only and opening a result is an explicit session switch.
- `/stop`, `/interrupt`, `/esc`, the Stop button, and the equivalent shortcut
  represent one interrupt intent. With no active foreground turn, the client
  sends no backend command.
- Session, approval, question, permission, task, rollback, review, model, and
  autonomy controls appear only when the server advertises the required method
  and feature combination.
- Optimistic events reconcile with canonical server projections; durable truth
  remains server-owned.

Browser controls may replace terminal keys, and layout may differ. Those are
presentation adaptations, not permission to invent a different workflow.

The following TUI-host behaviors cannot be copied into an unprivileged browser:

- `!` local-process execution;
- spawning, updating, or diagnosing a local `octos serve` binary;
- terminal scrollback, title, status-line, and raw terminal keymap behavior.

They must be omitted or fail closed with an explicit explanation. They must not
silently degrade into model prompts.

## Drift control

The current Web implementation tests the small interaction slice it supports.
The durable solution is for octoscode to export a versioned, machine-readable
interaction manifest from its canonical command registry, including aliases,
argument modes, capability predicates, and intent identifiers. TUI and Web
conformance tests should consume that same manifest. This repository must not
grow a second handwritten full command registry.

Until that export exists, new Web commands require a parity test and a recorded
octoscode source revision in the change that introduces them.

## Consequences

The Web client may ship fewer controls than the TUI, but every shipped control
must mean the same thing. Capability-gated incremental delivery is preferable
to a broad UI whose operations drift from Octoscode.
