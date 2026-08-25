# octoscode-web agent guide

## Product boundary

This repository is a browser client for the Octos AppUI/UI Protocol. It does
not own an agent loop, models, tools, sandboxing, approvals, durable sessions,
or plugin execution. Those remain in `octos serve`.

## Architecture rules

- Keep `packages/client` independent of React and browser presentation state.
- Treat server capabilities as runtime truth. Do not expose a control until the
  connected server advertises its method or feature.
- Do not copy the full Rust protocol into handwritten TypeScript. Temporary
  vertical-slice guards must be narrow and fail closed; generated contracts are
  the intended source of truth.
- Keep product features inside their own app feature directory. Do not create a
  global god store or a catch-all bridge.
- Treat Octoscode's command, queue, approval, session, and capability-gating
  behavior as the interaction source of truth. Browser controls may translate
  presentation, but they must not change command or state-transition semantics.
- Resolve slash and bang commands before prompt dispatch. Unknown or unavailable
  commands fail closed and must never reach the model as ordinary text.
- Use DSH as the browser product and visual reference without importing its
  Cordis or harness runtime. Shared visual values belong to `app/theme.css`;
  feature presentation should move toward colocated CSS Modules and consume
  semantic `--dsw-*` aliases rather than literal palette values.
- Preserve the DeepSeek MIT notice and audited source revision when copying or
  substantially adapting DSH UI code. See `THIRD_PARTY_NOTICES.md`.
- Browser-only state is limited to drafts, focus, selection, expansion, and
  connection preferences. Durable task/session state belongs to the server.
- Never persist an auth token to `localStorage`. The current server accepts a
  WebSocket query token because browsers cannot attach an Authorization header;
  avoid printing or retaining the resulting URL.

## Required checks

Before committing, run:

```sh
pnpm check
```
