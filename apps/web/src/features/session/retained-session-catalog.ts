import {
  knownSessionKey,
  type KnownSessionRef,
} from "./known-session-registry.ts";

/** Confirmed background forks/peers must be selectable without first stealing focus. */
export function mergeConfirmedRetainedSessions(
  remembered: readonly KnownSessionRef[],
  retained: readonly Pick<
    KnownSessionRef,
    "sessionId" | "profileId" | "workspaceRoot"
  >[],
): KnownSessionRef[] {
  const merged = new Map(
    remembered.map((entry) => [knownSessionKey(entry), entry]),
  );
  for (const entry of retained) {
    const key = knownSessionKey(entry);
    if (!merged.has(key)) merged.set(key, { ...entry, lastOpenedAt: 0 });
  }
  return [...merged.values()];
}
