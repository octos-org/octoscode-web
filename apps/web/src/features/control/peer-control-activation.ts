/**
 * peer-control-activation — the ONE activation → state machine for the peer
 * control seat (align round 2, 1640).
 *
 * The seat mounts, but a bare command activation is a silent NO-OP unless a
 * caller wires `onSend` AND the command survives the leaf's OFFLINE encoder.
 * This module is the pure seam between the panel's activation sink and the
 * client leaf: exactly ONE `peer/control` frame per activation, never a retry
 * (the leaf itself has no acquire/renew/fallback — the fence is an argument),
 * and every failure path settles to a BOUNDED presentation state.
 *
 * No React, no timers, no ambient state: `performPeerControl` is a pure async
 * function so it runs under node (apps/web has no jsdom).
 */
import type { PeerControlPanelState } from "./PeerControlPanel.tsx";
import {
  sendPeerControl,
  type PeerControlCommand,
  type PeerControlFence,
  type PeerControlLeaf,
  type PeerControlTarget,
} from "./peer-control-commands.ts";

/**
 * Bounded refusal narrowing: read the allowlisted typed kind off a rejected
 * leaf call. The leaf throws `ExternalDriverRefusalError` (its `refusalKind`
 * is a compile-time allowlisted constant); anything else — a malformed-receipt
 * `ExternalDriverProtocolError`, a transport failure — has NO kind and
 * degrades to the generic refusal copy. Raw server copy is never read.
 */
export function peerControlRefusalKindOf(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const kind = (error as { refusalKind?: unknown }).refusalKind;
  if (typeof kind !== "string" || kind.length === 0) return null;
  return kind;
}

export interface PeerControlActivation {
  readonly leaf: PeerControlLeaf | null;
  readonly fence: PeerControlFence;
  readonly target: PeerControlTarget;
  readonly command: PeerControlCommand;
}

/**
 * Send EXACTLY ONE control command and return the next presentation state.
 * Never throws: a rejection is mapped to `refused` with its typed kind (or the
 * generic kind-less state), so the caller can set state without a try/catch.
 */
export async function performPeerControl(
  activation: PeerControlActivation,
): Promise<PeerControlPanelState> {
  const { leaf, fence, target, command } = activation;
  if (leaf === null) {
    return { kind: "refused", refusalKind: "peer_control_unavailable" };
  }
  try {
    const receipt = await sendPeerControl(leaf, fence, target, command);
    return { kind: "receipt", receipt };
  } catch (error) {
    const refusalKind = peerControlRefusalKindOf(error);
    return refusalKind === null
      ? { kind: "refused", refusalKind: "peer_control_refused" }
      : { kind: "refused", refusalKind };
  }
}
