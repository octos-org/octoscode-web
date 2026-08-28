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
6. When Core returns an existing Session row with a usable identity, select it
   to resume it. Chat and Trajectory both follow the selected Session. Do not
   assume the list is complete on Core rc.9; unscoped/admin connections can
   misroute a known-path list to the wrong Profile (octos#2146).

Workspace is the coding object that groups Sessions for one server path. Core
validates and canonicalizes that path and owns every durable Session. For New
Session, the browser generates a fresh opaque Web identity behind the product
flow and Core creates the durable ledger; users never enter an id.

Current Core builds do not provide a complete server-wide Workspace catalog. In
the current tab, the sidebar remembers only a bounded list of recent server
paths. No Session ids, titles, prompts, or projections live in that cache. Core
rc.9 can lose the requested Profile or silently ignore cwd on an unscoped/admin
list call, and its response does not report the effective scope. The Web does
not project those rows: only the active/restored Session is shown, while a
recent path starts a new Session. Recents have no individual edit/remove action
and never become a second database. The missing Core object contract is tracked
in [octos#2146](https://github.com/octos-org/octos/issues/2146).

The active Session's permission control and effective runtime model are in the
composer footer. Full access appears only when advertised and requires a risk
acknowledgement. The runtime-model label is status, not a Session-level model
selector. Open **Settings** at the bottom of the sidebar for General connection
details, **Disconnect**, **Forget server**, or Models. The Models section
manages the active Profile default, which affects all Sessions using that
Profile and may require an Octos restart.

An empty solo server can offer profile and provider onboarding after a Workspace
is selected. Provider data comes from Core, the credential is tested before
saving, and the API key is never written to browser storage. Older servers
display the canonical `octoscode onboard` fallback instead.

After a successful connection, refreshing the same tab reopens the established
Session. Only the server origin is durable. The token, auto-connect marker,
active Session/Workspace/Profile restore hints, and recent Workspace paths are
bound to that endpoint in tab-scoped `sessionStorage`; closing the tab forgets
all of them. **Disconnect** keeps the endpoint and current tab data but stops
automatic reconnection; **Forget server** clears both storage scopes.

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
  the current tab's `sessionStorage`. Provider API keys remain memory-only and
  are never written to browser storage.
- Unsupported methods and malformed safety-bearing payloads fail closed.

For production hosting, continue with the [deployment contract](deployment.md).
For protocol behavior, see [Protocol integration](protocol.md).
