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
export function launchFailureMessage(reason: unknown): string {
  if (
    reason instanceof Error &&
    reason.name === "OctosUiConnectionClosedError" &&
    (reason as Error & { code?: number }).code === 1008
  )
    return PROFILE_ACCESS_DENIED_MESSAGE;
  return errorMessage(reason);
}
