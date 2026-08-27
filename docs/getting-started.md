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

3. Open the displayed local URL and complete the connection panel:

   | Field          | Meaning                                                                     |
   | -------------- | --------------------------------------------------------------------------- |
   | Server origin  | HTTP(S) origin that exposes the Octos AppUI endpoint.                       |
   | Auth token     | Optional server credential; retained only for the current browser tab.      |
   | Workspace path | Path on the **server host**, not on the browser device.                     |
   | Session id     | Advanced fallback identity for servers without workspace launch resolution. |

When Core supports `launch/resolve`, the server decides whether to resume,
activate, or select a profile for the workspace. An empty solo server can also
offer profile and provider onboarding in the browser. Provider data comes from
Core, the credential is tested before saving, and the API key is never written
to browser storage. Older servers display the canonical `octoscode onboard`
fallback instead.

After a successful connection, refreshing the same tab reopens the exact
established session. The browser remembers non-secret connection fields across
browser restarts. The auth token and auto-connect marker use tab-scoped
`sessionStorage`, so closing the tab forgets the credential. **Forget
connection** clears both scopes explicitly.

The product hierarchy is runtime connection → workspace → session. “Workspace”
is the Octoscode/Web name for the object that groups coding sessions by a path.
The path is on the `octos serve` host; a remote browser cannot open a local
directory picker for it. The server canonicalizes the path and returns the
authoritative workspace root.

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
