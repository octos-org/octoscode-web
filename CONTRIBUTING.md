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

`pnpm mock:server` runs the deterministic browser fixture. Protocol changes
must also pass `pnpm contract:verify`. Compatibility changes should run the
checksummed pinned runtime gate described in
[`docs/protocol.md`](docs/protocol.md#compatibility-gates).

## Change rules

- Keep transport and strict wire decoders in the React-free client package.
- Put product state and presentation in a focused feature directory; prefer
  colocated CSS Modules over expanding the global stylesheet.
- Gate optional controls on negotiated methods/features and fail closed on
  malformed safety-bearing payloads.
- Do not persist auth tokens or API keys, and do not add credentials to test
  fixtures, logs, screenshots, issues, or crash diagnostics.
- Preserve server-owned session, permission, diff, task, and replay truth.
- Add unit coverage for decoders/reducers and a browser flow for material user
  behavior. Keep accessibility assertions on blocking surfaces.
- Record a new architectural decision when a change introduces a durable
  boundary or rejects a plausible alternative.
- Preserve third-party notices for copied or substantially adapted code.

Generated Core vocabulary is updated with `pnpm contract:update` only after
changing the immutable source pin. Review the generated diff and keep payload
generation work aligned with upstream Core schema issues.
