import { isRecord } from "./rpc.ts";
import {
  EXTERNAL_DRIVER_METHODS,
  ExternalDriverProtocolError,
  requireExternalDriverControlCapability,
  requestExternalDriverControl,
  type ExternalDriverControlContext,
} from "./external-driver.ts";
import { isNonEmptyString, isU32, isU64 } from "./supervision-primitives.ts";

/** Wake control wire methods (ui_protocol.rs 1249 / 1253). Read ONLY inside
 * functions/invocations — never at module top level (contract §11), which
 * also keeps the leaf safe under the existing circular imports. */
function wakeClaimMethod(): string {
  return EXTERNAL_DRIVER_METHODS.SESSION_WAKE_CLAIM;
}
function wakeAckMethod(): string {
  return EXTERNAL_DRIVER_METHODS.SESSION_WAKE_ACK;
}

const INVALID_CLAIM_PARAMS = "invalid wake claim parameters";
const INVALID_ACK_PARAMS = "invalid wake ack parameters";
const CLAIM_RESULT_MALFORMED = "wake claim result malformed";
const ACK_RESULT_MALFORMED = "wake ack result malformed";

/**
 * Caller-supplied claim input. Every field is an EXPLICIT plain argument and
 * proof (`controlToken`) is never read from a token store, ambient lease or
 * global — there is no implicit acquire / retry / fallback.
 */
export interface ExternalDriverWakeClaimParams {
  readonly driverId: string;
  readonly epoch: number;
  readonly controlToken: string;
  /** OPAQUE wire cursor; echoed verbatim, never parsed. */
  readonly mailboxCursor?: string;
  readonly limit?: number;
  readonly ttlSeconds?: number;
}

/** One retained occurrence (ui_protocol.rs `WakeOccurrenceView` ~8208). */
export interface ExternalDriverWakeOccurrenceView {
  readonly sequence: number;
  readonly reasonKind: string;
  readonly dedupeKey: string;
  readonly payload?: unknown;
  readonly continuationRef?: string;
  readonly payloadDigest: string;
  readonly createdAtMs: number;
}

/** Result of `session/wake/claim` (~8287). `nextCursor` stays opaque. */
export interface ExternalDriverWakeClaimView {
  readonly occurrences: readonly ExternalDriverWakeOccurrenceView[];
  readonly claimToken: string;
  readonly nextCursor: string;
  readonly leaseExpiresAtMs: number;
}

/**
 * Caller-supplied ack input. `claimToken`/`sequences`/`operationIds` are the
 * claim's OWN ids, preserved in caller order and copied BEFORE any await.
 */
export interface ExternalDriverWakeAckParams {
  readonly driverId: string;
  readonly epoch: number;
  readonly controlToken: string;
  readonly claimToken: string;
  readonly sequences: readonly number[];
  readonly operationIds?: readonly string[];
}

/** Result of `session/wake/ack` (~8324): durably recorded DECISION, not a
 * delivery receipt, turn completion or goal completion. */
export interface ExternalDriverWakeAckView {
  readonly acknowledged: readonly number[];
}

/** Bounded constant claim failure — never echoes the raw reply. */
function claimFailure(): ExternalDriverProtocolError {
  return new ExternalDriverProtocolError(
    wakeClaimMethod(),
    CLAIM_RESULT_MALFORMED,
  );
}

function ackFailure(): ExternalDriverProtocolError {
  return new ExternalDriverProtocolError(wakeAckMethod(), ACK_RESULT_MALFORMED);
}

/** Recursively freeze a detached JSON value (payload/acknowledged arrays). */
function deepFreeze(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value);
  }
  if (isRecord(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    return Object.freeze(value);
  }
  return value;
}

/** Private sentinel: a payload that is not a finite JSON value cannot be
 * cloned, so the occurrence is refused with the bounded constant failure. */
const WAKE_PAYLOAD_NOT_CLONEABLE = Symbol("wake payload not cloneable");

/**
 * Clone a JSON value WITHOUT touching the caller's object graph. Cyclic,
 * non-finite-number, function, symbol, bigint or `undefined` content is not a
 * JSON value and throws the private sentinel (never a raw DataCloneError).
 */
function cloneJsonValue(value: unknown, seen: Set<object>): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw WAKE_PAYLOAD_NOT_CLONEABLE;
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw WAKE_PAYLOAD_NOT_CLONEABLE;
    seen.add(value);
    const cloned = value.map((entry) => cloneJsonValue(entry, seen));
    seen.delete(value);
    return cloned;
  }
  if (isRecord(value)) {
    if (seen.has(value)) throw WAKE_PAYLOAD_NOT_CLONEABLE;
    seen.add(value);
    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      // Define each OWN key as a data property. A plain `cloned[key] = ...`
      // would let an own JSON `"__proto__"` key invoke the prototype setter,
      // changing the clone's prototype and losing that own content.
      Object.defineProperty(cloned, key, {
        value: cloneJsonValue(entry, seen),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    seen.delete(value);
    return cloned;
  }
  throw WAKE_PAYLOAD_NOT_CLONEABLE;
}

/**
 * Decode ONE occurrence. Exactly ONE of `payload` / `continuation_ref` must be
 * MEANINGFULLY present (`content_is_decidable`, ~8233): a bare digest is never
 * decidable and both-present is ambiguous. Core serde maps JSON `null` to
 * `None` for both `Option` fields (transport ~19445), so `undefined` AND
 * `null` both count as ABSENT. Only known fields are copied forward; the
 * payload is returned as intentional decidable content, not redacted.
 */
function decodeOccurrence(
  value: unknown,
): ExternalDriverWakeOccurrenceView | null {
  if (!isRecord(value)) return null;
  const {
    sequence,
    reason_kind,
    dedupe_key,
    payload,
    continuation_ref,
    payload_digest,
    created_at_ms,
  } = value;
  if (!isU64(sequence)) return null;
  if (!isNonEmptyString(reason_kind)) return null;
  if (!isNonEmptyString(dedupe_key)) return null;
  if (!isNonEmptyString(payload_digest)) return null;
  if (!isU64(created_at_ms)) return null;
  const hasPayload = payload !== undefined && payload !== null;
  let ref: string | undefined;
  if (continuation_ref !== undefined && continuation_ref !== null) {
    if (!isNonEmptyString(continuation_ref)) return null;
    ref = continuation_ref;
  }
  // EXACTLY ONE meaningful form: neither (incl. null-only) or both is refused.
  if (hasPayload === (ref !== undefined)) return null;
  const occurrence: {
    sequence: number;
    reasonKind: string;
    dedupeKey: string;
    payload?: unknown;
    continuationRef?: string;
    payloadDigest: string;
    createdAtMs: number;
  } = {
    sequence,
    reasonKind: reason_kind,
    dedupeKey: dedupe_key,
    payloadDigest: payload_digest,
    createdAtMs: created_at_ms,
  };
  if (hasPayload) {
    let cloned: unknown;
    try {
      // Clone BEFORE freezing so the caller's raw payload object is never
      // mutated in place; non-JSON/cyclic input is a bounded typed refusal.
      cloned = deepFreeze(cloneJsonValue(payload, new Set<object>()));
    } catch {
      return null;
    }
    occurrence.payload = cloned;
  }
  if (ref !== undefined) occurrence.continuationRef = ref;
  return Object.freeze(occurrence);
}

export function parseExternalDriverWakeClaimResult(
  reply: unknown,
): ExternalDriverWakeClaimView {
  if (!isRecord(reply)) throw claimFailure();
  const { occurrences, claim_token, next_cursor, lease_expires_at_ms } = reply;
  if (!Array.isArray(occurrences)) throw claimFailure();
  const decoded: ExternalDriverWakeOccurrenceView[] = [];
  for (const entry of occurrences) {
    const occurrence = decodeOccurrence(entry);
    if (occurrence === null) throw claimFailure();
    decoded.push(occurrence);
  }
  if (!isNonEmptyString(claim_token)) throw claimFailure();
  if (!isNonEmptyString(next_cursor)) throw claimFailure();
  if (!isU64(lease_expires_at_ms)) throw claimFailure();
  return Object.freeze({
    occurrences: Object.freeze(decoded),
    claimToken: claim_token,
    nextCursor: next_cursor,
    leaseExpiresAtMs: lease_expires_at_ms,
  });
}

export function parseExternalDriverWakeAckResult(
  reply: unknown,
): ExternalDriverWakeAckView {
  if (!isRecord(reply)) throw ackFailure();
  const { acknowledged } = reply;
  if (!Array.isArray(acknowledged)) throw ackFailure();
  const decoded: number[] = [];
  for (const entry of acknowledged) {
    if (!isU64(entry)) throw ackFailure();
    decoded.push(entry);
  }
  return Object.freeze({ acknowledged: Object.freeze(decoded) });
}

/** Explicit return surface of the wake leaf (contract §11/§12). */
export interface ExternalDriverWakeCommands {
  wakeClaim(
    params: ExternalDriverWakeClaimParams,
  ): Promise<ExternalDriverWakeClaimView>;
  wakeAck(
    params: ExternalDriverWakeAckParams,
  ): Promise<ExternalDriverWakeAckView>;
}

/** Validate the REQUIRED proof fence; returns copied scalars (pre-await). */
function copyFence(
  params: unknown,
  method: string,
  reason: string,
): { driverId: string; epoch: number; controlToken: string } {
  if (!isRecord(params)) throw new ExternalDriverProtocolError(method, reason);
  const { driverId, epoch, controlToken } = params;
  if (!isNonEmptyString(driverId)) {
    throw new ExternalDriverProtocolError(method, reason);
  }
  if (!isU64(epoch)) throw new ExternalDriverProtocolError(method, reason);
  if (!isNonEmptyString(controlToken)) {
    throw new ExternalDriverProtocolError(method, reason);
  }
  return { driverId, epoch, controlToken };
}

/** Reject any caller-supplied field outside the allowlist (fail closed). */
function assertOnlyKeys(
  params: Record<string, unknown>,
  allowed: readonly string[],
  method: string,
  reason: string,
): void {
  for (const key of Object.keys(params)) {
    if (!allowed.includes(key)) {
      throw new ExternalDriverProtocolError(method, reason);
    }
  }
}

const CLAIM_ALLOWED = [
  "driverId",
  "epoch",
  "controlToken",
  "mailboxCursor",
  "limit",
  "ttlSeconds",
] as const;

/** One `session/wake/claim` RPC. Capability is gated FIRST, args validated,
 * scalars copied before the single await, wire encoded EXACT snake_case. */
async function runWakeClaim(
  context: ExternalDriverControlContext,
  params: ExternalDriverWakeClaimParams,
): Promise<ExternalDriverWakeClaimView> {
  const method = wakeClaimMethod();
  requireExternalDriverControlCapability(context, method);
  if (!isRecord(params)) {
    throw new ExternalDriverProtocolError(method, INVALID_CLAIM_PARAMS);
  }
  assertOnlyKeys(params, CLAIM_ALLOWED, method, INVALID_CLAIM_PARAMS);
  const fence = copyFence(params, method, INVALID_CLAIM_PARAMS);
  const { mailboxCursor, limit, ttlSeconds } = params;
  if (mailboxCursor !== undefined && !isNonEmptyString(mailboxCursor)) {
    throw new ExternalDriverProtocolError(method, INVALID_CLAIM_PARAMS);
  }
  if (limit !== undefined && !isU32(limit)) {
    throw new ExternalDriverProtocolError(method, INVALID_CLAIM_PARAMS);
  }
  if (ttlSeconds !== undefined && !isU32(ttlSeconds)) {
    throw new ExternalDriverProtocolError(method, INVALID_CLAIM_PARAMS);
  }
  const wire: Record<string, unknown> = {
    session_id: context.sessionId,
    driver_id: fence.driverId,
    epoch: fence.epoch,
    control_token: fence.controlToken,
  };
  if (context.topic !== undefined) wire.topic = context.topic;
  if (mailboxCursor !== undefined) wire.mailbox_cursor = mailboxCursor;
  if (limit !== undefined) wire.limit = limit;
  if (ttlSeconds !== undefined) wire.ttl_seconds = ttlSeconds;
  const reply = await requestExternalDriverControl(context, method, wire);
  return parseExternalDriverWakeClaimResult(reply);
}

const ACK_ALLOWED = [
  "driverId",
  "epoch",
  "controlToken",
  "claimToken",
  "sequences",
  "operationIds",
] as const;

/** One `session/wake/ack` RPC. Sequences/operationIds are copied in caller
 * order BEFORE the await; ack means a durable DECISION, never completion. */
async function runWakeAck(
  context: ExternalDriverControlContext,
  params: ExternalDriverWakeAckParams,
): Promise<ExternalDriverWakeAckView> {
  const method = wakeAckMethod();
  requireExternalDriverControlCapability(context, method);
  if (!isRecord(params)) {
    throw new ExternalDriverProtocolError(method, INVALID_ACK_PARAMS);
  }
  assertOnlyKeys(params, ACK_ALLOWED, method, INVALID_ACK_PARAMS);
  const fence = copyFence(params, method, INVALID_ACK_PARAMS);
  const { claimToken, sequences, operationIds } = params;
  if (!isNonEmptyString(claimToken)) {
    throw new ExternalDriverProtocolError(method, INVALID_ACK_PARAMS);
  }
  if (!Array.isArray(sequences) || sequences.length === 0) {
    throw new ExternalDriverProtocolError(method, INVALID_ACK_PARAMS);
  }
  const orderedSequences: number[] = [];
  for (const entry of sequences) {
    if (!isU64(entry)) {
      throw new ExternalDriverProtocolError(method, INVALID_ACK_PARAMS);
    }
    orderedSequences.push(entry);
  }
  const orderedOperationIds: string[] = [];
  if (operationIds !== undefined) {
    if (!Array.isArray(operationIds)) {
      throw new ExternalDriverProtocolError(method, INVALID_ACK_PARAMS);
    }
    for (const entry of operationIds) {
      if (!isNonEmptyString(entry)) {
        throw new ExternalDriverProtocolError(method, INVALID_ACK_PARAMS);
      }
      orderedOperationIds.push(entry);
    }
  }
  const wire: Record<string, unknown> = {
    session_id: context.sessionId,
    driver_id: fence.driverId,
    epoch: fence.epoch,
    control_token: fence.controlToken,
    claim_token: claimToken,
    sequences: orderedSequences,
  };
  if (context.topic !== undefined) wire.topic = context.topic;
  if (orderedOperationIds.length > 0) wire.operation_ids = orderedOperationIds;
  const reply = await requestExternalDriverControl(context, method, wire);
  return parseExternalDriverWakeAckResult(reply);
}

/** Composes the WAKE leaf's methods onto a captured control context. */
export function createExternalDriverWakeCommands(
  context: ExternalDriverControlContext,
): ExternalDriverWakeCommands {
  return {
    wakeClaim: (params) => runWakeClaim(context, params),
    wakeAck: (params) => runWakeAck(context, params),
  };
}
