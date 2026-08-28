# Testing and verification

Use the smallest gate that proves the change while developing, then run the
complete gate before review.

| Gate                  | Command                                         | Proves                                                 |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| Unit                  | `pnpm test`                                     | parsers, reducers, state machines, and components      |
| Types and lint        | `pnpm typecheck && pnpm lint`                   | package boundaries and exhaustive cases                |
| Repository policy     | `pnpm policy:verify`                            | UI tokens, style ownership, and ADR metadata           |
| Product browser       | `pnpm test:e2e`                                 | launch, recovery, multi-Session/background turns, WCAG |
| Live model (opt-in)   | `pnpm test:e2e:live`                            | real Core, runtime model, tools, turn, and tab restore |
| Generated contract    | `pnpm contract:verify`                          | Core vocabulary matches the immutable source pin       |
| Released Core runtime | `OCTOS_BINARY=/abs/octos pnpm integration:core` | a matching released Core completes the critical flow   |
| Deployment            | `pnpm build && pnpm deploy:verify`              | artifact, CSP, nginx contract, and size budgets        |
| Complete local gate   | `pnpm check`                                    | all deterministic non-browser gates                    |

Install Chromium once with `pnpm exec playwright install chromium`. E2E owns its
fixture and Vite ports; it deliberately refuses to reuse an existing server so a
developer's real Octos process cannot make a fixture test pass. Set
`OCTOSCODE_E2E_FIXTURE_PORT` and `OCTOSCODE_E2E_WEB_PORT` when the defaults are
occupied; the configured fixture origin is injected into the app.

## Multi-Session and background-turn gate

The deterministic AppUI fixture must model Session state per exact
Workspace/Profile/Session tuple. Hydrate must return that Session's own
messages, turns, and pending interactions, and durable turn events must reach
every socket that has the Session open. A fixed completed hydrate or an
arbitrary short timeout cannot prove background execution.

The product browser gate currently covers these sequences:

1. Create two confirmed Sessions in one Workspace, reopen each exact identity,
   refresh the tab, and verify neither creation deletes or replaces the other.
2. Start a server-acknowledged turn in A, create B, and verify A's owner socket
   remains open while its status and terminal result stay out of B's timeline.
3. Hold the next `turn/start` acknowledgement and verify the composer says
   Starting. `Stop` is absent and `/stop` sends no interrupt. One New Session
   click is queued without sending `session/open`, then runs automatically after
   release. A replay-lossy recovery whose hydrate already proves that exact turn
   active must release the same intent after recovery becomes ready, without
   waiting forever for the superseded RPC reply. If the same hydrate restores a
   pending approval or question, the parked Session must project **Waiting**,
   not a stale **Working** state.
4. Click several existing targets while the acknowledgement is held and verify
   latest-wins with exactly one candidate open. Cancelling the pending banner or
   rejecting the start clears the intent and leaves the source Session active.
5. Reject the candidate `session/open` after accepting the start and verify the
   handoff rolls back: the source remains selected, its owner socket stays open,
   its turn completes in the foreground, and a later retry succeeds.

The queue state machine, prepare-window terminal race, candidate transaction,
and eight-owner capacity exchange remain deterministic unit-test concerns.
Closing an owner socket in the fixture must produce the same durable
`connection_closed` result as Core rc.9, so a transport-preservation regression
cannot pass accidentally. The opt-in live gate supplies the real Core/model
proof for persisted output and hydrate after refresh.

The fixture exposes one-shot `/__test__/turn-start/hold-next`, `state`,
`release`, `reject`, and `reset` controls for this sequence. Product tests poll
the explicit held state and release or reject it themselves; they must not use a
short artificial acknowledgement timeout, a second UI click, or `Stop` as proof
that Core accepted the start. The one-shot `/__test__/session-open/reject-next`
control exercises candidate rollback without changing any production protocol.

## Opt-in live model gate

The live gate is intentionally separate from CI because it consumes a real
provider and mutates a real server workspace. It runs the production Web client
against a developer-supplied Core proxy, creates a fresh opaque Web Session,
requires the effective runtime model id to be exactly `glm-5.3-flash`, performs
one bounded file edit/read turn, and reloads the page to prove same-tab restore
plus durable server hydrate. It does not configure, change, or infer the active
Profile default. Set the Profile default through Core first and restart Octos
when required; the Session-runtime label must already report GLM-5.3-Flash
before the turn begins.

The gate disables Playwright traces, screenshots, and video so the tab-scoped
auth token cannot enter test artifacts. Its launcher also disables Playwright's
automatic failure-page accessibility snapshot before the worker starts because
that snapshot can serialize password field values.

Supply all four values explicitly:

```sh
OCTOSCODE_LIVE_PROXY_TARGET=http://127.0.0.1:18031 \
OCTOSCODE_LIVE_PROXY_ORIGIN=https://octoscode-web.example \
OCTOSCODE_LIVE_TOKEN='<ephemeral server token>' \
OCTOSCODE_LIVE_WORKSPACE=/absolute/path/on/server \
pnpm test:e2e:live
```

`OCTOSCODE_LIVE_PROXY_ORIGIN` must be an Origin that Core explicitly allows
(normally the deployed Web origin), not merely the local preview URL. The Vite
proxy rewrites the WebSocket Origin to this value; an untrusted local Origin is
expected to fail the handshake with 403.

There is no Session-id input: the product creates one through the same Add
workspace flow used by a person. The environment supplies a server path, not a
browser-owned Workspace record.

Model-settings changes need deterministic unit and product-fixture coverage for
capability-gated read/edit, exact-draft Test/Save, model discovery with manual
fallback, delete confirmation, Profile-default selection, and secret
non-retention. Those tests must use a fake provider; only the opt-in live gate
may spend a real credential.

The live gate builds `apps/web/dist` first and serves that production artifact
through Vite preview. `OCTOSCODE_DEV_PROXY_TARGET` and
`OCTOSCODE_DEV_PROXY_ORIGIN` configure only the local Vite dev/preview proxy;
they are absent from the built JavaScript and from a deployed static host. The
origin override is necessary when a local SSH tunnel reaches a Core that trusts
the deployed Web origin. Do not put tokens in either proxy variable, shell
history, committed files, or Playwright configuration.

## Flake triage

Do not weaken an assertion solely because it failed once. Re-run the smallest
test, inspect `test-results/` and `playwright-report/`, then decide whether the
assertion observes a product invariant or incidental markup. Text and role
assertions are preferred over exact syntax-highlighter span boundaries. A CI E2E
failure uploads both Playwright outputs for seven days.
