/**
 * composer-seat-handover — the PURE §5.2 handover planner + §6 bounded copy.
 *
 * One user turn crosses a session whose driver mode is `external`. Design 4000
 * §5.2 fixes EXACTLY three plans, and the composer must commit to one of them
 * BEFORE any `turn/start` frame:
 *
 *  1. THIS tab holds the seat (`acquireView` is OUR proof): release it with
 *     `next:"internal"` FIRST (parking with `next:"external"` keeps the session
 *     external and chat would still be refused), wait for the release result,
 *     then send the turn once. Release refused ⇒ nothing is sent, draft kept.
 *  2. Another app holds it (or it is parked with nobody holding): the send is
 *     refused `ExternalMasterHeld`. The UI shows "Another app is using this
 *     session" + Resume chat = acquire (CAS on the OBSERVED revision) →
 *     release(`next:"internal"`) → confirm → send once.
 *  3. Lost acquire reply: the token travels ONLY in that one reply, so no
 *     proof exists; no release/renew/dispatch frame may ever be sent with the
 *     unproven binding. Wait for the disclosed lease expiry, then a fresh
 *     acquire (§6 "lost acquire reply" row; never a second acquire before the
 *     expiry).
 *
 * Pure only: no I/O, no clock, no React. The hook wiring lives in
 * `use-octos-session.ts` (the session seam) and `use-turn-controller.ts` (the
 * send gate); this module never imports them.
 */
import type {
  DriverAcquireView,
  DriverReleaseParams,
} from "@octos-org/octoscode-client/external-driver-meta";

/** §6 row 1: the ExternalMasterHeld refusal rendered as task words. */
export const FOREIGN_SEAT_HOLDER_MESSAGE = "Another app is using this session";
/** §5.2 case 3: the affordance that runs acquire → release(internal) → send. */
export const RESUME_CHAT_LABEL = "Resume chat";
/** §5.2 case 2 strip status while the release is in flight. */
export const HANDING_BACK_CONTROL_STATUS = "Handing back control…";
/** §5.2 case 3 strip status while Resume chat is running. */
export const RESUMING_CHAT_STATUS = "Resuming chat…";
/** §6 row 8: release refused — the draft was kept, nothing was sent. */
export const RELEASE_FAILED_MESSAGE =
  "Couldn't hand back control — your message wasn't sent";
/**
 * §5.2 "Live foreign lease": a plain send under a LIVE foreign lease keeps
 * the human message but names the disclosed expiry, so the operator knows
 * when a Resume chat can succeed (`{time}` is the formatted lease expiry).
 */
export const FOREIGN_LEASE_BUSY_TEMPLATE =
  "Another app is using this session — try again when it finishes or after {time}";

/** The Core's own admission-refusal token for an external-held session. */
const EXTERNAL_MASTER_HELD = "ExternalMasterHeld";

/** Does this raw send failure mean a foreign controller holds the session? */
export function isExternalMasterHeldRefusal(message: string): boolean {
  return message.includes(EXTERNAL_MASTER_HELD);
}

/**
 * §6: bound ONE send failure to operator copy. Seat refusals collapse to the
 * single human message; everything else passes through verbatim (already
 * bounded upstream by the typed refusal kinds).
 */
export function boundedTurnAdmissionError(message: string): string {
  return isExternalMasterHeldRefusal(message)
    ? FOREIGN_SEAT_HOLDER_MESSAGE
    : message;
}

/** The observed facts ONE handover decision needs (all cheap, all pure). */
export interface ComposerSeatHandoverInput {
  /** Does THIS tab hold the seat (a live acquire whose proof we still have)? */
  readonly seatHeld: boolean;
  /** True only when the acquire proof belongs to this tab's own driver id. */
  readonly thisTabHoldsSeat: boolean;
  /** The held acquire view — the single source of release params. NULL = none. */
  readonly acquireView: DriverAcquireView | null;
  /** The OBSERVED disclosure revision, for the Resume-chat CAS acquire. */
  readonly observedRevision?: string | null;
  /**
   * A live FOREIGN lease's disclosed expiry. It does NOT gate the plan (a
   * live foreign holder still gets the Resume-chat affordance, acceptance 4:
   * the acquire inside Resume chat is what refuses busy with this expiry) —
   * it only annotates the resume-chat plan so the caller can render the busy
   * copy with the disclosed time.
   */
  readonly observedForeignLeaseExpiresAtMs?: number | null;
  /**
   * A live lease held under THIS TAB'S OWN driver id while we hold NO proof
   * (a lost acquire reply — the token traveled only in the reply we never
   * saw). §5.2/acceptance 20: no release/renew/dispatch frame may ever be
   * sent with the unproven binding; the only exit is the disclosed expiry.
   */
  readonly observedOwnLeaseExpiresAtMs?: number | null;
}

/** Plan 1: one release(next:internal), awaited, then one send. */
export interface ComposerReleaseThenSendPlan {
  readonly kind: "release-then-send";
  readonly releaseParams: DriverReleaseParams;
}

/** Plan 2: acquire → release(internal) → send once (Resume chat). */
export interface ComposerResumeChatPlan {
  readonly kind: "resume-chat";
  readonly acquireDriverId: string;
  readonly expectedRevision: number;
  /** Present while a live foreign lease holds the session (busy copy). */
  readonly foreignLeaseExpiresAtMs?: number;
}

/** Plan 3: wait for the disclosed expiry; no frame may be sent meanwhile. */
export interface ComposerWaitForExpiryPlan {
  readonly kind: "wait-for-expiry";
  readonly leaseExpiresAtMs: number;
}

/** The ordinary chat case: internal mode, no seat, no frames. */
export interface ComposerSendPlan {
  readonly kind: "send";
}

export type ComposerSeatHandoverPlan =
  | ComposerReleaseThenSendPlan
  | ComposerResumeChatPlan
  | ComposerWaitForExpiryPlan
  | ComposerSendPlan;

/**
 * Decide the ONE handover plan for a user turn (pure; fail-closed). Ordering
 * mirrors §5.2: a PROVEN own seat hands back first; a foreign/parked binding
 * can only be taken through the explicit Resume-chat sequence; an UNPROVEN
 * binding sends nothing and waits for the expiry; with neither, plain send.
 */
export function planComposerSeatHandover(
  input: ComposerSeatHandoverInput,
): ComposerSeatHandoverPlan {
  // Plan 1: our own proof. `next:"internal"` — never "external", which would
  // park the binding and leave the session refused for chat.
  if (input.seatHeld && input.thisTabHoldsSeat && input.acquireView) {
    return {
      kind: "release-then-send",
      releaseParams: {
        driverId: input.acquireView.capability.driverId,
        epoch: input.acquireView.capability.epoch,
        controlToken: input.acquireView.capability.reveal(),
        expectedRevision: input.acquireView.binding.revision,
        next: "internal",
      },
    };
  }
  // Plan 3 (before Plan 2): an unproven binding under OUR OWN driver id with
  // a LIVE lease — the lost-acquire reply. No frame may carry it; only the
  // disclosed expiry opens a fresh acquire.
  if (input.observedOwnLeaseExpiresAtMs != null) {
    return {
      kind: "wait-for-expiry",
      leaseExpiresAtMs: input.observedOwnLeaseExpiresAtMs,
    };
  }
  // Plan 2: a foreign (live or parked) holder with no proof of our own.
  // Resume chat is the ONLY route to a send, and it starts from the OBSERVED
  // revision — a live foreign lease does NOT hide the affordance; its acquire
  // is what refuses busy with the disclosed expiry (acceptance 4).
  if (input.observedRevision != null && input.observedRevision !== "") {
    const foreignLive =
      input.observedForeignLeaseExpiresAtMs != null
        ? { foreignLeaseExpiresAtMs: input.observedForeignLeaseExpiresAtMs }
        : {};
    return {
      kind: "resume-chat",
      acquireDriverId: "this-tab",
      expectedRevision: Number(input.observedRevision),
      ...foreignLive,
    };
  }
  // No seat, no observation: ordinary internal-mode chat.
  return { kind: "send" };
}

/**
 * §5.2 live-foreign-lease busy copy: the human message plus the disclosed
 * lease expiry. `formatTime` is the caller's locale clock (pure here).
 */
export function foreignLeaseBusyCopy(
  expiresAtMs: number,
  formatTime: (ms: number) => string = (ms) =>
    new Date(ms).toLocaleTimeString(),
): string {
  return FOREIGN_LEASE_BUSY_TEMPLATE.replace("{time}", formatTime(expiresAtMs));
}
