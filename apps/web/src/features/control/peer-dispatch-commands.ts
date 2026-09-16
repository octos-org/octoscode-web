/**
 * peer-dispatch-commands — the PURE mapping from one pending peer to the
 * client's single `peer/dispatch` leaf (design 1120, build 1230).
 *
 * Where `peer-control-commands.ts` maps the four product CONTROL commands onto
 * an ALREADY-ACCEPTED dispatch, this module maps the STAGING of a peer itself:
 * one activation ⇒ exactly ONE `peer/dispatch` frame. There is no retry here,
 * no implicit acquire, and no ambient fence — the caller-held fence
 * (`driverId`/`epoch`/`controlToken`) is an argument on the call, exactly as
 * the leaf demands (external-driver-peer-control.ts:155).
 *
 * Types are DERIVED from the client's public `ExternalDriverCommands` surface so
 * this module can never drift from the leaf's real argument shape. No snake_case
 * appears here — the leaf owns the wire encoding.
 */
import type { ExternalDriverCommands } from "@octos-org/octoscode-client/external-driver-meta";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client/protocol";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
} from "@octos-org/octoscode-client/external-driver-meta";
import type { PeerControlFence } from "./peer-control-commands.ts";

export type { PeerControlFence };

/** The minimal leaf this surface needs: the single `peerDispatch` method. */
export type PeerDispatchLeaf = Pick<ExternalDriverCommands, "peerDispatch">;

/** The leaf's own parameter view (camelCase; wire casing is the leaf's job). */
export type PeerDispatchParams = Parameters<
  PeerDispatchLeaf["peerDispatch"]
>[0];

/**
 * Fail-closed capability gate: `peer/dispatch` must be in `supported_methods`
 * AND `external_driver_v1` in `supported_features`. An absent capability block
 * (or a missing either half) is NOT admitted — never a cast, never a guess.
 */
export function peerDispatchAdmitted(
  capabilities: UiProtocolCapabilities | undefined,
): boolean {
  if (capabilities === undefined) return false;
  const methods = capabilities.supported_methods;
  const features = capabilities.supported_features;
  return (
    Array.isArray(methods) &&
    methods.includes(EXTERNAL_DRIVER_METHODS.PEER_DISPATCH) &&
    Array.isArray(features) &&
    features.includes(EXTERNAL_DRIVER_V1_FEATURE)
  );
}

/**
 * §6 recovery copy for a typed dispatch refusal kind (design 4000): task
 * words, never protocol vocabulary. Unknown kinds degrade to a generic label
 * — raw server copy is never rendered.
 */
const PEER_DISPATCH_REFUSAL_LABELS: Readonly<Record<string, string>> = {
  driver_scope_mismatch: "This session can't be controlled from here",
  driver_fence_stale: "Your control of this session expired",
  driver_revision_conflict: "This session changed hands; refresh and try again",
  driver_busy_handover: "This session is changing hands right now",
  driver_operation_conflict:
    "A different request already used this id — nothing was sent",
  driver_model_unavailable: "That model is not configured on this server",
};

export function peerDispatchRefusalLabel(kind: string): string {
  return PEER_DISPATCH_REFUSAL_LABELS[kind] ?? "Couldn't start that peer.";
}

/** The pre-dispatch facts ONE `peer/dispatch` frame is built from. */
export interface PeerDispatchSeed {
  readonly brief: string;
  readonly slug: string;
  readonly prompt: string;
}

/**
 * Build the exact leaf argument for ONE staging dispatch (pure; no I/O).
 * The operation id is MINTED by the caller and reused verbatim on every retry
 * of the same staging, so a lost-ack replay dedupes server-side.
 */
export function buildPeerDispatchParams(
  fence: PeerControlFence,
  operationId: string,
  seed: PeerDispatchSeed,
  modelLane: string,
): PeerDispatchParams {
  return {
    driverId: fence.driverId,
    epoch: fence.epoch,
    controlToken: fence.controlToken,
    operationId,
    // The REQUESTED lane key, echoed back as the receipt's modelLane — never a
    // locally resolved model.
    model: modelLane,
    dispatch: {
      kind: "new_brief",
      brief: seed.brief,
      title: seed.slug,
    },
    ...(seed.prompt
      ? { kickoffInput: [{ kind: "text", text: seed.prompt }] }
      : {}),
  };
}
