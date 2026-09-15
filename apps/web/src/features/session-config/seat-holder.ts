/**
 * Round 4 B (design §4.3/§5.2): distinguish WHO holds the session's external
 * binding. A peer THIS app started (the binding is this browser's own stable
 * driver id) is NOT "another app" — the session is busy with our own peer.
 * Only a foreign driver id (or a parked external binding with nobody local)
 * renders the other-app copy.
 */

export const SEAT_HOLDER_SELF = "self" as const;
export const SEAT_HOLDER_FOREIGN = "foreign" as const;
export const SEAT_HOLDER_NONE = "none" as const;

export type SeatHolderKind =
  | typeof SEAT_HOLDER_SELF
  | typeof SEAT_HOLDER_FOREIGN
  | typeof SEAT_HOLDER_NONE;

/** Pure classification of the observed disclosure binding. */
export function seatHolderKind(input: {
  /** The observed `session/driver/get` mode. */
  readonly mode: string;
  /** The observed binding's driver id, or null when none is bound. */
  readonly bindingDriverId: string | null;
  /** THIS app's stable driver id (`stablePeerDriverId`). */
  readonly ownDriverId: string;
}): SeatHolderKind {
  if (input.mode !== "external") return SEAT_HOLDER_NONE;
  if (input.bindingDriverId === null) return SEAT_HOLDER_FOREIGN;
  return input.bindingDriverId === input.ownDriverId
    ? SEAT_HOLDER_SELF
    : SEAT_HOLDER_FOREIGN;
}

/**
 * The English source words for each hold kind (the strip's third segment).
 * SELF renders the peers fact, never the other-app copy.
 */
export function stripSeatWords(kind: SeatHolderKind): string {
  switch (kind) {
    case SEAT_HOLDER_SELF:
      return "Peers running";
    case SEAT_HOLDER_FOREIGN:
      return "Another app is using this session";
    case SEAT_HOLDER_NONE:
      return "";
  }
}
