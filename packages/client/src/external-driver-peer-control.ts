import { isRecord } from "./rpc.ts";
import { isNonEmptyString, isNonNegativeInteger } from "./wire-decoders.ts";
import { isProtocolUuid } from "./protocol-id.ts";
import {
  ExternalDriverProtocolError,
  ExternalDriverRefusalError,
  adoptedIdentityIsNativeShared,
  peerSlugIsSafe,
  requireExternalDriverControlCapability,
  requestExternalDriverControl,
  workerSessionMatchesCapturedMaster,
} from "./external-driver.ts";
import type {
  DriverScopedGoalView,
  ExternalDriverControlContext,
} from "./external-driver.ts";

/**
 * Typed LEAF for the external-master `peer/dispatch` + `peer/control` pair.
 * Wire truth: octos crates/octos-core/src/ui_protocol.rs @ HEAD 38eca094
 * dirty M (PeerDispatchParams/Result ~7940-8180, PeerControlParams/Result
 * ~8330-8560). SHAPE-ONLY client codec: no lease store, no idempotency
 * ledger, no retry/fallback. Exactly one RPC per explicit call; the native
 * server owns authority. Proof is ALWAYS an explicit caller argument.
 *
 * Circular-import discipline (per ROOT-WEB-SPLIT-CONTRACT-2019): imported
 * runtime values are referenced ONLY inside functions, never at module top
 * level; only `import type` annotations appear here.
 */

/** Pinned wire method names (Rust `method::PEER_DISPATCH`/`PEER_CONTROL`). */
const PEER_DISPATCH = "peer/dispatch";
const PEER_CONTROL = "peer/control";

const INVALID_DISPATCH_ARGS = "invalid peer dispatch arguments";
const INVALID_CONTROL_ARGS = "invalid peer control arguments";
const INVALID_DISPATCH_RECEIPT = "peer dispatch receipt malformed";
const INVALID_CONTROL_RECEIPT = "peer control receipt malformed";

/**
 * Allowlisted caller fields per request (`deny_unknown_fields` parity for
 * the control request; dispatch takes only its own allowlist). The captured
 * session/profile/topic are NEVER caller-overridable.
 */
const DISPATCH_REQUEST_KEYS: readonly string[] = [
  "driverId",
  "epoch",
  "controlToken",
  "operationId",
  "model",
  "dispatch",
  "kickoffInput",
  "goalId",
  "taskId",
];
const CONTROL_REQUEST_KEYS: readonly string[] = [
  "driverId",
  "epoch",
  "controlToken",
  "operationId",
  "targetOperationId",
  "expectedTurnId",
  "command",
];
/** Rust `PeerControlResult` is `deny_unknown_fields`: exactly these keys. */
const CONTROL_RESULT_KEYS: readonly string[] = [
  "operation_id",
  "state",
  "target_operation_id",
  "expected_turn_id",
  "target_session_id",
  "slug",
  "accepted_at_ms",
  "payload_digest",
  "duplicate",
];

/**
 * Per-kind caller-field allowlists for `PeerControlCommand`. Native is a
 * `deny_unknown_fields` internally-tagged enum, so each variant has an EXACT
 * own-key set; a `steer`+`approvalId` or `interrupt`+`input` mixture is a
 * cross-variant injection and is rejected OFFLINE (no RPC). Nested
 * `UserQuestionAnswer` is intentionally NOT deny-unknown: Rust tolerates
 * unknown sibling fields there, so this side only reads its known fields.
 */
const APPROVAL_RESPOND_KEYS: readonly string[] = [
  "kind",
  "approvalId",
  "decision",
  "approvalScope",
  "clientNote",
];
const QUESTION_RESPOND_KEYS: readonly string[] = [
  "kind",
  "questionId",
  "answers",
  "clientNote",
];
const STEER_KEYS: readonly string[] = ["kind", "input"];
const INTERRUPT_KEYS: readonly string[] = ["kind"];

/** True only when every own key of `value` is in `allowed` (no extras). */
function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Ordered native `InputItem::Text` — the sole forward-representable kind. */
export interface PeerTextInput {
  readonly kind: "text";
  readonly text: string;
}

/** Tagged dispatch target, mirroring `PeerDispatchTarget`. */
export type PeerDispatchTargetInput =
  | {
      readonly kind: "new_brief";
      readonly brief: string;
      readonly title?: string;
      readonly worktree?: boolean;
    }
  | { readonly kind: "existing_slug"; readonly slug: string };

/** `UserQuestionAnswer` — ordered labels and/or free text. */
export interface PeerUserQuestionAnswer {
  readonly selectedLabels?: readonly string[];
  readonly freeText?: string;
}

/** Tagged control command, mirroring `PeerControlCommand`. */
export type PeerControlCommand =
  | {
      readonly kind: "approval_respond";
      readonly approvalId: string;
      readonly decision: "approve" | "deny";
      readonly approvalScope?: string;
      readonly clientNote?: string;
    }
  | {
      readonly kind: "question_respond";
      readonly questionId: string;
      readonly answers: readonly PeerUserQuestionAnswer[];
      readonly clientNote?: string;
    }
  | { readonly kind: "steer"; readonly input: readonly PeerTextInput[] }
  | { readonly kind: "interrupt" };

/**
 * Explicit caller-held fence (driver_id / epoch / control_token). The token
 * is an argument on EVERY call — never read from a store, global or ambient
 * acquire. No implicit acquire/renew/retry.
 */
export interface PeerControlFence {
  readonly driverId: string;
  readonly epoch: number;
  readonly controlToken: string;
}

/** Caller args for `peerDispatch` (camelCase in, snake_case wire). */
export interface PeerDispatchParams extends PeerControlFence {
  readonly operationId: string;
  /** REQUESTED model lane key (wire `model` → `PeerDispatchParams.model`),
   * echoed back as the receipt's `modelLane` — NOT the resolved model. */
  readonly model: string;
  readonly dispatch: PeerDispatchTargetInput;
  readonly kickoffInput?: readonly PeerTextInput[];
  readonly goalId?: string;
  readonly taskId?: string;
}

/** Caller args for `peerControl`. */
export interface PeerControlParams extends PeerControlFence {
  readonly operationId: string;
  readonly targetOperationId: string;
  readonly expectedTurnId: string;
  readonly command: PeerControlCommand;
}

/**
 * Immutable dispatch receipt disclosure. `model` is the server-RESOLVED model
 * (may differ from the requested lane) and `workspaceRoot`/`scopedGoal` are
 * server-REPORTED facts — only the request dimensions (operation/requested
 * lane/requested goal/target slug) are caller-fenced. The resolved model and
 * workspace are DISCLOSED, never an independently proven authority.
 */
export interface PeerDispatchReceiptView {
  readonly operationId: string;
  readonly state: "accepted";
  readonly model: string;
  readonly modelLane: string;
  readonly workspaceRoot: string;
  readonly scopedGoal: DriverScopedGoalView | null;
  readonly adoptedTurnId: string;
  readonly adoptedSessionId: string;
  readonly slug: string;
  readonly duplicate: boolean;
  readonly acceptedAtMs: number;
  readonly payloadDigest: string;
}

/**
 * Immutable `peer/control` receipt. Carries ONLY the control facts — never a
 * dispatch-shaped model/workspace/allocated-worker field (`PeerControlResult`
 * is `deny_unknown_fields`).
 */
export interface PeerControlReceiptView {
  readonly operationId: string;
  readonly state: "accepted";
  readonly targetOperationId: string;
  readonly expectedTurnId: string;
  readonly targetSessionId: string;
  readonly slug: string;
  readonly acceptedAtMs: number;
  readonly payloadDigest: string;
  readonly duplicate: boolean;
}

/** The explicit typed leaf surface composed onto the driver factory. */
export interface ExternalDriverPeerCommands {
  peerDispatch(params: PeerDispatchParams): Promise<PeerDispatchReceiptView>;
  peerControl(params: PeerControlParams): Promise<PeerControlReceiptView>;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/** Copy ordered native text items; any non-text/blank item rejects. */
function encodeTextInput(
  value: unknown,
): ReadonlyArray<{ kind: "text"; text: string }> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: Array<{ kind: "text"; text: string }> = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (item.kind !== "text") return null;
    if (!isNonEmptyString(item.text)) return null;
    out.push({ kind: "text", text: item.text });
  }
  return out;
}

/** Encode the tagged dispatch target. `existing_slug` REQUIRES an explicit
 * non-empty `kickoff_input` (checked by the caller) — the stored brief is
 * never silently re-run. */
function encodeDispatchTarget(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (value.kind === "new_brief") {
    // Native `dispatch_target_is_unambiguous`: a `slug` sibling is the
    // "both variants" shape — reject it on the RAW object (serde would
    // otherwise silently drop it and lose the ambiguity).
    if ("slug" in value) return null;
    if (!isNonEmptyString(value.brief)) return null;
    const wire: Record<string, unknown> = {
      kind: "new_brief",
      brief: value.brief,
    };
    if (value.title !== undefined) {
      // Optional Rust `Option<String>` — no non-blank rule on the title.
      if (typeof value.title !== "string") return null;
      wire.title = value.title;
    }
    if (value.worktree !== undefined) {
      if (typeof value.worktree !== "boolean") return null;
      wire.worktree = value.worktree;
    }
    return wire;
  }
  if (value.kind === "existing_slug") {
    // Symmetric "both variants" shape: any new_brief field on an
    // existing_slug target is rejected on the RAW object.
    if ("brief" in value || "title" in value || "worktree" in value) {
      return null;
    }
    if (!peerSlugIsSafe(value.slug)) return null;
    return { kind: "existing_slug", slug: value.slug };
  }
  return null;
}

function decodeScopedGoal(value: unknown): DriverScopedGoalView | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.goal_id)) return null;
  const out: {
    goalId: string;
    taskId?: string;
    revision?: number;
  } = { goalId: value.goal_id };
  if (value.task_id !== undefined) {
    if (!isNonEmptyString(value.task_id)) return null;
    out.taskId = value.task_id;
  }
  if (value.revision !== undefined) {
    if (!isNonNegativeInteger(value.revision)) return null;
    out.revision = value.revision;
  }
  return Object.freeze(out);
}

/**
 * Decode an accepted `peer/dispatch` receipt. Fences ONLY the caller-owned
 * request dimensions (operation id, the REQUESTED MODEL LANE, requested
 * scoped goal, target slug) plus the native worker identity. The wire truth
 * (ui_protocol.rs ~7958 ~8040): `PeerDispatchParams.model` is the requested
 * LANE key, echoed back as `PeerDispatchResult.model_lane`; the result's
 * `model` is the server-RESOLVED model and may legitimately DIFFER from the
 * requested lane. Both `model` (resolved) and `workspace_root` are therefore
 * reported as DISCLOSED facts, never expected authority. Unknown extra result
 * fields are permitted by the wire (dispatch result is not deny_unknown_fields)
 * but are NEVER surfaced.
 */
function decodePeerDispatchReceipt(
  value: unknown,
  context: ExternalDriverControlContext,
  request: { readonly operationId: string; readonly modelLane: string },
  requestedGoal: { goalId: string; taskId?: string } | null,
  requestedSlug: string | null,
): PeerDispatchReceiptView | null {
  if (!isRecord(value)) return null;
  if (value.state !== "accepted") return null;
  if (typeof value.duplicate !== "boolean") return null;
  if (!isNonEmptyString(value.operation_id)) return null;
  if (!isNonEmptyString(value.model)) return null;
  if (!isNonEmptyString(value.model_lane)) return null;
  if (!isNonEmptyString(value.workspace_root)) return null;
  if (!isProtocolUuid(value.adopted_turn_id)) return null;
  if (!isNonEmptyString(value.adopted_session_id)) return null;
  if (!peerSlugIsSafe(value.slug)) return null;
  if (!isNonNegativeInteger(value.accepted_at_ms)) return null;
  if (!isNonEmptyString(value.payload_digest)) return null;
  const scopedGoal = decodeScopedGoal(value.scoped_goal);
  if (
    scopedGoal === null &&
    value.scoped_goal !== undefined &&
    value.scoped_goal !== null
  ) {
    return null;
  }
  // Request-derived fences.
  if (value.operation_id !== request.operationId) return null;
  // The ECHOED requested lane must byte-match; the resolved `model` above only
  // has to be a non-empty disclosed value — never compared to the request.
  if (value.model_lane !== request.modelLane) return null;
  if (requestedGoal !== null) {
    if (scopedGoal === null || scopedGoal.goalId !== requestedGoal.goalId) {
      return null;
    }
    if (
      requestedGoal.taskId !== undefined &&
      scopedGoal.taskId !== requestedGoal.taskId
    ) {
      return null;
    }
  }
  if (requestedSlug !== null && value.slug !== requestedSlug) return null;
  // Native identity: captured master wire base + #peer-<slug>.
  if (
    !workerSessionMatchesCapturedMaster(
      context.sessionId,
      context.profileId,
      value.adopted_session_id,
      value.slug,
    ) ||
    !adoptedIdentityIsNativeShared(
      value.adopted_turn_id,
      value.adopted_session_id,
      value.slug,
    )
  ) {
    return null;
  }
  return Object.freeze({
    operationId: value.operation_id,
    state: "accepted" as const,
    model: value.model,
    modelLane: value.model_lane,
    workspaceRoot: value.workspace_root,
    scopedGoal,
    adoptedTurnId: value.adopted_turn_id,
    adoptedSessionId: value.adopted_session_id,
    slug: value.slug,
    duplicate: value.duplicate,
    acceptedAtMs: value.accepted_at_ms,
    payloadDigest: value.payload_digest,
  });
}

/**
 * Decode an accepted `peer/control` receipt. `deny_unknown_fields` on the
 * native result means a dispatch-shaped reply (model/workspace/allocated
 * worker) is malformed; only the exact control facts are surfaced this side.
 * `expected_turn_id` must equal the caller's expected turn and the target
 * session must be the native worker shape for the reported slug.
 */
function decodePeerControlReceipt(
  value: unknown,
  context: ExternalDriverControlContext,
  request: {
    readonly operationId: string;
    readonly targetOperationId: string;
    readonly expectedTurnId: string;
  },
): PeerControlReceiptView | null {
  if (!isRecord(value)) return null;
  // Rust `PeerControlResult` is `deny_unknown_fields`: a dispatch-shaped
  // reply (model/workspace/allocated worker) is malformed, not tolerated.
  if (!hasOnlyKeys(value, CONTROL_RESULT_KEYS)) return null;
  // 0830: the Core's typed REFUSED receipt (state:"refused", empty target
  // fields, duplicate:false) is a real decode OUTCOME, not garbage. Branch it
  // to a typed refusal BEFORE the accepted decode; every other non-accepted
  // state (and any malformed shape) stays INVALID_CONTROL_RECEIPT. The refusal
  // carries no target, so no fence/field validation applies on this path.
  if (value.state === "refused") {
    throw new ExternalDriverRefusalError(PEER_CONTROL, "peer_control_refused");
  }
  if (value.state !== "accepted") return null;
  if (typeof value.duplicate !== "boolean") return null;
  if (!isNonEmptyString(value.operation_id)) return null;
  if (!isNonEmptyString(value.target_operation_id)) return null;
  if (!isProtocolUuid(value.expected_turn_id)) return null;
  if (!isNonEmptyString(value.target_session_id)) return null;
  if (!peerSlugIsSafe(value.slug)) return null;
  if (!isNonNegativeInteger(value.accepted_at_ms)) return null;
  if (!isNonEmptyString(value.payload_digest)) return null;
  if (value.operation_id !== request.operationId) return null;
  if (value.target_operation_id !== request.targetOperationId) return null;
  if (value.expected_turn_id !== request.expectedTurnId) return null;
  // Captured master/profile scope: shape + slug alone would accept a
  // FOREIGN base `#peer-<same-slug>` receipt. The target session must be
  // EXACTLY the captured master wire base + `#peer-<slug>`.
  if (
    !workerSessionMatchesCapturedMaster(
      context.sessionId,
      context.profileId,
      value.target_session_id,
      value.slug,
    ) ||
    !adoptedIdentityIsNativeShared(
      value.expected_turn_id,
      value.target_session_id,
      value.slug,
    )
  ) {
    return null;
  }
  return Object.freeze({
    operationId: value.operation_id,
    state: "accepted" as const,
    targetOperationId: value.target_operation_id,
    expectedTurnId: value.expected_turn_id,
    targetSessionId: value.target_session_id,
    slug: value.slug,
    acceptedAtMs: value.accepted_at_ms,
    payloadDigest: value.payload_digest,
    duplicate: value.duplicate,
  });
}

/** Encode ONE control command, strict on kind, capturing ordered arrays. */
function encodeControlCommand(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "approval_respond": {
      if (!hasOnlyKeys(value, APPROVAL_RESPOND_KEYS)) return null;
      if (!isNonEmptyString(value.approvalId)) return null;
      if (value.decision !== "approve" && value.decision !== "deny") {
        return null;
      }
      const wire: Record<string, unknown> = {
        kind: "approval_respond",
        approval_id: value.approvalId,
        decision: value.decision,
      };
      if (value.approvalScope !== undefined) {
        if (typeof value.approvalScope !== "string") return null;
        wire.approval_scope = value.approvalScope;
      }
      if (value.clientNote !== undefined) {
        if (typeof value.clientNote !== "string") return null;
        wire.client_note = value.clientNote;
      }
      return wire;
    }
    case "question_respond": {
      if (!hasOnlyKeys(value, QUESTION_RESPOND_KEYS)) return null;
      if (!isNonEmptyString(value.questionId)) return null;
      if (!Array.isArray(value.answers) || value.answers.length === 0) {
        return null;
      }
      const answers: Array<Record<string, unknown>> = [];
      for (const answer of value.answers) {
        if (!isRecord(answer)) return null;
        const entry: Record<string, unknown> = {};
        if (answer.selectedLabels !== undefined) {
          if (
            !Array.isArray(answer.selectedLabels) ||
            !answer.selectedLabels.every((label) => typeof label === "string")
          ) {
            return null;
          }
          entry.selected_labels = [...answer.selectedLabels];
        }
        if (answer.freeText !== undefined) {
          if (typeof answer.freeText !== "string") return null;
          entry.free_text = answer.freeText;
        }
        answers.push(entry);
      }
      const wire: Record<string, unknown> = {
        kind: "question_respond",
        question_id: value.questionId,
        answers,
      };
      if (value.clientNote !== undefined) {
        if (typeof value.clientNote !== "string") return null;
        wire.client_note = value.clientNote;
      }
      return wire;
    }
    case "steer": {
      if (!hasOnlyKeys(value, STEER_KEYS)) return null;
      const input = encodeTextInput(value.input);
      if (input === null) return null;
      return { kind: "steer", input };
    }
    case "interrupt": {
      if (!hasOnlyKeys(value, INTERRUPT_KEYS)) return null;
      return { kind: "interrupt" };
    }
    default:
      return null;
  }
}

/** Validate the explicit fence. `epoch` must be a positive safe integer. */
function validateFence(
  fence: PeerControlFence,
  method: string,
  reason: string,
): void {
  if (!isRecord(fence)) throw new ExternalDriverProtocolError(method, reason);
  if (!isNonEmptyString(fence.driverId)) {
    throw new ExternalDriverProtocolError(method, reason);
  }
  if (!isPositiveInteger(fence.epoch)) {
    throw new ExternalDriverProtocolError(method, reason);
  }
  if (!isNonEmptyString(fence.controlToken)) {
    throw new ExternalDriverProtocolError(method, reason);
  }
}

/**
 * Explicit typed leaf constructor. Every call: gate on the EXACT wire method
 * + negotiated feature, validate/encode ONLY caller-owned args (capturing
 * nested ordered arrays before the await), send EXACTLY one RPC with the
 * pinned snake_case wire, then decode the immutable receipt. No acquire/
 * renew/retry/fallback and no ambient token store — the fence is an argument.
 */
export function createExternalDriverPeerCommands(
  context: ExternalDriverControlContext,
): ExternalDriverPeerCommands {
  return {
    async peerDispatch(rawArgs: PeerDispatchParams) {
      requireExternalDriverControlCapability(context, PEER_DISPATCH);
      const reason = INVALID_DISPATCH_ARGS;
      if (!isRecord(rawArgs)) {
        throw new ExternalDriverProtocolError(PEER_DISPATCH, reason);
      }
      if (!hasOnlyKeys(rawArgs, DISPATCH_REQUEST_KEYS)) {
        throw new ExternalDriverProtocolError(PEER_DISPATCH, reason);
      }
      validateFence(rawArgs, PEER_DISPATCH, reason);
      if (!isNonEmptyString(rawArgs.operationId)) {
        throw new ExternalDriverProtocolError(PEER_DISPATCH, reason);
      }
      if (!isNonEmptyString(rawArgs.model)) {
        throw new ExternalDriverProtocolError(PEER_DISPATCH, reason);
      }
      const dispatchWire = encodeDispatchTarget(rawArgs.dispatch);
      if (dispatchWire === null) {
        throw new ExternalDriverProtocolError(PEER_DISPATCH, reason);
      }
      // `existing_slug` REQUIRES an explicit non-empty kickoff_input.
      let kickoffWire: ReadonlyArray<{ kind: "text"; text: string }> | null =
        null;
      if (rawArgs.kickoffInput !== undefined) {
        kickoffWire = encodeTextInput(rawArgs.kickoffInput);
        if (kickoffWire === null) {
          throw new ExternalDriverProtocolError(PEER_DISPATCH, reason);
        }
      }
      if (dispatchWire.kind === "existing_slug" && kickoffWire === null) {
        throw new ExternalDriverProtocolError(PEER_DISPATCH, reason);
      }
      let goalId: string | undefined;
      if (rawArgs.goalId !== undefined) {
        if (!isNonEmptyString(rawArgs.goalId)) {
          throw new ExternalDriverProtocolError(PEER_DISPATCH, reason);
        }
        goalId = rawArgs.goalId;
      }
      let taskId: string | undefined;
      if (rawArgs.taskId !== undefined) {
        if (!isNonEmptyString(rawArgs.taskId)) {
          throw new ExternalDriverProtocolError(PEER_DISPATCH, reason);
        }
        taskId = rawArgs.taskId;
      }
      const requestedSlug =
        dispatchWire.kind === "existing_slug"
          ? (dispatchWire.slug as string)
          : null;
      // Immutable expectation snapshot captured BEFORE the await: the decode
      // after the await MUST NOT read the caller's mutable `rawArgs`.
      const expected = Object.freeze({
        operationId: rawArgs.operationId,
        // The caller's `model` argument IS the requested lane key; the fence
        // compares it against the echoed `model_lane`, never the resolved model.
        modelLane: rawArgs.model,
      });
      const requestedGoal =
        goalId === undefined
          ? null
          : Object.freeze(
              taskId === undefined ? { goalId } : { goalId, taskId },
            );
      // Captured BEFORE the await: the wire object is fully built and frozen.
      const wire: Record<string, unknown> = {
        session_id: context.sessionId,
        driver_id: rawArgs.driverId,
        epoch: rawArgs.epoch,
        control_token: rawArgs.controlToken,
        operation_id: rawArgs.operationId,
        model: rawArgs.model,
        dispatch: dispatchWire,
      };
      if (context.topic !== undefined) wire.topic = context.topic;
      if (kickoffWire !== null) wire.kickoff_input = kickoffWire;
      if (goalId !== undefined) wire.goal_id = goalId;
      if (taskId !== undefined) wire.task_id = taskId;
      const raw = await requestExternalDriverControl(
        context,
        PEER_DISPATCH,
        wire,
      );
      const parsed = decodePeerDispatchReceipt(
        raw,
        context,
        expected,
        requestedGoal,
        requestedSlug,
      );
      if (parsed === null) {
        throw new ExternalDriverProtocolError(
          PEER_DISPATCH,
          INVALID_DISPATCH_RECEIPT,
        );
      }
      return parsed;
    },
    async peerControl(rawArgs: PeerControlParams) {
      requireExternalDriverControlCapability(context, PEER_CONTROL);
      const reason = INVALID_CONTROL_ARGS;
      if (!isRecord(rawArgs)) {
        throw new ExternalDriverProtocolError(PEER_CONTROL, reason);
      }
      if (!hasOnlyKeys(rawArgs, CONTROL_REQUEST_KEYS)) {
        throw new ExternalDriverProtocolError(PEER_CONTROL, reason);
      }
      validateFence(rawArgs, PEER_CONTROL, reason);
      if (!isNonEmptyString(rawArgs.operationId)) {
        throw new ExternalDriverProtocolError(PEER_CONTROL, reason);
      }
      if (!isNonEmptyString(rawArgs.targetOperationId)) {
        throw new ExternalDriverProtocolError(PEER_CONTROL, reason);
      }
      if (!isProtocolUuid(rawArgs.expectedTurnId)) {
        throw new ExternalDriverProtocolError(PEER_CONTROL, reason);
      }
      const commandWire = encodeControlCommand(rawArgs.command);
      if (commandWire === null) {
        throw new ExternalDriverProtocolError(PEER_CONTROL, reason);
      }
      // Immutable expectation snapshot captured BEFORE the await.
      const expected = Object.freeze({
        operationId: rawArgs.operationId,
        targetOperationId: rawArgs.targetOperationId,
        expectedTurnId: rawArgs.expectedTurnId,
      });
      const wire: Record<string, unknown> = {
        session_id: context.sessionId,
        driver_id: rawArgs.driverId,
        epoch: rawArgs.epoch,
        control_token: rawArgs.controlToken,
        operation_id: rawArgs.operationId,
        target_operation_id: rawArgs.targetOperationId,
        expected_turn_id: rawArgs.expectedTurnId,
        command: commandWire,
      };
      if (context.topic !== undefined) wire.topic = context.topic;
      const raw = await requestExternalDriverControl(
        context,
        PEER_CONTROL,
        wire,
      );
      const parsed = decodePeerControlReceipt(raw, context, expected);
      if (parsed === null) {
        throw new ExternalDriverProtocolError(
          PEER_CONTROL,
          INVALID_CONTROL_RECEIPT,
        );
      }
      return parsed;
    },
  };
}
