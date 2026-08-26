# Releasing

Releases are immutable static archives. The tag is the identity and must not be
moved or reused.

1. Update `CHANGELOG.md` and verify the intended Core contract/runtime pins.
2. Run `pnpm check`, `pnpm test:e2e`, and the real-Core integration.
3. Create and push a SemVer-like tag such as `v0.1.0` or `v0.1.0-rc.3`.
4. Let the release workflow verify, package, and upload; do not create the
   GitHub release manually.
5. Verify the SHA-256 and GitHub artifact attestation before promotion.

The workflow separates verification from publication. The verification job has
read-only repository access. Only the final job receives release and OIDC
authority; it attests the exact archive/checksum pair and refuses to replace an
existing release. A failed publication remains a draft when possible, making
recovery explicit instead of silently clobbering assets.

Rollback serves a previous immutable archive. It does not migrate or delete
server-owned Octos sessions.
