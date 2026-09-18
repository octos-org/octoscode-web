import { PeerProtocolError, type PeerPrepareParams } from "./peer-protocol.ts";
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const uint = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function buildPeerPrepareParams(
  params: PeerPrepareParams,
): PeerPrepareParams {
  if (
    !text(params.brief) ||
    new TextEncoder().encode(params.brief.trim()).length > 65536 ||
    (params.n !== undefined &&
      (!uint(params.n) || params.n < 1 || params.n > 8)) ||
    (params.title !== undefined && !text(params.title)) ||
    (params.cwd !== undefined && !text(params.cwd)) ||
    (params.worktree !== undefined && typeof params.worktree !== "boolean")
  )
    throw new PeerProtocolError("Invalid peer prepare parameters");
  if (
    params.names !== undefined &&
    (!Array.isArray(params.names) ||
      params.names.length !== (params.n ?? 1) ||
      params.names.some(
        (name) => !text(name) || [...name.trim()].length > 64,
      ) ||
      new Set(params.names.map((name) => name.trim().toLowerCase())).size !==
        params.names.length)
  )
    throw new PeerProtocolError(
      "Peer names must be non-empty, unique, and match the fleet size",
    );
  return {
    brief: params.brief.trim(),
    ...(params.n === undefined ? {} : { n: params.n }),
    ...(params.title === undefined ? {} : { title: params.title.trim() }),
    ...(params.names === undefined
      ? {}
      : { names: params.names.map((name) => name.trim()) }),
    ...(params.cwd === undefined ? {} : { cwd: params.cwd }),
    ...(params.worktree === undefined ? {} : { worktree: params.worktree }),
  };
}
