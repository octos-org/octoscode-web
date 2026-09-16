import { isRecord } from "./rpc.ts";
import type {
  PeerPrepareResult,
  PeerGatherResult,
  PeerFleetEntry,
  PeerGatherEntry,
} from "./peer-protocol.ts";
// Keep receipt-only validation out of the background lifecycle subscription path.
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const profile = (v: unknown): v is string => text(v) && !/[:#\s]/u.test(v);
const slug = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(v);
const uint = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const optionalText = (v: unknown): boolean => v == null || text(v);
function parsePeerFleetEntry(value: unknown): PeerFleetEntry | null {
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

export function parsePeerPrepareResult(
  value: unknown,
  profileId: string,
): PeerPrepareResult | null {
  const head = parsePeerFleetEntry(value);
  if (!head || head.profile_id !== profileId || !isRecord(value)) return null;
  // Old scalar-only servers omit peers; do not silently drop malformed fleet members.
  if (value.peers !== undefined && !Array.isArray(value.peers)) return null;
  const values: unknown[] =
    value.peers === undefined ? [] : (value.peers as unknown[]);
  if (values.length > 8) return null;
  const peers: PeerFleetEntry[] = [];
  const seen = new Set<string>();
  for (const row of values) {
    const entry = parsePeerFleetEntry(row);
    if (!entry || entry.profile_id !== profileId || seen.has(entry.topic))
      return null;
    seen.add(entry.topic);
    peers.push(entry);
  }
  const first = peers[0];
  if (
    first &&
    (first.slug !== head.slug ||
      first.topic !== head.topic ||
      first.cwd !== head.cwd ||
      first.brief_path !== head.brief_path ||
      first.worktree_branch !== head.worktree_branch)
  )
    return null;
  return { ...head, peers };
}

export function parsePeerGatherResult(
  value: unknown,
  profileId: string,
): PeerGatherResult | null {
  if (
    !isRecord(value) ||
    value.profile_id !== profileId ||
    !Array.isArray(value.peers)
  )
    return null;
  const peers: PeerGatherEntry[] = [];
  const seen = new Set<string>();
  for (const row of value.peers) {
    if (
      !isRecord(row) ||
      !slug(row.slug) ||
      row.topic !== `peer-${row.slug}` ||
      seen.has(row.slug) ||
      !optionalText(row.name) ||
      typeof row.brief !== "string" ||
      typeof row.brief_truncated !== "boolean" ||
      !(row.result === null || typeof row.result === "string") ||
      typeof row.result_truncated !== "boolean" ||
      !(row.result_updated_unix === null || uint(row.result_updated_unix)) ||
      typeof row.has_worktree !== "boolean" ||
      typeof row.closed !== "boolean"
    )
      return null;
    seen.add(row.slug);
    peers.push({
      slug: row.slug,
      topic: row.topic,
      ...(typeof row.name === "string" ? { name: row.name } : {}),
      brief: row.brief,
      brief_truncated: row.brief_truncated,
      result: row.result,
      result_truncated: row.result_truncated,
      result_updated_unix: row.result_updated_unix,
      has_worktree: row.has_worktree,
      closed: row.closed,
    });
  }
  return { profile_id: profileId, peers };
}
