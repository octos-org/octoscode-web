/**
 * Chat / Code work modes (two-modes proposal T-A and T-B; Core names them in
 * octos#3255 and octos#3256). The web asks for and reads them only behind its
 * two-modes flag.
 */
export type WorkMode = "chat" | "code";

/** Sessions carry a durable `work_mode` on open and list (T-A). */
export const SESSION_WORK_MODE_UI_FEATURE = "session.work_mode.v1";

/** The server gives every chat its own workspace and lists chats (T-B). */
export const CHAT_WORKSPACE_UI_FEATURE = "session.chat_workspace.v1";

/**
 * Core reports only the features a connection asks for, so Chat is possible
 * only on a connection that requested both.
 */
export const WORK_MODE_UI_FEATURES = [
  SESSION_WORK_MODE_UI_FEATURE,
  CHAT_WORKSPACE_UI_FEATURE,
] as const;

/**
 * Creates a chat under a session id the client chose: the server makes the
 * chat's own folder and binds the id to it (T-B). Opening it afterwards is an
 * ordinary `session/open` with that folder.
 */
export const CHAT_CREATE_METHOD = "session/chat/create";
