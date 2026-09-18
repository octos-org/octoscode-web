/**
 * Server-lifecycle methods. Optional: a server offers them only where they are
 * safe — `server/shutdown` exists only on a local `octos serve --solo` over
 * HTTP — so gate on `supportsMethod(capabilities, …)` before calling.
 */
export const APPUI_SERVER_METHODS = {
  SHUTDOWN: "server/shutdown",
} as const;
