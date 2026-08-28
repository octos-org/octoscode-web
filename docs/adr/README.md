# Architectural decisions

ADRs explain durable boundaries and the alternatives that were deliberately
rejected. Accepted records are historical: supersede them with a new ADR instead
of rewriting the original decision.

## Product foundation

| ADR                                              | Decision                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| [0001](0001-clean-client-boundary.md)            | Build a focused sibling client instead of extracting the old `octos-web`. |
| [0002](0002-dsh-evaluation.md)                   | Use DSH as a reference, not as the Web runtime base.                      |
| [0003](0003-octoscode-semantic-parity.md)        | Preserve Octoscode interaction semantics.                                 |
| [0004](0004-dsh-product-and-visual-reference.md) | Adopt DSH's audited product and visual language.                          |

## Sessions, coding, and supervision

| ADR                                                                  | Decision                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [0005](0005-durable-session-recovery.md)                             | Treat hydrate, cursor replay, dedupe, and reconnect as one invariant. |
| [0006](0006-safe-markdown-transcript.md)                             | Parse Markdown only after assistant output settles.                   |
| [0007](0007-coding-safety-surfaces.md)                               | Keep permission and diff safety surfaces server-authoritative.        |
| [0008](0008-supervised-work-surfaces.md)                             | Project plans, tasks, output, and artifacts from Octos.               |
| [0009](0009-workspace-session-surfaces.md)                           | Historical foreground-only navigation, partially superseded by 0019.  |
| [0010](0010-server-resolved-workspace-launch.md)                     | Server-resolved launch; activation confirmation superseded by 0019.   |
| [0012](0012-background-session-activity.md)                          | Retired the incomplete cross-session Activity navigator.              |
| [0015](0015-solo-web-onboarding.md)                                  | Onboard an empty solo server through capability-gated Core methods.   |
| [0017](0017-workspace-session-and-connection-memory.md)              | Historical connection/restore design, superseded by ADR 0018.         |
| [0018](0018-dsh-aligned-product-shell.md)                            | DSH-aligned shell, partially superseded by ADR 0019.                  |
| [0019](0019-tab-session-navigation-and-background-turn-ownership.md) | Remember confirmed Sessions and retain acknowledged turn owners.      |

## Contracts and delivery

| ADR                                           | Decision                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| [0011](0011-versioned-static-releases.md)     | Publish immutable, checksummed static releases.                              |
| [0013](0013-generated-core-contract-index.md) | Generate and verify Core protocol vocabulary as an intermediate contract.    |
| [0014](0014-pinned-core-runtime-smoke.md)     | Test a checksummed released Core in CI and release gates.                    |
| [0016](0016-architectural-ratchets.md)        | Replace recurring defect chains with shared boundaries and checked ratchets. |

## Adding an ADR

Use the next four-digit sequence and a short kebab-case filename. Include:

- status and date;
- the context and forces behind the choice;
- the decision and its consequences;
- rejected alternatives when they are plausible;
- exact upstream revisions when the decision depends on source archaeology.

Link the new record from this index and from the relevant guide. Update an
existing ADR's status only when the new record explicitly supersedes it.
