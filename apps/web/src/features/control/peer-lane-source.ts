/**
 * peer-lane-source — the ONE sanctioned LANE SOURCE for a peer dispatch
 * (program WEB-PEER-CONTROLLER-2800 §1, grant 2810).
 *
 * Lane keys come from the profile's REAL `profile/sub_providers` rows read
 * through the existing `researchCommands` → `parseResearchLanes` path, and from
 * nowhere else: a lane key is a server fact, never a client literal. The OUP
 * boundary string is NOT a lane, and no fixture key is ever assumed.
 *
 * Everything here is PURE (no React, no I/O, no ambient state) so it runs under
 * node — apps/web has no jsdom. The activation caller does the one `list()`
 * read; this module only decides what that read admits.
 *
 * Fail-closed contract:
 *   • the read is admitted ONLY when `profile/sub_providers/list` is advertised
 *     by THIS authority's negotiated capabilities AND a Profile is confirmed;
 *   • an unread/empty lane set leaves the picker DISABLED — never a fallback to
 *     a default or primary model;
 *   • an unknown candidate is refused with the SAME typed kind the Core returns
 *     (`driver_model_unavailable`, `peer-dispatch-commands.ts` label table) so
 *     the two refusal paths present identical, bounded copy — and NO frame is
 *     sent for it.
 */
import {
  APPUI_RESEARCH_METHODS,
  supportsMethod,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type { ResearchLane } from "@octos-org/octoscode-client/research";

/**
 * The typed refusal kind for a lane the profile does not advertise. Byte-equal
 * to the Core's own kind (design 2800 §1; contract §1 `driver_model_unavailable`),
 * so a locally-refused lane and a server-refused lane render the same copy.
 */
export const PEER_LANE_UNAVAILABLE_REFUSAL =
  "driver_model_unavailable" as const;

const isName = (value: string): boolean => value.trim().length > 0;

/**
 * The advertised lane keys, in advertised order. Keys are copied VERBATIM
 * (they are the fence the Core matches on `model`); a blank key is dropped
 * rather than repaired, and an empty input yields an empty set.
 */
export function peerLaneKeys(lanes: readonly ResearchLane[]): string[] {
  const keys: string[] = [];
  for (const lane of lanes) if (isName(lane.key)) keys.push(lane.key);
  return keys;
}

/**
 * Fail-closed admission for the lane READ itself: the connected authority must
 * advertise `profile/sub_providers/list` and a Profile must be confirmed.
 * Anything else — unknown caps, an unadvertised method, a blank profile —
 * leaves the source unread, so no key can be invented and no picker is offered.
 */
export function peerLaneSourceAdmitted(
  capabilities: UiProtocolCapabilities | undefined,
  profileId: string,
): boolean {
  if (!isName(profileId)) return false;
  return supportsMethod(capabilities, APPUI_RESEARCH_METHODS.LIST);
}

/**
 * The lane picker's presentation state. `disabled` is the ONLY outcome for an
 * unadmitted read or an empty lane set; `ready` carries the advertise-order
 * keys the caller renders. There is no default lane and no literal fallback.
 */
export type PeerLanePickerState =
  | { readonly kind: "disabled" }
  | { readonly kind: "ready"; readonly keys: readonly string[] };

export function peerLanePickerState(
  admitted: boolean,
  keys: readonly string[],
): PeerLanePickerState {
  if (!admitted || keys.length === 0) return { kind: "disabled" };
  return { kind: "ready", keys: [...keys] };
}

/** The decision for ONE candidate lane key: admitted verbatim, or typed refusal. */
export type PeerLaneRefusalKind = typeof PEER_LANE_UNAVAILABLE_REFUSAL;
export type PeerLaneChoice =
  | { readonly kind: "admitted"; readonly laneKey: string }
  | { readonly kind: "refused"; readonly refusalKind: PeerLaneRefusalKind };

/**
 * Decide ONE dispatch candidate against the advertised set. The candidate is
 * admitted ONLY by exact membership of an advertised key — never by trimming,
 * prefix, casing or a resolution against a local model table. A null source
 * (unread profile) refuses everything, so an unknown/unread lane can never
 * reach the wire and never stages a peer.
 */
export function choosePeerLane(
  keys: readonly string[] | null,
  candidate: string,
): PeerLaneChoice {
  if (keys === null || !isName(candidate) || !keys.includes(candidate))
    return { kind: "refused", refusalKind: PEER_LANE_UNAVAILABLE_REFUSAL };
  return { kind: "admitted", laneKey: candidate };
}
