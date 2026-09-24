# Changelog

## Unreleased

## v0.11.0-rc.2 — 2026-09-24

- Rebuild the 0.11.0 candidate from its tagged source. The rc.1 artifact was
  withdrawn because its build revision did not match its tag.
- Validate the browser client against Octos v2.0.3-rc.13 and pin that Core
  runtime and UI Protocol contract for this release. The Core update keeps local
  Solo Sessions in-process when its profile watcher runs.

## v0.11.0-rc.1 — 2026-09-24

- Stop a local `octos serve --solo` from Settings when the server advertises
  `server/shutdown`: a confirmation dialog guards the stop, a failure keeps the
  session connected, and success disconnects the tab to the connect screen.
- Preserve unsent drafts across same-tab refresh, isolate them by sign-in and
  Session, and report browser storage failures without silently losing editing
  state.
- Keep earlier drafts at the cache limit and make failed Forget operations
  visible, including browsers that reject storage reads or deletions.
- Add unread tab counts and explicitly enabled desktop notifications for hidden
  or background responses; suppress historical/repeated notifications.
- Improve diff review with syntax highlighting and conservative word changes,
  retaining full raw text when highlighting is unavailable or the preview is
  large.
- Bound silent connection handshakes and consume newer Core canonical hydrate
  replay without changing attached execution or old-server capabilities.
- Add continuous Firefox/WebKit critical-flow checks alongside the Chromium
  suite.

- Preserve active work, drafts and queued messages when an optional view fails
  to load; make modal loading cancellable and keep recovery actions available.
- Resolve uncertain turns through the advertised status query without automatic
  resends; retain their records across reconnect and block unsafe navigation.
- Correct late-response/socket ownership and queue settlement ordering, and
  preserve canonical transcript text and terminal states.
- Improve direct workspace entry, mobile navigation and control reachability,
  IME editing, nested modal focus, queued-message removal and reader-controlled
  transcript scrolling and disclosures.
- Keep received conversation history available through incremental expansion,
  support confirmed cross-browser conversation links, and report clipboard
  results truthfully without writing late feedback into another session.
- Run the complete interaction and visual browser suite in pull-request CI;
  retain the existing JavaScript, CSS and long-frame budgets.

- Restore a successful runtime/workspace/session connection across refresh with
  tab-scoped credential retention, explicit forgetting, and canonical
  server-returned identity.
- Replace client-entered protocol ids with a profile-neutral `web-<uuid>` launch
  intent, then bind it to `<resolved-profile>:api:web-<uuid>` before
  `session/open`; restored Sessions reopen by their committed server identity
  without inheriting a stale active Profile.
- Fail closed on Core rc.9's unscoped `session/list` rows: show only the
  successfully opened or restored Session until Core returns an authoritative
  Workspace/Profile-scoped SessionRef catalog.
- Add an opt-in GLM-5.3-Flash live gate that authenticates, creates and verifies
  a bounded workspace file through real Core tools using the production static
  build, then proves refresh recovery.
- Replace the diagnostic shell with DSH-aligned Workspace/Session navigation,
  composer permission/runtime controls, and General/Models settings; defer
  non-primary surfaces so the initial production bundle stays inside budget.
- Replace scattered connection/recovery refs and turn handling with directly
  tested lifecycle controllers and grouped session domains.
- Validate every structured request result, quarantine late RPC responses, and
  centralize shared wire decoders and generated Core method vocabulary.
- Add focus-trapped modal semantics, dark/light WCAG gates, accessible diff and
  command widgets, token-only feature styling, and explicit bounded-history
  disclosure.
- Harden deployment and publication with a strict CSP, checked nginx syntax,
  exact toolchain/action pins, separate publish authority, immutable assets, and
  build provenance attestations; generate and verify the production dependency
  license closure in every release.

## v0.1.0-rc.2 — 2026-08-26

- Record both the generated protocol source pin and checksummed released Core
  runtime baseline in the deployed build manifest.
- Mark release-candidate tags as GitHub prereleases and ship security/changelog
  metadata with the static archive.
- Make settled Markdown links, syntax tokens, and task-list controls pass the
  deterministic light-theme WCAG 2/2.1 A/AA gate.

## v0.1.0-rc.1 — 2026-08-26

First release candidate of the standalone Octoscode browser client.

- Durable UI Protocol hydrate, cursor replay, dedupe, reconnect, and gap repair.
- Octoscode-compatible prompt queue, interrupt, launch, approval, question, and
  canonical coding-session semantics.
- Safe Markdown/code transcript, server-owned permissions and diff review,
  plans, tasks, paged output/artifacts, context/cost/model status, and bounded
  cross-session activity.
- Session navigation with per-session drafts and capability-gated Core forward
  methods.
- Browser-first solo profile/provider onboarding with transient credentials,
  provider test-before-save, partial-failure recovery, and a TUI fallback.
- DSH-derived visual language with the MIT notice preserved.
- Strict protocol decoders, generated Core vocabulary, pinned checksummed real
  Core integration, Chromium/WCAG gates, hardened deployment reference, and
  versioned static release artifacts.
