# Testing and verification

Use the smallest gate that proves the change while developing, then run the
complete gate before review.

| Gate                  | Command                                         | Proves                                                  |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Unit                  | `pnpm test`                                     | parsers, reducers, state machines, and components       |
| Types and lint        | `pnpm typecheck && pnpm lint`                   | package boundaries and exhaustive cases                 |
| Repository policy     | `pnpm policy:verify`                            | UI tokens, style ownership, and ADR metadata            |
| Product browser       | `pnpm test:e2e`                                 | launch, recovery, interactions, responsive layout, WCAG |
| Generated contract    | `pnpm contract:verify`                          | Core vocabulary matches the immutable source pin        |
| Released Core runtime | `OCTOS_BINARY=/abs/octos pnpm integration:core` | a matching released Core completes the critical flow    |
| Deployment            | `pnpm build && pnpm deploy:verify`              | artifact, CSP, nginx contract, and size budgets         |
| Complete local gate   | `pnpm check`                                    | all deterministic non-browser gates                     |

Install Chromium once with `pnpm exec playwright install chromium`. E2E owns its
fixture and Vite ports; it deliberately refuses to reuse an existing server so a
developer's real Octos process cannot make a fixture test pass. Set
`OCTOSCODE_E2E_FIXTURE_PORT` and `OCTOSCODE_E2E_WEB_PORT` when the defaults are
occupied; the configured fixture origin is injected into the app.

## Flake triage

Do not weaken an assertion solely because it failed once. Re-run the smallest
test, inspect `test-results/` and `playwright-report/`, then decide whether the
assertion observes a product invariant or incidental markup. Text and role
assertions are preferred over exact syntax-highlighter span boundaries. A CI E2E
failure uploads both Playwright outputs for seven days.
