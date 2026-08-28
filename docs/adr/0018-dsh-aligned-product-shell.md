# ADR 0018: Separate authentication from the coding workspace

- Status: Accepted
- Date: 2026-08-27
- Supersedes: ADR 0012 and ADR 0017; the primary session-files presentation in
  ADR 0009

## Context

The first product shell presented runtime and protocol concepts as if they were
normal coding choices. Connection asked for a session id, profile id, and
workspace path; the sidebar mixed session navigation with permissions, files,
activity polling, capability messages, and an explanation of the runtime
boundary. These controls exposed implementation structure without helping a user
start or continue coding.

DeepSeek Harness already has a coherent browser coding-product hierarchy:
authenticate, choose a Workspace, choose or create a Session, then control the
active Session from its composer. We audited its sidebar, Workspace browser,
conversation input, permission/model selectors, and Settings shell at revision
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. ADR 0004 and
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) record the
product-reference and attribution boundary; DSH's Cordis and harness runtimes
remain out of scope.

Octos Core does not yet expose a global, persistent Workspace catalog with
globally addressable Session descriptors. It can validate a server path and list
Sessions for an active Workspace, but the browser cannot truthfully claim that
it has discovered every Workspace or Session on the server. A client-side
catalog must not become a second source of durable truth.

## Decision

The product shell uses these layers:

```text
Octos server authentication
  └─ Workspace (the coding object, identified by a server path)
       └─ Session (one durable coding conversation)
            ├─ Chat
            └─ Trajectory
```

The connection gate asks only for the Octos server origin and, when required, an
auth token. Workspace path, profile id, and session id are not login fields.
Only the endpoint is written to durable browser storage. The endpoint, token,
auto-connect marker, and active Workspace/Profile/Session restore hints are
bound together in the current tab. Closing the tab leaves only the endpoint;
provider credentials remain memory-only.

The left sidebar is the primary navigation surface. It contains New Session,
Workspace groups with their Sessions, search and view options, Add workspace,
and Settings at the bottom. New Session first chooses a known Workspace. Add
workspace accepts a path on the Octos server and immediately creates a fresh
Session; it is not Workspace-registry CRUD. New Session likewise creates a fresh
opaque Web identity in the chosen path. Session identity remains an adapter
detail and is never entered by the user.

The browser may keep a bounded, endpoint-scoped list of recent Workspace paths
in the current tab. It never stores Session ids, titles, prompts, or projections
in that cache. The list is navigation memory only: it can be stale, does not
prove that a path or Session still exists, and has no individual edit/remove
action. rc.9 `session/list` does not prove its effective Workspace/Profile
scope, so the browser does not project its rows; only the successfully opened or
restored Session appears. A complete Workspace/Session object model requires the
Core contract tracked in
[octos#2146](https://github.com/octos-org/octos/issues/2146).

Opening or switching work uses a staged candidate connection. The current
Session remains visible and connected until the candidate has connected, opened,
passed the coding capability baseline, and hydrated. Cancellation or failure
discards the candidate without replacing browser state. This is a client
transaction, not a claim that Core's create-or-resume `session/open` is
server-atomic; prepare/commit or a created/abort contract is part of octos#2146.
Session-ingress credentials are likewise unsupported until Core advertises the
bound Session scope instead of requiring an undiscoverable raw id.

Session execution status and controls remain adjacent to the composer. The
permission selector presents only complete permission-and-network combinations
advertised by the server and requires explicit acknowledgement for dangerous
full access. The model seat is different: it reports the effective model served
by the selected Session runtime and opens Settings; it is not a Session model
selector. Durable session policy and authenticated full-access administration
are tracked in [octos#2147](https://github.com/octos-org/octos/issues/2147).

Settings opens from the bottom of the sidebar and has General and Models
sections. General shows the active server and Workspace and owns Disconnect and
Forget server. Models distinguishes the Session runtime model from the active
Profile default. Changing the Profile default affects every Session using that
Profile and can require an Octos restart. A true Session override is tracked in
[octos#2148](https://github.com/octos-org/octos/issues/2148). Chat and
Trajectory are local views of the selected Session; Trajectory replaces the
global Activity navigator and its cross-session polling.

Runtime cards, architecture boundary explanations, raw capability diagnostics,
and session-files/debug panels are not product navigation. Architecture belongs
in documentation, and capability failures appear only where the affected user
action lives. Diff review, approvals, questions, task detail, and recovery
remain contextual Session surfaces.

The Web coding baseline is explicit and fail closed: creation requires
`session/open`; an active candidate must also advertise `session/hydrate`,
`turn/start`, and the durable hydrate/projection features. `turn/interrupt` and
`session/status/read` remain optional, so Stop and runtime-model presentation
exist only when their respective methods are advertised.

## Rejected alternatives

- Keep path, profile, and session identity in the connection form. This makes
  authentication depend on information a user normally learns only after
  connecting.
- Treat browser recents as a durable Workspace registry or persist Session
  labels there. That would create a partial client database that cannot validate
  remote paths or enumerate Core truth.
- Present Profile-default model configuration as a Session selector. It would
  hide the effect on other Sessions and could claim a change before the runtime
  restarts.
- Keep a global Activity screen backed by per-Session polling. It adds N+1 work
  while still presenting an incomplete server-wide view.
- Keep files, capabilities, runtime ownership, and safety configuration as
  permanent sidebar sections. They mix implementation diagnostics with primary
  coding navigation.
- Import DSH's complete Web client. Its UI is coupled to DSH's client runtime,
  host API, projections, and plugin graph; Octos remains the only harness here.

## Consequences

The browser now follows the same product grammar as the DSH reference while
preserving Octoscode action semantics and Octos server authority. Users connect
before choosing work, known Workspace paths load their Session catalogs in the
left navigation, and Session status/controls stay next to the composer.

Until Core implements octos#2146, a new tab starts without Workspace paths even
if Core already has Sessions. Within a tab, only paths opened there can be
reloaded; stale paths can fail when selected. Add workspace necessarily creates
a fresh Session, and the browser cannot edit/remove one recent path. Legacy
profile-global session storage and session-ingress authentication cannot be
presented as Workspace navigation. Permission and Profile-model management
remain bounded by the current Core contracts identified above.
