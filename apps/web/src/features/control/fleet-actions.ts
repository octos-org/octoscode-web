/**
 * fleet-actions — the Start = acquire → dispatch state machine (judge round 1
 * item #2; round 2 owner web-ux-fleet-02; design WEB-UX-DESIGN-4000 §4.3/§5.4:
 * "Start is the ONLY implicit acquisition: it acquires control of the target
 * session (§5.2) and then dispatches once with a minted operation id; a retry
 * after an uncertain outcome reuses that id").
 *
 * PURE state (no React, no I/O) so it runs under node. The component holds ONE
 * `FleetStartState`; this module derives every transition:
 *   idle → (begin: model + non-blank brief, no repeat) requesting
 *   requesting → settle: accepted (receipt identity) | failed (bounded kind,
 *                brief retained for retry)
 *   uncertain ack → retry KEEPS the operation id (server replays or reports
 *                the conflict; §6 row "no receipt within 15 s").
 *
 * The acquire (CAS on the observed revision) and the ONE `peer/dispatch` frame
 * stay in the caller's sink (use-octos-session's existing seams); this machine
 * only decides WHAT is in flight and WHAT the operator sees.
 */

/** The CAS basis for ONE Start acquire, as `session/driver/get` disclosed it. */
export interface FleetStartAcquireBasis {
  /** This browser's stable driver id (octoscode-web:<uuid>). */
  readonly driverId: string;
  /** The OBSERVED revision; null when the inventory walk never completed. */
  readonly observedRevision: number | null;
}

/** The proof ONE Start dispatch is fenced with (from the acquire reply). */
export interface FleetStartProof {
  readonly driverId: string;
  readonly epoch: number;
  readonly controlToken: string;
}

/** The dispatch frame ONE Start sends (camelCase; the leaf owns the wire). */
export interface FleetStartDispatchFrame {
  readonly driverId: string;
  readonly epoch: number;
  readonly controlToken: string;
  readonly operationId: string;
  readonly model: string;
  readonly dispatch: {
    readonly kind: "new_brief";
    readonly brief: string;
    readonly title: string;
  };
}

/**
 * Fixes 4230: the acquire frame ONE Start sends — CAS on the OBSERVED revision
 * (design §5.2/§5.4: Start is the ONLY implicit acquisition, so START ITSELF
 * must acquire). Pure and IDEMPOTENT per machine state: the caller sends the
 * frame once; rebuilding it from the SAME state returns an equal value (never
 * a second acquire). Null when the revision is unknown — there is no CAS
 * basis, so nothing is sent (the operator sees the walk-failed copy).
 */
export function buildFleetStartAcquire(
  state: FleetStartState,
  basis: FleetStartAcquireBasis,
): { driverId: string; expectedRevision: number; leaseSeconds: number } | null {
  if (state.kind !== "requesting") return null;
  if (basis.observedRevision === null) return null;
  if (basis.driverId === "") return null;
  return {
    driverId: basis.driverId,
    expectedRevision: basis.observedRevision,
    // The hook's own bounded lease; mirrored so the frame is complete.
    leaseSeconds: 120,
  };
}

/**
 * Fixes 4230: the dispatch frame ONE Start sends — fenced with the JUST-
 * acquired proof, carrying the machine's operation id (the replay key), the
 * chosen lane and the brief. Null when no proof is held: the OLD bug's exact
 * class (a dispatch planned with a fence nobody acquired sent NOTHING and the
 * row rested in 'Starting' for 150 s — live evidence 4200c s8).
 */
export function buildFleetStartDispatch(
  state: FleetStartState,
  proof: FleetStartProof | null,
): FleetStartDispatchFrame | null {
  if (state.kind !== "requesting") return null;
  if (proof === null) return null;
  const title = state.brief.split("\n", 1)[0]?.slice(0, 60) ?? "";
  return {
    driverId: proof.driverId,
    epoch: proof.epoch,
    controlToken: proof.controlToken,
    operationId: state.operationId,
    model: state.laneKey,
    dispatch: { kind: "new_brief", brief: state.brief, title },
  };
}

/** The Start form's observable state. All copy is presentation-only. */
export type FleetStartState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "requesting";
      /** The advertised lane key the dispatch targets (verbatim). */
      readonly laneKey: string;
      /** The operator's brief, held verbatim so a failure keeps the draft. */
      readonly brief: string;
      /** Minted ONCE per Start; reused verbatim on every retry (§4.3). */
      readonly operationId: string;
      /** Bumps on retry (diagnostic only; the operation id is the replay key). */
      readonly attempt: number;
    }
  | {
      readonly kind: "accepted";
      readonly laneKey: string;
      readonly brief: string;
      readonly operationId: string;
      /** The receipt's OWN adopted slug (the row key). */
      readonly slug: string;
    }
  | {
      readonly kind: "failed";
      readonly laneKey: string;
      readonly brief: string;
      readonly operationId: string;
      /** A bounded typed refusal kind; raw server copy never rides. */
      readonly refusalKind: string;
    }
  | {
      /**
       * Round 4 J2: no receipt within 15 s (§6 "no receipt within 15 s") —
       * the request MAY still have run, so Retry reuses the SAME operation id
       * (the server replays the duplicate or reports the conflict) and Dismiss
       * only hides the notice.
       */
      readonly kind: "unknown";
      readonly laneKey: string;
      readonly brief: string;
      readonly operationId: string;
    };

export const FLEET_START_IDLE: FleetStartState = Object.freeze({
  kind: "idle",
}) as FleetStartState;

/** A REQUESTING sentinel for callers that cannot construct one (tests only). */
export const FLEET_START_REQUESTING: FleetStartState = Object.freeze({
  kind: "requesting",
  laneKey: "",
  brief: "",
  operationId: "",
  attempt: 1,
}) as FleetStartState;

/** A minted operation id. Test seams inject a deterministic id. */
export function fleetStartOperationId(
  newOperationId: () => string = () => crypto.randomUUID(),
): string {
  const id = newOperationId();
  return id === "" ? newOperationId() : id;
}

/**
 * Begin ONE Start: idle → requesting with a NON-blank brief and a chosen lane.
 * A repeat begin while requesting/accepted is REFUSED (the same object) so no
 * second acquire or dispatch can be issued from the UI.
 */
export function fleetStartBegin(
  state: FleetStartState,
  laneKey: string,
  brief: string,
  newOperationId: () => string = () => crypto.randomUUID(),
): FleetStartState {
  if (state.kind !== "idle") return state;
  if (laneKey === "") return state;
  if (brief.trim() === "") return state;
  return {
    kind: "requesting",
    laneKey,
    brief,
    operationId: fleetStartOperationId(newOperationId),
    attempt: 1,
  };
}

/** The receipt identity ONE settle hands the state machine. */
export interface FleetStartReceipt {
  readonly kind: "accepted";
  readonly slug: string;
  readonly operationId: string;
}

/** Settle a REQUESTING Start from the sink's receipt (accepted) outcome. */
export function fleetStartSettle(
  state: FleetStartState,
  receipt: FleetStartReceipt,
): FleetStartState {
  if (state.kind !== "requesting") return state;
  return {
    kind: "accepted",
    laneKey: state.laneKey,
    brief: state.brief,
    operationId: state.operationId,
    slug: receipt.slug,
  };
}

/**
 * Settle a FAILED Start: the bounded typed refusal kind is kept and the brief
 * is RETAINED (design §6 "kept: brief"), so the operator retries without
 * retyping. The operation id is kept too — a retry of the SAME staging reuses
 * it; a NEW Start (edit + begin) mints a fresh one through `fleetStartBegin`
 * after the caller resets to idle.
 */
export function fleetStartFailure(
  state: FleetStartState,
  refusalKind: string,
): FleetStartState {
  if (state.kind !== "requesting") return state;
  return {
    kind: "failed",
    laneKey: state.laneKey,
    brief: state.brief,
    operationId: state.operationId,
    refusalKind,
  };
}

/**
 * An UNCERTAIN acknowledgment (no receipt in 15 s, §6): the retry reuses the
 * SAME operation id — the server replays the duplicate or reports
 * `driver_operation_conflict` — so the operator never unknowingly sends a
 * second peer. Null for a non-requesting state.
 */
export function fleetStartRetryKeepsOperationId(
  state: FleetStartState,
): FleetStartState | null {
  if (state.kind !== "requesting") return null;
  return { ...state, attempt: state.attempt + 1 };
}

/**
 * Round 4 J2: settle a REQUESTING Start as UNCERTAIN (15 s, no receipt).
 * Retry keeps the operation id; Dismiss (not modeled here) only hides copy.
 */
export function fleetStartUncertain(state: FleetStartState): FleetStartState {
  if (state.kind !== "requesting") return state;
  return {
    kind: "unknown",
    laneKey: state.laneKey,
    brief: state.brief,
    operationId: state.operationId,
  };
}

/** Round 4 J2: a Retry from the UNCERTAIN state re-enters requesting, SAME id. */
export function fleetStartRetryFromUncertain(
  state: FleetStartState,
): FleetStartState {
  if (state.kind !== "unknown") return state;
  return {
    kind: "requesting",
    laneKey: state.laneKey,
    brief: state.brief,
    operationId: state.operationId,
    attempt: 1,
  };
}
