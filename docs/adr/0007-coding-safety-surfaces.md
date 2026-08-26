# ADR 0007: Keep coding safety surfaces server-authoritative

- Status: Accepted
- Date: 2026-08-26

## Context

Permission selection and diff review are the first Web features that can change
the safety posture of an Octoscode session or influence approval of a file
mutation. Reconstructing either from client defaults, git commands, or prose
would create a second and potentially stale authority.

The implementation was checked against Octos Core revision
`04cb5596ec0935926d2e8afdd0826bfa18e0c4bb` and its
`crates/octos-core/src/ui_protocol.rs` blob
`853140d45c3e59e1c4ab2e4445c0282dbb09a8bc`. Interaction semantics follow
Octoscode revision `dab1de823cdb5db9587c09fc91c2e7e744f251c9`.

## Decision

The React-free client owns strict decoders and typed methods for:

- `permission/profile/list` and `permission/profile/set`;
- `diff/preview/get`;
- preview-id discovery from `approval/requested.typed_details.diff` and
  `progress/updated.metadata.file_mutation`.

Golden JSON fixtures pin representative request and result shapes to the exact
Core source blob. Unknown permission modes are rejected. Diff labels stay
forward compatible because Octoscode intentionally displays future status,
source, file-status, and line-kind strings, but their enclosing ids, sessions,
files, hunks, line numbers, and content are still validated.

The Web permission panel is session scoped and capability gated. A choice is
enabled only when the active server advertises both the method and a compatible
profile selection. Mode changes carry the advertised network pair so the client
cannot synthesize an unsupported combination. The server response, not the
optimistic click, becomes current state.

The review surface uses the server's proposal-time diff snapshot. It does not
run git in the browser, recursively scrape ids from text, or merge preview state
across sessions. Request and response session/preview ids must match. Opening a
newer preview invalidates any older in-flight response.

Approval remains a separate blocking interaction. The diff dialog is read-only
evidence; approve and deny actions stay on the authoritative approval request.

## Consequences

Older servers expose an explicit unavailable state instead of controls that
cannot work. Empty profile lists disable mutation. A missing or expired preview
shows an actionable error and refresh path. A generated Rust-to-TypeScript
contract can later replace the handwritten decoders without changing feature
ownership or UI behavior.
