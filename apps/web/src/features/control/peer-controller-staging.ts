/**
 * peer-controller-staging — the peer controller console's OWN editable staging
 * state + the ONE dispatch gate (P2b, grant 2855).
 *
 * Before P2b the console's `brief`/`title` were `readOnly` props and its lane
 * `<select>` was `defaultValue`-driven, so an operator could neither type a
 * brief nor choose a lane in the product (e2e peer-controller.spec.ts:48-58
 * reports exactly that reachability limit). The console now OWNS controlled
 * state; the caller supplies only lanes, seat state, roster and callbacks.
 *
 * Everything here is PURE (no React, no I/O), so it runs under node — apps/web
 * has no jsdom. Types owned by the panel are imported TYPE-ONLY, so this module
 * never adds a runtime edge back to the panel.
 *
 * Fail-closed:
 *   • the staging starts EMPTY — an empty lane is never an implicit default;
 *   • a staged pick is DROPPED the moment the picker stops advertising it, so a
 *     stale choice can never survive a lane-set change as a fallback;
 *   • the gate admits ONLY a held seat + an ADMITTED lane + a non-empty brief,
 *     and reuses the ONE lane decision (`choosePeerLane`) the supplier shares.
 */
import type {
  PeerControllerPanelState,
  PeerControllerRosterRow,
  PeerControllerRowActivity,
} from "./PeerControllerPanel.tsx";
import type { PeerControlPanelState } from "./PeerControlPanel.tsx";
import type { PeerRosterEntry } from "../peers/peer-manager.ts";
import type { PeerControlTarget } from "./peer-control-commands.ts";
import { isProtocolUuid } from "@octos-org/octoscode-client/protocol";
import {
  choosePeerLane,
  type PeerLanePickerState,
} from "./peer-lane-source.ts";

/**
 * The kind-less DISPATCH refusal sentinel — the exact parallel of the seat's
 * own `peer_control_refused` fallback (`peer-control-activation.ts:55`): NOT a
 * Core kind, but a bounded marker that degrades to the generic dispatch copy
 * through `peerDispatchRefusalLabel`. Raw server copy is never rendered.
 */
export const PEER_DISPATCH_REFUSED_REFUSAL = "peer_dispatch_refused" as const;

/**
 * P2L (grant 3220 §1): the CLOSED, bounded set of reasons ONE not-confirmed
 * (`unknown`) dispatch settle can carry. Before P2L the `unknown` class was a
 * SINGLE opaque value: a live console rendered "The dispatch could not be
 * confirmed." for 90 s against ZERO wire frames and neither the operator nor a
 * live diagnostic could tell WHICH fail-closed precondition fired (run 2850f,
 * evidence native-glm-web-pc-p4-dispatch-diag-2850f). These tokens are the
 * instrument that reads the branch — bounded markers only, never raw copy.
 *
 * Every token names a REAL branch in the sink/supplier; a plan-level lane or
 * fence failure is a TYPED refusal (`refused`), never `unknown`, so it is
 * deliberately absent here.
 */
export const PEER_DISPATCH_UNKNOWN_REASONS = [
  /** The console resolved NO peer manager for the record at all. */
  "no-manager",
  /** The adopt seam could not reach the record engine (a truly foreign record). */
  "no-engine",
  /** `kickoff` settled `null`: the lazy manager's load/authority mismatch. */
  "kickoff-mismatch",
  /** The staging leaf threw something that was NOT a typed refusal. */
  "leaf-refused",
  /**
   * P2N (grant 3320 §3): the STAGED VALUES themselves are locally invalid, so
   * the shared prepare encoder refused them BEFORE any frame. A blank optional
   * field sent as `""` (not omitted) is the live instance. This is NOT the
   * load/authority class: run 2850g reported `kickoff-mismatch` for exactly
   * this local rejection, so the instrument named the wrong branch and the
   * investigation chased a phantom identity mismatch.
   */
  "invalid-staging",
] as const;

export type PeerDispatchUnknownReason =
  (typeof PEER_DISPATCH_UNKNOWN_REASONS)[number];

/** Bounded operator copy per reason — the sr-only companion to the attribute. */
const PEER_DISPATCH_UNKNOWN_REASON_COPY: Readonly<
  Record<PeerDispatchUnknownReason, string>
> = {
  "no-manager": "No peer controller is bound to this Session.",
  "no-engine": "The Session record engine was not available for adoption.",
  "kickoff-mismatch": "The staging supplier did not confirm the peer.",
  "leaf-refused": "The staging leaf refused without a typed reason.",
  "invalid-staging": "The staged brief or title was not valid to stage.",
};

export function peerControllerUnknownReasonCopy(
  reason: PeerDispatchUnknownReason,
): string {
  return PEER_DISPATCH_UNKNOWN_REASON_COPY[reason];
}

/**
 * The bounded outcome of ONE staged dispatch as the CONSOLE sees it (P2g, grant
 * 3030). Run-12 triage (evidence native-deepseek-web-pc-p3e-run12-triage-3010)
 * found a ready console dispatching nothing and surfacing nothing: the sink
 * returned early on a null manager and swallowed a `null` settle. Fail-closed
 * means VISIBLE, so the sink is typed and every non-`dispatched` outcome renders.
 *
 * `refused` carries an allowlisted typed kind (the bounded label table); `unknown`
 * is the honest "not confirmed" class — a null manager, a module/authority
 * mismatch, or a kind-less rejection. Raw server copy never rides either.
 *
 * P2o (grant 3410): `dispatched` also carries the SERVER-ADOPTED row identity
 * when the manager reports it. Run 2850h proved the wire accepted the dispatch
 * (`slug op-d32a…`, adopted turn `01a099dd-…`, lane glm-53) while the panel
 * rendered NOTHING: the sink dropped the identity and the console had no
 * `accepted` state to render, so a real acceptance was indistinguishable from
 * silence. Both fields are optional ONLY so a manager that cannot report the
 * row keeps the older identity-less reading; a confirmed row must set both.
 */
export type PeerDispatchSinkState =
  | {
      readonly kind: "dispatched";
      /** The receipt's OWN adopted slug (`op-d32a…` live), when observed. */
      readonly slug?: string;
      /** The ACCEPTED dispatch operation id the receipt echoed, when observed. */
      readonly operationId?: string;
    }
  | { readonly kind: "refused"; readonly refusalKind: string }
  | {
      readonly kind: "unknown";
      /** The bounded branch marker (P2L §1). Never raw server copy. */
      readonly reason: PeerDispatchUnknownReason;
    };

/**
 * Narrow ONE seat CONTROL outcome into the console's own bounded observable
 * state. The seat reports the accepted receipt VERBATIM; the console keeps only
 * the presentation facts it renders (`slug`, `duplicate`) — never the receipt's
 * ids or server copy. A seat `sending` settles `idle` here: the console's own
 * `sending` state is set by the caller's activation, not inferred from a seat
 * command kind.
 */
export function peerControllerStateFrom(
  seatState: PeerControlPanelState,
): PeerControllerPanelState {
  if (seatState.kind === "receipt")
    return {
      kind: "receipt",
      slug: seatState.receipt.slug,
      duplicate: seatState.receipt.duplicate,
    };
  if (seatState.kind === "refused")
    return {
      kind: "refused",
      source: "control",
      refusalKind: seatState.refusalKind,
      ...(seatState.detail === undefined ? {} : { detail: seatState.detail }),
    };
  return { kind: "idle" };
}

/** The operator's staging inputs. Every field starts EMPTY. */
export interface PeerControllerStaging {
  readonly lane: string;
  readonly brief: string;
  readonly title: string;
}

export const EMPTY_PEER_CONTROLLER_STAGING: PeerControllerStaging =
  Object.freeze({ lane: "", brief: "", title: "" });

/** One controlled-field edit (the three fields the operator types/chooses). */
export type PeerControllerStagingEdit =
  | { readonly field: "lane"; readonly value: string }
  | { readonly field: "brief"; readonly value: string }
  | { readonly field: "title"; readonly value: string };

/** Apply ONE edit, returning fresh state (never mutating the previous value). */
export function applyPeerControllerEdit(
  staging: PeerControllerStaging,
  edit: PeerControllerStagingEdit,
): PeerControllerStaging {
  return {
    lane: edit.field === "lane" ? edit.value : staging.lane,
    brief: edit.field === "brief" ? edit.value : staging.brief,
    title: edit.field === "title" ? edit.value : staging.title,
  };
}

/** The seat-level sources a dispatch is gated on (pure inputs, no reading). */
export interface PeerControllerDispatchGate {
  readonly seatHeld: boolean;
  readonly lanePicker: PeerLanePickerState;
  readonly lane: string;
  readonly brief: string;
}

/**
 * The dispatch gate: a HELD seat, an ADMITTED lane (exact membership of the
 * advertised keys — the ONE lane decision, shared with the supplier) and a
 * non-empty brief. Anything else leaves Dispatch disabled; nothing is sent.
 */
export function peerControllerDispatchAdmitted(
  gate: PeerControllerDispatchGate,
): boolean {
  if (!gate.seatHeld || gate.brief.trim().length === 0) return false;
  const keys = gate.lanePicker.kind === "ready" ? gate.lanePicker.keys : null;
  return choosePeerLane(keys, gate.lane).kind === "admitted";
}

/**
 * The lane the console may DISPLAY/SUBMIT: the staged pick, but ONLY while the
 * picker currently advertises it. Anything else (picker disabled, key withdrawn
 * after a profile change, nothing staged) collapses to the empty placeholder —
 * never a fallback the operator did not choose.
 */
export function peerControllerStagedLane(
  staging: PeerControllerStaging,
  lanePicker: PeerLanePickerState,
): string {
  if (lanePicker.kind !== "ready") return "";
  return lanePicker.keys.includes(staging.lane) ? staging.lane : "";
}

/** The exact values ONE submit hands to the caller's dispatch sink. */
export interface PeerControllerStagingSubmit {
  /** The advertised lane key, verbatim (never resolved locally). */
  readonly laneKey: string;
  readonly brief: string;
  readonly title: string;
}

/**
 * The submit payload for ONE activation, or NULL when the gate is closed.
 * Reuses the console's ONE gate so the button's disabled state and the submit
 * contract can never disagree: no held seat, no ADMITTED lane or a blank brief
 * ⇒ null ⇒ the caller's sink is not invoked at all.
 */
export function peerControllerStagingSubmit(input: {
  readonly staging: PeerControllerStaging;
  readonly lanePicker: PeerLanePickerState;
  readonly seatHeld: boolean;
}): PeerControllerStagingSubmit | null {
  const laneKey = peerControllerStagedLane(input.staging, input.lanePicker);
  const admitted = peerControllerDispatchAdmitted({
    seatHeld: input.seatHeld,
    lanePicker: input.lanePicker,
    lane: laneKey,
    brief: input.staging.brief,
  });
  if (!admitted) return null;
  return {
    laneKey,
    brief: input.staging.brief,
    title: input.staging.title,
  };
}

/**
 * The console's ONE observable state, derived from the two sources a staging
 * console actually has: the control SEAT (typed refusal kinds, receipts) and the
 * staging supplier's own busy/error axis. A dispatch failure is reported by
 * PRESENCE only — the manager's bounded copy is never read here, and the
 * sentinel degrades to the generic dispatch label. Raw server copy can never
 * reach the panel through this path.
 */
export function peerControllerPanelState(input: {
  readonly control: PeerControlPanelState;
  readonly dispatchBusy: boolean;
  readonly dispatchFailed: boolean;
  /**
   * The console's OWN staged-dispatch sink outcome (P2g, grant 3030), or null.
   * A null manager / module mismatch / kind-less rejection NEVER settles as
   * silence: it renders the bounded `unknown` row. A typed sink refusal takes
   * precedence over the manager's mirrored kind (the sink is the nearer cause).
   */
  readonly dispatchSink?: PeerDispatchSinkState | null;
  /**
   * The allowlisted TYPED dispatch-refusal kind from the last staging settle, or
   * null. The Core refuses `peer/dispatch` with a JSON-RPC error carrying
   * `data.kind` (evidence native-glm-dispatch-refusal-shape-2920) and never sets
   * `prepareError`, so `dispatchFailed` alone would render NOTHING for a refused
   * dispatch (finding 2920 (a)). A typed kind renders its OWN bounded label; a
   * kind-less failure still degrades to the generic dispatch sentinel. Raw
   * server copy never rides this field.
   */
  readonly dispatchRefusalKind?: string | null;
}): PeerControllerPanelState {
  if (input.dispatchBusy) return { kind: "sending", source: "dispatch" };
  const sink = input.dispatchSink ?? null;
  // The console's OWN sink outcome is the NEARER cause, so a typed refusal from
  // it outranks the manager's mirrored kind; a null manager / module mismatch /
  // kind-less rejection renders the bounded `unknown` row rather than silence.
  if (sink?.kind === "refused")
    return {
      kind: "refused",
      source: "dispatch",
      refusalKind: sink.refusalKind,
    };
  if (input.dispatchRefusalKind)
    return {
      kind: "refused",
      source: "dispatch",
      refusalKind: input.dispatchRefusalKind,
    };
  // P2L (grant 3220 §1): carry the sink's OWN bounded branch marker into the
  // panel state, so the live diagnostic reads WHICH precondition fired instead
  // of one opaque "could not be confirmed" (run 2850f).
  if (sink?.kind === "unknown")
    return { kind: "unknown", source: "dispatch", reason: sink.reason };
  // P2o (grant 3410): a CONFIRMED staged dispatch is an ACCEPTED outcome, not
  // silence. Run 2850h's console staged a peer the Core accepted (slug
  // `op-d32a…`, adopted turn `01a099dd-…`) yet rendered NOTHING, because
  // `dispatched` fell through to the idle mirror. The receipt's OWN adopted
  // identity now renders its own bounded row.
  if (
    sink?.kind === "dispatched" &&
    sink.slug !== undefined &&
    sink.operationId !== undefined
  )
    return {
      kind: "accepted",
      slug: sink.slug,
      operationId: sink.operationId,
    };
  if (input.dispatchFailed)
    return {
      kind: "refused",
      source: "dispatch",
      refusalKind: PEER_DISPATCH_REFUSED_REFUSAL,
    };
  if (input.control.kind === "sending")
    return { kind: "sending", source: "control" };
  return peerControllerStateFrom(input.control);
}

/**
 * The console's roster: only rows carrying BOTH server-reported ids the control
 * commands need (the ACCEPTED dispatch `operationId` and the row's live
 * `turnId`) and a live lifecycle status. A row missing an id is UNTESTABLE
 * rather than disabled-in-place — the console never mints an identity the
 * server did not report.
 *
 * P2p (task 3530 §1b): `adoptedTurns` maps a row's slug to the ADOPTED native
 * turn the dispatch receipt reported (or the adopted record's CURRENT live
 * turn). Root's P4C wire capture (evidence
 * native-glm-web-pc-p4c-row-wire-3530) caught the row addressing the MASTER
 * session's turn, so the Core targeted the wrong turn. When the map has no
 * entry the row's own `turnId` is kept — the legacy/mock path stays
 * byte-identical.
 */
export function peerControllerRosterRows(
  entries: readonly PeerRosterEntry[],
  adoptedTurns: ReadonlyMap<string, string> | null = null,
): PeerControllerRosterRow[] {
  const rows: PeerControllerRosterRow[] = [];
  for (const entry of entries) {
    const adopted = adoptedTurns?.get(entry.slug);
    const turnId =
      typeof adopted === "string" && adopted !== "" ? adopted : entry.turnId;
    const activity = peerControllerRowActivity(entry);
    // P2p (§2): a REAPED row (the peer is closed) still renders its activity
    // glyph so the operator can see it finished, but it carries NO accepted
    // operation id — `buildPeerRowControlTarget` fails closed on it and the
    // panel hides its affordances.
    if (activity === "reaped") {
      rows.push({ slug: entry.slug, operationId: "", turnId, activity });
      continue;
    }
    const operationId = entry.operationId;
    if (typeof operationId !== "string" || operationId === "") continue;
    if (turnId === "") continue;
    if (entry.status !== "opening" && entry.status !== "started") continue;
    rows.push({ slug: entry.slug, operationId, turnId, activity });
  }
  return rows;
}

/**
 * P2p (task 3530 §2): project a roster entry onto the row ACTIVITY vocabulary.
 *
 * This is a PROJECTION of `PeerManager`'s existing `PeerActivity` axis — the one
 * `observeSessionEvent` already folds from the adopted Session's own frames and
 * the dock already renders — never a second tracker. `staged` (dispatched, no
 * turn running yet) and `reaped` (the row is closed, so its affordances are
 * gone) are the two ROW-only states; every other value passes straight through.
 */
export function peerControllerRowActivity(entry: {
  readonly status: PeerRosterEntry["status"];
  readonly activity: PeerRosterEntry["activity"];
}): PeerControllerRowActivity {
  if (entry.status === "closed") return "reaped";
  if (entry.activity === "blocked") return "blocked";
  if (entry.activity === "live") return "live";
  if (entry.activity === "done") return "done";
  return "staged";
}

/**
 * P2p (task 3530 §1): the target identity for ONE row control activation.
 *
 * Reads the ROW — `targetOperationId` is the ACCEPTED dispatch id the manager
 * retained, and `expectedTurnId` is the row's ADOPTED turn (never the master
 * session's turn the P4C capture caught the wire carrying). Every required id
 * is validated; a missing/blank one is NULL, so the caller sends NO frame
 * rather than minting one the encoder would reject offline.
 */
export function buildPeerRowControlTarget(input: {
  readonly row: Pick<PeerControllerRosterRow, "operationId" | "turnId">;
  readonly newOperationId: () => string;
}): PeerControlTarget | null {
  const { operationId, turnId } = input.row;
  if (typeof operationId !== "string" || operationId === "") return null;
  if (!isProtocolUuid(turnId)) return null;
  return {
    controlOperationId: input.newOperationId(),
    targetOperationId: operationId,
    expectedTurnId: turnId,
  };
}
