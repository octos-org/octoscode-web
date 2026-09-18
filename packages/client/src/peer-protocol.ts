import { isRecord, type RpcNotification } from "./rpc.ts";
import { CORE_UI_METHODS } from "./generated/core-contract.ts";

// rc11 raw_peer_prepare/raw_peer_gather are AppUI extensions, not generated RPCs.
export const PEER_METHODS = {
  PREPARE: "peer/prepare",
  GATHER: "peer/gather",
  STAGED: CORE_UI_METHODS.PEER_STAGED,
  CLOSED: CORE_UI_METHODS.PEER_CLOSED,
} as const;

/**
 * A non-secret authenticated owner token, stable through ordinary transport
 * reconnects. Replace it when authentication or the master's workspace binding
 * changes. Commands object identity separately fences each transport incarnation.
 */
export interface PeerScope {
  readonly sessionId: string;
  readonly profileId: string;
  readonly authority: object;
}

export function samePeerScope(
  a: PeerScope | null,
  b: PeerScope | null,
): boolean {
  return (
    a !== null &&
    b !== null &&
    a.sessionId === b.sessionId &&
    a.profileId === b.profileId &&
    a.authority === b.authority
  );
}

export interface PeerCapabilities {
  readonly prepare: boolean;
  readonly gather: boolean;
  readonly staged: boolean;
  readonly closed: boolean;
}

export interface PeerPrepareParams {
  brief: string;
  n?: number;
  title?: string;
  names?: string[];
  worktree?: boolean;
  cwd?: string;
}
export interface PeerGatherParams {
  slugs?: string[];
}
export interface PeerFleetEntry {
  slug: string;
  topic: string;
  profile_id: string;
  cwd: string;
  brief_path: string;
  worktree_branch?: string;
}
export interface PeerPrepareResult extends PeerFleetEntry {
  peers: PeerFleetEntry[];
}
export interface PeerGatherEntry {
  slug: string;
  topic: string;
  name?: string;
  brief: string;
  brief_truncated: boolean;
  result: string | null;
  result_truncated: boolean;
  result_updated_unix: number | null;
  has_worktree: boolean;
  closed: boolean;
}
/** Gather is PROFILE-wide. Rows do not assert an originating session or workspace. */
export interface PeerGatherResult {
  profile_id: string;
  peers: PeerGatherEntry[];
}
export interface PeerStagedParams extends PeerFleetEntry {
  session_id: string;
  brief: string;
}
export interface PeerClosedParams {
  session_id: string;
  profile_id: string;
  topic: string;
  slug: string;
}
export type PeerNotification =
  | { kind: "staged"; event: PeerStagedParams }
  | { kind: "closed"; event: PeerClosedParams };

export class PeerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeerProtocolError";
  }
}
export class PeerCapabilityError extends Error {
  constructor(method: string) {
    super(`${method} is not advertised by the connected server`);
    this.name = "PeerCapabilityError";
  }
}
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const profile = (v: unknown): v is string => text(v) && !/[:#\s]/u.test(v);
const slug = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(v);
const optionalText = (v: unknown): boolean => v == null || text(v);

export function peerIdentityForTopic(profileId: string, topic: string): string {
  if (
    !profile(profileId) ||
    !topic.startsWith("peer-") ||
    !slug(topic.slice(5))
  )
    throw new PeerProtocolError("Invalid native peer identity");
  return `${profileId}:local:tui#${topic}`;
}

export function parsePeerFleetEntry(value: unknown): PeerFleetEntry | null {
  if (
    !isRecord(value) ||
    !slug(value.slug) ||
    value.topic !== `peer-${value.slug}` ||
    !profile(value.profile_id) ||
    !text(value.cwd) ||
    !text(value.brief_path) ||
    !optionalText(value.worktree_branch)
  )
    return null;
  return {
    slug: value.slug,
    topic: value.topic,
    profile_id: value.profile_id,
    cwd: value.cwd,
    brief_path: value.brief_path,
    ...(typeof value.worktree_branch === "string"
      ? { worktree_branch: value.worktree_branch }
      : {}),
  };
}

export function parsePeerNotification(
  notification: Pick<RpcNotification, "method" | "params">,
  scope: PeerScope,
): PeerNotification | null {
  const value = notification.params;
  if (
    !isRecord(value) ||
    value.session_id !== scope.sessionId ||
    value.profile_id !== scope.profileId
  )
    return null;
  if (notification.method === PEER_METHODS.STAGED) {
    const entry = parsePeerFleetEntry(value);
    if (!entry || !text(value.brief)) return null;
    return {
      kind: "staged",
      event: { ...entry, session_id: scope.sessionId, brief: value.brief },
    };
  }
  if (
    notification.method === PEER_METHODS.CLOSED &&
    slug(value.slug) &&
    value.topic === `peer-${value.slug}`
  ) {
    return {
      kind: "closed",
      event: {
        session_id: scope.sessionId,
        profile_id: scope.profileId,
        slug: value.slug,
        topic: value.topic,
      },
    };
  }
  return null;
}

export interface PeerCommands {
  readonly scope: PeerScope;
  readonly capabilities: PeerCapabilities;
  prepare(params: PeerPrepareParams): Promise<PeerPrepareResult>;
  gather(params?: PeerGatherParams): Promise<PeerGatherResult>;
}

/** Validate/copy before dispatch so a rejected local draft is safe to correct and retry. */
