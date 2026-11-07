# Contributing

octoscode-web is the focused browser sibling of Octoscode. Start with the
[`documentation index`](docs/README.md). Before changing a flow, read
[`AGENTS.md`](AGENTS.md), [`docs/architecture.md`](docs/architecture.md),
[`docs/protocol.md`](docs/protocol.md), and the relevant ADR. Octoscode is the
interaction-semantics source; DSH is the product/visual reference; Octos Core
remains the runtime authority.

## Development

Use Node.js 22 and pnpm 11.5.2:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm mock:server` runs the deterministic browser fixture. Protocol changes must
also pass `pnpm contract:verify`. Compatibility changes should run the
checksummed pinned runtime gate described in
[`docs/protocol.md`](docs/protocol.md#compatibility-gates).

## Change rules

- Keep transport and strict wire decoders in the React-free client package.
- Put product state and presentation in a focused feature directory; prefer
  colocated CSS Modules over expanding the global stylesheet.
- Gate optional controls on negotiated methods/features and fail closed on
  malformed safety-bearing payloads.
- Never persist auth tokens to `localStorage`; only the tab-scoped connection
  preference boundary may retain them in `sessionStorage`. Provider API keys
  remain memory-only. Do not add credentials to test fixtures, logs,
  screenshots, issues, or crash diagnostics.
- Preserve server-owned session, permission, diff, task, and replay truth.
- Add unit coverage for decoders/reducers and a browser flow for material user
  behavior. Keep accessibility assertions on blocking surfaces.
- Test lines may not grow on net: the `check` job compares a pull request's test
  lines with its base and fails on any increase
  (`node scripts/test-growth.mjs --base origin/main` shows the same numbers
  locally). Pay for a new test by deleting as much elsewhere, or ask a
  maintainer (alan0x, BH3GEI, ymote) to add the `test-growth-approved` label.
- [`apps/web/TESTS-KEPT.md`](apps/web/TESTS-KEPT.md) lists the apps/web unit
  tests that stay, each with its category and what it guards; apps/web unit
  tests not on it are slated for deletion.
- Record a new architectural decision when a change introduces a durable
  boundary or rejects a plausible alternative.
- Preserve third-party notices for copied or substantially adapted code.

Generated Core vocabulary is updated with `pnpm contract:update` only after
changing the immutable source pin. Review the generated diff and keep payload
generation work aligned with upstream Core schema issues.
