/**
 * Chat / Code work modes (docs: octoscode-web-vnext two-modes proposal, T-A
 * and T-B). PROVISIONAL: Core has not named these on the wire yet. The web
 * reads them only behind its two-modes flag; rename them here, and in the
 * fixture, once Core's protocol proposal lands.
 */
export type WorkMode = "chat" | "code";

/** Sessions carry a durable `work_mode` on open and list (T-A). */
export const SESSION_WORK_MODE_UI_FEATURE = "session.work_mode.v1";

/** The server gives every chat its own workspace and lists chats (T-B). */
export const CHAT_WORKSPACE_UI_FEATURE = "session.chat_workspace.v1";

/**
 * Creates a chat under a session id the client chose: the server makes the
 * chat's own folder and binds the id to it (T-B). Opening it afterwards is an
 * ordinary `session/open` with that folder.
 */
export const CHAT_CREATE_METHOD = "session/chat/create";
