import { errorMessage } from "../../shared/errors.ts";

export const PROFILE_ACCESS_DENIED_MESSAGE =
  "This account can't open the Profile for this folder. Choose another folder, or ask the server admin for access and try again.";

/**
 * Core closes the socket with 1008 when a launch asks for a Profile outside the
 * authenticated identity (and drops the RPC error behind that close). The close
 * reason still reads `auth_expired` for the retired SPA, but the token is valid:
 * a really bad one fails the reconnect handshake and takes the connection path.
 * So this is a permission message, and nothing clears the token here.
 *
 * The error class lives in the lazily loaded transport; match its stable name
 * instead of importing it for instanceof.
 */
export const CHAT_WORKSPACE_RESERVED_MESSAGE =
  "This folder contains or belongs to a protected Chat workspace and cannot be used for coding. Choose a different folder — for example a project subfolder.";

const RECORD = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The launch's typed refusal from `session/open`: Core rejects a folder that
 * is at/below a reserved Chat root or inside the state tree
 * (`-32120 chat_workspace_reserved`). The recovery is a different folder, so
 * the reason must survive the launch path as an actionable message instead of
 * the generic "session could not be opened".
 */
export function isChatWorkspaceReservedError(reason: unknown): boolean {
  return (
    reason instanceof Error &&
    RECORD((reason as Error & { data?: unknown }).data) &&
    (reason as Error & { data: Record<string, unknown> }).data.kind ===
      "chat_workspace_reserved"
  );
}

export function launchFailureMessage(reason: unknown): string {
  if (isChatWorkspaceReservedError(reason))
    return CHAT_WORKSPACE_RESERVED_MESSAGE;
  if (
    reason instanceof Error &&
    reason.name === "OctosUiConnectionClosedError" &&
    (reason as Error & { code?: number }).code === 1008
  )
    return PROFILE_ACCESS_DENIED_MESSAGE;
  return errorMessage(reason);
}
