# Getting started

octoscode-web is a static browser client. For normal use it connects to an
already-running `octos serve`; for product development it can connect to the
repository's narrow fixture server.

## Requirements

- Node.js 22 or newer
- pnpm 11.5.2
- Chromium only when running the browser test suite

Install the workspace exactly from the lockfile:

```sh
pnpm install --frozen-lockfile
```

## Connect to Octos

1. Start a compatible `octos serve` on the machine that owns the workspace.
2. Start the Web development server:

   ```sh
   pnpm dev
   ```

3. Open the displayed local URL. The connection gate has two fields:

   | Field         | Meaning                                                             |
   | ------------- | ------------------------------------------------------------------- |
   | Server origin | HTTP(S) origin for the Octos server.                                |
   | Auth token    | Credential when the server requires one; retained only in this tab. |

4. Select **Connect**. Authentication happens before work selection; there are
   no Workspace path, profile, or Session identity fields on this screen.
5. In the product sidebar, select **New Session** and choose a known Workspace.
   To use another repository, select **Add workspace** and enter its path on the
   **Octos server host**, not the browser device. Add workspace validates that
   path and creates a fresh Session; it is not Workspace-registry CRUD.
6. Select any Session this tab has already confirmed to reopen it. Chat and
   Trajectory both follow the selected Session. Multiple Sessions can share the
   same Workspace path without replacing one another. Do not assume the list is
   complete on Core rc.9; unscoped/admin connections can misroute a known-path
   list to the wrong Profile (octos#2146).

Workspace is the coding object that groups Sessions for one server path. Core
validates and canonicalizes that path and owns every durable Session. For New
Session, the browser generates a fresh opaque Web identity behind the product
flow and Core creates the durable ledger; users never enter an id.

Current Core builds do not provide a complete server-wide Workspace catalog. In
the current tab, the sidebar remembers a bounded list of recent server paths and
the minimal Workspace/Profile/Session routing tuples returned by successful
opens. A local recency timestamp orders those confirmed rows. Session titles,
prompts, transcripts, model output, and other durable projections never enter
that cache.

Core rc.9 can lose the requested Profile or silently ignore cwd on an
unscoped/admin list call, and its response does not report the effective scope.
The Web therefore does not project those rows as a catalog. It shows only
Sessions this tab has successfully opened, while a recent path remains an entry
point for a new Session. Recents and confirmed refs have no individual
edit/remove action and never become a second database. The missing Core object
contract is tracked in
[octos#2146](https://github.com/octos-org/octos/issues/2146).

## Switch Sessions while a turn is running

After Core acknowledges a turn started by this tab, you can select another
Session or create one in the same or another Workspace. The original Session
continues to show its running or waiting status in the sidebar, and selecting it
again restores its authoritative hydrate/replay projection. Browser-local queued
prompts cannot move with that owner socket, and a `turn/start` whose
acknowledgement has not arrived has ambiguous ownership, so either state blocks
navigation until it settles.

This is same-live-tab continuation, not a detached server job. Refreshing or
closing the tab, losing the WebSocket through a network or proxy failure, or
selecting **Disconnect** closes the rc.9 owner socket and terminates a
still-running turn. Disconnect keeps the current tab's confirmed Session refs
for reconnect. **Forget server** and endpoint/token identity changes clear those
refs, recent Workspace paths, and in-memory drafts.

For a fresh Web Session, an unambiguous `activate` result opens automatically
with Core's resolved Profile. A `cross_profile` result still asks which Profile
to use, and `no_profile` still opens onboarding or the truthful TUI fallback.

The active Session's permission control and effective runtime model are in the
composer footer. Full access appears only when advertised and requires a risk
acknowledgement. The runtime-model label is status, not a Session-level model
selector. Open **Settings** at the bottom of the sidebar for General connection
details, **Disconnect**, **Forget server**, or Models.

## Configure providers and models

**Settings → Models** reads the active Profile's configured primary and fallback
entries from Core. Depending on the connected server's advertised methods, it
can be read-only or expose these actions:

1. Select **Add provider** or edit one configured row. Enter the provider
   family, model id, route id/label, base URL, credential environment name, and
   API protocol. Catalog and discovered values are suggestions; the model id can
   still be entered manually.
2. Enter an API key only when adding or replacing one. A configured route
   reopens with a blank password field and a configured indicator because Core
   does not return the saved value. Leaving it blank preserves the Core-owned
   key.
3. **Test** probes the exact draft. **Fetch models** asks that provider/route
   for suggestions and can be unavailable even when direct inference works.
   Editing the draft invalidates its prior test result.
4. **Save** tests that same draft again before it upserts the Profile. Set it as
   the Profile default when that is the intended cross-Session change. Delete
   removes the exact configured route after confirmation.

The browser keeps a typed key only for the current request; it does not write
provider keys to browser storage. Core owns any saved key and exposes only
whether one is configured. This is a write-only protocol property, not a claim
that every Core platform encrypts its credential store.

The **Session runtime** row remains authoritative for the model actually served
by the current process. **Profile default** is configuration shared by Sessions
on that Profile. A changed default may require an Octos restart and is not a
Session override. The current AppUI contract cannot persist `temperature`,
`top_p`, maximum-token/context values, or reasoning controls, so those fields
are intentionally absent from Web Settings.

### GLM-5.3-Flash

The exact API model id is `glm-5.3-flash` (lowercase). A normal Z.AI API account
uses the OpenAI-compatible base URL `https://api.z.ai/api/paas/v4`; the
dedicated Coding Plan base URL is `https://api.z.ai/api/coding/paas/v4`. See the
official
[GLM-5.3-Flash model page](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)
for current model behavior.

The GLM Coding Plan is contractually limited to Z.AI's
[listed supported tools](https://docs.z.ai/devpack/tool/others), and Octos is
not currently named there. Use a normal API key/endpoint for Octos unless Z.AI
has separately authorized this integration. Endpoint compatibility alone does
not grant Coding Plan usage rights.

An empty solo server can offer profile and provider onboarding after a Workspace
is selected. Provider data comes from Core, the credential is tested before
saving, and the API key is never written to browser storage. Older servers
display the canonical `octoscode onboard` fallback instead.

After a successful connection, refreshing the same tab reopens the established
Session. Only the server origin is durable. The token, auto-connect marker,
selected Session/Workspace/Profile restore hints, recent Workspace paths, and
confirmed Session refs are bound to that endpoint and token in tab-scoped
`sessionStorage`; closing the tab forgets all of them. **Disconnect** keeps the
endpoint and current tab navigation data but stops automatic reconnection and
terminates live owner transports; **Forget server** clears both storage scopes.

## Run the product fixture

The fixture is useful for interface work and deterministic browser flows. It
implements only the protocol slice used by this repository; it is not proof of
compatibility with Octos Core.

Run these commands in separate terminals:

```sh
pnpm mock:server
```

```sh
pnpm dev
```

Use the fixture origin shown in its terminal output. The fixture contains a
representative Markdown/code transcript, approvals, questions, task output,
artifacts, and session state.

## Common commands

| Command                 | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`              | Start the Vite development server.                                             |
| `pnpm mock:server`      | Start the deterministic AppUI fixture.                                         |
| `pnpm check`            | Format-check, lint, typecheck, unit-test, build, and verify deployment output. |
| `pnpm test:e2e`         | Run Chromium product and accessibility flows.                                  |
| `pnpm contract:verify`  | Verify generated vocabulary against the pinned Core source blob.               |
| `pnpm integration:core` | Exercise an explicitly supplied, pinned real Core binary.                      |

Install Chromium once before the E2E suite:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

To run the real-Core gate locally, point at the binary that matches
`packages/client/core-runtime.json`:

```sh
OCTOS_BINARY=/absolute/path/to/octos pnpm integration:core
```

The gate starts isolated temporary state and does not make an external model
turn. Its local provider fixture exercises catalog, credential testing, and
profile save without contacting a model service.

## Browser and credential constraints

- A browser cannot spawn the Octos binary.
- Browser WebSockets cannot attach an `Authorization` header. The current
  endpoint accepts a query token, so use HTTPS/WSS outside loopback and keep
  query strings out of proxy logs.
- Auth tokens are never written to `localStorage`; they may survive refresh in
  the current tab's `sessionStorage`. Provider API-key drafts remain memory-only
  and are never written to browser storage; after Save, Core owns the credential
  and returns only whether it is configured.
- Unsupported methods and malformed safety-bearing payloads fail closed.

For production hosting, continue with the [deployment contract](deployment.md).
For protocol behavior, see [Protocol integration](protocol.md).
