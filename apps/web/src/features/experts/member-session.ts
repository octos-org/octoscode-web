import {
  OctosUiProtocolError,
  type HydratedFileMutation,
  type HydratedTurn,
  type SessionHydrateParams,
} from "@octos-org/octoscode-client/protocol";

/** The two calls a refreshed page needs on a member's own session. */
export interface MemberSessionClient {
  hydrateSession(params: SessionHydrateParams): Promise<{
    turns?: readonly HydratedTurn[];
    file_mutations?: readonly HydratedFileMutation[];
  }>;
  interruptTurn(sessionId: string, turnId: string): Promise<unknown>;
}

/** The member's turns, and nothing else, from `session/hydrate`. */
export function readMemberTurns(
  client: MemberSessionClient,
  sessionId: string,
): Promise<readonly HydratedTurn[] | null> {
  return client
    .hydrateSession({ session_id: sessionId, include: ["turns"] })
    .then((result) => result.turns ?? null);
}

/**
 * The files the member's tools changed. Core only sends them with the
 * messages section; a member's session is a few turns, so that stays small.
 */
export function readMemberFiles(
  client: MemberSessionClient,
  sessionId: string,
): Promise<readonly HydratedFileMutation[] | null> {
  return client
    .hydrateSession({ session_id: sessionId, include: ["messages"] })
    .then((result) => result.file_mutations ?? null);
}

/**
 * `turn/interrupt` for exactly this turn. Core refuses a turn id that is no
 * longer running (`turn_id_mismatch`, or an error for an unknown turn): that
 * is a definite no, not a failure, and is never retried here.
 */
export async function stopMemberTurn(
  client: MemberSessionClient,
  sessionId: string,
  turnId: string,
): Promise<"stopped" | "declined" | "failed"> {
  try {
    const result = await client.interruptTurn(sessionId, turnId);
    const answer =
      typeof result === "object" && result !== null
        ? (result as { interrupted?: unknown; accepted?: unknown })
        : {};
    return answer.interrupted === true || answer.accepted === true
      ? "stopped"
      : "declined";
  } catch (error) {
    return error instanceof OctosUiProtocolError ? "declined" : "failed";
  }
}
