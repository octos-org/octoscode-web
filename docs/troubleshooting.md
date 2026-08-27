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

“Could not open the Octos UI Protocol connection” means the WebSocket handshake
failed before `session/open`. Workspace, profile, and session errors occur only
after the socket opens and retain the server's specific error text.

## A workspace path does not open

The path is resolved on the `octos serve` host, not on the browser computer. The
server's workspace-root policy remains authoritative. A `/path` containing
another slash is treated as prompt text, while a recognized `/command` is
resolved locally and never sent to the model.

## A new session does not open

**New** creates a server-owned `<profile>:api:web-<uuid>` session in the active
workspace; there is no browser-owned session registry or user-entered identity.
Keeping the active profile in the id lets hydrate, task, and permission methods
route correctly even when the connection uses a global serve token rather than
profile-bound authentication. If it is rejected, verify that the current profile
still exists and that the server-confirmed workspace root remains accessible.
Existing rows come from `session/list`, not browser storage.

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
