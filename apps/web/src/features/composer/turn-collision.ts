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
 * away. Core names the turn that is occupying the session in typed error data.
 */
export interface TurnCollision {
  turnId: string;
}

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
  return isRecord(data) &&
    data.kind === "turn_in_progress" &&
    isProtocolUuid(data.turn_id)
    ? { turnId: data.turn_id }
    : null;
}
