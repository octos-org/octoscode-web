# ADR 0014: Pinned Core runtime smoke

## Decision

The browser fixture remains useful for deterministic product flows, but it is
not the compatibility authority. CI and tagged releases also download one
explicit Octos release asset, verify its published SHA-256, start a real
`octos serve` against isolated state and workspace directories, and exercise
the browser-facing AppUI transport.

`packages/client/core-runtime.json` is the machine-readable runtime baseline.
It records the release tag, commit, platform assets, required Web methods and
features, and newer workspace methods that the client can adopt when a server
advertises them. It is separate from `contract-source.json`: the latter may pin
a newer immutable source revision for generated vocabulary while the runtime
gate must pin an actually downloadable, checksummed binary.

The smoke covers public health, protocol negotiation, no-profile launch,
local-solo profile bootstrap, a non-routable placeholder model configuration,
the exact Octoscode TUI coding session id, hydrate, permissions, task
supervision, and session status. It never starts a model turn or contacts the
placeholder model endpoint.

## Consequences

- A green mock suite can no longer hide an incompatible shipped Core binary.
- Runtime capability absence remains visible. The pinned rc.9 baseline does
  not advertise the forward workspace methods (`session/list`,
  `session/delete`, and `session/files.list`), so those surfaces continue to
  fail closed until a compatible server advertises them.
- Core downloads add roughly 80 MB and a slower independent CI job. The job is
  intentionally separate from fast checks and has a checksum before extract.
- The smoke workspace lives under an OS-created temporary directory. It cannot
  write `.octos` state into the repository under test.
