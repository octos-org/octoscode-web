# Getting started

octoscode-web is a static browser client. For normal use it connects to an
already-running `octos serve`; for product development it can connect to the
repository's narrow fixture server.

## Requirements

- Node.js 22 or newer
- pnpm 11.5.2
- Chromium only when running the browser test suite

Install the workspace exactly from the lockfile:

```sh
pnpm install --frozen-lockfile
```

## Connect to Octos

1. Start a compatible `octos serve` on the machine that owns the workspace.
2. Start the Web development server:

   ```sh
   pnpm dev
   ```

3. Open the displayed local URL. The connection gate has two fields:

   | Field         | Meaning                                                             |
   | ------------- | ------------------------------------------------------------------- |
   | Server origin | HTTP(S) origin for the Octos server.                                |
   | Auth token    | Credential when the server requires one; retained only in this tab. |

4. Select **Connect** or press Enter. The address defaults to this page's
   origin; **Use this page** restores it after a custom address was saved.
   Authentication happens before work selection; there are no Workspace path,
   profile, or Session identity fields on this screen.
5. On your first connection, enter a workspace path and select **Start
   session**. For later conversations, select **New Session** in the sidebar and
   choose a recent Workspace, or select **Add workspace**. Enter paths on the
   **Octos server host**, not the browser device. Add workspace validates that
   path and creates a fresh Session; it is not Workspace-registry CRUD.
6. Select any Session this tab has already confirmed to reopen it. Chat and
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
and endpoint/token changes clear the refs and drafts.

The retained-Session implementation has passed local real-provider capacity,
recovery and endurance checkpoints. New source additions still require their own
acceptance: see the artifact-specific results in
[Feature parity](feature-parity.md). The separately pinned rc9 baseline remains
unchanged.

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
Enter still uses the same command/turn admission and FIFO. Clipboard shortcuts,
IME composition and modal/approval/question focus retain priority. Supported
operations are `h j k l 0 $ w b e G gg x dd dw cc i a A I o O`; counts, Visual
mode, macros and registers are not implemented. Pending operators never carry
into another Session's draft.

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

An empty solo server can offer profile and provider onboarding after a Workspace
is selected. Provider data comes from Core, the credential is tested before
saving, and the API key is never written to browser storage. Older servers
display the canonical `octoscode onboard` fallback instead.

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

## Common commands

| Command                 | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`              | Start the Vite development server.                                             |
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

For production hosting, continue with the [deployment contract](deployment.md).
For protocol behavior, see [Protocol integration](protocol.md).
