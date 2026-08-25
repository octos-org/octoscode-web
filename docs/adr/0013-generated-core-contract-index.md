# ADR 0013: Generated Core contract index

## Status

Accepted as an intermediate boundary; generated request/result types remain
required.

## Context

Octos Core does not currently emit JSON Schema or TypeScript for its AppUI
contract. Copying method and feature strings into a Web client already caused a
real drift: the fixture advertised `octos.ui.v1` and capability schema 1 while
the pinned Core source declares `octos-ui/v1alpha1` and capability schema 2.

## Decision

Generate the protocol identity, method registry, feature registry, server
method list, and notification list directly from an exact
`crates/octos-core/src/ui_protocol.rs` Git blob. The sync script:

- reads the full upstream commit, blob, and path from
  `packages/client/contract-source.json`;
- downloads that immutable revision or accepts an explicit local source path;
- recomputes the Git blob SHA before parsing;
- refuses suspiciously small or unresolved registries;
- produces a deterministic checked-in TypeScript index;
- fails CI and releases when the checked-in result differs.

Production request methods, requested features, build metadata, and golden
fixtures consume this index. Handwritten payload decoders remain narrow and
fail closed.

## Consequences

- Protocol vocabulary and release identity can no longer drift silently.
- Updating the Core pin is an explicit, reviewable generated diff.
- This is not full type generation. Rust request/result/event shapes can still
  drift until Core exports a machine-readable schema or a generator derives
  those shapes from Rust. Golden payload fixtures continue to guard that gap.
