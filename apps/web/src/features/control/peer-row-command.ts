/**
 * peer-row-command — the PRODUCT row-action mapping (round 2, judge #4:
 * WEB-UX-ROUND2-4400).
 *
 * Two call shapes, one file:
 *  1. PRODUCT path (dock rows, Fleet rows): the caller supplies the row's
 *     REAL attention facts (`PeerRowAttention`). Approve/Deny/Answer then
 *     bind the pending request id the server reported — fail-closed NULL
 *     when the row carries none, so a frame is never minted against a
 *     placeholder id ("synthetic-approval" was the round-1 defect).
 *  2. CONSOLE path (PeerControllerPanel, behind Fleet's Advanced
 *     disclosure): the legacy two-argument call keeps its historical
 *     encoder-valid placeholder command. The design freezes the console as
 *     "unchanged code" (WEB-UX-DESIGN-4000 §4.3 footer), so its behavior is
 *     preserved byte-for-byte; only the product surfaces upgraded.
 */
import {
  buildPeerControlCommand,
  type PeerControlCommand,
  type PeerControlCommandKind,
} from "./peer-control-commands.ts";
import type { PeerAttentionRequestKind } from "../peers/peer-manager.ts";
type PeerUserQuestionAnswer = Extract<
  PeerControlCommand,
  { kind: "question_respond" }
>["answers"][number];

/** Console row actions (legacy; unchanged vocabulary). */
export type PeerControllerRowAction =
  "approve" | "deny" | "steer" | "interrupt";

/** Product row actions (design §4.1/§4.3 dock + Fleet parity). */
export type PeerRowAction =
  "approve" | "approve_session" | "deny" | "answer" | "steer" | "stop";

const ROW_ACTION_KIND: Readonly<
  Record<PeerControllerRowAction, PeerControlCommandKind>
> = {
  approve: "approval_respond",
  deny: "approval_respond",
  steer: "steer",
  interrupt: "interrupt",
};

/**
 * The real pending-request facts a row action needs. Every id is
 * SERVER-REPORTED (stamped by PeerManager from the peer Session's own
 * frames); a missing id fails closed rather than synthesizing one.
 */
export interface PeerRowAttention {
  /** The pending approval/question id, or null when none is outstanding. */
  readonly requestId?: string | null;
  readonly requestKind?: PeerAttentionRequestKind | null;
  /** The row's ACCEPTED dispatch operation id (steer/stop targeting). */
  readonly operationId?: string | null;
  /** The turn the row last targeted (replacement-turn detection). */
  readonly turnId: string;
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Build ONE product row command from the row's REAL attention facts.
 * Fail-closed: NULL whenever a required id is missing, the attention kind
 * does not match the action, or (steer/stop) the row carries no accepted
 * operation id or a blank targeted turn.
 */
export function buildRowControlCommand(
  action: PeerRowAction,
  steerText: string,
  attention: PeerRowAttention,
  answers?: readonly PeerUserQuestionAnswer[],
): PeerControlCommand | null;

/** Console path (unchanged behavior; see the file comment). */
export function buildRowControlCommand(
  action: PeerControllerRowAction,
  steerText?: string,
): PeerControlCommand;

export function buildRowControlCommand(
  action: PeerRowAction | PeerControllerRowAction,
  steerText = "",
  attention?: PeerRowAttention,
  answers?: readonly PeerUserQuestionAnswer[],
): PeerControlCommand | null {
  if (attention === undefined) {
    // Legacy console call: exactly the historical mapping.
    const legacy = action as PeerControllerRowAction;
    const command = buildPeerControlCommand(ROW_ACTION_KIND[legacy]);
    if (command.kind === "approval_respond")
      return {
        ...command,
        decision: legacy === "deny" ? "deny" : "approve",
      };
    if (command.kind === "steer")
      return {
        kind: "steer",
        input: [{ kind: "text", text: steerText.trim() }],
      };
    return command;
  }
  switch (action) {
    case "approve":
    case "approve_session":
    case "deny": {
      if (attention.requestKind !== "approval") return null;
      if (!hasText(attention.requestId)) return null;
      return {
        kind: "approval_respond",
        approvalId: attention.requestId,
        decision: action === "deny" ? "deny" : "approve",
        ...(action === "approve_session"
          ? { approvalScope: "session" as const }
          : {}),
      };
    }
    case "answer": {
      if (attention.requestKind !== "question") return null;
      if (!hasText(attention.requestId)) return null;
      const payload =
        answers && answers.length > 0
          ? answers
          : steerText.trim() !== ""
            ? [{ freeText: steerText.trim() }]
            : [];
      if (payload.length === 0) return null;
      return {
        kind: "question_respond",
        questionId: attention.requestId,
        answers: payload,
      };
    }
    case "steer": {
      if (!hasText(attention.operationId) || attention.turnId === "")
        return null;
      const text = steerText.trim();
      if (text === "") return null;
      return { kind: "steer", input: [{ kind: "text", text }] };
    }
    case "stop": {
      if (!hasText(attention.operationId) || attention.turnId === "")
        return null;
      return { kind: "interrupt" };
    }
    default:
      return null;
  }
}
