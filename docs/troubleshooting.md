# Troubleshooting

## The browser cannot connect

- Confirm `octos serve` is running and `/health` responds from the browser's
  network location.
- Use `https://` for a remote endpoint; the client derives `wss://`.
- Configure the Web origin in `OCTOS_APPUI_ALLOWED_ORIGINS`.
- Re-enter the token. Tokens are intentionally memory-only and disappear on
  reload.

## A workspace path does not open

The path is resolved on the `octos serve` host, not on the browser computer. The
server's workspace-root policy remains authoritative. A `/path` containing
another slash is treated as prompt text, while a recognized `/command` is
resolved locally and never sent to the model.

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
