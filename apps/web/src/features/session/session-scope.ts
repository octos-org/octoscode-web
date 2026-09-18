/**
 * Durable Session identity for the persistent record manager. A Session is NOT
 * identified by sessionId alone: the endpoint, workspace root, and profile are
 * part of the key, and an opaque authority epoch distinguishes the AUTH identity
 * behind a reconnect (same URL, different login = new epoch). The epoch is a
 * monotonically increasing opaque counter — NEVER credentials — so keys/logs
 * stay credential-free.
 */
export interface SessionRuntimeScope {
  endpoint: string;
  workspaceRoot: string;
  profileId: string;
  sessionId: string;
  /** Opaque authority epoch: bumped on every endpoint OR auth change. */
  authorityEpoch: number;
}

export function sessionRuntimeScopeKey(scope: SessionRuntimeScope): string {
  // JSON tuple serialization: a `::` delimiter can collide when any segment
  // contains the delimiter; a JSON array cannot.
  return JSON.stringify([
    scope.endpoint.trim(),
    scope.workspaceRoot.trim(),
    scope.profileId.trim(),
    scope.sessionId.trim(),
    scope.authorityEpoch,
  ]);
}
