import { isRecord } from "./rpc.ts";
import { isNonEmptyString, isNonNegativeInteger } from "./wire-decoders.ts";
import { isProtocolUuid } from "./protocol-id.ts";

export { isProtocolUuid as isProtocolUuidReexported } from "./protocol-id.ts";
import {
  buildDriverOperationsRequest,
  classifyDriverGetOperationsResult,
} from "./external-driver-operations.ts";
import { OctosUiProtocolError } from "./protocol-error.ts";
import type {
  DriverOperationsPageRequestInit,
  DriverOperationsPageView,
} from "./external-driver-operations.ts";
import type { UiProtocolCapabilities } from "./types.ts";
import { createExternalDriverPeerCommands } from "./external-driver-peer-control.ts";
import { createExternalDriverWakeCommands } from "./external-driver-wake-control.ts";
import type { ExternalDriverPeerCommands } from "./external-driver-peer-control.ts";
import type { ExternalDriverWakeCommands } from "./external-driver-wake-control.ts";

/**
 * Narrow, fail-closed slice of the OUP external-master surface
 * (`external_driver_v1`). Per AGENTS.md this is a vertical-slice guard, NOT
 * a copied Rust schema.
 *
 * Source pin (wire truth, recorded at inspection): oup-external-master
 * checkout octos at HEAD 38eca0945afe84b875487ac6c374272f6408a0a7 with
 * crates/octos-core/src/ui_protocol.rs DIRTY (candidate M state), sha256
 * 8406abdb9017ab6b... — the feature is NOT committed at 38eca.
 * DISPATCH-RECOVERY-HANDOFF.md (frozen 2026-09-07): every SUCCESSFUL
 * peer/dispatch receipt carries state "accepted" (immutable acceptance;
 * lifecycle disclosed separately, never on the receipt); a retained
 * inactive binding is disclosure only; requested-but-missing `operations`
 * inventory is UNSUPPORTED, never empty. WEB-NATIVE-IDENTITY-ALIGNMENT
 * (2026-09-08): the native assign_external_identity preserves the trusted
 * MASTER WIRE BASE (Core SessionKey::base_key, first `#topic` stripped) and
 * appends `#peer-<slug>` — no TUI prefix is ever manufactured for a bare
 * Web ID. TurnIds are protocol UUIDs (protocol-id.ts isProtocolUuid).
 */


const DRIVER_GET = EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_GET;
const DISPATCH = EXTERNAL_DRIVER_METHODS.PEER_DISPATCH;
const ACQUIRE = EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_ACQUIRE;
const RENEW = EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_RENEW;
const RELEASE = EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_RELEASE;

export type DriverMode = "internal" | "external";
export type DriverRecoveryState = "none" | "interrupted" | "recovery_required";

export interface DriverBindingView {
  readonly driverId: string;
  readonly epoch: number;
  /** Public CAS target. Reading it is never control authority. */
  readonly revision: number;
  /** 0 = no live lease (retained inactive bindings always carry 0). */
  readonly leaseExpiresAtMs: number;
  readonly workspaceRoot?: string;
  readonly acceptedWork: readonly string[];
}

export interface SessionDriverGetView {
  readonly mode: DriverMode;
  /** null = never-bound internal scope; implies initial expected_revision 0. */
  readonly binding: DriverBindingView | null;
  readonly recovery: DriverRecoveryState;
}


/** Whitelist ONE typed kind from a server protocol error's data.kind. */
function typedRefusalKind(
  serverError: unknown,
): ExternalDriverRefusalKind | null {
  // IDENTITY, not duck-typing: only the ACTUAL client protocol error's
  // data.kind is eligible. A fake lookalike object (plain Error or literal
  // with a matching .data.kind) never yields a typed refusal — it stays
  // the scrubbed generic failure.
  if (!(serverError instanceof OctosUiProtocolError)) return null;
  const data = serverError.data;
  const kind = (data as { kind?: unknown } | null | undefined)?.kind;
  if (typeof kind !== "string") return null;
  return (EXTERNAL_DRIVER_REFUSAL_KINDS as readonly string[]).includes(kind)
    ? (kind as ExternalDriverRefusalKind)
    : null;
}


function isDriverMode(value: unknown): value is DriverMode {
  return value === "internal" || value === "external";
}

function isDriverRecovery(value: unknown): value is DriverRecoveryState {
  return (
    value === "none" || value === "interrupted" || value === "recovery_required"
  );
}

function isAbsentOrNull(value: unknown): boolean {
  return value === undefined || value === null;
}

/** Mirrors peer-protocol.ts `profile`: non-empty, no `:`, `#`, whitespace. */
function isValidProfileId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !/[:#\s]/u.test(value)
  );
}

/** A full peer topic, e.g. `peer-abc`. */
function isValidPeerTopic(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("peer-") &&
    peerSlugIsSafe(value.slice(5))
  );
}

/**
 * Both gates are REQUIRED: the connected server must advertise the method
 * AND negotiate the `external_driver_v1` feature. Absence of either fails
 * closed before any wire traffic.
 */
export function decodeExternalDriverCapabilities(
  capabilities: UiProtocolCapabilities,
): {
  available: boolean;
  methodAdvertised: boolean;
  featureAdvertised: boolean;
} {
  const methodAdvertised = capabilities.supported_methods.includes(DRIVER_GET);
  const featureAdvertised = (capabilities.supported_features ?? []).includes(
    EXTERNAL_DRIVER_V1_FEATURE,
  );
  return {
    available: methodAdvertised && featureAdvertised,
    methodAdvertised,
    featureAdvertised,
  };
}

/**
 * Strict `session/driver/get` result decoder. Unknown fields (including any
 * control token, proof or digest) never reach the parsed public view. A
 * retained binding in internal mode must be INACTIVE (lease 0) — CAS
 * metadata is disclosure, never control authority. u64 wire integers are
 * accepted only as exact safe integers; never rounded or coerced. Views are
 * frozen and detached from the server payload.
 */
export function parseSessionDriverGetResult(
  value: unknown,
): SessionDriverGetView | null {
  if (!isRecord(value)) return null;
  if (!isDriverMode(value.mode)) return null;
  if (!isDriverRecovery(value.recovery)) return null;
  if (isAbsentOrNull(value.binding)) {
    if (value.mode === "external") return null;
    return Object.freeze({
      mode: value.mode,
      binding: null,
      recovery: value.recovery,
    });
  }
  const binding = value.binding as unknown;
  if (!isRecord(binding)) return null;
  if (!isNonEmptyString(binding.driver_id)) return null;
  if (!isNonNegativeInteger(binding.epoch)) return null;
  if (!isNonNegativeInteger(binding.revision)) return null;
  if (!isNonNegativeInteger(binding.lease_expires_at_ms)) return null;
  if (
    binding.workspace_root !== undefined &&
    !isNonEmptyString(binding.workspace_root)
  ) {
    return null;
  }
  if (binding.accepted_work !== undefined) {
    if (!Array.isArray(binding.accepted_work)) return null;
    if (!binding.accepted_work.every(isNonEmptyString)) return null;
  }
  const view: DriverBindingView = Object.freeze({
    driverId: binding.driver_id,
    epoch: binding.epoch,
    revision: binding.revision,
    leaseExpiresAtMs: binding.lease_expires_at_ms,
    ...(binding.workspace_root === undefined
      ? {}
      : { workspaceRoot: binding.workspace_root }),
    acceptedWork: Object.freeze([...(binding.accepted_work ?? [])]),
  });
  if (value.mode === "internal" && view.leaseExpiresAtMs !== 0) return null;
  return Object.freeze({
    mode: value.mode,
    binding: view,
    recovery: value.recovery,
  });
}

/**
 * CAS input for a future acquire: revision 0 ONLY for a never-bound
 * internal scope; a retained inactive binding keeps its live revision.
 */
export function nextExpectedRevision(result: SessionDriverGetView): number {
  return result.binding === null ? 0 : result.binding.revision;
}

/** Minimal adapter the host app injects; no client internals leak through. */
export interface ExternalDriverRpc {
  request(method: string, params: unknown): Promise<unknown>;
}

/** Confirmed (profile, full session/topic) scope captured by the host. */
export interface ExternalDriverScope {
  readonly profileId: string;
  readonly topic?: string;
}

export interface DriverGetOptions {
  /**
   * Typed discovery page request (cursor/limit). Omitted entirely —
   * legacy wire preserved. Explicit malformed options (null/array/unknown
   * fields, out-of-range limit, empty cursor) reject OFFLINE with bounded
   * constant errors; a requested-but-missing result inventory is a typed
   * explicit UNSUPPORTED failure, never an empty page.
   */
  readonly operations?: DriverOperationsPageRequestInit;
}

/** driverGet result: legacy binding view, plus a typed operations page
 * outcome ONLY when the caller requested one. */
/** Success-only operations outcome exposed by driverGet: a valid frozen
 * page. Unsupported/malformed/omitted outcomes never reach callers —
 * they are typed protocol failures. */
export interface DriverGetOperationsPageOutcome {
  readonly kind: "page";
  readonly page: DriverOperationsPageView;
}

export interface SessionDriverGetWithOperationsView extends SessionDriverGetView {
  readonly operations?: DriverGetOperationsPageOutcome;
}

/** Opaque, closure-backed lease capability. The proof token lives in a
 * closure and is NOT an own enumerable property, so JSON/debug/keys/values of
 * any public view cannot leak it; only an explicit `reveal()` returns it. */
export interface DriverControlCapability {
  readonly driverId: string;
  readonly epoch: number;
  reveal(): string;
}

/** Explicit caller-supplied lease fence. Proof is ALWAYS an argument — never
 * read from localStorage, a global, or any ambient token store. */
export interface DriverControlFence {
  readonly driverId: string;
  readonly epoch: number;
  readonly controlToken: string;
}

export interface DriverAcquireParams {
  readonly driverId: string;
  readonly expectedRevision: number;
  readonly leaseSeconds: number;
}

/** Decoded `session/driver/acquire` result: the proof is reachable ONLY
 * through the opaque capability handle. */
export interface DriverAcquireView {
  readonly capability: DriverControlCapability;
  readonly binding: DriverBindingView;
  readonly pendingWork: readonly string[];
  readonly recovery: DriverRecoveryState;
}

export interface DriverRenewParams extends DriverControlFence {
  readonly leaseSeconds: number;
}

/** `session/driver/renew` result: the refreshed lease deadline only. */
export interface DriverRenewView {
  readonly leaseExpiresAtMs: number;
}

/** Explicit next mode for release. */
export type DriverReleaseNext = DriverMode;

export interface DriverReleaseParams extends DriverControlFence {
  readonly expectedRevision: number;
  readonly next: DriverReleaseNext;
}

/** `session/driver/release` result: the parked binding view (lease 0) and the
 * disclosure-only recovery state. No CAS reset happens on the client. */
export interface DriverReleaseView {
  readonly mode: DriverMode;
  readonly binding: DriverBindingView | null;
  readonly recovery: DriverRecoveryState;
}

export interface ExternalDriverCommands {
  driverGet(
    options?: DriverGetOptions,
  ): Promise<SessionDriverGetWithOperationsView>;
  nextExpectedRevision(result: SessionDriverGetView): number;
  driverAcquire(params: DriverAcquireParams): Promise<DriverAcquireView>;
  driverRenew(params: DriverRenewParams): Promise<DriverRenewView>;
  driverRelease(params: DriverReleaseParams): Promise<DriverReleaseView>;
  peerDispatch: ExternalDriverPeerCommands["peerDispatch"];
  peerControl: ExternalDriverPeerCommands["peerControl"];
  wakeClaim: ExternalDriverWakeCommands["wakeClaim"];
  wakeAck: ExternalDriverWakeCommands["wakeAck"];
}

/**
 * Narrow READ-ONLY projection of the full control factory: the two
 * discovery members ONLY. The inventory walker and the fenced read wrapper
 * require just these; the concrete full `ExternalDriverCommands` factory
 * (all 9 callable methods) remains assignable to this type. It grants no
 * control RPC surface.
 */
export type ExternalDriverReadCommands = Pick<
  ExternalDriverCommands,
  "driverGet" | "nextExpectedRevision"
>;

const INVALID_SCOPE = "invalid captured driver scope";
const OPERATIONS_UNSUPPORTED =
  "requested operations inventory is unsupported by the connected server";
const OPERATIONS_REQUEST_INVALID = "operations request invalid";
const INVALID_GET_OPTIONS = "invalid driver get options";
const OPERATIONS_RESULT_MALFORMED = "operations result malformed";
const INVALID_RESULT = "invalid result payload";
const RPC_FAILED = "rpc rejected";
const INVALID_EXPECTATION = "invalid receipt expectation";

/**
 * FACTORY-PRIVATE control context shared with the peer/wake leaf modules.
 * Scalars, the negotiated method set and the feature flag are SNAPSHOTTED at
 * factory construction — never a live capability array, never returned to a
 * caller, never stored in a global.
 */
export interface ExternalDriverControlContext {
  readonly rpc: ExternalDriverRpc;
  readonly sessionId: string;
  readonly profileId: string;
  readonly topic?: string;
  readonly supportedMethods: ReadonlySet<string>;
  readonly featureAdvertised: boolean;
}

/**
 * Gate a control call on the EXACT wire method AND the negotiated
 * `external_driver_v1` feature. Fails closed OFFLINE with the typed
 * capability error; never touches the wire.
 */
export function requireExternalDriverControlCapability(
  context: ExternalDriverControlContext,
  method: string,
): void {
  if (!context.featureAdvertised || !context.supportedMethods.has(method)) {
    throw new ExternalDriverCapabilityError(method);
  }
}

/**
 * Gate, then send EXACTLY one RPC. Re-gates so a mutated context cannot leak
 * a call past the fence, forwards `params` UNTOUCHED (no spread/retarget, no
 * decode), and converts EVERY rejection into a bounded typed failure: an
 * allowlisted typed refusal kind survives as a constant, anything else is
 * the scrubbed generic rpc failure. Never echoes raw message/data/cause.
 */
export async function requestExternalDriverControl(
  context: ExternalDriverControlContext,
  method: string,
  params: unknown,
): Promise<unknown> {
  requireExternalDriverControlCapability(context, method);
  try {
    return await context.rpc.request(method, params);
  } catch (serverError) {
    const refusal = typedRefusalKind(serverError);
    if (refusal !== null) {
      throw new ExternalDriverRefusalError(method, refusal);
    }
    throw new ExternalDriverProtocolError(method, RPC_FAILED);
  }
}

/**
 * Core types.rs `is_reserved_channel_name` — pinned compatibility list
 * (source-pinned 2026-09-08, octos @ 38eca094 dirty M). This is the ONLY
 * authoritative way a `{profile}:{channel}:{chat}` key is distinguished
 * from an ordinary `{channel}:{chat-with-colons}` key (Core split_base_key
 * uses `splitn(3)` + this registry — never a colon count).
 */
const RESERVED_CHANNEL_NAMES: ReadonlySet<string> = new Set([
  "acp",
  "api",
  "cli",
  "dingtalk",
  "discord",
  "email",
  "feishu",
  "line",
  "local",
  "matrix",
  "qq-bot",
  "slack",
  "system",
  "telegram",
  "test",
  "twilio",
  "wechat",
  "wecom",
  "wecom-bot",
  "whatsapp",
]);

/**
 * Port of Core `SessionKey::split_base_key` profile detection for a base
 * with its topic already stripped. Returns the PROFILE segment when the
 * base is qualified `{profile}:{channel}:{chat...}`, else null (ordinary
 * `channel:chat`, colon-bearing chat ids like `local:demo/api:session` or
 * `matrix:!room:localhost`, or a raw opaque Web id).
 */
function capturedProfileSegment(base: string): string | null {
  if (!base.includes(":")) return null;
  const firstColon = base.indexOf(":");
  const first = base.slice(0, firstColon);
  const secondColon = base.indexOf(":", firstColon + 1);
  if (secondColon === -1) return null; // channel:chat — never qualified
  const second = base.slice(firstColon + 1, secondColon);
  if (
    !RESERVED_CHANNEL_NAMES.has(first) &&
    RESERVED_CHANNEL_NAMES.has(second)
  ) {
    return first;
  }
  return null;
}

/**
 * Explicit control-code predicate: true when a code unit is a C0 control
 * (below 0x20) or DEL (0x7f). One shared, regex-free replacement for the
 * old C0/DEL character-class guard, with IDENTICAL accept/reject behavior
 * for every code unit (lone surrogates are >= 0xD800 and are never control
 * bytes under either form).
 */
function hasControlCode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Raw opaque Web id shape: non-empty, no whitespace/#/control bytes. */
function isRawOpaqueId(value: string): boolean {
  return value.length > 0 && !/[\s#]/u.test(value) && !hasControlCode(value);
}

/**
 * An ORDINARY get topic (master/coding/ops/peer — any non-empty string
 * without blanks, control characters or `#`). The `peer-*` slug shape is
 * NOT required here: `session/driver/get` is primarily for MASTERS, and
 * that restriction belongs ONLY to dispatch receipts.
 */
function isOrdinaryTopic(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[\s#]/u.test(value) &&
    !hasControlCode(value)
  );
}

/**
 * ONE shared captured-base/profile shape guard for BOTH the read-only
 * `session/driver/get` scope and dispatch receipt expectations, matching
 * actual Core SessionKey semantics (reserved-channel interpretation — see
 * `capturedProfileSegment`). Throws on contradiction; returns nothing.
 * A QUALIFIED base must byte-match the captured profileId; an ordinary
 * `channel:chat` (colon chat ids included) or raw `web-N` base carries no
 * profile dimension and passes byte-exact — the server-confirmed captured
 * profile remains the separate authority.
 */
function validateCapturedBase(
  base: string,
  profileId: string,
  reason: string,
): void {
  // COMMON base-shape guard FIRST, before any colon/profile
  // interpretation: every base — qualified, ordinary channel:chat or raw
  // opaque — must be non-empty with no whitespace, `#` or control bytes.
  // Native Core's generic receipt path rejects the same base corruption;
  // this also covers colon-containing strings like `api:bad\n`.
  if (!isRawOpaqueId(base)) {
    throw new ExternalDriverProtocolError(DRIVER_GET, reason);
  }
  const profileSeg = capturedProfileSegment(base);
  if (profileSeg !== null) {
    if (!isValidProfileId(profileSeg)) {
      throw new ExternalDriverProtocolError(DRIVER_GET, reason);
    }
    if (profileSeg !== profileId) {
      throw new ExternalDriverProtocolError(DRIVER_GET, reason);
    }
  }
}

/**
 * Validates the captured scope BEFORE any wire traffic. The session id must
 * be EITHER a profile-qualified native ID `profile:kind:instance[#topic]`
 * whose profile segment BYTE-MATCHES the captured profileId, OR a bare
 * opaque Web ID (e.g. `web-N`) accepted byte-exact under confirmed profile
 * auth (Core validate_authenticated_session_scope, ~L18960). A foreign
 * `other:...` session with profile `dev` never passes. An optional
 * ordinary topic must be well-formed and never contradict the session
 * suffix; an invalid topic is NEVER silently normalized away (omitted).
 */
function validateCapturedScope(
  sessionId: string,
  scope: ExternalDriverScope,
): void {
  if (
    typeof sessionId !== "string" ||
    !isNonEmptyString(sessionId) ||
    sessionId.includes("\u0000")
  ) {
    throw new ExternalDriverProtocolError(DRIVER_GET, INVALID_SCOPE);
  }
  if (
    typeof scope.profileId !== "string" ||
    !isValidProfileId(scope.profileId)
  ) {
    throw new ExternalDriverProtocolError(DRIVER_GET, INVALID_SCOPE);
  }
  const hashIndex = sessionId.indexOf("#");
  const base = hashIndex === -1 ? sessionId : sessionId.slice(0, hashIndex);
  const suffix = hashIndex === -1 ? null : sessionId.slice(hashIndex + 1);
  // Shared captured-base guard (reserved-channel semantics): qualified →
  // profile byte-match; ordinary `channel:chat` (colon chat ids included)
  // and raw opaque `web-N` bases pass byte-exact.
  validateCapturedBase(base, scope.profileId, INVALID_SCOPE);
  if (suffix !== null && !isOrdinaryTopic(suffix)) {
    throw new ExternalDriverProtocolError(DRIVER_GET, INVALID_SCOPE);
  }
  if (scope.topic !== undefined && !isOrdinaryTopic(scope.topic)) {
    throw new ExternalDriverProtocolError(DRIVER_GET, INVALID_SCOPE);
  }
  if (scope.topic !== undefined && suffix !== null && scope.topic !== suffix) {
    throw new ExternalDriverProtocolError(DRIVER_GET, INVALID_SCOPE);
  }
}

/** Bounded constant lease failures — never echo the raw server reply. */
const INVALID_ACQUIRE_ARGS = "invalid driver acquire arguments";
const INVALID_RENEW_ARGS = "invalid driver renew arguments";
const INVALID_RELEASE_ARGS = "invalid driver release arguments";
const ACQUIRE_RESULT_MALFORMED = "driver acquire result malformed";
const RENEW_RESULT_MALFORMED = "driver renew result malformed";
const RELEASE_RESULT_MALFORMED = "driver release result malformed";

const ACQUIRE_ALLOWED = [
  "driverId",
  "expectedRevision",
  "leaseSeconds",
] as const;
const RENEW_ALLOWED = [
  "driverId",
  "epoch",
  "controlToken",
  "leaseSeconds",
] as const;
const RELEASE_ALLOWED = [
  "driverId",
  "epoch",
  "controlToken",
  "expectedRevision",
  "next",
] as const;

/** Reject any caller-supplied field outside the allowlist (fail closed). */
function assertOnlyLeaseKeys(
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

/** Validate the REQUIRED proof fence; returns copied scalars (pre-await). */
function copyLeaseFence(
  params: Record<string, unknown>,
  method: string,
  reason: string,
): { driverId: string; epoch: number; controlToken: string } {
  const { driverId, epoch, controlToken } = params;
  if (!isNonEmptyString(driverId)) {
    throw new ExternalDriverProtocolError(method, reason);
  }
  if (!isNonNegativeInteger(epoch)) {
    throw new ExternalDriverProtocolError(method, reason);
  }
  if (!isNonEmptyString(controlToken)) {
    throw new ExternalDriverProtocolError(method, reason);
  }
  return { driverId, epoch, controlToken };
}

/** Decode a native DriverBindingView from a wire object (strict, frozen). */
function decodeBindingView(value: unknown): DriverBindingView | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.driver_id)) return null;
  if (!isNonNegativeInteger(value.epoch)) return null;
  if (!isNonNegativeInteger(value.revision)) return null;
  if (!isNonNegativeInteger(value.lease_expires_at_ms)) return null;
  if (
    value.workspace_root !== undefined &&
    !isNonEmptyString(value.workspace_root)
  ) {
    return null;
  }
  if (value.accepted_work !== undefined) {
    if (!Array.isArray(value.accepted_work)) return null;
    if (!value.accepted_work.every(isNonEmptyString)) return null;
  }
  return Object.freeze({
    driverId: value.driver_id,
    epoch: value.epoch,
    revision: value.revision,
    leaseExpiresAtMs: value.lease_expires_at_ms,
    ...(value.workspace_root === undefined
      ? {}
      : { workspaceRoot: value.workspace_root }),
    acceptedWork: Object.freeze([...(value.accepted_work ?? [])]),
  });
}

/** Decode `session/driver/acquire`: the control token is reachable ONLY
 * through an opaque closure-backed capability; the raw proof never becomes an
 * own enumerable property of any returned view. The receipt is bound to the
 * caller's captured `driverId`: a reply for a FOREIGN driver is never accepted,
 * so a foreign driver's capability is never silently handed back. */
function parseDriverAcquireResult(
  reply: unknown,
  expectedDriverId: string,
): DriverAcquireView {
  const fail = () =>
    new ExternalDriverProtocolError(ACQUIRE, ACQUIRE_RESULT_MALFORMED);
  if (!isRecord(reply)) throw fail();
  const token = reply.control_token;
  if (!isNonEmptyString(token)) throw fail();
  const binding = decodeBindingView(reply.binding);
  if (binding === null) throw fail();
  if (binding.driverId !== expectedDriverId) throw fail();
  if (!isDriverRecovery(reply.recovery)) throw fail();
  let pendingWork: readonly string[] = Object.freeze([]);
  if (reply.pending_work !== undefined) {
    if (!Array.isArray(reply.pending_work)) throw fail();
    if (!reply.pending_work.every(isNonEmptyString)) throw fail();
    pendingWork = Object.freeze([...reply.pending_work]);
  }
  const capability: DriverControlCapability = Object.freeze({
    driverId: binding.driverId,
    epoch: binding.epoch,
    reveal: () => token,
  });
  return Object.freeze({
    capability,
    binding,
    pendingWork,
    recovery: reply.recovery,
  });
}

/** Decode `session/driver/renew`: the refreshed lease deadline only. */
function parseDriverRenewResult(reply: unknown): DriverRenewView {
  const fail = () =>
    new ExternalDriverProtocolError(RENEW, RENEW_RESULT_MALFORMED);
  if (!isRecord(reply)) throw fail();
  if (!isNonNegativeInteger(reply.lease_expires_at_ms)) throw fail();
  return Object.freeze({ leaseExpiresAtMs: reply.lease_expires_at_ms });
}

/** Decode `session/driver/release`: disclosure-only mode/binding/recovery.
 * No CAS reset is performed client-side. FROZEN mode-specific shape:
 * `next = internal` => binding ABSENT; `next = external` => PARKED binding
 * PRESENT with lease 0. The post-release `mode` MUST echo the caller's
 * requested `next` (captured BEFORE the await) — a reply describing any other
 * transition is a foreign result and is rejected. */
function parseDriverReleaseResult(
  reply: unknown,
  requestedNext: DriverReleaseNext,
): DriverReleaseView {
  const fail = () =>
    new ExternalDriverProtocolError(RELEASE, RELEASE_RESULT_MALFORMED);
  if (!isRecord(reply)) throw fail();
  if (!isDriverMode(reply.mode)) throw fail();
  if (reply.mode !== requestedNext) throw fail();
  if (!isDriverRecovery(reply.recovery)) throw fail();
  const rawBinding = reply.binding;
  if (requestedNext === "internal") {
    // Unlike `session/driver/get` (which RETAINS the inactive binding as
    // disclosure), a release-to-internal reply omits the binding entirely.
    if (rawBinding !== undefined && rawBinding !== null) throw fail();
    return Object.freeze({
      mode: reply.mode,
      binding: null,
      recovery: reply.recovery,
    });
  }
  // requestedNext === "external": the durable mode stays external with NO live
  // controller lease — the parked binding is present and MUST carry lease 0.
  const binding = decodeBindingView(rawBinding);
  if (binding === null) throw fail();
  if (binding.leaseExpiresAtMs !== 0) throw fail();
  return Object.freeze({
    mode: reply.mode,
    binding,
    recovery: reply.recovery,
  });
}

/** One `session/driver/acquire` RPC. Capability gated FIRST, args validated,
 * scalars copied BEFORE the single await, wire encoded EXACT snake_case. */
async function runDriverAcquire(
  context: ExternalDriverControlContext,
  params: unknown,
): Promise<DriverAcquireView> {
  const method = ACQUIRE;
  requireExternalDriverControlCapability(context, method);
  if (!isRecord(params)) {
    throw new ExternalDriverProtocolError(method, INVALID_ACQUIRE_ARGS);
  }
  assertOnlyLeaseKeys(params, ACQUIRE_ALLOWED, method, INVALID_ACQUIRE_ARGS);
  const { driverId, expectedRevision, leaseSeconds } = params;
  if (!isNonEmptyString(driverId)) {
    throw new ExternalDriverProtocolError(method, INVALID_ACQUIRE_ARGS);
  }
  if (!isNonNegativeInteger(expectedRevision)) {
    throw new ExternalDriverProtocolError(method, INVALID_ACQUIRE_ARGS);
  }
  if (!isNonNegativeInteger(leaseSeconds)) {
    throw new ExternalDriverProtocolError(method, INVALID_ACQUIRE_ARGS);
  }
  const wire: Record<string, unknown> = {
    session_id: context.sessionId,
    driver_id: driverId,
    expected_revision: expectedRevision,
    lease_seconds: leaseSeconds,
  };
  if (context.topic !== undefined) wire.topic = context.topic;
  const reply = await requestExternalDriverControl(context, method, wire);
  // Bind the receipt to the caller's captured driverId (never a foreign one).
  return parseDriverAcquireResult(reply, driverId);
}

/** One `session/driver/renew` RPC against the EXPLICIT live fence + proof. */
async function runDriverRenew(
  context: ExternalDriverControlContext,
  params: unknown,
): Promise<DriverRenewView> {
  const method = RENEW;
  requireExternalDriverControlCapability(context, method);
  if (!isRecord(params)) {
    throw new ExternalDriverProtocolError(method, INVALID_RENEW_ARGS);
  }
  assertOnlyLeaseKeys(params, RENEW_ALLOWED, method, INVALID_RENEW_ARGS);
  const fence = copyLeaseFence(params, method, INVALID_RENEW_ARGS);
  const leaseSeconds = params.leaseSeconds;
  if (!isNonNegativeInteger(leaseSeconds)) {
    throw new ExternalDriverProtocolError(method, INVALID_RENEW_ARGS);
  }
  const wire: Record<string, unknown> = {
    session_id: context.sessionId,
    driver_id: fence.driverId,
    epoch: fence.epoch,
    control_token: fence.controlToken,
    lease_seconds: leaseSeconds,
  };
  if (context.topic !== undefined) wire.topic = context.topic;
  const reply = await requestExternalDriverControl(context, method, wire);
  return parseDriverRenewResult(reply);
}

/** One `session/driver/release` RPC with a strict mode-specific `next`. */
async function runDriverRelease(
  context: ExternalDriverControlContext,
  params: unknown,
): Promise<DriverReleaseView> {
  const method = RELEASE;
  requireExternalDriverControlCapability(context, method);
  if (!isRecord(params)) {
    throw new ExternalDriverProtocolError(method, INVALID_RELEASE_ARGS);
  }
  assertOnlyLeaseKeys(params, RELEASE_ALLOWED, method, INVALID_RELEASE_ARGS);
  const fence = copyLeaseFence(params, method, INVALID_RELEASE_ARGS);
  const expectedRevision = params.expectedRevision;
  if (!isNonNegativeInteger(expectedRevision)) {
    throw new ExternalDriverProtocolError(method, INVALID_RELEASE_ARGS);
  }
  // Capture the requested next mode ONCE, BEFORE the await: the reply must
  // echo exactly this value and the wire must carry it — never a re-read of
  // mutable params.
  const next = params.next;
  if (!isDriverMode(next)) {
    throw new ExternalDriverProtocolError(method, INVALID_RELEASE_ARGS);
  }
  const wire: Record<string, unknown> = {
    session_id: context.sessionId,
    driver_id: fence.driverId,
    epoch: fence.epoch,
    control_token: fence.controlToken,
    expected_revision: expectedRevision,
    next,
  };
  if (context.topic !== undefined) wire.topic = context.topic;
  const reply = await requestExternalDriverControl(context, method, wire);
  return parseDriverReleaseResult(reply, next);
}

/**
 * Driver control surface: the read-only get view PLUS the explicit,
 * caller-proved lease methods (acquire/renew/release) and the peer/wake leaf
 * methods composed from their own modules. The captured scope is validated
 * before construction; extra caller fields cannot override it through spread.
 */
export function createExternalDriverCommands(
  rpc: ExternalDriverRpc,
  sessionId: string,
  capabilities: UiProtocolCapabilities,
  scope: ExternalDriverScope,
): ExternalDriverCommands {
  validateCapturedScope(sessionId, scope);
  const gating = decodeExternalDriverCapabilities(capabilities);
  const topic = scope.topic;
  // Capture the confirmed profile ONCE at construction: a caller mutating
  // the original scope object afterwards can never retarget the decode
  // fence of a pending or future request.
  const profileId = scope.profileId;
  // FACTORY-PRIVATE control context: scalar snapshot of the captured scope
  // plus the negotiated method set and feature flag. Never returned, never
  // global-stored, never re-read from a live capability array.
  const controlContext: ExternalDriverControlContext = Object.freeze({
    rpc,
    sessionId,
    profileId,
    ...(topic === undefined ? {} : { topic }),
    supportedMethods: Object.freeze(
      new Set<string>(capabilities.supported_methods),
    ),
    featureAdvertised: gating.featureAdvertised,
  });
  const peerCommands = createExternalDriverPeerCommands(controlContext);
  const wakeCommands = createExternalDriverWakeCommands(controlContext);
  return {
    async driverGet(rawOptions: DriverGetOptions = {}) {
      if (!gating.available) {
        throw new ExternalDriverCapabilityError(DRIVER_GET);
      }
      // Top-level options are validated as a plain record with ONLY the
      // known key: null/array/number/string/unknown-key options reject
      // OFFLINE with a bounded typed error — zero traffic, no raw
      // TypeError from touching options.operations.
      if (
        rawOptions === null ||
        typeof rawOptions !== "object" ||
        Array.isArray(rawOptions)
      ) {
        throw new ExternalDriverProtocolError(DRIVER_GET, INVALID_GET_OPTIONS);
      }
      for (const key of Object.keys(rawOptions)) {
        if (key !== "operations") {
          throw new ExternalDriverProtocolError(
            DRIVER_GET,
            INVALID_GET_OPTIONS,
          );
        }
      }
      const options: DriverGetOptions = rawOptions;
      // Copy typed cursor/limit and captured scope BEFORE any await: the
      // caller mutating its options objects mid-request cannot retarget
      // params or decode fences. Explicit malformed options reject OFFLINE.
      let operationsWire: Record<string, string | number> | undefined;
      if (options.operations !== undefined) {
        let built;
        try {
          built = buildDriverOperationsRequest(options.operations);
        } catch (error) {
          throw new ExternalDriverProtocolError(
            DRIVER_GET,
            error instanceof Error && error.name === "DriverOperationsError"
              ? error.message
              : OPERATIONS_REQUEST_INVALID,
          );
        }
        if (built !== undefined) operationsWire = { ...built.wire };
      }
      const requestedOperations = options.operations !== undefined;
      const capturedScope = Object.freeze({
        profileId,
        masterSessionId: sessionId,
      });
      const params: Record<string, unknown> = { session_id: sessionId };
      if (topic !== undefined) params.topic = topic;
      if (operationsWire !== undefined) params.operations = operationsWire;
      let raw: unknown;
      try {
        raw = await rpc.request(DRIVER_GET, params);
      } catch (serverError) {
        // Constant diagnostics only: a rejected RPC never echoes its
        // unbounded message/payload into ours. ONE narrow exception — an
        // allowlisted typed refusal kind from the server protocol error's
        // data.kind survives as a constant; everything else stays the
        // scrubbed generic failure.
        const refusal = typedRefusalKind(serverError);
        if (refusal !== null) {
          throw new ExternalDriverRefusalError(DRIVER_GET, refusal);
        }
        throw new ExternalDriverProtocolError(DRIVER_GET, RPC_FAILED);
      }
      const parsed = parseSessionDriverGetResult(raw);
      if (parsed === null) {
        throw new ExternalDriverProtocolError(DRIVER_GET, INVALID_RESULT);
      }
      if (!requestedOperations) {
        return parsed;
      }
      const outcome = classifyDriverGetOperationsResult(
        raw,
        requestedOperations,
        capturedScope,
      );
      if (outcome === null) {
        throw new ExternalDriverProtocolError(DRIVER_GET, INVALID_RESULT);
      }
      if (outcome.kind === "unsupported") {
        throw new ExternalDriverProtocolError(
          DRIVER_GET,
          OPERATIONS_UNSUPPORTED,
        );
      }
      if (outcome.kind === "malformed") {
        throw new ExternalDriverProtocolError(
          DRIVER_GET,
          OPERATIONS_RESULT_MALFORMED,
        );
      }
      if (outcome.kind !== "page") {
        throw new ExternalDriverProtocolError(DRIVER_GET, INVALID_RESULT);
      }
      // Narrow frozen SUCCESS view: the public type exposes ONLY a valid
      // frozen page — omitted/unsupported/malformed outcomes never escape.
      const withPage: SessionDriverGetWithOperationsView = Object.freeze({
        ...parsed,
        operations: Object.freeze({ kind: "page", page: outcome.page }),
      });
      return withPage;
    },
    nextExpectedRevision,
    driverAcquire: (params: DriverAcquireParams) =>
      runDriverAcquire(controlContext, params),
    driverRenew: (params: DriverRenewParams) =>
      runDriverRenew(controlContext, params),
    driverRelease: (params: DriverReleaseParams) =>
      runDriverRelease(controlContext, params),
    peerDispatch: peerCommands.peerDispatch,
    peerControl: peerCommands.peerControl,
    wakeClaim: wakeCommands.wakeClaim,
    wakeAck: wakeCommands.wakeAck,
  };
}

// ---------------------------------------------------------------------------
// Immutable accepted dispatch receipt (for subsequent B methods)
// ---------------------------------------------------------------------------

export interface DriverScopedGoalView {
  readonly goalId: string;
  readonly taskId?: string;
  readonly revision?: number;
}

/** Native peers/mod.rs PEER_SLUG_MAX_BYTES (UTF-8 bytes). */
const PEER_SLUG_MAX_BYTES = 64;

/**
 * Port of native peer_slug_is_safe (peers/mod.rs:354) for RECEIPT slugs
 * only: ≤64 UTF-8 bytes, not `.`/`..`, no trailing dot or space, no path
 * separators (`/`, `\`), no colon, no control bytes (<0x20, 0x7f). This
 * deliberately admits genuine legacy escaped slugs (CJK FNV fallback
 * `peer-<16 hex>`); an alphanumeric-only regex would NOT match native
 * accepted identities.
 */
/**
 * SHARED native adopted-identity SHAPE (receipt + discovery decoders):
 * UUID turn id, native-safe slug, exactly one `#peer-<slug>` topic, and a
 * non-empty whitespace/control-free master base. Port of Core
 * adopted_identity_is_native (ui_protocol.rs:8078).
 */
/**
 * SHARED captured-worker-session match for BOTH the immutable receipt and
 * discovery rows: the adopted session must be EXACTLY the captured master
 * WIRE base (first `#topic` stripped; qualified profile byte-matches the
 * captured profileId) + `#peer-<slug>` with a native-safe slug and exactly
 * one topic segment. Shape-only checks are insufficient — this is the one
 * authority-matching helper.
 */
export function workerSessionMatchesCapturedMaster(
  masterSessionId: unknown,
  profileId: unknown,
  adoptedSessionId: unknown,
  slug: unknown,
): boolean {
  if (typeof masterSessionId !== "string") return false;
  if (typeof profileId !== "string" || !isValidProfileId(profileId)) {
    return false;
  }
  if (typeof adoptedSessionId !== "string") return false;
  if (!peerSlugIsSafe(slug)) return false;
  const base = masterWireBase(masterSessionId, profileId);
  if (base === null) return false;
  return adoptedSessionId === `${base}#peer-${slug}`;
}

export function adoptedIdentityIsNativeShared(
  turnId: unknown,
  sessionId: unknown,
  slug: unknown,
): boolean {
  if (!isProtocolUuid(turnId)) return false;
  if (!peerSlugIsSafe(slug)) return false;
  if (typeof sessionId !== "string") return false;
  const hash = sessionId.indexOf("#");
  if (hash === -1) return false;
  const base = sessionId.slice(0, hash);
  const topic = sessionId.slice(hash + 1);
  if (topic.includes("#") || topic !== `peer-${slug}`) return false;
  return base.length > 0 && !hasControlCode(base) && !/\s/u.test(base);
}

export function peerSlugIsSafe(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value === "." || value === "..") return false;
  if (value.endsWith(".") || value.endsWith(" ")) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    // Core slug_is_native_safe: path separators, drive/ADS colon AND the
    // topic-ambiguous '#' are all rejected in the shared native shape.
    if (code === 0x2f || code === 0x5c || code === 0x3a || code === 0x23) {
      return false;
    }
    if (code < 0x20 || code === 0x7f) return false;
  }
  return utf8ByteLength(value) <= PEER_SLUG_MAX_BYTES;
}

const utf8Encoder = new TextEncoder();
function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).length;
}

/**
 * The trusted MASTER WIRE BASE of a captured master session: strip only the
 * first `#topic`. A qualified base `profile:kind:instance` must byte-match
 * the captured profile (foreign profile → null); a bare opaque Web ID
 * (e.g. `web-4`) passes byte-exact with NO manufactured prefix. Returns null
 * for NUL/ambiguous extra topics, storage-suffix shapes or unsafe segments.
 */
export function masterWireBase(
  masterSessionId: string,
  profileId: string,
): string | null {
  // The captured profile is validated FIRST for EVERY base shape — a bare
  // opaque Web master never lets an invalid profileId slip through.
  if (typeof profileId !== "string" || !isValidProfileId(profileId)) {
    return null;
  }
  if (
    typeof masterSessionId !== "string" ||
    !isNonEmptyString(masterSessionId)
  ) {
    return null;
  }
  if (masterSessionId.includes("\u0000")) return null;
  const hashIndex = masterSessionId.indexOf("#");
  const base =
    hashIndex === -1 ? masterSessionId : masterSessionId.slice(0, hashIndex);
  if (hashIndex === -1) {
    // No topic suffix — still a full base; fall through to base validation.
  } else {
    const topic = masterSessionId.slice(hashIndex + 1);
    if (!isOrdinaryTopic(topic)) return null;
    if (masterSessionId.indexOf("#", hashIndex + 1) !== -1) return null;
  }
  try {
    validateCapturedBase(base, profileId, INVALID_SCOPE);
  } catch {
    return null;
  }
  return base;
}

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

/** Discriminated request target — an existing target cannot omit a fence. */
export type DispatchTarget =
  | { readonly kind: "new"; readonly topic?: string }
  | {
      readonly kind: "existing";
      readonly slug: string;
      readonly sessionId: string;
    };

/**
 * Request-derived fences confirmed on every receipt — an internally
 * self-consistent reply from the WRONG peer never passes. Optional fields
 * left undefined impose no fence; `null` scopedGoal is an EXPLICIT
 * absence expectation. Expected facts are NEVER inferred from the reply.
 */
export interface DispatchReceiptExpectation {
  readonly operationId: string;
  readonly model: string;
  readonly modelLane?: string;
  readonly workspaceRoot: string;
  readonly profileId: string;
  /** Confirmed master wire session, captured BEFORE dispatch. Mandatory. */
  readonly masterSessionId: string;
  readonly scopedGoal?: DriverScopedGoalView | null;
  readonly target: DispatchTarget;
}

function parseScopedGoal(value: unknown): DriverScopedGoalView | null {
  if (isAbsentOrNull(value)) return null;
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.goal_id)) return null;
  if (value.task_id !== undefined && !isNonEmptyString(value.task_id)) {
    return null;
  }
  if (value.revision !== undefined && !isNonNegativeInteger(value.revision)) {
    return null;
  }
  return Object.freeze({
    goalId: value.goal_id,
    ...(value.task_id === undefined ? {} : { taskId: value.task_id }),
    ...(value.revision === undefined ? {} : { revision: value.revision }),
  });
}

/** Caller bugs (malformed expectations) throw; they are never parsed. */
function validateExpectationShape(
  expectation: DispatchReceiptExpectation,
): void {
  const invalid = () =>
    new ExternalDriverProtocolError(DISPATCH, INVALID_EXPECTATION);
  if (!isNonEmptyString(expectation.operationId)) throw invalid();
  if (!isNonEmptyString(expectation.model)) throw invalid();
  const hasLane =
    expectation.modelLane === undefined ||
    isNonEmptyString(expectation.modelLane);
  if (!hasLane) throw invalid();
  if (!isNonEmptyString(expectation.workspaceRoot)) throw invalid();
  if (!isValidProfileId(expectation.profileId)) throw invalid();
  const masterBase = masterWireBase(
    expectation.masterSessionId,
    expectation.profileId,
  );
  if (masterBase === null) throw invalid();
  const goal = expectation.scopedGoal;
  if (goal !== undefined && goal !== null) {
    if (!isNonEmptyString(goal.goalId)) throw invalid();
    if (goal.taskId !== undefined && !isNonEmptyString(goal.taskId)) {
      throw invalid();
    }
    if (goal.revision !== undefined && !isNonNegativeInteger(goal.revision)) {
      throw invalid();
    }
  }
  const target = expectation.target as { kind?: unknown };
  if (target.kind === "existing") {
    const existing = expectation.target as {
      slug: string;
      sessionId: string;
    };
    if (!peerSlugIsSafe(existing.slug)) throw invalid();
    if (existing.sessionId !== `${masterBase}#peer-${existing.slug}`) {
      throw invalid();
    }
  } else if (target.kind === "new") {
    const fresh = expectation.target as { topic?: string };
    if (fresh.topic !== undefined && !isValidPeerTopic(fresh.topic)) {
      throw invalid();
    }
  } else {
    throw invalid();
  }
}

function scopedGoalFenceHolds(
  expected: DriverScopedGoalView,
  actual: DriverScopedGoalView,
): boolean {
  if (expected.goalId !== actual.goalId) return false;
  if (expected.taskId !== undefined && expected.taskId !== actual.taskId) {
    return false;
  }
  if (
    expected.revision !== undefined &&
    expected.revision !== actual.revision
  ) {
    return false;
  }
  return true;
}

/**
 * Validates an actual SUCCESSFUL receipt: state must be exactly "accepted"
 * (immutable acceptance — the frozen amendment supersedes any
 * admitted/started/terminal examples), the mandatory native identities must
 * be REAL (protocol UUID TurnId; canonical `profile:local:tui#peer-<slug>`
 * adopted session; bare slug) for BOTH first and duplicate results, and
 * every request-derived fence must hold. The returned view is frozen and
 * detached; lifecycle is disclosed elsewhere, never on this receipt.
 */
export function parsePeerDispatchReceipt(
  value: unknown,
  expectation: DispatchReceiptExpectation,
): PeerDispatchReceiptView | null {
  validateExpectationShape(expectation);
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
  const scopedGoal = parseScopedGoal(value.scoped_goal);
  if (scopedGoal === null && !isAbsentOrNull(value.scoped_goal)) return null;
  // Request-derived fences — never inferred from the reply.
  if (value.operation_id !== expectation.operationId) return null;
  if (value.model !== expectation.model) return null;
  const laneFenced =
    expectation.modelLane !== undefined &&
    value.model_lane !== expectation.modelLane;
  if (laneFenced) return null;
  if (value.workspace_root !== expectation.workspaceRoot) return null;
  if (expectation.scopedGoal !== undefined) {
    if (expectation.scopedGoal === null) {
      if (scopedGoal !== null) return null;
    } else if (
      scopedGoal === null ||
      !scopedGoalFenceHolds(expectation.scopedGoal, scopedGoal)
    ) {
      return null;
    }
  }
  // Native identity: the trusted MASTER WIRE BASE + the peer topic —
  // exactly what assign_external_identity preserves. A same-profile
  // different-base or foreign-profile reply never passes.
  const masterBase = masterWireBase(
    expectation.masterSessionId,
    expectation.profileId,
  );
  if (masterBase === null) {
    return null;
  }
  if (
    !workerSessionMatchesCapturedMaster(
      expectation.masterSessionId,
      expectation.profileId,
      value.adopted_session_id,
      value.slug,
    )
  ) {
    return null;
  }
  const target = expectation.target as { kind?: unknown };
  if (target.kind === "existing") {
    const existing = expectation.target as {
      slug: string;
      sessionId: string;
    };
    if (value.slug !== existing.slug) return null;
    if (value.adopted_session_id !== existing.sessionId) return null;
  } else {
    const fresh = expectation.target as { topic?: string };
    const topicBindsSlug =
      fresh.topic !== undefined && value.slug !== fresh.topic.slice(5);
    if (topicBindsSlug) return null;
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

export type DispatchRetryIdentityCheck =
  { ok: true } | { ok: false; field: string };

function sameScopedGoal(
  a: DriverScopedGoalView | null,
  b: DriverScopedGoalView | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.goalId === b.goalId && a.taskId === b.taskId && a.revision === b.revision
  );
}

/**
 * An equal retry may change ONLY `duplicate`. Every immutable acceptance
 * field of the previously confirmed identity is preserved; any conflict is
 * reported with a CONSTANT field name — the conflicting value (which may
 * carry a canary or secret) is never echoed.
 */
export function checkDispatchRetryIdentity(
  first: PeerDispatchReceiptView,
  retry: PeerDispatchReceiptView,
): DispatchRetryIdentityCheck {
  const checks: Array<[string, boolean]> = [
    ["operationId", retry.operationId === first.operationId],
    ["model", retry.model === first.model],
    ["modelLane", retry.modelLane === first.modelLane],
    ["workspaceRoot", retry.workspaceRoot === first.workspaceRoot],
    ["scopedGoal", sameScopedGoal(first.scopedGoal, retry.scopedGoal)],
    ["adoptedTurnId", retry.adoptedTurnId === first.adoptedTurnId],
    ["adoptedSessionId", retry.adoptedSessionId === first.adoptedSessionId],
    ["slug", retry.slug === first.slug],
    ["acceptedAtMs", retry.acceptedAtMs === first.acceptedAtMs],
    ["payloadDigest", retry.payloadDigest === first.payloadDigest],
  ];
  for (const [field, equal] of checks) {
    if (!equal) return { ok: false, field };
  }
  return { ok: true };
}
import { EXTERNAL_DRIVER_V1_FEATURE, EXTERNAL_DRIVER_METHODS, ExternalDriverProtocolError, EXTERNAL_DRIVER_REFUSAL_KINDS, ExternalDriverRefusalError, ExternalDriverCapabilityError, type ExternalDriverRefusalKind } from "./external-driver-meta.ts";
export { EXTERNAL_DRIVER_V1_FEATURE, EXTERNAL_DRIVER_METHODS, ExternalDriverProtocolError, EXTERNAL_DRIVER_REFUSAL_KINDS, ExternalDriverRefusalError, ExternalDriverCapabilityError, type ExternalDriverRefusalKind } from "./external-driver-meta.ts";
