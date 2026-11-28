/**
 * Whether a browsed folder is the user's own home directory. The first-run
 * wizard must not offer $HOME as a directly usable workspace: it contains the
 * server's state tree, and Core refuses it with `chat_workspace_reserved`.
 * The detection is deliberately shape-based — the web client has no Core-side
 * registry in the release-blocking path — and covers the standard platforms
 * (`/home/<user>`, `/Users/<user>`, `C:\Users\<user>`). A project folder
 * merely NAMED `home` under a project tree does not match.
 */
export function isUserHomeRoot(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return /^\/(home|Users)\/[^/]+\/?$/.test(normalized) ||
    /^[A-Za-z]:\/Users\/[^/]+\/?$/.test(normalized);
}
