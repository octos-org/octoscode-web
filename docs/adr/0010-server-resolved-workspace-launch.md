# ADR 0010: Let the server resolve workspace launch

Status: accepted

## Context

A server-side path does not tell a browser which Octos profile owns the
folder's durable coding conversation. Octoscode resolves that relationship
before `session/open`: the requested profile is a hint, then the folder's
sticky profile and server default participate in the decision. Reimplementing
that scan in Web code would be impossible for remote servers and would create
a second source of truth.

The contract was checked against Octos Core revision
`04cb5596ec0935926d2e8afdd0826bfa18e0c4bb` and Core protocol blob
`853140d45c3e59e1c4ab2e4445c0282dbb09a8bc`. Interaction order and session
identity follow Octoscode revision
`dab1de823cdb5db9587c09fc91c2e7e744f251c9`.

## Decision

When a workspace `cwd` is present, the client opens the WebSocket and reads
`config/capabilities/list` before opening a session. It invokes
`launch/resolve` only when both that method and
`session.workspace_cwd.v1` are advertised. The four results retain Octoscode's
meaning:

- `resume` immediately opens the server-resolved profile;
- `activate` asks before creating that profile's conversation in the folder;
- `cross_profile` offers “start the resolved profile here” plus one resume row
  for each existing profile;
- `no_profile` blocks session creation and points to `octoscode onboard`.

The resulting coding session id is `<profile>:local:tui#coding`, exactly the
identity Octoscode constructs. This lets TUI and Web address the same durable
conversation rather than creating client-specific twins. Choosing a profile
always sends the server path and profile back through `session/open`.

An older server that rejects `config/capabilities/list` as method-not-found, or
does not advertise the launch contract, falls back to the explicitly entered
session id. Other capability or launch errors do not fall back. If the socket
disconnects before a launch choice, reconnect repeats launch resolution; it
must not bypass the pending decision.

## Consequences

Repository ownership, path validation, sticky profiles, and cross-profile
detection remain server truth. Web startup now has the same observable choices
as the TUI and shares its coding ledger. The browser still cannot discover
folders on the server: a user or deployment must supply the server-side path.
Full profile onboarding remains outside this product slice, so `no_profile`
provides the canonical command instead of a partial duplicate wizard.
