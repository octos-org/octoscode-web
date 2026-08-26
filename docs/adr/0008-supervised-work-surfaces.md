# ADR 0008: Project supervised work from Octos

- Status: Accepted
- Date: 2026-08-26

## Context

Octoscode treats plans, child tasks, runtime policy, output, and artifacts as
part of the coding interaction—not as a separate dashboard. A Web sibling must
preserve those meanings while avoiding the duplicate stores and hand-built event
bus found in the general `octos-web` product.

The implemented wire shapes were checked against Octos Core revision
`04cb5596ec0935926d2e8afdd0826bfa18e0c4bb` and its
`crates/octos-core/src/ui_protocol.rs` blob
`853140d45c3e59e1c4ab2e4445c0282dbb09a8bc`. Session-status presentation and
interaction semantics follow Octoscode revision
`dab1de823cdb5db9587c09fc91c2e7e744f251c9`.

## Decision

The React-free client owns strict decoders and bounded request helpers for:

- `session/status/read` runtime truth;
- `task/list`, `task/cancel`, and `task/updated` lifecycle state;
- `task/output/read` and `task/output/delta` captured output;
- `task/artifact/list` and `task/artifact/read` evidence;
- `plan/updated` model-authored progress.

The application folds those values into one supervision projection. It does not
introduce a generic event bus or mirror task state into a compatibility store.
The inspector renders runtime truth, the current plan, and supervised tasks; raw
frames remain available in a collapsed diagnostics section.

Task output and artifact bodies are bounded and cursor-paged. Output cursor
values are UTF-8 byte offsets. A live delta that overlaps a hydrated snapshot
contributes only its unseen suffix; an entirely replayed delta is ignored; a
forward gap is surfaced rather than guessed. Artifact pages are appended only
when session, task, and artifact identity all match.

Cancellation is capability-gated and becomes locally non-repeatable while its
request is in flight. The server response remains authoritative, and a failed
request restores the previous task state.

## Consequences

An older server exposes explicit unavailable states instead of decorative
controls. Reconnect cannot duplicate output already present in the task
snapshot, and large evidence files do not need unbounded responses. New task or
plan fields can be added to the narrow parser and projection without changing
the product shell or reviving octos-web's store hierarchy.
