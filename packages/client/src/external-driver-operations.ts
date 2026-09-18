import { isRecord } from "./rpc.ts";
import { isNonEmptyString, isNonNegativeInteger } from "./wire-decoders.ts";

import {
  adoptedIdentityIsNativeShared,
  masterWireBase as masterWireBaseForValidation,
  peerSlugIsSafe,
  workerSessionMatchesCapturedMaster,
} from "./external-driver.ts";
import type { DriverScopedGoalView } from "./external-driver.ts";

/**
 * Pure typed decoder for the opt-in `session/driver/get` operations page
 * (frozen DISPATCH-RECOVERY-HANDOFF.md + grant GLM-WEB-DISCOVERY-DECODER
 * -20260908). Wire truth: octos crates/octos-core/src/
 * ui_protocol_driver_operations.rs @ 38eca094 (dirty M), pinned 2026-09-08.
 * SHAPE-ONLY: this module parses/validates; it is NOT a runtime authority
 * — no page-chain store, pagination, retry, acquire or dispatch wiring.
 * The live client keeps `operations` unsupported until backend grant.
 */

export const DRIVER_OPERATIONS_LIMITS = Object.freeze({
  defaultLimit: 50,
  minLimit: 1,
  maxLimit: 100,
  maxCursorBytes: 4096,
  maxPageRows: 100,
  maxPageBytes: 256 * 1024,
});

/** Stable diagnostic codes — never payload content (bounded, constant). */
export const DRIVER_OPERATIONS_ERRORS = Object.freeze({
  LIMIT_OUT_OF_RANGE: "driver_operations_limit_out_of_range",
  CURSOR_EMPTY: "driver_operations_cursor_empty",
  CURSOR_TOO_LARGE: "driver_operations_cursor_too_large",
  REVISION_MALFORMED: "driver_operations_revision_malformed",
  COMPLETE_NEXT_CURSOR_MISMATCH:
    "driver_operations_complete_next_cursor_mismatch",
  IDENTITY_INCOMPLETE: "driver_operations_identity_incomplete",
  UNKNOWN_FIELD: "driver_operations_unknown_field",
  MALFORMED: "driver_operations_malformed",
  PAGE_TOO_LARGE: "driver_operations_view_too_large",
});

export class DriverOperationsError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "DriverOperationsError";
  }
}

function fail(code: string): never {
  throw new DriverOperationsError(code);
}

export interface DriverOperationsPageRequestInit {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface DriverOperationsBuiltRequest {
  /** Serde-ready wire object (empty object = defaults). */
  readonly wire: Readonly<Record<string, string | number>>;
  readonly effectiveLimit: number;
}

/** Captured BEFORE the response: confirmed profile + master wire session. */
export interface DriverOperationsCapturedScope {
  readonly profileId: string;
  readonly masterSessionId: string;
}

export type DriverOperationLifecycle =
  "accepted" | "admitted" | "started" | "terminal" | "recovery_required";

export interface DriverOperationAcceptanceView {
  readonly model: string;
  readonly modelLane: string;
  readonly workspaceRoot: string;
  readonly scopedGoal: DriverScopedGoalView | null;
  readonly adoptedTurnId: string;
  readonly adoptedSessionId: string;
  readonly slug: string;
  readonly acceptedAtMs: number;
  readonly payloadDigest: string;
}

export interface OperationRecoveryRow {
  readonly operationId: string;
  readonly kind: "peer_dispatch";
  readonly acceptance: DriverOperationAcceptanceView;
  readonly lifecycle: DriverOperationLifecycle;
  readonly createdAtMs: number;
  readonly startedAtMs?: number;
  readonly terminalAtMs?: number;
}

export interface DriverOperationsPageView {
  readonly items: readonly OperationRecoveryRow[];
  readonly snapshot: string;
  readonly observedRevision: string;
  readonly complete: boolean;
  readonly nextCursor: string | null;
}

const utf8 = new TextEncoder();
const utf8Bytes = (value: string): number => utf8.encode(value).length;

/**
 * Builds the request `operations` object. Omitted init → undefined (legacy
 * wire preserved). Explicit unknown fields, null cursor/limit, fractional
 * or out-of-range limits, and empty/oversized cursors throw typed errors —
 * an explicit malformed request can never silently disappear.
 */
export function buildDriverOperationsRequest(
  init?: DriverOperationsPageRequestInit,
): DriverOperationsBuiltRequest | undefined {
  if (init === undefined) return undefined;
  if (init === null || typeof init !== "object" || Array.isArray(init)) {
    fail(DRIVER_OPERATIONS_ERRORS.MALFORMED);
  }
  const allowed = new Set(["cursor", "limit"]);
  for (const key of Object.keys(init)) {
    if (!allowed.has(key)) fail(DRIVER_OPERATIONS_ERRORS.UNKNOWN_FIELD);
  }
  const wire: Record<string, string | number> = {};
  if (init.cursor !== undefined) {
    if (typeof init.cursor !== "string") {
      fail(DRIVER_OPERATIONS_ERRORS.MALFORMED);
    }
    if (init.cursor.length === 0) fail(DRIVER_OPERATIONS_ERRORS.CURSOR_EMPTY);
    if (utf8Bytes(init.cursor) > DRIVER_OPERATIONS_LIMITS.maxCursorBytes) {
      fail(DRIVER_OPERATIONS_ERRORS.CURSOR_TOO_LARGE);
    }
    wire.cursor = init.cursor;
  }
  let effectiveLimit: number = DRIVER_OPERATIONS_LIMITS.defaultLimit;
  if (init.limit !== undefined) {
    if (
      typeof init.limit !== "number" ||
      !Number.isSafeInteger(init.limit) ||
      init.limit < DRIVER_OPERATIONS_LIMITS.minLimit ||
      init.limit > DRIVER_OPERATIONS_LIMITS.maxLimit
    ) {
      fail(DRIVER_OPERATIONS_ERRORS.LIMIT_OUT_OF_RANGE);
    }
    wire.limit = init.limit;
    effectiveLimit = init.limit;
  }
  return Object.freeze({ wire: Object.freeze(wire), effectiveLimit });
}

const LIFECYCLES = new Set([
  "accepted",
  "admitted",
  "started",
  "terminal",
  "recovery_required",
]);

function parseScopedGoal(value: unknown): DriverScopedGoalView | null | "bad" {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return "bad";
  const allowed = new Set(["goal_id", "task_id", "revision"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return "bad";
  }
  if (!isNonEmptyString(value.goal_id)) return "bad";
  if (value.task_id !== undefined && !isNonEmptyString(value.task_id)) {
    return "bad";
  }
  if (value.revision !== undefined && !isNonNegativeInteger(value.revision)) {
    return "bad";
  }
  return Object.freeze({
    goalId: value.goal_id,
    ...(value.task_id === undefined ? {} : { taskId: value.task_id }),
    ...(value.revision === undefined ? {} : { revision: value.revision }),
  });
}

function parseAcceptance(
  value: unknown,
  scope: DriverOperationsCapturedScope,
): DriverOperationAcceptanceView | "bad" {
  if (!isRecord(value)) return "bad";
  const allowed = new Set([
    "model",
    "model_lane",
    "workspace_root",
    "scoped_goal",
    "adopted_turn_id",
    "adopted_session_id",
    "slug",
    "accepted_at_ms",
    "payload_digest",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return "bad";
  }
  if (!isNonEmptyString(value.model)) return "bad";
  if (!isNonEmptyString(value.model_lane)) return "bad";
  if (!isNonEmptyString(value.workspace_root)) return "bad";
  if (typeof value.adopted_turn_id !== "string") return "bad";
  if (!isNonEmptyString(value.adopted_session_id)) return "bad";
  if (typeof value.slug !== "string" || !peerSlugIsSafe(value.slug)) {
    return "bad";
  }
  if (!isNonNegativeInteger(value.accepted_at_ms)) return "bad";
  if (!isNonEmptyString(value.payload_digest)) return "bad";
  const goal = parseScopedGoal(value.scoped_goal);
  if (goal === "bad") return "bad";
  if (
    !adoptedIdentityIsNativeShared(
      value.adopted_turn_id,
      value.adopted_session_id,
      value.slug,
    )
  ) {
    return "bad";
  }
  if (
    !workerSessionMatchesCapturedMaster(
      scope.masterSessionId,
      scope.profileId,
      value.adopted_session_id,
      value.slug,
    )
  ) {
    return "bad";
  }
  return Object.freeze({
    model: value.model,
    modelLane: value.model_lane,
    workspaceRoot: value.workspace_root,
    scopedGoal: goal,
    adoptedTurnId: value.adopted_turn_id,
    adoptedSessionId: value.adopted_session_id,
    slug: value.slug,
    acceptedAtMs: value.accepted_at_ms,
    payloadDigest: value.payload_digest,
  });
}

function parseRow(
  value: unknown,
  scope: DriverOperationsCapturedScope,
): OperationRecoveryRow | "bad" {
  if (!isRecord(value)) return "bad";
  const allowed = new Set([
    "operation_id",
    "kind",
    "acceptance",
    "lifecycle",
    "created_at_ms",
    "started_at_ms",
    "terminal_at_ms",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return "bad";
  }
  if (!isNonEmptyString(value.operation_id)) return "bad";
  if (value.kind !== "peer_dispatch") return "bad";
  if (typeof value.lifecycle !== "string" || !LIFECYCLES.has(value.lifecycle)) {
    return "bad";
  }
  if (!isNonNegativeInteger(value.created_at_ms)) return "bad";
  if (value.started_at_ms !== undefined) {
    if (!isNonNegativeInteger(value.started_at_ms)) return "bad";
  }
  if (value.terminal_at_ms !== undefined) {
    if (!isNonNegativeInteger(value.terminal_at_ms)) return "bad";
  }
  const acceptance = parseAcceptance(value.acceptance, scope);
  if (acceptance === "bad") return "bad";
  return Object.freeze({
    operationId: value.operation_id,
    kind: "peer_dispatch" as const,
    acceptance,
    lifecycle: value.lifecycle as DriverOperationLifecycle,
    createdAtMs: value.created_at_ms,
    ...(value.started_at_ms === undefined
      ? {}
      : { startedAtMs: value.started_at_ms }),
    ...(value.terminal_at_ms === undefined
      ? {}
      : { terminalAtMs: value.terminal_at_ms }),
  });
}

/** Canonical decimal-string u64: `0` or nonzero-leading ASCII digits. */
export function parseObservedRevision(value: string): bigint | null {
  // Bound the digit run BEFORE any BigInt allocation: canonical u64 is at
  // most 20 ASCII digits, so a longer run can never be in range.
  if (value.length === 0 || value.length > 20) return null;
  if (!/^[0-9]+$/u.test(value)) return null;
  if (value !== "0" && value.startsWith("0")) return null;
  if (value.length === 20 && value > "18446744073709551615") return null;
  return BigInt(value);
}

/**
 * Parses the `operations` field of a `session/driver/get` RESULT. Returns
 * null for any malformed shape — explicit `operations: null`, missing
 * `next_cursor`, non-canonical revision, unknown fields, non-native
 * identity, or whole-page overflow (rows/bytes; never truncates). Parsed
 * views are frozen and detached; no prompt/proof/token is disclosed.
 */
function validateCapturedOperationsScope(
  scope: DriverOperationsCapturedScope,
): void {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) {
    throw new DriverOperationsError(DRIVER_OPERATIONS_ERRORS.MALFORMED);
  }
  // FULL shared validation via masterWireBase — profile syntax, base
  // shape and topic all validated up front for EVERY page (empty items
  // and omitted operations included); no guessed authority from rows.
  if (
    typeof scope.profileId !== "string" ||
    typeof scope.masterSessionId !== "string" ||
    masterWireBaseForValidation(scope.masterSessionId, scope.profileId) === null
  ) {
    throw new DriverOperationsError(DRIVER_OPERATIONS_ERRORS.MALFORMED);
  }
}

export function parseDriverOperationsPageResult(
  value: unknown,
  scope: DriverOperationsCapturedScope,
): DriverOperationsPageView | null {
  validateCapturedOperationsScope(scope);
  if (!isRecord(value)) return null;
  const allowed = new Set([
    "items",
    "snapshot",
    "observed_revision",
    "complete",
    "next_cursor",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return null;
  }
  if (!Array.isArray(value.items)) return null;
  if (value.items.length > DRIVER_OPERATIONS_LIMITS.maxPageRows) {
    return null;
  }
  if (!isNonEmptyString(value.snapshot)) return null;
  if (typeof value.observed_revision !== "string") return null;
  if (parseObservedRevision(value.observed_revision) === null) return null;
  if (typeof value.complete !== "boolean") return null;
  // next_cursor is REQUIRED string-or-null; missing is malformed.
  if (!("next_cursor" in value)) return null;
  const nextCursorRaw = (value as Record<string, unknown>).next_cursor;
  if (nextCursorRaw === null) {
    if (!value.complete) return null;
  } else {
    if (typeof nextCursorRaw !== "string") return null;
    if (nextCursorRaw.length === 0) return null;
    if (utf8Bytes(nextCursorRaw) > DRIVER_OPERATIONS_LIMITS.maxCursorBytes) {
      return null;
    }
    if (value.complete) return null;
  }
  // EXACT RAW snake_case serialization bound: measure the wire bytes the
  // server sent (UTF-8), never a renamed camelCase view approximation. A
  // cyclic/unknown payload throws inside JSON.stringify — caught, bounded
  // constant rejection, never a crash.
  let rawBytes: number;
  try {
    rawBytes = utf8Bytes(JSON.stringify(value));
  } catch {
    return null;
  }
  if (rawBytes > DRIVER_OPERATIONS_LIMITS.maxPageBytes) {
    return null;
  }
  const rows: OperationRecoveryRow[] = [];
  for (const raw of value.items) {
    const row = parseRow(raw, scope);
    if (row === "bad") return null;
    rows.push(row);
  }
  const view: DriverOperationsPageView = {
    items: Object.freeze(rows),
    snapshot: value.snapshot,
    observedRevision: value.observed_revision,
    complete: value.complete,
    nextCursor: nextCursorRaw as string | null,
  };
  return Object.freeze(view);
}

export type DriverGetOperationsOutcome =
  | { kind: "omitted" }
  | { kind: "unsupported" }
  | { kind: "malformed" }
  | { kind: "page"; page: DriverOperationsPageView };

/**
 * Typed pure boundary for the `operations` field of a `session/driver/get`
 * RESULT, resolved against whether the caller REQUESTED a page: requested +
 * absent is typed UNSUPPORTED (never an empty inventory); malformed
 * (`operations: null`, missing `next_cursor`, bad row) stays malformed. A
 * page the server sent without a request is still a page. Pure — the live
 * client keeps `operations` unsupported until the backend grant.
 */
export function classifyDriverGetOperationsResult(
  result: unknown,
  requested: boolean,
  scope: DriverOperationsCapturedScope,
): DriverGetOperationsOutcome | null {
  validateCapturedOperationsScope(scope);
  if (!isRecord(result)) return { kind: "malformed" };
  const operations = (result as Record<string, unknown>).operations;
  if (operations === undefined) {
    return requested ? { kind: "unsupported" } : { kind: "omitted" };
  }
  const page = parseDriverOperationsPageResult(operations, scope);
  if (page === null) return { kind: "malformed" };
  return { kind: "page", page };
}
