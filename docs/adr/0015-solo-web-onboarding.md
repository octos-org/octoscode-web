# ADR 0015: Solo Web onboarding

- Status: Accepted
- Date: 2026-08-26

## Decision

A browser connected to an empty `octos serve --solo` must be able to reach a
coding session without switching to the TUI. On a `launch/resolve` `no_profile`
decision, octoscode-web offers a focused version of Octoscode's local onboarding
when the server advertises all of these methods:

- `profile/local/create`
- `profile/llm/catalog`
- `profile/llm/test`
- `profile/llm/upsert`

The server catalog is authoritative. The Web does not ship provider or model
tables. The user chooses a nameable local profile, provider family, model, and
route; the Web creates the profile, tests the exact selection and credential,
saves only after a successful test, then opens `<profile>:local:tui#coding` in
the selected workspace.

The API key is transient React form state. It is not written to local storage,
session storage, URLs, telemetry, diagnostics, or controller state. Surfaced
server errors replace the exact submitted secret and are length bounded. The
root crash boundary applies its independent credential redaction as a second
line of defense.

Families with an empty catalog key environment are rendered as keyless, just as
Octoscode does. The pinned Core still requires a non-empty value in
`profile/llm/test` for those families
([octos#2123](https://github.com/octos-org/octos/issues/2123)). Until that
server mismatch is fixed, the Web sends a fixed non-secret probe value; because
the selection has no key environment, `profile/llm/upsert` does not persist it.
This compatibility shim is isolated in the onboarding controller and should be
deleted with the Core fix.

Profile creation and provider provisioning are not one atomic server command. If
creation succeeds but test or save fails, the controller retains only the
created profile id and retries provisioning without recreating the profile.
Changing identity after that boundary requires reconnecting, which makes the
partial state explicit.

If any onboarding method is absent, the catalog is malformed, or the runtime is
not configured for this surface, the client fails closed and preserves the
canonical `octoscode onboard` server-side fallback. It does not infer models,
invent routes, or bypass provider testing.

## Why this boundary

The Web remains a client of the existing runtime: it does not install Octos,
start a daemon, own model configuration, or create a second harness. This closes
the practical browser-only first-run gap while preserving Octoscode's profile
identity, server-owned catalog, tested-provider rule, and session identity.

The four method literals currently live in the `octos-cli` AppUI transport and
are not exported by the generated Core vocabulary. They are isolated in the
React-free client with strict decoders and capability checks. Once Core exports
them in its machine-readable contract, generation must replace this temporary
vocabulary rather than creating a second compatibility lane.

## Verification

Unit tests reject malformed catalog and result payloads and check deterministic
route projection. The browser suite exercises a failed provider test with
credential redaction, partial-profile retry, successful save, exact TUI session
open, and WCAG 2/2.1 A/AA checks. The pinned real-Core gate loads the real
catalog and completes test/save against an isolated loopback provider fixture.
