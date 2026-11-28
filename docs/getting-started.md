# Getting started

octoscode-web is a static browser client. For normal use it connects to an
already-running `octos serve`; for product development it can connect to the
repository's narrow fixture server.

## Requirements

- Git, curl, and Node.js 22 or newer.
- pnpm 11.5.2. On Node.js 22 or 24, `corepack enable` provides it; if that fails
  with a permission error, Node.js is installed for all users, so run it with
  `sudo` or use a per-user Node.js such as nvm. Node.js 25 and newer no longer
  include Corepack: run `npm install -g pnpm@11.5.2` instead.
- An Octos server on the machine that owns your files: v2.0.3 or newer for Code
  mode, v2.1.0 or newer for Chat mode.
- Chromium, only when running the browser test suite.

## Install

### The Octos server

Download the server bundle for your computer from
[Octos releases](https://github.com/octos-org/octos/releases), check it, and
unpack it into `~/.octos/bin`:

```sh
VERSION=v2.1.0
ASSET=octos-bundle-x86_64-unknown-linux-gnu.tar.gz
mkdir -p ~/.octos/bin
cd "$(mktemp -d)"
curl -fLO "https://github.com/octos-org/octos/releases/download/$VERSION/$ASSET"
curl -fLO "https://github.com/octos-org/octos/releases/download/$VERSION/$ASSET.sha256"
sha256sum -c "$ASSET.sha256"
tar -xzf "$ASSET" -C ~/.octos/bin
~/.octos/bin/octos --version
```

| Computer          | `ASSET`                                         |
| ----------------- | ----------------------------------------------- |
| Linux x64         | `octos-bundle-x86_64-unknown-linux-gnu.tar.gz`  |
| Linux ARM64       | `octos-bundle-aarch64-unknown-linux-gnu.tar.gz` |
| Apple silicon Mac | `octos-bundle-aarch64-apple-darwin.tar.gz`      |
| Windows x64       | `octos-bundle-x86_64-pc-windows-msvc.zip`       |

On a Mac, check the download with `shasum -a 256 -c "$ASSET.sha256"`. The
commands on this page are for Linux and macOS shells. v2.1.0 is the first Octos
release with Chat mode; until it is published, `VERSION=v2.0.3` gives you Code
mode. The bundle holds the `octos` server, its sandbox helper, the tools it
runs, and its model catalog. `~/.octos/bin` is not added to your `PATH`, so this
page uses the full path.

The [Octoscode TUI](https://github.com/octos-org/octoscode) also installs a
server into `~/.octos/bin` the first time it runs, but only the version that TUI
release was built for. Check it with `~/.octos/bin/octos --version`, and install
the bundle if it is older than you need.

### This app

Check out a release and install its dependencies exactly from the lockfile:

```sh
git clone --branch v1.0.0 https://github.com/octos-org/octoscode-web.git
cd octoscode-web
pnpm install --frozen-lockfile
pnpm build
```

`--branch` picks a release from
[Releases](https://github.com/octos-org/octoscode-web/releases); `main` is
unreleased work. Until 1.0 is published, use `--branch v0.22.0`, which has Code
mode only. Each release also has an archive, `octoscode-web-<tag>.tar.gz`, with
the same app already built. It is for hosting behind a web server, over HTTPS;
see the [deployment contract](deployment.md). On your own computer, use the
checkout.

## Connect to Octos

1. Start the server, **bound to a port** so a browser can reach it, on the
   machine that owns the workspace. Pick a token — any string:

   ```sh
   export OCTOS_AUTH_TOKEN=my-local-token
   ~/.octos/bin/octos serve --host 127.0.0.1 --port 50080 --solo
   ```

   The server reads the token from `OCTOS_AUTH_TOKEN`; do not also pass
   `--auth-token`, which puts the token in the process list. `--solo` lets this
   app create your profile on first run; without it a fresh server answers "This
   server cannot onboard from the Web". The server keeps its data in `~/.octos`.

   `--stdio` will not work here: it runs the protocol over the process's stdin
   and stdout instead of binding HTTP, which serves only the process that
   spawned it. That is the mode the
   [Octoscode TUI](https://github.com/octos-org/octoscode) uses when you run it
   on its own. A port-bound server accepts both, at the same time — see
   [Share a session with the terminal](#share-a-session-with-the-terminal).

2. In the checkout, serve the built app with the server behind it:

   ```sh
   OCTOSCODE_DEV_PROXY_TARGET=http://127.0.0.1:50080 \
   OCTOSCODE_DEV_PROXY_ORIGIN=http://127.0.0.1:50080 \
   pnpm --filter @octos-org/octoscode-web exec vite preview --host 127.0.0.1
   ```

   Keep both variables. They make the browser talk only to this app's address,
   which forwards to the server. Without them the server refuses the browser,
   because by default it trusts only its own address. To serve the app another
   way, set `OCTOS_APPUI_ALLOWED_ORIGINS=http://<host>:<port>` on the server
   instead. While changing the app itself, `pnpm dev` with the same variables
   serves the same address and reloads as you edit.

3. Open <http://127.0.0.1:4173>. The connection gate has two fields:

   | Field         | Meaning                                                             |
   | ------------- | ------------------------------------------------------------------- |
   | Server origin | HTTP(S) origin for the Octos server.                                |
   | Auth token    | Credential when the server requires one; retained only in this tab. |

4. Leave **Server origin** as it is, enter the token, and select **Connect** or
   press Enter. The address defaults to this page's origin; **Use this page**
   restores it after a custom address was saved. Authentication happens before
   work selection; there are no Workspace path, profile, or Session identity
   fields on this screen.
5. On your first connection, enter a workspace path, or select **Browse…**, and
   select **Start session**. For later conversations, select **New Session** in
   the sidebar and choose a recent Workspace, or select **Add workspace**. Enter
   paths on the **Octos server host**, not the browser device. Add workspace
   validates that path and creates a fresh Session; it is not Workspace-registry
   CRUD.
6. The first time, **Set up your coding assistant** opens:
   1. **Step 1 of 2 · Model service**: choose a provider and a **Model**, then
      select **Continue**. **More providers** lists the rest. **Advanced** holds
      the profile's ID and name; the ID is `coding` unless you change it.
   2. **Step 2 of 2 · Connect**: paste the provider's API key, or select **Use a
      custom OpenAI-compatible endpoint** and enter its base URL, and select
      **Test, save & open**. The key is tested with the provider before the
      profile is saved. Octos keeps the key; the browser does not.

   The conversation then opens. [Kimi](#kimi) covers the Kimi Coding Plan.

7. Select any Session this tab has already confirmed to reopen it. Chat and
   Trajectory both follow the selected Session. Multiple Sessions can share the
   same Workspace path without replacing one another. Do not assume the list is
   complete on Core rc.9; unscoped/admin connections can misroute a known-path
   list to the wrong Profile (octos#2146).

Workspace is the coding object that groups Sessions for one server path. Core
validates and canonicalizes that path and owns every durable Session. For New
Session, the browser generates a fresh opaque Web identity behind the product
flow and Core creates the durable ledger; users never enter an id.

Current Core builds do not provide a complete server-wide Workspace catalog. In
the current tab, the sidebar remembers a bounded list of recent server paths and
the minimal Workspace/Profile/Session routing tuples returned by successful
opens. A local recency timestamp orders those confirmed rows. Session titles,
prompts, transcripts, model output, and other durable projections never enter
that cache.

Core rc.9 can lose the requested Profile or silently ignore cwd on an
unscoped/admin list call, and its response does not report the effective scope.
The Web therefore does not project those rows as a catalog. It shows only
Sessions this tab has successfully opened, while a recent path remains an entry
point for a new Session. Recents and confirmed refs have no individual
edit/remove action and never become a second database. The missing Core object
contract is tracked in
[octos#2146](https://github.com/octos-org/octos/issues/2146).

## Share a session with the terminal

The terminal client and this app are peers on one server, not alternatives.
Point the TUI at the same origin with the same token:

```sh
export OCTOS_AUTH_TOKEN=my-local-token
octoscode \
  --endpoint ws://127.0.0.1:50080/api/ui-protocol/ws \
  --session <session id>
```

Like the server, the TUI reads the token from `OCTOS_AUTH_TOKEN`.

`session/open` attaches; it does not claim. The server replays what you missed
from your cursor and then pushes every later event to every attached connection,
so a turn started in one client streams into the other while it runs.

The server allows one active turn per session, so while one client is working
the other's send is refused rather than queued on the server. Nothing arbitrates
who may start a turn: either side can, whenever the slot is free, and any
attached client can interrupt a running turn regardless of who started it. Start
the TUI with `--readonly` when you want it to watch without sending.

## Switch Sessions while a turn is running

Select or create another Session while the source is running, starting, waiting,
or holding queued prompts. Each confirmed Session keeps its own FIFO and
interactions; a terminal event can advance a background queue without selecting
it. The queue above the composer shows each pending message and its remove
control. The shared WebSocket stays open across selection changes. There is no
eight-connection Session cap or deferred-until-ACK navigation action. Stop and
other mutations remain subject to the selected Session's own readiness checks.

Use the sidebar's waiting state to return to the Session that owns an approval
or question. Native peer Sessions are also retained without stealing focus; use
`/peer` or `/gather` when the server advertises those operations. Unsupported
controls remain unavailable rather than starting a browser-owned agent loop.

This is same-live-tab continuation, not a detached server job. Core rc11 still
interrupts connection-owned work when refresh, tab close, network/proxy loss, or
**Disconnect** closes the pooled socket. Ordinary reconnect retains local queues
but pauses dispatch until hydrate/replay reconciles each Session. The browser
warns before refresh or close while foreground, queued, or background work is
active; this warning does not keep work alive after leaving. Reload discards
queued prompts and image drafts; it cannot recover them from the server.
Disconnect keeps confirmed navigation refs, not live records. **Forget server**
and endpoint/token changes clear the refs and in-memory drafts. Unsent text also
survives closing a tab: authenticate again and open the same Session to restore
your draft. **Forget server** deletes the confirmed user's saved drafts on this
browser; changing the token does not expose another user's drafts.

The retained-Session implementation has passed local real-provider capacity,
recovery and endurance checkpoints. New source additions still require their own
acceptance: see the artifact-specific results in
[Feature parity](feature-parity.md). The current downloadable runtime baseline
is recorded in [`core-runtime.json`](../packages/client/core-runtime.json);
earlier audit results remain tied to their tested revisions.

For a fresh Web Session, an unambiguous `activate` result opens automatically
with Core's resolved Profile. A `cross_profile` result still asks which Profile
to use, and `no_profile` still opens onboarding or the truthful TUI fallback.

The active Session's permission control and effective runtime model are in the
composer footer. Full access appears only when advertised and requires a risk
acknowledgement. The runtime-model label is status, not a Session-level model
selector. Open **Settings** at the bottom of the sidebar for General connection
details, **Disconnect**, **Forget server**, or Models.

## Read and write comfortably

To save the current conversation for another browser, use **Settings → General →
Copy conversation link**. The link contains its server workspace and routing
reference, without your login token. Sign in to the same server in the new
browser, check the target, and select **Open conversation**. If it no longer
exists, Core may open an empty Session; opening a link never sends a prompt.

After a connection loss, a missing response can require a separate status check.
**Check status** asks Core about that exact response. An unknown result pauses
sending and retains queued messages; it does not establish that the work never
ran. You can edit your draft, remove queued entries, and manage the connection
in Settings. Disconnecting or forgetting the server while work is unfinished
asks for confirmation because running work can stop and queued messages are
discarded.

Enter sends a message; Shift+Enter adds a line. Confirming an IME candidate does
not send. During a turn, typing another message makes the queue action
available; Stop remains available once Core has accepted the active turn.

New output follows the end of the conversation while you are there. Scroll up to
read history without being pulled down by streaming text. **Back to latest**
resumes following. Reasoning and tool details start collapsed, support keyboard
activation, and stay open when the tool finishes.

On a phone, the header's navigation button opens Sessions and Workspaces in a
drawer. Close it with Escape or by selecting a Session to return to the
conversation. The input stays inside the viewport and retains its draft.
Settings scrolls within its dialog. Escape closes the topmost dialog; closing a
Diff review above an approval returns to that approval without interrupting it.

## Session commands and local display preferences

Type a slash command into the composer; unsupported commands and arguments fail
closed instead of becoming model prompts. The palette lists only usable
commands.

| Command                                          | Browser interaction                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `/sessions`                                      | Focus the confirmed-Session search; switching does not pause other records.                       |
| `/resume [search]`                               | Browse scoped historical candidates and explicitly confirm opening one.                           |
| `/btw question` or `/aside question`             | Ask an ephemeral side question; its reply stays with the originating Session.                     |
| `/steer on` / `/steer off`                       | Opt into native mid-turn text steering for this Session; otherwise inputs remain FIFO.            |
| `/threads`, `/turn state [UUID]`, `/permissions` | Inspect the connected Core's exact scoped graph, lifecycle or remembered approval decisions.      |
| `/goal`, `/agents`, `/loop`, `/monitor`          | Open capability-gated native controls; the browser does not run a scheduler or agent loop.        |
| `/thinking`, `/images`                           | Choose future-turn reasoning effort / display visibility, or explicitly select and upload images. |
| `/theme`, `/lang`                                | Open browser preferences; `/lang en` and `/lang zh` change interface language directly.           |
| `/vimmode`                                       | Toggle the pinned TUI's normal/insert editing subset; this is not a full Vim implementation.      |
| `/saveconfig`                                    | Explicitly save language, theme and Vim preference in this browser only.                          |

**Browser preferences** is also available without a Core connection. Its five
palettes are Terminal, Codex, Claude, Slate and Solarized. Terminal preserves
the browser's automatic light/dark appearance; named palettes also affect code
highlighting. Language changes UI text, not user/model content or wire values.
Changes take effect immediately, but only **Save browser preferences** or
`/saveconfig` persists them. This is not a write to the server's TUI config.

Vim starts in Insert when enabled or toggled. In the focused composer, Escape
enters Normal without interrupting. A Normal-mode pending operator is cancelled
by Escape; a subsequent bare Escape can interrupt that Session's accepted turn.
Enter uses the same command/turn admission: compatible text steers an active
turn by default; `/steer off` restores FIFO. Tab or Queue defers a draft to the
next turn. Ctrl+X or Send now interrupts and sends pending input after the turn
settles, preserving the unfinished draft. Clipboard shortcuts, IME composition
and modal/approval/question focus retain priority. Supported operations are
`h j k l 0 $ w b e G gg x dd dw cc i a A I o O`; counts, Visual mode, macros and
registers are not implemented. Pending operators never carry into another
Session's draft.

With Vim disabled, bare Escape in the composer dismisses an open command palette
first; otherwise it interrupts the selected Session's accepted turn when
allowed.

The browser preference additions are source work undergoing their own
artifact-specific acceptance; do not infer that an already published build
contains them. See [Feature parity](feature-parity.md).

## Configure providers and models

**Settings → Models** reads the active Profile's configured primary and fallback
entries from Core. Depending on the connected server's advertised methods, it
can be read-only or expose these actions:

1. Select **Add provider** or edit one configured row. Enter the provider
   family, model id, route id/label, base URL, credential environment name, and
   API protocol. Catalog and discovered values are suggestions; the model id can
   still be entered manually.
2. Enter an API key only when adding or replacing one. A configured route
   reopens with a blank password field and a configured indicator because Core
   does not return the saved value. Leaving it blank preserves the Core-owned
   key.
3. **Test** probes the exact draft. **Fetch models** asks that provider/route
   for suggestions and can be unavailable even when direct inference works.
   Editing the draft invalidates its prior test result.
4. **Save** tests that same draft again before it upserts the Profile. Set it as
   the Profile default when that is the intended cross-Session change. Delete
   removes the exact configured route after confirmation.

The browser keeps a typed key only for the current request; it does not write
provider keys to browser storage. Core owns any saved key and exposes only
whether one is configured. This is a write-only protocol property, not a claim
that every Core platform encrypts its credential store.

The **Session runtime** row remains authoritative for the model actually served
by the current process. **Profile default** is configuration shared by Sessions
on that Profile. A changed default may require an Octos restart and is not a
Session override. Web and the pinned TUI do not expose an inference-override
editor, although rc11 Core can persist typed per-model sampling, context, and
reasoning defaults. Existing known overrides are preserved during provider
edits; unsupported configured fields make an entry edit-ineligible. `/thinking`
separately captures reasoning effort for new turns in the selected Session,
including queued turns. `/images` accepts explicit image selection/upload, up to
four images of at most 20 MiB each; typing a local path does not read a file
from your computer.

### GLM-5.3-Flash

The exact API model id is `glm-5.3-flash` (lowercase). A normal Z.AI API account
uses the OpenAI-compatible base URL `https://api.z.ai/api/paas/v4`; the
dedicated Coding Plan base URL is `https://api.z.ai/api/coding/paas/v4`. See the
official
[GLM-5.3-Flash model page](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)
for current model behavior.

The GLM Coding Plan is contractually limited to Z.AI's
[listed supported tools](https://docs.z.ai/devpack/tool/others), and Octos is
not currently named there. Use a normal API key/endpoint for Octos unless Z.AI
has separately authorized this integration. Endpoint compatibility alone does
not grant Coding Plan usage rights.

### Kimi

The setup wizard and **Settings → Models** list two Kimi entries. Pick the one
that matches your key:

| Entry                | Key                                                      | Models                                              | Endpoint                         |
| -------------------- | -------------------------------------------------------- | --------------------------------------------------- | -------------------------------- |
| **Kimi Coding Plan** | A Kimi Coding Plan subscription key, starting `sk-kimi-` | `k3` (the default), `kimi-for-coding-highspeed`     | `https://api.kimi.com/coding/v1` |
| **Kimi 月之暗面**    | A Moonshot open platform API key                         | `kimi-k2.5` (the default) and newer `kimi-*` models | `https://api.moonshot.ai/v1`     |

Octos fills in the endpoint; leave **Use a custom OpenAI-compatible endpoint**
off. The two kinds of key are not interchangeable: the Moonshot endpoint rejects
Coding Plan keys, so with the wrong entry the key test fails. In the setup
wizard, select **Back**, pick the other entry, and try again. Use a key from
your own Kimi account, and check that your plan's terms allow its use with
Octos. From octoscode-web 1.0, **Kimi Coding Plan** is in the first row of the
wizard; in v0.22 it is under **More providers**.

An empty solo server offers profile and provider onboarding after a Workspace is
selected. Provider data comes from Core, the credential is tested before saving,
and the API key is never written to browser storage. A server started without
`--solo`, or one too old for Web onboarding, shows **This server cannot onboard
from the Web** and names `octoscode onboard`. Octoscode has no such subcommand.
Restart the server with `--solo` instead, or set up from the terminal: run
`octoscode` on the server machine and finish its first-launch setup (`/onboard`
in the TUI reopens it later), then restart `octos serve` and reconnect.

After a successful connection, refreshing the same tab reopens the established
Session. Only the server origin and explicitly saved local display preferences
are durable browser configuration. The token, auto-connect marker, selected
Session/Workspace/Profile restore hints, recent Workspace paths, and confirmed
Session refs are bound to that endpoint and token in tab-scoped
`sessionStorage`; closing the tab forgets all of them. **Disconnect** keeps the
endpoint and current tab navigation data but stops automatic reconnection and
closes the pooled transport and retires local queues; **Forget server** clears
both storage scopes.

## Run the product fixture

The fixture is useful for interface work and deterministic browser flows. It
implements only the protocol slice used by this repository; it is not proof of
compatibility with Octos Core.

Run these commands in separate terminals:

```sh
pnpm mock:server
```

```sh
pnpm dev
```

Use the fixture origin shown in its terminal output. The fixture contains a
representative Markdown/code transcript, approvals, questions, task output,
artifacts, and session state.

## Use Chat mode

Chat mode is for everyday work that needs no folder, such as a weekly report, a
summary of a PDF, or a cleaned-up table. Each chat works in a folder that the
server assigns to it alone; the page never asks for or shows a path. It needs
octoscode-web 1.0 or newer and Octos v2.1.0 or newer.
[Before 1.0](#before-10-the-chat-preview) covers earlier builds.

1. Under **Work mode** at the top of the sidebar (in the drawer on a phone),
   select **Chat**, then **New chat**. If **Chat** is disabled and says the
   server cannot give every chat its own folder, the server is older than
   v2.1.0: [install v2.1.0](#the-octos-server) and restart it. Code mode works
   either way.
2. Pick a template on the chat's home or type a request. A new chat is read-only
   with the network blocked: answers stay in the conversation and nothing is
   written. You can attach pasted text, images, Markdown, CSV, and PDF files,
   but not Office files. Attachments can be previewed and downloaded from the
   conversation.
3. To let Octos save files, select **Allow file outputs**. This changes only
   this chat, to writing in its own folder with the network still blocked. The
   chat sends nothing until the server has confirmed the change; then it shows
   **File outputs on**.
4. Ask for a file, for example "save the weekly report as a markdown file". The
   file appears in the conversation and under **Outputs** at the top right, each
   with **Preview** and **Download**.
5. **Turn off file outputs** returns the chat to read-only. Files it already
   saved stay under **Outputs**.

The network stays blocked in Chat mode; switching modes, picking a template, or
allowing file outputs does not open it. Chats share the connection, the
Profile's models, saved memory, installed skills, and connectors with Code mode,
but not their files.

### Turn Chat mode off

From 1.0, Chat mode is on unless a browser opts out. To opt out, run this in the
browser's developer console:

```js
localStorage.setItem("octoscode-web.two-modes", "off");
location.reload();
```

**Work mode** disappears and the page stops asking the server for Chat features.
Chats stay on the server; nothing is deleted. Session links live in the tab, so
chats this tab opened still show as ordinary Sessions under their folders until
you close the tab or select **Forget server**. To return to the default, run
`localStorage.removeItem("octoscode-web.two-modes")` and reload. Phones have no
developer console; there, choose **Code** under **Work mode** instead.

### Before 1.0: the Chat preview

Releases up to v0.22 have Code mode only. Builds of `main` before 1.0 show Code
only unless a tester turns the Chat preview on, in a test browser against a
server they may test on, never in someone else's browser or on a shared
deployment:

1. In the test browser's console, run
   `localStorage.setItem('octoscode-web.two-modes', 'on'); location.reload()`.
   The page reads the flag only when it loads.
2. **Work mode** appears, and Chat works as above against Octos v2.1.0 or a Core
   build from `main` that has the per-chat folders.
3. Against the fixture, connect with the token `two-modes-e2e-token`; only that
   token gets the Chat features. The fixture's files are simulated, so this is
   no evidence of how a real Core behaves.
4. To turn the preview off, run
   `localStorage.removeItem('octoscode-web.two-modes'); location.reload()`.

The [1.0 flag drill](release-1.0-flag-drill.md) is the full checklist for
turning the flag on in a designated test environment before the release.

## Upgrade or roll back

Code mode needs Octos v2.0.3 or newer; Chat mode needs octoscode-web 1.0 and
Octos v2.1.0 or newer. Sessions, chats, and their files live on the server, so
changing the app's version never moves or deletes them.

**This app, from a checkout.** Stop the preview, then:

```sh
git fetch --tags
git checkout v1.0.0
pnpm install --frozen-lockfile
pnpm build
```

and start the preview again with the same two variables. To roll back, do the
same with the earlier tag, for example `git checkout v0.22.0`. Going back to
v0.22 removes **Work mode**; your chats stay on the server and reappear when you
upgrade again.

**This app, hosted from a release archive.** Download the new
`octoscode-web-<tag>.tar.gz` and its `.sha256` from
[Releases](https://github.com/octos-org/octoscode-web/releases), verify them,
extract next to the current directory, and switch the web server to it. Keep the
previous directory: rolling back means serving it again. The
[deployment contract](deployment.md#rollback-and-health) lists the checks.

**The Octos server.** Read the
[Octos upgrade guide](https://github.com/octos-org/octos/blob/main/docs/UPGRADE-v2.1.0.md)
first. Then stop `octos serve`, keep a copy of the current binaries, install the
new bundle with the commands in [The Octos server](#the-octos-server), and start
the server again:

```sh
cp -a ~/.octos/bin ~/.octos/bin-previous
```

To roll back, stop the server, put the copy back
(`rm -rf ~/.octos/bin && mv ~/.octos/bin-previous ~/.octos/bin`), and start it
again. Their files stay in place, but a server older than v2.1.0 cannot see the
chats v2.1.0 created, and the page shows **Chat** as unavailable. Code mode
works with v2.0.3 or newer.

## Common commands

## Common commands

| Command                 | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`              | Start the Vite development server.                                             |
| `pnpm build`            | Build the app into `apps/web/dist`.                                            |
| `pnpm mock:server`      | Start the deterministic AppUI fixture.                                         |
| `pnpm check`            | Format-check, lint, typecheck, unit-test, build, and verify deployment output. |
| `pnpm test:e2e`         | Run Chromium product and accessibility flows.                                  |
| `pnpm contract:verify`  | Verify generated vocabulary against the pinned Core source blob.               |
| `pnpm integration:core` | Exercise an explicitly supplied, pinned real Core binary.                      |

Install Chromium once before the E2E suite:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

To run the real-Core gate locally, point at the binary that matches
`packages/client/core-runtime.json`:

```sh
OCTOS_BINARY=/absolute/path/to/octos pnpm integration:core
```

The gate starts isolated temporary state and does not make an external model
turn. Its local provider fixture exercises catalog, credential testing, and
profile save without contacting a model service.

## Browser and credential constraints

- A browser cannot spawn the Octos binary.
- Browser WebSockets cannot attach an `Authorization` header. The current
  endpoint accepts a query token, so use HTTPS/WSS outside loopback and keep
  query strings out of proxy logs.
- Auth tokens are never written to `localStorage`; they may survive refresh in
  the current tab's `sessionStorage`. Provider API-key drafts remain memory-only
  and are never written to browser storage; after Save, Core owns the credential
  and returns only whether it is configured.
- Unsupported methods and malformed safety-bearing payloads fail closed.
- Browsers: the product suite runs in Chromium, with smoke tests in Firefox and
  WebKit. Playwright's WebKit is not Safari on a Mac, iPhone, or iPad, and these
  instructions have not been checked there. Nothing on this page needs a
  developer console except opting out of Chat mode or turning on the preview,
  which phones cannot do.

For production hosting, continue with the [deployment contract](deployment.md).
For protocol behavior, see [Protocol integration](protocol.md).
