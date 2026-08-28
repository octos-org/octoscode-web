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
shows only the Session that this client successfully opened or restored. Core
rc.9 can route an unscoped/admin `session/list({cwd})` through `_main` instead
of the Workspace's coding Profile, or silently ignore cwd, without reporting the
effective scope. The Web rejects those rows instead of placing them under the
wrong Workspace. A new tab therefore begins with no Workspace recents even
though the durable server has other work; only the endpoint survives.

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

Session switching and creation are disabled while the selected Session has an
active turn or queued prompts. Stop or finish that work before switching.

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

Temperature, `top_p`, maximum-token/context values, and reasoning controls are
not missing because of a collapsed panel: the current Core AppUI configuration
contract cannot persist them. Configure supported runtime parameters outside the
Web until Core exports an explicit contract.

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

## A transcript image shows only alt text

Remote model-authored images are not loaded automatically because they can leak
the browser's network identity without a user gesture. Explicit HTTPS links
remain clickable.
