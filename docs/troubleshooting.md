# Troubleshooting

## The browser cannot connect

- Confirm `octos serve` is running and `/health` responds from the browser's
  network location.
- Use `https://` for a remote endpoint; the client derives `wss://`.
- Configure the Web origin in `OCTOS_APPUI_ALLOWED_ORIGINS`.
- Confirm the reverse proxy forwards `Upgrade` and `Connection` for
  `/api/ui-protocol/ws`; serving the static page successfully does not prove the
  WebSocket route works.
- Re-enter the token if the tab was closed. It survives a refresh in the same
  tab but is intentionally absent from `localStorage`.

The connection gate asks only for server origin and token. If it reports “Could
not connect,” fix authentication or network reachability there; Workspace and
Session choices appear only after the product opens.

## A workspace path does not open

Open **Add workspace** from the left sidebar and enter a path on the
`octos serve` host, not on the browser computer. Core's Workspace-root and
filesystem policy remains authoritative. A recent Workspace may also have moved
or been deleted since the browser remembered it. There is currently no
individual edit/remove action for a recent path. Enter the corrected path with
**Add workspace**; **Forget server** clears the whole tab-scoped recent list
when you need a full reset.

Typing a path in Chat does not select a Workspace. Absolute paths containing a
directory separator remain ordinary prompt text. A slash-shaped command that is
not in the Web command registry fails closed and is never sent to the model;
recognized `/commands` are resolved locally.

## Workspaces or Sessions are missing from the sidebar

Current Core builds cannot yet provide an authoritative Workspace/Session
catalog. During the current tab, the sidebar remembers recent paths, but it
shows only the Sessions that this tab successfully opened and confirmed. Two
Sessions with the same Workspace path remain separate rows. Core rc.9 can route
an unscoped/admin `session/list({cwd})` through `_main` instead of the
Workspace's coding Profile, or silently ignore cwd, without reporting the
effective scope. The Web rejects those rows instead of placing them under the
wrong Workspace. A new tab therefore begins with no Workspace recents or
confirmed Session refs even though the durable server has other work; only the
endpoint survives.

Use **Add workspace** with the server path. This creates a fresh Session and
makes the path available as a recent navigation hint; it does not import a
client-side Workspace object or guarantee discovery of older Sessions. Do not
copy browser storage between deployments. A complete server-owned catalog is
tracked in [octos#2146](https://github.com/octos-org/octos/issues/2146).

Changing `appui.sessions_in_cwd` cannot make the current response authoritative:
the setting is not returned to the client and the list has no effective scope.
This wire-contract gap is tracked in octos#2146.

## A new session does not open

**New Session** first asks for a recent Workspace path. Choosing it creates a
fresh Web Session; **Add workspace** does the same after accepting a new server
path. There is no user-entered Session identity and neither action means “resume
the canonical TUI coding Session.” The adapter waits for Core's Profile decision
before forming the profile-routable Web identity. If creation is rejected,
verify that the server path remains accessible and has a usable Octos coding
profile. An empty server may open onboarding or direct you to
`octoscode onboard`.

Older clients that opened a bare `web-*` identity through an unscoped admin
credential may have created a Session that Core can open but cannot hydrate. The
browser cannot safely guess a Profile and migrate that history; the Core
resolver defect is tracked in
[octos#2162](https://github.com/octos-org/octos/issues/2162).

If Core returned an unambiguous `activate` decision for a fresh Web Session, the
browser opens it automatically. `cross_profile` still asks which Profile to use;
`no_profile` still requires onboarding or the TUI fallback.

Switching and creating Sessions no longer waits for a source turn ACK or an
empty FIFO. Each confirmed record retains its own queue while another Session is
selected. A destination still needs a valid server path/Profile and a successful
scoped open/hydrate; a failed destination does not replace the source view.
Mutation/recovery locks may still disable unsafe actions.

## An older build reports an eight-connection limit

That message belongs to the superseded per-owner-socket implementation. The
retained-record candidate multiplexes Sessions over one authenticated physical
WebSocket and has no eight-Session navigation limit. Verify the served build
identity and reload the current static bundle; do not disconnect healthy running
work merely to free a supposed Session socket slot.

## A background turn stopped after navigation or refresh

Selecting another Session does not close the shared WebSocket or move the source
queue. Check for a socket/proxy failure, daemon restart, or explicit interrupt
if a background turn stops. An empty Session is idle, not completed; only a
retained canonical turn terminal supplies a completed/failed work badge.

Core rc11 still interrupts connection-owned work when the pooled socket closes,
including a `connection_closed` terminal on ordinary connection teardown.
Refresh, tab close, network/proxy loss, and **Disconnect** cannot preserve that
execution. Daemon restart also requires authoritative reconciliation, not a
claim that old work kept running. Ordinary reconnect retains local pending
prompts in memory and pauses dispatch until each Session recovers; it does not
blindly retry an ambiguous sent turn. Reload loses unsent prompts and image
drafts. Confirmed refs can survive a same-tab refresh or Disconnect, but are
only navigation hints. **Forget server** or changing endpoint/token identity
clears them. Durable detached execution needs a Core contract, not browser
storage.

## Full access cannot be selected

The composer shows only complete permission and network combinations advertised
for the selected Session. Full access is absent or disabled when the server does
not allow it; the browser cannot promote its own authority. When available,
selecting it requires explicit risk acknowledgement. Durable policy and
authenticated administration are tracked in
[octos#2147](https://github.com/octos-org/octos/issues/2147).

## A model is missing or Profile default differs from Session runtime

The composer reports the effective model from the selected Session's runtime; it
is not a Session-level selector. **Settings → Models** separately reads the
configured provider/model/routes and, when each Core method is advertised,
offers Test, Fetch models, Save, Delete, and Profile-default selection. Missing
controls mean that operation was not advertised; the Web does not infer it from
another model capability.

**Fetch models** is only provider discovery. Some compatible inference routes do
not expose a model catalog, so an empty or unavailable result does not prove
that the API key is wrong. Keep the manually entered model id and use **Test**
to verify the exact draft. For GLM-5.3-Flash, the exact id is `glm-5.3-flash`.

A saved API key is intentionally never displayed again. A blank field with a
configured indicator means Core has a value; leave it blank to reuse that key,
or enter a new key to replace it. The Web never stores it in browser storage and
Core returns only `has_api_key`. This does not imply that Core encrypts the
server-side value.

If Settings says a restart is required, the saved Profile default and the model
served by the current Octos process are intentionally shown as different values.
Restart Octos before expecting new turns to use the default. A true
Session-scoped override is tracked in
[octos#2148](https://github.com/octos-org/octos/issues/2148).

Web and the pinned TUI have no inference-override editor. Core rc11 nevertheless
supports typed per-model `temperature`, `top_p`, `context_window`, reasoning
defaults, and compatibility hints; Web preserves those configured values while
editing a provider. If an entry contains fields this editor cannot preserve,
edit it through Core configuration instead. `max_output_tokens` belongs to the
Profile gateway and is rejected by the model upsert contract. The separate
`/thinking` control snapshots reasoning effort into new and queued Session
turns.

If using GLM Coding Plan, confirm that your tool is in Z.AI's
[official supported-tool list](https://docs.z.ai/devpack/tool/others). Octos is
not currently named there; use the normal API endpoint unless Z.AI has granted
separate authorization.

## Recovery is stuck

The app pauses prompts until hydrate and durable cursor replay agree. A gap,
lossy replay signal, or wrong-session envelope causes another authoritative
hydrate instead of continuing with partial state. If reconnect keeps failing,
verify server availability and disconnect/reconnect explicitly; do not clear
browser storage because durable state is not stored there.

## Onboarding falls back to the TUI

Browser onboarding appears only if the server advertises the complete solo
onboarding method set. Upgrade Core or run `octoscode onboard`; the client does
not guess missing provider APIs.

## A slash or bang command is unavailable

Unknown slash commands fail closed. `!` executes on the TUI host and therefore
cannot be emulated safely by a browser. Use the TUI for host shell commands.

The expanded parity surface is still a candidate. **Refresh blackboard** in
`/peer` is deliberately read-only. `/gather [all|slug…]` instead reads peer
results and queues a synthesis prompt in its originating Session; empty results
create no turn. A blocked/stale receipt does not silently retry. A blackboard
read is not synthesis completion; see [Feature parity](feature-parity.md) for
current acceptance and remaining gaps.

## A transcript image shows only alt text

Remote model-authored images are not loaded automatically because they can leak
the browser's network identity without a user gesture. Explicit HTTPS links
remain clickable.
