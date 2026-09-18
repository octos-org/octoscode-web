import { supportsMethod } from "./interaction.ts";
import {
  PEER_METHODS,
  PeerProtocolError,
  PeerCapabilityError,
  type PeerCommands,
  type PeerScope,
} from "./peer-protocol.ts";
import type { UiProtocolCapabilities } from "./types.ts";
import { buildPeerPrepareParams } from "./peer-prepare.ts";
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const profile = (v: unknown): v is string => text(v) && !/[:#\s]/u.test(v);
const slug = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(v);
/** Explicit whitelist: callers cannot override captured routing with extra object fields. */
export function createPeerCommands(
  rpc: { request(method: string, params: unknown): Promise<unknown> },
  scope: PeerScope,
  caps: UiProtocolCapabilities | undefined,
): PeerCommands {
  if (!text(scope.sessionId) || !profile(scope.profileId) || !scope.authority)
    throw new PeerProtocolError("A confirmed peer scope is required");
  const bound = Object.freeze({
    sessionId: scope.sessionId,
    profileId: scope.profileId,
    authority: scope.authority,
  });
  const capabilities = Object.freeze({
    prepare: supportsMethod(caps, PEER_METHODS.PREPARE),
    gather: supportsMethod(caps, PEER_METHODS.GATHER),
    staged:
      caps?.supported_notifications.includes(PEER_METHODS.STAGED) ?? false,
    closed:
      caps?.supported_notifications.includes(PEER_METHODS.CLOSED) ?? false,
  });
  return {
    scope: bound,
    capabilities,
    async prepare(params) {
      if (!capabilities.prepare)
        throw new PeerCapabilityError(PEER_METHODS.PREPARE);
      const input = buildPeerPrepareParams(params);
      const value = await rpc.request(PEER_METHODS.PREPARE, {
        ...input,
        session_id: bound.sessionId,
        profile_id: bound.profileId,
      });
      const { parsePeerPrepareResult } = await import("./peer-results.ts");
      const parsed = parsePeerPrepareResult(value, bound.profileId);
      if (!parsed || (parsed.peers.length || 1) !== (input.n ?? 1))
        throw new PeerProtocolError(
          "Invalid or wrong-profile peer prepare result; staging may have completed",
        );
      return parsed;
    },
    async gather(params = {}) {
      if (!capabilities.gather)
        throw new PeerCapabilityError(PEER_METHODS.GATHER);
      if (
        params.slugs !== undefined &&
        (!Array.isArray(params.slugs) || !params.slugs.every(slug))
      )
        throw new PeerProtocolError("Invalid peer gather filter");
      const slugs = params.slugs === undefined ? undefined : [...params.slugs];
      const value = await rpc.request(PEER_METHODS.GATHER, {
        session_id: bound.sessionId,
        profile_id: bound.profileId,
        ...(slugs === undefined ? {} : { slugs }),
      });
      const { parsePeerGatherResult } = await import("./peer-results.ts");
      const parsed = parsePeerGatherResult(value, bound.profileId);
      if (
        !parsed ||
        (slugs !== undefined &&
          parsed.peers.some((row) => !slugs.includes(row.slug)))
      )
        throw new PeerProtocolError(
          "Invalid or wrong-profile peer gather result",
        );
      return parsed;
    },
  };
}
