# Testing and verification

Use the smallest gate that proves the change while developing, then run the
complete gate before review.

| Gate                  | Command                                         | Proves                                                  |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Unit                  | `pnpm test`                                     | parsers, reducers, state machines, and components       |
| Types and lint        | `pnpm typecheck && pnpm lint`                   | package boundaries and exhaustive cases                 |
| Repository policy     | `pnpm policy:verify`                            | UI tokens, style ownership, and ADR metadata            |
| Product browser       | `pnpm test:e2e`                                 | launch, recovery, interactions, responsive layout, WCAG |
| Live model (opt-in)   | `pnpm test:e2e:live`                            | real Core, provider, tools, durable turn, and refresh   |
| Generated contract    | `pnpm contract:verify`                          | Core vocabulary matches the immutable source pin        |
| Released Core runtime | `OCTOS_BINARY=/abs/octos pnpm integration:core` | a matching released Core completes the critical flow    |
| Deployment            | `pnpm build && pnpm deploy:verify`              | artifact, CSP, nginx contract, and size budgets         |
| Complete local gate   | `pnpm check`                                    | all deterministic non-browser gates                     |

Install Chromium once with `pnpm exec playwright install chromium`. E2E owns its
fixture and Vite ports; it deliberately refuses to reuse an existing server so a
developer's real Octos process cannot make a fixture test pass. Set
`OCTOSCODE_E2E_FIXTURE_PORT` and `OCTOSCODE_E2E_WEB_PORT` when the defaults are
occupied; the configured fixture origin is injected into the app.

## Opt-in live model gate

The live gate is intentionally separate from CI because it consumes a real
provider and mutates a real server workspace. It runs the production Web client
against a developer-supplied Core proxy, verifies the server-selected model,
performs one bounded file edit/read turn, and reloads the page to prove durable
recovery. It disables Playwright traces, screenshots, and video so the
tab-scoped auth token cannot enter test artifacts.

Supply all five values explicitly:

```sh
OCTOSCODE_LIVE_PROXY_TARGET=http://127.0.0.1:18031 \
OCTOSCODE_LIVE_PROXY_ORIGIN=https://octoscode-web.example \
OCTOSCODE_LIVE_TOKEN='<ephemeral server token>' \
OCTOSCODE_LIVE_WORKSPACE=/absolute/path/on/server \
OCTOSCODE_LIVE_SESSION_ID=coding:api:web-live-e2e-001 \
pnpm test:e2e:live
```

`OCTOSCODE_DEV_PROXY_TARGET` and `OCTOSCODE_DEV_PROXY_ORIGIN` are wired only
into Vite's development server. They are absent from production builds. The
origin override is necessary when a local SSH tunnel reaches a Core that trusts
the deployed Web origin. Do not put tokens in either proxy variable, shell
history, committed files, or Playwright configuration.

## Flake triage

Do not weaken an assertion solely because it failed once. Re-run the smallest
test, inspect `test-results/` and `playwright-report/`, then decide whether the
assertion observes a product invariant or incidental markup. Text and role
assertions are preferred over exact syntax-highlighter span boundaries. A CI E2E
failure uploads both Playwright outputs for seven days.
