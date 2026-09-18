<div align="center">

# octoscode-web

**Octoscode, in the browser.**

A focused Web client for the Octos coding UI Protocol.

[![CI](https://github.com/octos-org/octoscode-web/actions/workflows/ci.yml/badge.svg)](https://github.com/octos-org/octoscode-web/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/octos-org/octoscode-web?include_prereleases&sort=semver)](https://github.com/octos-org/octoscode-web/releases)
[![License](https://img.shields.io/github/license/octos-org/octoscode-web)](LICENSE)

[Get started](docs/getting-started.md) · [Documentation](docs/README.md) ·
[Releases](https://github.com/octos-org/octoscode-web/releases)

</div>

octoscode-web brings the interaction model of
[Octoscode](https://github.com/octos-org/octoscode) to a browser workspace. It
is intentionally separate from the general-purpose
[`octos-web`](https://github.com/octos-org/octos-web) product.

| Coding session (light)                                                                                                                                           | Coding session (dark)                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ![A coding session in the light theme, with Shiki-highlighted TypeScript, a reasoning trace, and capability controls](docs/screenshots/coding-session-light.png) | ![The same coding session in the dark theme](docs/screenshots/coding-session-dark.png) |

```text
 Octoscode TUI ──┐
                 ├── Octos UI Protocol ── octos serve
octoscode-web ───┘                        agents · tools · sessions · tasks
```

The two clients share server-owned runtime truth. The Web app does not contain a
second agent loop, plugin host, sandbox, or session store.

## What is included

- Octoscode-compatible launch, prompt queue, interrupt, approval, question,
  command, and session behavior.
- Durable hydrate, cursor replay, deduplication, gap recovery, and reconnect.
  Capability-gated turn-state checks preserve uncertainty without resending.
- Saved conversation links can reopen an exact server-confirmed reference in a
  new browser after authentication and explicit review.
- A DSH-aligned Workspace/Session sidebar with search, New Session, Add
  workspace, tab-confirmed Session navigation, and Settings.
- Concurrent retained Sessions on one pooled WebSocket, with independent prompt
  queues, approvals, questions, and native peer hosting while switching views.
- Unread tab counts and opt-in desktop notifications when hidden or background
  responses finish or need attention.
- Session-local Chat and Trajectory views, safe Markdown/code rendering,
  approvals, questions, plans, tasks, output, artifacts, and diff review.
- Server-advertised permission control and effective runtime-model status in the
  composer, plus capability-gated provider, model, route, credential, test,
  discovery, save/delete, and Profile-default management in Settings.
- Browser onboarding for an empty solo server, with transient credentials and a
  truthful TUI fallback on older Core versions.
- Single-use pairing links, so connecting needs no pasted token, with the token
  optionally remembered per device and a Forget action.
- Server folder browsing when creating a workspace, including New folder, behind
  `onboarding.workspace_browse.v1`.
- Math in chat output through KaTeX, loaded only for messages that carry math.
- A responsive coding workspace informed by
  [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), with its
  MIT attribution preserved.

See [Product scope](docs/product.md) for the supported surface and deliberate
non-goals. The expanded parity implementation is a candidate: fixture and unit
passes do not establish complete TUI parity or acceptance of the live soak. See
[Feature parity](docs/feature-parity.md) for the acceptance boundary.

## Run locally

### First time, against a real Octos server

Four steps. Each was run exactly as written from an empty home directory. Pick a
token — any string — and use the same one everywhere.

You need Node.js 22+ and pnpm (`corepack enable` installs the right pnpm), and
an `octos` binary. Running the
[Octoscode TUI](https://github.com/octos-org/octoscode) once downloads one to
`~/.octos/bin/octos`. It is **not** added to your `PATH`, so the commands below
use the full path.

**1. Start the server:**

```sh
export OCTOS_AUTH_TOKEN=my-local-token
~/.octos/bin/octos serve --host 127.0.0.1 --port 50080 \
  --auth-token "$OCTOS_AUTH_TOKEN" --solo
```

`--solo` lets this app create your profile on first run. Without it a fresh
server answers "This server cannot onboard from the Web".

**2. Start this app**, in another terminal:

```sh
pnpm install --frozen-lockfile
OCTOSCODE_DEV_PROXY_TARGET=http://127.0.0.1:50080 \
OCTOSCODE_DEV_PROXY_ORIGIN=http://127.0.0.1:50080 \
pnpm dev
```

Keep both `OCTOSCODE_DEV_PROXY_*` variables. They make the browser talk only to
this app's own address, which forwards to the server. Leave them out and the
server refuses the browser, because by default it trusts only its own address —
and the page reports a connection failure that blames your server and token,
though both are fine.

**3. Open the address step 2 prints** — usually <http://127.0.0.1:4173>. Leave
**Server origin** as it is, paste the token into **Auth token**, and select
**Connect**. Under **Add workspace** enter a project folder's full path and
select **Start session**. The first time, **Create your local coding profile**
opens: set **Profile ID** to `main`, pick a **Provider** and **Model**, and
paste the provider's API key.

**4. Optionally attach the terminal too:**

```sh
OCTOS_AUTH_TOKEN=my-local-token octoscode \
  --endpoint ws://127.0.0.1:50080/api/ui-protocol/ws --profile-id main
```

It reports "Pass --session to open an interactive session." That is expected:
type `/resume` to join the conversation from the browser. See
[Share a session with the terminal](#share-a-session-with-the-terminal).

| You see                                                         | Fix                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `command not found: octos`                                      | Use the full path, `~/.octos/bin/octos`                                   |
| "This server cannot onboard from the Web"                       | Restart the server with `--solo`                                          |
| A connection failure, though the server runs and token is right | Restart step 2 with both `OCTOSCODE_DEV_PROXY_*` variables set            |
| Nothing to pick after `/resume` in the terminal                 | Send one message in the browser first; a session lists once it has a turn |

Serving this app somewhere without that proxy? Tell the server to trust its
address: `OCTOS_APPUI_ALLOWED_ORIGINS=http://<host>:<port>` on the server, or
`appui.allowed_origins` in its config.

### Developing this app, without Octos

The deterministic fixture stands in for a server. It listens on port 50080 by
default — the same port as step 1 — so run one or the other, or move the fixture
with `OCTOSCODE_MOCK_PORT`:

```sh
pnpm install --frozen-lockfile
pnpm mock:server   # terminal 1
pnpm dev           # terminal 2
```

Open the app, set **Server origin** to `http://127.0.0.1:50080`, type any value
into **Auth token** — the form requires one, but the fixture accepts anything —
and connect.

### The server must be listening on a port

A browser can only reach Octos over HTTP, so `octos serve` has to be bound to a
host and port, as in step 1 above.

**Not `--stdio`.** That mode runs the UI Protocol over the process's stdin and
stdout _instead of_ binding HTTP, so it serves exactly one client — the one that
spawned it — and no browser can attach. It is what the
[Octoscode TUI](https://github.com/octos-org/octoscode) uses by default when you
run it on its own.

Pick the mode by what you want in front of you:

| You want                              | Run                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Just a terminal, nothing to configure | `octoscode` on its own — it provisions a server and speaks stdio to it                                     |
| A browser                             | `octos serve --host … --port …`, then this app                                                             |
| Both at once                          | the same `octos serve`, then this app **and** `octoscode --endpoint ws://<host>:<port>/api/ui-protocol/ws` |

The third row is a real configuration, not a workaround: the terminal and the
browser are peers on one server. See
[Share a session with the terminal](#share-a-session-with-the-terminal).

### Connecting

Run `octos serve` separately. There are two ways to connect it.

**From a pairing link, when the server offers one.** Start the server with the
address this app is served from:

```sh
octos serve --web-url http://127.0.0.1:5173
```

It prints one line:

```
Open the web client: http://127.0.0.1:5173/?octos=http://127.0.0.1:53124&pair=EMX3MBRB
```

Open that link and the app connects on its own. The code works once, expires
five minutes after the server starts, and is only accepted over loopback. The
link's parameters are removed from the address bar before the first render. The
page also suppresses referrers while its resources load. The auth token stays in
this browser tab; it is never saved to localStorage. **Cancel** stops the
current claim, and **Forget saved connection** removes this tab's saved
connection and any legacy device token. Without `--web-url`, servers supporting
pairing print their origin and code as separate labelled lines instead.

**By hand, which always works.** Enter the server's origin and auth token. The
connection form defaults to this page's origin; **Use this page** restores that
address after a custom server was saved. A server that does not offer pairing
shows this form with no extra step.

Then choose where the session runs: type a path on the Octos server, or select
**Browse…** to walk the server's folders, which appears when the server
advertises `onboarding.workspace_browse.v1`. The browser lists subfolders only,
goes up and down, and **New folder** creates one and moves into it. Select
**Start session** to open the conversation. For later conversations, **New
Session** offers recent Workspaces and **Add workspace**. The sidebar remembers
the Sessions this tab successfully opens, so multiple conversations in the same
Workspace remain distinct and can be selected again. The selected Session is
restored on refresh in the same tab. Unsent composer drafts also survive closing
the tab: sign in again and open the same Session to restore its text. Drafts
stay scoped to the server, authenticated user and Session; they are never sent
automatically after restoration. These confirmed references are navigation
memory, not a complete Session catalog: Core rc.9 can misroute
`session/list({cwd})` for unscoped/admin connections, so the Web client cannot
promise a complete or correctly grouped catalog until the server-owned
SessionRef contract in
[octos#2146](https://github.com/octos-org/octos/issues/2146) lands. The browser
cannot start or provision the Octos binary.

Switch or create Sessions while other Sessions are running, starting, waiting,
or holding queued prompts. Each confirmed Session retains its own controller,
FIFO, interactions, cursor, and bounded transcript projection; selecting another
view does not move or discard that work. All records share one physical
WebSocket, replacing the old eight-owner-connection limit and ACK navigation
guard. Native peer Sessions are hosted without selecting them.

This is not detached server execution. Core rc11 still interrupts
connection-owned work when the pooled socket closes: refresh, tab close,
network/proxy loss, or **Disconnect** can stop running turns. Same-tab reconnect
retains local queues but must reconcile each Session through hydrate/replay
before dispatch; a page reload loses queued prompts and attachment drafts. A
browser leave warning helps prevent accidental refresh or close while work is
active. Disconnect keeps confirmed navigation refs, not live records. **Forget
server** or an endpoint/token change clears those refs. The rc11 candidate does
not replace the repository's separately pinned rc9 runtime baseline. Durable
detached execution remains a Core boundary, tracked in
[octos#2167](https://github.com/octos-org/octos/issues/2167).

### Share a session with the terminal

One `octos serve` accepts many clients. Point the
[Octoscode TUI](https://github.com/octos-org/octoscode) at the same server, with
the same token, and both are live against the same agent, sessions and
workspace:

```sh
octoscode \
  --endpoint ws://127.0.0.1:50080/api/ui-protocol/ws \
  --auth-token "$OCTOS_AUTH_TOKEN"
```

Add `--session <id>` to open one specific conversation in both places. Each
client's `session/open` is an _attach_, not a claim, and the server fans every
event for that session out to every connection that opened it — so a turn
started in the terminal streams into the browser as it happens, and the reverse.

Two rules follow from that, and they are the server's, not this app's:

- **One turn at a time per session.** The server keeps a single active-turn slot
  per session. While one client's turn is running, the other's `turn/start` is
  refused rather than queued server-side.
- **Nothing decides who "owns" a session.** Both clients may start turns
  whenever the slot is free, and any attached client can interrupt the running
  turn — `turn/interrupt` is not scoped to the connection that started it. If
  you want one side to watch only, start the TUI with `--readonly`, which
  disables its sends.

For UI work without a local Octos installation, start the deterministic AppUI
fixture in another terminal:

```sh
pnpm mock:server
```

The [getting-started guide](docs/getting-started.md) explains both paths.

## Documentation

| Read this                                  | When you need to…                                    |
| ------------------------------------------ | ---------------------------------------------------- |
| [Getting started](docs/getting-started.md) | run the app or connect a server                      |
| [Product scope](docs/product.md)           | understand features, boundaries, and roadmap         |
| [Architecture](docs/architecture.md)       | understand ownership and package boundaries          |
| [Protocol integration](docs/protocol.md)   | change transport, projections, or Core compatibility |
| [Deployment](docs/deployment.md)           | host or roll back a release safely                   |
| [Testing](docs/testing.md)                 | choose verification gates and diagnose flakes        |
| [Troubleshooting](docs/troubleshooting.md) | resolve connection, recovery, and command issues     |
| [Releasing](docs/releasing.md)             | publish and verify immutable releases                |
| [ADR index](docs/adr/README.md)            | find the reasoning behind durable decisions          |

The [documentation index](docs/README.md) is the complete map. Contributors
should also read [CONTRIBUTING.md](CONTRIBUTING.md) and
[SECURITY.md](SECURITY.md).

## Project layout

```text
apps/web          React application and feature UI
packages/client   React-free JSON-RPC/WebSocket client
e2e               Playwright product, recovery, responsive, and WCAG flows
scripts           Contract, policy, deployment, and real-Core verification
deploy            Checked same-origin nginx production reference
.github/workflows CI and immutable provenance-attested release automation
docs              product, architecture, protocol, and deployment guides
docs/adr          accepted architectural decisions
```

## Verify a change

```sh
pnpm check
pnpm contract:verify
pnpm exec playwright install chromium
pnpm test:e2e
```

Compatibility changes should also pass the pinned real-Core integration gate;
see [Protocol integration](docs/protocol.md#compatibility-gates).

## License

Apache-2.0. Copied or substantially adapted third-party work is recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); the generated production
dependency closure is recorded in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
