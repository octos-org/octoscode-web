/**
 * PeerControllerPanel — the peer CONTROLLER console (program WEB-PEER-CONTROLLER
 * 2800 §3, grant 2840; P2b editable staging, grant 2855). It is the sibling of
 * `PeerControlPanel` (the control SEAT): the seat drives an ALREADY-ACCEPTED
 * peer, this console STAGES one.
 *
 * The console OWNS its staging inputs (P2b). `lane`, `brief` and `title` are
 * CONTROLLED state living HERE — the caller supplies only the advertised lanes
 * (`lanePicker`), the seat state, the roster and the callbacks. Before P2b they
 * were caller-held `readOnly`/`defaultValue` props, so an operator could
 * neither type a brief nor choose a lane in the product.
 *
 * It is FAIL-CLOSED: unless BOTH `peer/control` and `peer/dispatch` are
 * advertised (with `external_driver_v1`) the console renders NOTHING and sends
 * ZERO frames. There is NO "Close peer" affordance: the wire has no such method
 * (design 2800 §3, Core contract 2800 §4), so the only seat-level control is
 * Release seat. The lane picker is driven ONLY by the pure `peer-lane-source`
 * state it is HANDED — this module never reads capabilities, never invents a
 * lane literal and never resolves a model locally.
 */
import { useState } from "react";
import {
  PEER_CONTROL_COMMAND_KINDS,
  peerControlAdmitted,
  peerControlRefusalLabel,
  type PeerControlCommand,
  type PeerControlCommandKind,
} from "./peer-control-commands.ts";
import {
  peerDispatchAdmitted,
  peerDispatchRefusalLabel,
} from "./peer-dispatch-commands.ts";
import {
  applyPeerControllerEdit,
  EMPTY_PEER_CONTROLLER_STAGING,
  peerControllerDispatchAdmitted,
  peerControllerStagedLane,
  peerControllerStagingSubmit,
  peerControllerUnknownReasonCopy,
  type PeerControllerStaging,
  type PeerControllerStagingSubmit,
  type PeerDispatchUnknownReason,
} from "./peer-controller-staging.ts";
import type { PeerLanePickerState } from "./peer-lane-source.ts";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client/protocol";
import type { DriverInventoryDisclosureBinding } from "../session/driver-discovery.ts";
import styles from "./PeerControllerPanel.module.css";
import { buildRowControlCommand } from "./peer-row-command.ts";
export { buildRowControlCommand } from "./peer-row-command.ts";
import { useUiText } from "../preferences/ui-text.tsx";

export {
  EMPTY_PEER_CONTROLLER_STAGING,
  peerControllerDispatchAdmitted,
  peerControllerRosterRows,
  peerControllerStagedLane,
  peerControllerStagingSubmit,
} from "./peer-controller-staging.ts";
export type {
  PeerControllerDispatchGate,
  PeerControllerStaging,
  PeerControllerStagingEdit,
  PeerControllerStagingSubmit,
} from "./peer-controller-staging.ts";

/**
 * P2p (task 3530 §2): the row's ACTIVITY axis, driven by the adopted peer
 * Session's own lifecycle frames. It is a PROJECTION of `PeerManager`'s
 * existing `PeerActivity` (folded by `observeSessionEvent`, which the dock
 * already renders) — never a second tracker. Two row-only states extend it:
 * `staged` (dispatched, no turn running yet) and `reaped` (the row is closed,
 * so its control affordances are gone).
 */
export type PeerControllerRowActivity =
  "staged" | "live" | "blocked" | "done" | "reaped";

/**
 * P2p (task 3530 §1c): the row's OWN control outcome. Root's P4C capture
 * (evidence native-glm-web-pc-p4c-row-wire-3530) found NO receipt and NO
 * refusal rendered for a row Steer, so a landed control was indistinguishable
 * from silence. This is presentation-only and bounded — a typed refusal kind
 * rides it, never raw server copy.
 */
export type PeerRowControlState =
  | { readonly kind: "sending" }
  | { readonly kind: "receipt"; readonly duplicate: boolean }
  | { readonly kind: "refused"; readonly refusalKind: string };

/** One roster row the console can act on; every id is server-reported. */
export interface PeerControllerRosterRow {
  readonly slug: string;
  /** The ACCEPTED dispatch id the row's control commands target. */
  readonly operationId: string;
  /**
   * The row's ADOPTED native turn (the control leaf's `expectedTurnId`). P2p
   * (task 3530 §1b): this is the receipt's `adopted_turn_id`, NOT the locally
   * minted kickoff turn the row used to carry — the P4C capture showed the wire
   * addressing the MASTER session's turn (`b86a3059-…`) instead of the peer's
   * (`01a09a29-…`), so the Core targeted the wrong turn.
   */
  readonly turnId: string;
  /** P2p (§2): the row's activity, projected from the manager's own axis. */
  readonly activity: PeerControllerRowActivity;
  /**
   * P2p (§1c): the LAST control outcome for THIS row, or absent. Written by the
   * caller's row-activation sink; the panel only renders it.
   */
  readonly control?: PeerRowControlState | null | undefined;
}

/**
 * P2p (§2): the readable glyph/text per row activity. Mirrors the dock's TUI
 * semantics (bleak/blocked > streaming > done) with the two row-only states,
 * so an operator can see at a glance whether the peer is running.
 */
const ROW_ACTIVITY_GLYPH: Readonly<Record<PeerControllerRowActivity, string>> =
  {
    staged: "○",
    live: "✻",
    blocked: "⚠",
    done: "✓",
    reaped: "✕",
  };
const ROW_ACTIVITY_LABEL: Readonly<Record<PeerControllerRowActivity, string>> =
  {
    staged: "staged",
    live: "streaming",
    blocked: "needs you",
    done: "done",
    reaped: "reaped",
  };

/** Which half of the console an outcome came from (drives the label table). */
export type PeerControllerSource = "dispatch" | "control";

/** The console's observable state. All copies are presentation-only. */
export type PeerControllerPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "sending"; readonly source: PeerControllerSource }
  | {
      readonly kind: "receipt";
      readonly slug: string;
      readonly duplicate: boolean;
    }
  | {
      /**
       * P2o (grant 3410): the ACCEPTED STAGED dispatch. Run 2850h proved the
       * console's own `peer/dispatch` was accepted Core-side (slug `op-d32a…`,
       * adopted session/turn recorded) while this panel rendered NO state at
       * all, so the operator could not tell a real acceptance from silence.
       * The staged `dispatched` settle now folds HERE instead of into `idle`;
       * `slug` is the receipt's OWN adopted slug the roster row is keyed by.
       */
      readonly kind: "accepted";
      readonly slug: string;
      readonly operationId: string;
    }
  | {
      readonly kind: "refused";
      readonly source: PeerControllerSource;
      readonly refusalKind: string;
      /** Raw server detail — accepted but NEVER rendered. */
      readonly detail?: string | undefined;
    }
  | {
      /**
       * P2g (grant 3030): the NOT-CONFIRMED class. A null manager, a
       * module/authority mismatch or a kind-less rejection settles here so the
       * console renders a bounded row instead of SILENCE (run-12 triage: a
       * ready, seat-held console dispatched nothing and surfaced nothing).
       */
      readonly kind: "unknown";
      readonly source: PeerControllerSource;
      /**
       * P2L (grant 3220 §1): the BOUNDED branch marker for WHY the dispatch was
       * not confirmed. Rendered as `data-unknown-reason` plus an sr-only copy so
       * a live diagnostic can read the exact fail-closed precondition (run
       * 2850f surfaced one opaque sentence and ZERO wire frames for 90 s).
       * Bounded token only. Absent for a non-dispatch (control) `unknown`.
       */
      readonly reason?: PeerDispatchUnknownReason | undefined;
    };

/** The four per-row affordances, in product order. */
export type PeerControllerRowAction =
  "approve" | "deny" | "steer" | "interrupt";

/**
 * The row affordances each SEAT command kind yields. `question_respond` yields
 * none (the console offers no free-text answer affordance), so the row table is
 * DERIVED from `PEER_CONTROL_COMMAND_KINDS` — it can never drift from the seat
 * if a kind is added, removed or reordered.
 */
const ROW_ACTIONS_FOR_KIND: Readonly<
  Partial<Record<PeerControlCommandKind, readonly PeerControllerRowAction[]>>
> = {
  approval_respond: ["approve", "deny"],
  steer: ["steer"],
  interrupt: ["interrupt"],
};

export const PEER_CONTROLLER_ROW_ACTIONS: readonly PeerControllerRowAction[] =
  Object.freeze(
    PEER_CONTROL_COMMAND_KINDS.flatMap(
      (kind) => ROW_ACTIONS_FOR_KIND[kind] ?? [],
    ),
  );

/** The seat command kind each row action builds (single source of mapping). */

/** Button copy per row action. */
const ROW_ACTION_LABEL: Readonly<Record<PeerControllerRowAction, string>> = {
  approve: "Approve",
  deny: "Deny",
  steer: "Steer",
  interrupt: "Interrupt",
};

/**
 * Per-row ARIA copy. Each affordance names its OWN row (the PeerDock
 * precedent, `Approve {value0}`), so a screen reader announces which peer a
 * bare "Approve" belongs to.
 */
const ROW_ACTION_ARIA: Readonly<Record<PeerControllerRowAction, string>> = {
  approve: "Approve {value0}",
  deny: "Deny {value0}",
  steer: "Steer {value0}",
  interrupt: "Interrupt {value0}",
};

/**
 * Build ONE encoder-valid control command for a row affordance. Steer/Interrupt
 * reuse the seat's own `buildPeerControlCommand`; Approve/Deny take that
 * command's synthetic approval identity and assign the decision.
 *
 * P2p (task 3530 §1a): Steer takes the OPERATOR's typed text. Root's P4C wire
 * capture (evidence native-glm-web-pc-p4c-row-wire-3530) caught the row sending
 * the hardcoded placeholder `synthetic-steer` while the operator typed
 * "octopus" — the Core's transcript could never contain the operator's words.
 * A blank/whitespace text trims to `""` and the caller disables the affordance,
 * so the leaf's empty-array encoder rejection is never reached (zero frames).
 */

/** P2p (§1a): the text a row action carries — only Steer is free-text. */
function steerTextFor(
  action: PeerControllerRowAction,
  row: PeerControllerRosterRow,
  drafts: Readonly<Record<string, string>>,
): string {
  return action === "steer" ? (drafts[row.slug] ?? "") : "";
}

/** The bounded copy for ONE outcome. Raw server detail is never read here. */
function outcomeCopy(
  state: PeerControllerPanelState,
  t: (source: string, params?: Record<string, string | number>) => string,
): string | null {
  if (state.kind === "refused")
    return state.source === "dispatch"
      ? peerDispatchRefusalLabel(state.refusalKind)
      : peerControlRefusalLabel(state.refusalKind);
  // P2g: a NOT-CONFIRMED dispatch is never silent — it renders this bounded
  // copy (no raw server text, no stack) so the operator learns the staging did
  // not land and may retry.
  if (state.kind === "unknown")
    return state.source === "dispatch"
      ? t("The dispatch could not be confirmed.")
      : t("The control command could not be confirmed.");
  if (state.kind === "receipt")
    return state.duplicate ? t("Already applied") : t("Newly applied");
  // P2o (grant 3410): an ACCEPTED staged dispatch announces itself; run 2850h
  // rendered nothing at all for an acceptance the Core had already recorded.
  if (state.kind === "accepted") return t("The peer dispatch was accepted.");
  return null;
}

export interface PeerControllerPanelProps {
  /** Negotiated capabilities for the CURRENT authority (undefined ⇒ hidden). */
  capabilities: UiProtocolCapabilities | undefined;
  /** The pure lane-picker state (disabled ⇒ no option, no fallback). */
  lanePicker: PeerLanePickerState;
  /** Whether a control seat is currently held (the dispatch fence source). */
  seatHeld: boolean;
  /** The observed binding from `session/driver/get`, or null. */
  binding: DriverInventoryDisclosureBinding | null;
  /** The current roster rows. */
  roster: readonly PeerControllerRosterRow[];
  /** Observable state, owned by the caller. */
  state: PeerControllerPanelState;
  /**
   * Staging sink; the console never dispatches on render. The payload carries
   * the OPERATOR's own controlled values (lane/brief/title), so the caller
   * forwards exactly what was typed and chosen.
   */
  onDispatch?: ((submit: PeerControllerStagingSubmit) => void) | undefined;
  /** Seat release sink. */
  onReleaseSeat?: (() => void) | undefined;
  /**
   * P3 (grant 3120 §b): the operator PARKED the seat, so it STAYS released. The
   * console disables Dispatch/Release and offers an explicit `Acquire seat`
   * instead — a Release that silently re-acquired was a visible no-op.
   */
  seatReleased?: boolean | undefined;
  /** Explicit re-acquire sink, offered only while `seatReleased`. */
  onAcquireSeat?: (() => void) | undefined;
  /** Per-row activation sink. */
  onRowAction?:
    | ((row: PeerControllerRosterRow, command: PeerControlCommand) => void)
    | undefined;
}

export function PeerControllerPanel({
  capabilities,
  lanePicker,
  seatHeld,
  binding,
  roster,
  state,
  onDispatch,
  onReleaseSeat,
  seatReleased = false,
  onAcquireSeat,
  onRowAction,
}: PeerControllerPanelProps) {
  const t = useUiText();
  // The console's OWN staging: controlled state, one field per edit. Hook
  // order is stable because the fail-closed return happens after it.
  const [staging, setStaging] = useState<PeerControllerStaging>(
    EMPTY_PEER_CONTROLLER_STAGING,
  );
  // P2p (§1a): the operator's OWN steer text, one entry per roster row. Root's
  // P4C wire capture caught the row sending the hardcoded `synthetic-steer`
  // placeholder while the operator typed "octopus", so the input box was
  // decorative. This is React-controlled state and never a prop.
  const [steerDrafts, setSteerDrafts] = useState<Record<string, string>>({});
  // Fail-closed: no staging method, no console, no frames.
  if (!peerControlAdmitted(capabilities) || !peerDispatchAdmitted(capabilities))
    return null;

  // The DISPLAYED lane is the operator's pick only while it is still
  // advertised; a withdrawn pick collapses to the empty placeholder.
  const lane = peerControllerStagedLane(staging, lanePicker);
  const dispatchable = peerControllerDispatchAdmitted({
    seatHeld,
    lanePicker,
    lane,
    brief: staging.brief,
  });
  const copy = outcomeCopy(state, t);
  const edit = (field: "lane" | "brief" | "title") => (value: string) =>
    setStaging((current) => applyPeerControllerEdit(current, { field, value }));

  return (
    <section
      className={styles.panel}
      data-control-panel="peer-controller"
      aria-label={t("Peer controller")}
    >
      <h2 className={styles.title}>{t("Peer controller")}</h2>

      {binding ? (
        <p
          className={styles.binding}
          data-driver-binding={binding.driverId}
          data-binding-epoch={String(binding.epoch)}
        >
          {t("Bound to {value0} @ epoch {value1}", {
            value0: binding.driverId,
            value1: String(binding.epoch),
          })}
        </p>
      ) : null}

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("Model lane")}</span>
        <select
          className={styles.select}
          data-lane-picker={lanePicker.kind}
          aria-label={t("Model lane")}
          value={lane}
          onChange={(event) => edit("lane")(event.target.value)}
          {...(lanePicker.kind === "disabled" ? { disabled: true } : {})}
        >
          {lanePicker.kind === "ready" ? (
            // No implicit default: the empty placeholder keeps an unselected
            // picker from displaying the first advertised key as if chosen.
            <>
              <option value="" hidden />
              {lanePicker.keys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </>
          ) : null}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("Brief")}</span>
        <textarea
          className={styles.textarea}
          data-control-field="brief"
          aria-label={t("Brief")}
          value={staging.brief}
          onChange={(event) => edit("brief")(event.target.value)}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("Title")}</span>
        <input
          className={styles.input}
          data-control-field="title"
          aria-label={t("Title")}
          value={staging.title}
          onChange={(event) => edit("title")(event.target.value)}
        />
      </label>

      <div className={styles.actions} role="group" aria-label={t("Staging")}>
        <button
          type="button"
          className={styles.action}
          data-control-action="dispatch"
          aria-label={t("Dispatch peer")}
          disabled={!dispatchable || state.kind === "sending"}
          onClick={() => {
            // The submit reuses the ONE gate, so a closed gate sends nothing
            // even if the click somehow reaches the button.
            const submit = peerControllerStagingSubmit({
              staging,
              lanePicker,
              seatHeld,
            });
            if (submit) onDispatch?.(submit);
          }}
        >
          {t("Dispatch")}
        </button>
        <button
          type="button"
          className={styles.action}
          data-control-action="release-seat"
          aria-label={t("Release seat")}
          disabled={!seatHeld}
          onClick={() => onReleaseSeat?.()}
        >
          {t("Release seat")}
        </button>
        {seatReleased ? (
          <button
            type="button"
            className={styles.action}
            data-control-action="acquire-seat"
            aria-label={t("Acquire seat")}
            onClick={() => onAcquireSeat?.()}
          >
            {t("Acquire seat")}
          </button>
        ) : null}
      </div>

      {roster.length > 0 ? (
        <ul className={styles.roster} aria-label={t("Session peers")}>
          {roster.map((row) => {
            // P2p (§2): a REAPED row offers no affordance at all — the peer is
            // closed, so a control command would address nothing.
            const reaped = row.activity === "reaped";
            const steerText = steerTextFor("steer", row, steerDrafts);
            const blankSteer = steerText.trim() === "";
            return (
              <li
                key={row.slug}
                className={styles.row}
                data-peer-row={row.slug}
                // P2p (§2): the activity axis rides the ROW element itself, so a
                // live diagnostic sampling `[data-peer-row]` reads it directly
                // (run 3520 found only `class` + `data-peer-row` there).
                data-activity={row.activity}
              >
                {/* The readable glyph + sr-only word for that same activity. */}
                <span
                  className={styles.glyph}
                  aria-hidden="true"
                  data-activity={row.activity}
                  data-peer-slug={row.slug}
                >
                  {ROW_ACTIVITY_GLYPH[row.activity]}
                </span>
                <span className="sr-only">
                  {t(ROW_ACTIVITY_LABEL[row.activity])}
                </span>
                <span className={styles.slug}>{row.slug}</span>
                {reaped ? null : (
                  <div
                    className={styles.rowActions}
                    role="group"
                    aria-label={row.slug}
                  >
                    {PEER_CONTROLLER_ROW_ACTIONS.map((action) => (
                      <button
                        key={action}
                        type="button"
                        className={styles.rowAction}
                        data-row-action={action}
                        aria-label={t(ROW_ACTION_ARIA[action], {
                          value0: row.slug,
                        })}
                        // P2p (§1a): a blank Steer text fails closed HERE — the
                        // leaf's encoder rejects an empty ordered array OFFLINE,
                        // so the affordance is disabled before it can send zero
                        // frames or a placeholder.
                        disabled={
                          state.kind === "sending" ||
                          (action === "steer" && blankSteer)
                        }
                        onClick={() =>
                          onRowAction?.(
                            row,
                            buildRowControlCommand(
                              action,
                              steerTextFor(action, row, steerDrafts),
                            ),
                          )
                        }
                      >
                        {t(ROW_ACTION_LABEL[action])}
                      </button>
                    ))}
                  </div>
                )}
                {/* P2p (§1a): the row's OWN steer text. Root's P4C capture caught
                    the wire carrying the hardcoded placeholder while the
                    operator typed "octopus", so the operator's words were
                    unreachable from the product. */}
                {reaped ? null : (
                  <input
                    className={styles.input}
                    type="text"
                    data-row-steer-input={row.slug}
                    aria-label={t("Steer {value0}", { value0: row.slug })}
                    value={steerTextFor("steer", row, steerDrafts)}
                    onChange={(event) =>
                      setSteerDrafts((current) => ({
                        ...current,
                        [row.slug]: event.target.value,
                      }))
                    }
                  />
                )}
                {/* P2p (§1c): the LAST control outcome for THIS row. Root's P4C
                    capture found NEITHER an accepted NOR a refused control
                    receipt rendered, so a landed control read as silence.
                    Bounded copy only; the typed refusal kind is never raw
                    server text. */}
                {row.control?.kind === "receipt" ? (
                  <span
                    className={styles.receiptRow}
                    data-row-control-state="receipt"
                    data-row-control-slug={row.slug}
                  >
                    {row.control.duplicate
                      ? t("Already applied")
                      : t("Newly applied")}
                  </span>
                ) : null}
                {row.control?.kind === "refused" ? (
                  <span
                    className={styles.refusal}
                    role="alert"
                    data-row-control-state="refused"
                    data-row-refusal-kind={row.control.refusalKind}
                  >
                    {t(peerControlRefusalLabel(row.control.refusalKind))}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {state.kind === "refused" ? (
        <p
          className={styles.refusal}
          role="alert"
          data-controller-state="refused"
          data-refusal-kind={state.refusalKind}
        >
          {copy}
        </p>
      ) : null}

      {/* P2g (grant 3030): a NOT-CONFIRMED dispatch renders too — a null
          manager, a module/authority mismatch or a kind-less rejection is never
          SILENCE. Bounded copy only; raw server text never reaches this row. */}
      {state.kind === "unknown" ? (
        <p
          className={styles.refusal}
          role="alert"
          data-controller-state="unknown"
          data-unknown-source={state.source}
          {...(state.reason === undefined
            ? {}
            : { "data-unknown-reason": state.reason })}
        >
          {copy}
          {state.reason === undefined ? null : (
            <span className="sr-only">
              {t(peerControllerUnknownReasonCopy(state.reason))}
            </span>
          )}
        </p>
      ) : null}

      {/* P2o (grant 3410): the console's OWN accepted STAGED dispatch. Run
          2850h rendered NO element at all for an acceptance the Core had
          already recorded (receipt slug + adopted turn), so the operator could
          not tell success from silence. Bounded copy only; the adopted slug is
          the receipt's own, and no raw server text rides this row. */}
      {state.kind === "accepted" ? (
        <dl className={styles.receipt} data-controller-state="accepted">
          <div className={styles.receiptRow}>
            <dt>{t("Worker")}</dt>
            <dd data-accepted-slug={state.slug}>{state.slug}</dd>
          </div>
          <div className={styles.receiptRow}>
            <dt>{t("Operation")}</dt>
            <dd data-accepted-operation={state.operationId}>
              {state.operationId}
            </dd>
          </div>
        </dl>
      ) : null}

      {state.kind === "receipt" ? (
        <dl className={styles.receipt} data-controller-state="receipt">
          <div className={styles.receiptRow}>
            <dt>{t("Worker")}</dt>
            <dd data-receipt-slug={state.slug}>{state.slug}</dd>
          </div>
          <div className={styles.receiptRow}>
            <dt>{t("Duplicate")}</dt>
            <dd data-receipt-duplicate={String(state.duplicate)}>{copy}</dd>
          </div>
        </dl>
      ) : null}

      {/* Keyboard reachable end-to-end: every affordance is a native <button>
          and every outcome is announced in this polite live region, so a
          receipt or refusal is never conveyed by raw server copy alone. */}
      <p className={styles.live} role="status" aria-live="polite">
        {state.kind === "sending" ? t("Working…") : ""}
      </p>
    </section>
  );
}
