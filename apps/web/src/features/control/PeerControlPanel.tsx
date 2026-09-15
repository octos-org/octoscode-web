/**
 * PeerControlPanel — the external-master control seat (plan 0630 §1-4, build 0700).
 *
 * Presentation + ONE typed command path per explicit activation. It is
 * FAIL-CLOSED: unless BOTH `peer/control` is advertised in `supported_methods`
 * AND `external_driver_v1` in `supported_features` (and a leaf is present), the
 * panel renders NOTHING and sends ZERO frames — an old-caps or unknown authority
 * is indistinguishable from "no seat".
 *
 * Scope of this grant: the component + its tests live ONLY here. Mounting into
 * SessionControlBar/App is a LATER grant, so nothing in those files changes.
 * The panel never reads ambient capabilities, never mints a fence, and never
 * discloses the control token.
 */
import {
  PEER_CONTROL_COMMAND_KINDS,
  buildPeerControlCommand,
  peerControlAdmitted,
  peerControlRefusalLabel,
  type PeerControlCommand,
  type PeerControlCommandKind,
  type PeerControlFence,
  type PeerControlLeaf,
  type PeerControlReceipt,
  type PeerControlTarget,
} from "./peer-control-commands.ts";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client/protocol";
import styles from "./PeerControlPanel.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

/** The seat's observable state. All copies are presentation-only. */
export type PeerControlPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "sending"; readonly command: PeerControlCommandKind }
  | { readonly kind: "receipt"; readonly receipt: PeerControlReceipt }
  | {
      readonly kind: "refused";
      readonly refusalKind: string;
      /** Raw server detail — accepted but NEVER rendered. */
      readonly detail?: string | undefined;
    };

export interface PeerControlPanelProps {
  /** Negotiated capabilities for the CURRENT authority (undefined ⇒ hidden). */
  capabilities: UiProtocolCapabilities | undefined;
  /** The control leaf, or null before one is built (null ⇒ hidden). */
  leaf: PeerControlLeaf | null;
  /** Caller-held fence; the token is passed through, never rendered. */
  fence: PeerControlFence;
  /** Caller-held target identity. */
  target: PeerControlTarget;
  /** Observable state, owned by the caller (no internal async ownership). */
  state: PeerControlPanelState;
  /** Activation sink. The panel itself never calls the leaf on render. */
  onSend?(command: PeerControlCommand): void;
}

/** Button copy per command kind. */
const COMMAND_LABEL_KEY: Readonly<Record<PeerControlCommandKind, string>> = {
  approval_respond: "Respond to approval",
  question_respond: "Answer question",
  steer: "Steer",
  interrupt: "Interrupt",
};

export function PeerControlPanel({
  capabilities,
  leaf,
  fence,
  target,
  state,
  onSend,
}: PeerControlPanelProps) {
  const t = useUiText();
  // Fail-closed: no seat, no frames.
  if (leaf === null || !peerControlAdmitted(capabilities)) return null;

  return (
    <section
      className={styles.panel}
      data-control-panel="peer"
      data-driver-id={fence.driverId}
      data-epoch={fence.epoch}
      data-target-operation-id={target.targetOperationId}
      aria-label={t("Peer control")}
    >
      <h2 className={styles.title}>{t("Peer control")}</h2>
      <div className={styles.commands} role="group" aria-label={t("Commands")}>
        {PEER_CONTROL_COMMAND_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={styles.command}
            data-control-command={kind}
            disabled={state.kind === "sending"}
            onClick={() => onSend?.(buildPeerControlCommand(kind))}
          >
            {t(COMMAND_LABEL_KEY[kind])}
          </button>
        ))}
      </div>

      {state.kind === "sending" ? (
        <p className={styles.status} role="status" data-control-state="sending">
          {t("Sending {command}…", { command: state.command })}
        </p>
      ) : null}

      {state.kind === "refused" ? (
        <p
          className={styles.refusal}
          role="alert"
          data-control-state="refused"
          data-refusal-kind={state.refusalKind}
        >
          {t(peerControlRefusalLabel(state.refusalKind))}
        </p>
      ) : null}

      {state.kind === "receipt" ? (
        <dl className={styles.receipt} data-control-state="receipt">
          <div className={styles.receiptRow}>
            <dt>{t("Worker")}</dt>
            <dd data-receipt-slug={state.receipt.slug}>
              {state.receipt.slug}
            </dd>
          </div>
          <div className={styles.receiptRow}>
            <dt>{t("Duplicate")}</dt>
            <dd data-receipt-duplicate={String(state.receipt.duplicate)}>
              {state.receipt.duplicate
                ? t("Already applied")
                : t("Newly applied")}
            </dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
