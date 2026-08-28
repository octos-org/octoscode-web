import type { SessionOpened } from "@octos-org/octoscode-client";

const MAX_KNOWN_SESSIONS = 100;
const LIMITS = {
  sessionId: 1_024,
  profileId: 512,
  workspaceRoot: 4_096,
} as const;

/**
 * A Session reference this browser tab has successfully opened.
 *
 * This is deliberately not a server catalog. It contains only the minimum
 * routing metadata echoed by session/open plus a local recency timestamp. In
 * particular, conversation titles, prompts, credentials, and model output do
 * not belong in this cache.
 */
export interface KnownSessionRef {
  sessionId: string;
  profileId: string;
  workspaceRoot: string;
  lastOpenedAt: number;
}

/**
 * Project one decoded session/open result into the bounded tab cache schema.
 * Missing scope proof fails closed: older servers that omit profile or
 * workspace identity remain current-session-only.
 */
export function knownSessionFromOpened(
  opened: SessionOpened,
  now = Date.now(),
): KnownSessionRef | null {
  const sessionId = boundedText(opened.session_id, LIMITS.sessionId);
  const profileId = boundedText(opened.active_profile_id, LIMITS.profileId);
  const workspaceRoot = boundedText(
    opened.workspace_root,
    LIMITS.workspaceRoot,
  );
  const lastOpenedAt = timestamp(now);
  if (!sessionId || !profileId || !workspaceRoot || lastOpenedAt === null) {
    return null;
  }
  return { sessionId, profileId, workspaceRoot, lastOpenedAt };
}

/** Parse untrusted browser state without accepting a partially valid catalog. */
export function parseKnownSessionRegistry(value: unknown): KnownSessionRef[] {
  if (!Array.isArray(value) || value.length > MAX_KNOWN_SESSIONS) return [];
  const parsed = value.map(parseKnownSession);
  if (parsed.some((entry) => entry === null)) return [];
  return canonicalize(parsed as KnownSessionRef[]);
}

/** Upsert only a server-confirmed Session and retain a bounded LRU projection. */
export function rememberKnownSession(
  current: readonly KnownSessionRef[],
  opened: SessionOpened,
  now = Date.now(),
): KnownSessionRef[] {
  const next = knownSessionFromOpened(opened, now);
  if (!next) return canonicalize(current);
  const nextKey = knownSessionKey(next);
  return canonicalize([
    next,
    ...current.filter((entry) => knownSessionKey(entry) !== nextKey),
  ]);
}

/** The compatibility identity is a tuple until Core provides an opaque SessionRef. */
export function knownSessionKey(
  session: Pick<KnownSessionRef, "sessionId" | "profileId" | "workspaceRoot">,
): string {
  return JSON.stringify([
    session.workspaceRoot,
    session.profileId,
    session.sessionId,
  ]);
}

function canonicalize(entries: readonly KnownSessionRef[]): KnownSessionRef[] {
  const byKey = new Map<string, KnownSessionRef>();
  for (const entry of [...entries].sort(compareRecency)) {
    const parsed = parseKnownSession(entry);
    if (!parsed) continue;
    const key = knownSessionKey(parsed);
    if (!byKey.has(key)) byKey.set(key, parsed);
    if (byKey.size >= MAX_KNOWN_SESSIONS) break;
  }
  return [...byKey.values()];
}

function parseKnownSession(value: unknown): KnownSessionRef | null {
  if (!isRecord(value)) return null;
  const sessionId = boundedText(value.sessionId, LIMITS.sessionId);
  const profileId = boundedText(value.profileId, LIMITS.profileId);
  const workspaceRoot = boundedText(value.workspaceRoot, LIMITS.workspaceRoot);
  const lastOpenedAt = timestamp(value.lastOpenedAt);
  if (!sessionId || !profileId || !workspaceRoot || lastOpenedAt === null) {
    return null;
  }
  return { sessionId, profileId, workspaceRoot, lastOpenedAt };
}

function boundedText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= limit ? text : null;
}

function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function compareRecency(left: KnownSessionRef, right: KnownSessionRef): number {
  return right.lastOpenedAt - left.lastOpenedAt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
