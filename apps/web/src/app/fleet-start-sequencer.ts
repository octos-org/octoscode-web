/**
 * Fleet Start sequencer — the App-side half of "Start is the ONLY implicit
 * acquisition" (design WEB-UX-DESIGN-4000 §4.3/§5.4; walkthrough 4200c: Start
 * sent ONLY peer/prepare because nothing ever acquired).
 *
 * The product chain is: FleetView's Start → App's onStart → (this sequencer)
 * → the hook's acquire seat seam, then the hook's staged dispatch once the
 * seat proof lands. PURE: no React, no I/O; the sink records the calls so a
 * hook-level test can assert the exact acquire-then-dispatch order.
 *
 * Contract:
 *  - submit with NO seat held ⇒ ONE acquire call, dispatch deferred (the row
 *    shows the machine's "requesting" — never a silent no-op).
 *  - submit with a held seat ⇒ ONE dispatch, nothing deferred.
 *  - the awaited seat landing ⇒ exactly ONE dispatch for the LATEST brief,
 *    consumed once (no double dispatch on re-render).
 *  - while the seat is still not held, nothing is sent and nothing repeats.
 */

export interface FleetStartSubmit {
  readonly laneKey: string;
  readonly brief: string;
  readonly title: string;
}

export type FleetStartCalls =
  | { readonly kind: "acquire" }
  | { readonly kind: "dispatch"; readonly submit: FleetStartSubmit };

export interface FleetStartSink {
  onAcquireSeat: () => void;
  onDispatch: (submit: FleetStartSubmit) => void;
}

export type FleetStartSequencerState =
  | { readonly kind: "idle" }
  | { readonly kind: "awaiting-seat"; readonly submit: FleetStartSubmit };

/** The pending submit, or null once consumed. */
export function fleetStartOnSubmit(input: {
  readonly state: FleetStartSequencerState;
  readonly seatHeld: boolean;
  readonly submit: FleetStartSubmit;
  readonly sink: FleetStartSink;
}): FleetStartSequencerState | null {
  if (!input.seatHeld) {
    // Only the FIRST awaiting submit acquires; a repeat just replaces the
    // pending brief (the acquire frame is already in flight).
    if (input.state.kind === "idle") input.sink.onAcquireSeat();
    return { kind: "awaiting-seat", submit: input.submit };
  }
  input.sink.onDispatch(input.submit);
  return null;
}

/** The awaited seat landed; dispatch the pending submit exactly once. */
export function fleetStartOnSeatHeld(input: {
  readonly state: FleetStartSequencerState;
  readonly seatHeld: boolean;
  readonly sink: FleetStartSink;
}): FleetStartSequencerState | null {
  if (input.state.kind !== "awaiting-seat") return input.state;
  if (!input.seatHeld) return input.state;
  input.sink.onDispatch(input.state.submit);
  return null;
}
