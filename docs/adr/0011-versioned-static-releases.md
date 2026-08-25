# ADR 0011: Versioned static releases

## Status

Accepted.

## Decision

Release `octoscode-web` as an immutable static archive from a SemVer-like Git
tag. A tag build repeats the complete check and Chromium E2E gates, embeds its
release/source/Core-contract identity in a machine-readable build manifest,
and publishes both the archive and a SHA-256 file.

The Web release remains independent from Octos Core. Compatibility is decided
by protocol capabilities at connection time; the embedded Core revision states
what was tested, not a required server version. A future generated contract and
paired compatibility matrix can strengthen that statement without changing the
artifact format.

## Consequences

- Deployments and bug reports can identify the exact Web and protocol inputs.
- A static host or Octos packaging job can consume the same artifact.
- Release tags are immutable and require all product gates to pass.
- Publishing an OCI image or embedding the client in Octos remains a separate
  distribution decision.
