# Documentation

This directory explains the product as a browser client, how to work on it, and
why its durable boundaries exist. Start with the shortest document that answers
your question.

## Use and operate

| Document                              | Purpose                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| [Getting started](getting-started.md) | Connect, choose a Workspace, start a Session, or use the fixture. |
| [Product scope](product.md)           | Supported workflows, product principles, and explicit non-goals.  |
| [Deployment contract](deployment.md)  | Build identity, hosting, security headers, health, and rollback.  |
| [Troubleshooting](troubleshooting.md) | Connection, recovery, onboarding, and command diagnostics.        |
| [Security policy](../SECURITY.md)     | Supported versions and private vulnerability reporting.           |

## Understand and change

| Document                                                                                   | Purpose                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [Architecture](architecture.md)                                                            | Runtime ownership, dependency direction, state, and extension boundaries. |
| [Protocol integration](protocol.md)                                                        | Capability negotiation, projections, Core pins, and compatibility gates.  |
| [ADR index](adr/README.md)                                                                 | Accepted decisions, grouped by concern.                                   |
| [Product shell ADR](adr/0018-dsh-aligned-product-shell.md)                                 | Authentication, Workspace/Session navigation, and controls.               |
| [Session navigation ADR](adr/0019-tab-session-navigation-and-background-turn-ownership.md) | Confirmed Session refs and background turn ownership.                     |
| [Contributing](../CONTRIBUTING.md)                                                         | Development workflow and review expectations.                             |
| [Testing](testing.md)                                                                      | Unit, browser, contract, runtime, and deployment verification.            |
| [Releasing](releasing.md)                                                                  | Immutable publication, provenance, and rollback procedure.                |
| [Agent guide](../AGENTS.md)                                                                | Non-negotiable repository rules for coding agents.                        |

## Project records

- [Changelog](../CHANGELOG.md) — release-level user and operator changes.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) — copied or adapted source
- [Production dependency licenses](../THIRD_PARTY_LICENSES.md) — generated
  license material for the shipped JavaScript graph attribution, including the
  DSH visual reference.
- [Release history](https://github.com/octos-org/octoscode-web/releases) —
  immutable archives, checksums, and release notes.

## Documentation conventions

- Guides describe the current system. Update them in the same change as the
  behavior they document.
- ADRs record durable decisions and rejected alternatives. Do not rewrite an
  accepted decision to make history look current; supersede it with a new ADR.
- Machine-readable compatibility truth belongs in
  `packages/client/contract-source.json` and
  `packages/client/core-runtime.json`, not in prose version claims.
- Security-sensitive examples must not contain real tokens, API keys, private
  repository paths, or credential-bearing WebSocket URLs.
