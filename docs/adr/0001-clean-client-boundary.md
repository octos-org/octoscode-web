# ADR 0001: Build a focused sibling client

Status: accepted, 2026-08-26.

## Decision

Create `octos-org/octoscode-web` as a new repository. It is a sibling of the
Rust `octoscode` TUI and speaks the same server-owned AppUI/UI Protocol.

We will not fork-prune `octos-web`. Coding-adjacent behavior may be extracted
only as small, audited modules or fixtures with preserved history and license.

## Why

The existing dashboard combines chat with voice/video, Learn, Studio, slides,
sites, smart home, admin, login, and extensive settings. Its chat path crosses
large bridge, router, runtime, compatibility-store, and product-shell closures.
There is no standalone coding workspace directory to split.

A new client gives coding workflows their own product boundary while retaining
the valuable server contract and durable event semantics.

## Consequences

- The server and protocol, not the old SPA, are the integration boundary.
- We must build durable replay and approvals correctly before calling the app a
  production coding client.
- Generic protocol/projection code should eventually be shared by both Web
  clients instead of copied between them.
