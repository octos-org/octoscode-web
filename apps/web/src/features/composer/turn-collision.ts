import {
  isProtocolUuid,
  OctosUiProtocolError,
} from "@octos-org/octoscode-client/protocol";

/**
 * One `octos serve` instance can be shared: the octoscode terminal client and
 * this browser client can open the SAME session, and the server keeps a
 * process-global active-turn registry keyed by session id. When the other
 * client is mid-turn, our `turn/start` is refused.
 *
 * That refusal is ordinary and recoverable — the session is busy, not broken —
 * so it must never read as "Turn rejected" with the operator's text thrown
 * away. This module recognises it and, when the server is new enough to say
 * so, names the turn that is occupying the session.
 */
export interface TurnCollision {
  /**
   * The occupying turn's id, when the server disclosed it. Absent against a
   * server that only sends the prose message: we then know the session is
   * busy but cannot adopt the other client's turn, because a synthetic id
   * would never receive a terminal notification and would wedge the queue.
   */
  turnId?: string;
}

/**
 * The server's human message for this refusal. Matched verbatim as the
 * fallback for servers predating the typed `turn_in_progress` data; the typed
 * form is preferred whenever it is present.
 */
const COLLISION_MESSAGE = "a turn is already running for this session";

/** The typed error kind, shared with the session-rollback guard server-side. */
const COLLISION_KIND = "turn_in_progress";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Classify a failed `turn/start`. Returns null for every other failure so the
 * caller's existing rejection path is untouched.
 */
export function turnCollisionFrom(reason: unknown): TurnCollision | null {
  if (!(reason instanceof OctosUiProtocolError)) return null;
  const data = reason.data;
  const kind = isRecord(data) ? data.kind : undefined;
  const typed = kind === COLLISION_KIND;
  // The message check is a substring, not equality: the transport may prefix
  // the method name. Only the server's own sentence is matched.
  if (!typed && !reason.message.includes(COLLISION_MESSAGE)) return null;
  const turnId = isRecord(data) ? data.turn_id : undefined;
  return isProtocolUuid(turnId) ? { turnId } : {};
}
