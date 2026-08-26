# ADR 0014: Pinned Core runtime smoke

- Status: Accepted
- Date: 2026-08-26

## Decision

The browser fixture remains useful for deterministic product flows, but it is
not the compatibility authority. CI and tagged releases also download one
explicit Octos release asset, verify its published SHA-256, start a real
`octos serve` against isolated state and workspace directories, and exercise the
browser-facing AppUI transport.

`packages/client/core-runtime.json` is the machine-readable runtime baseline. It
records the release tag, commit, platform assets, required Web methods and
features, the complete optional solo-onboarding method set, and newer workspace
methods that the client can adopt when a server advertises them. It is separate
from `contract-source.json`: the latter may pin a newer immutable source
revision for generated vocabulary while the runtime gate must pin an actually
downloadable, checksummed binary.

The smoke covers public health, protocol negotiation, no-profile launch,
local-solo profile bootstrap, the provider catalog, provider test and save, the
exact Octoscode TUI coding session id, hydrate, permissions, task supervision,
and session status. A loopback OpenAI-compatible fixture proves that
`profile/llm/test` sends the expected authenticated request and accepts a valid
response. It never starts an agent turn or contacts an external model service.

## Consequences

- A green mock suite can no longer hide an incompatible shipped Core binary.
- Runtime capability absence remains visible. The pinned rc.9 baseline does not
  advertise the forward workspace methods (`session/list`, `session/delete`, and
  `session/files.list`), so those surfaces continue to fail closed until a
  compatible server advertises them.
- Core downloads add roughly 80 MB and a slower independent CI job. The job is
  intentionally separate from fast checks and has a checksum before extract.
- The smoke workspace lives under an OS-created temporary directory. It cannot
  write `.octos` state into the repository under test.
