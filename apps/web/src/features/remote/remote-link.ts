import type { ActiveSessionRuntimeSnapshot } from "../session/active-session-runtime.ts";

/**
 * Whether the phone can reach Octos right now. A short drop shows as
 * reconnecting; after a few failed attempts, or when the transport gave up,
 * the overview says plainly that the server is unreachable. Nothing on the
 * phone is queued or pretended to be sent while it is not online.
 */
export type RemoteLink =
  | { kind: "online" }
  | { kind: "reconnecting"; attempt: number }
  | { kind: "offline"; attempt: number };

export const OFFLINE_AFTER_ATTEMPTS = 3;

export function remoteLink(
  server: Pick<ActiveSessionRuntimeSnapshot, "phase" | "status" | "recovery">,
): RemoteLink {
  if (
    server.status === "connected" &&
    (server.phase === "authenticated" ||
      server.phase === "ready" ||
      server.phase === "recovering")
  )
    return { kind: "online" };
  const attempt = server.recovery.reconnectAttempt;
  if (
    server.phase === "error" ||
    server.phase === "disconnected" ||
    attempt >= OFFLINE_AFTER_ATTEMPTS
  )
    return { kind: "offline", attempt };
  return { kind: "reconnecting", attempt };
}
