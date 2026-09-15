// Dependency-leaf public constants/errors; importing a label must not load RPC engines.
export type * from "./external-driver.ts";

export const EXTERNAL_DRIVER_V1_FEATURE = "external_driver_v1";

export const EXTERNAL_DRIVER_METHODS = {
  SESSION_DRIVER_GET: "session/driver/get",
  SESSION_DRIVER_ACQUIRE: "session/driver/acquire",
  SESSION_DRIVER_RENEW: "session/driver/renew",
  SESSION_DRIVER_RELEASE: "session/driver/release",
  PEER_DISPATCH: "peer/dispatch",
  PEER_CONTROL: "peer/control",
  SESSION_WAKE_CLAIM: "session/wake/claim",
  SESSION_WAKE_ACK: "session/wake/ack",
} as const;


export class ExternalDriverProtocolError extends Error {
  constructor(method: string, reason: string) {
    super(`${method} failed: ${reason}`);
    this.name = "ExternalDriverProtocolError";
  }
}

/** Allowlisted typed refusal kinds (Core ui_protocol.rs ~638/666/671,
 * plus the control/dispatch store-error kinds from
 * ui_protocol_transport.rs:19218-19236 and peers/mod.rs:3451). ONLY these
 * constants may surface from driverGet RPC rejections — never raw server
 * message/data/code payload, proof, paths or tokens. */
export const EXTERNAL_DRIVER_REFUSAL_KINDS = Object.freeze([
  "driver_operations_cursor_reset",
  "driver_operations_view_too_large",
  "driver_scope_mismatch",
  "driver_fence_stale",
  "driver_revision_conflict",
  "driver_busy_handover",
  "driver_operation_conflict",
  "interaction_recovery_required",
  "driver_model_unavailable",
  "peer_control_refused",
] as const);

export type ExternalDriverRefusalKind =
  (typeof EXTERNAL_DRIVER_REFUSAL_KINDS)[number];

/** Narrow typed refusal: allowlisted constant kind only, scrubbed cause. */
export class ExternalDriverRefusalError extends ExternalDriverProtocolError {
  readonly refusalKind: ExternalDriverRefusalKind;
  constructor(method: string, refusalKind: ExternalDriverRefusalKind) {
    super(method, `server refused: ${refusalKind}`);
    this.name = "ExternalDriverRefusalError";
    this.refusalKind = refusalKind;
  }
}


export class ExternalDriverCapabilityError extends ExternalDriverProtocolError {
  constructor(method: string) {
    super(method, "capability not advertised (method + external_driver_v1)");
    this.name = "ExternalDriverCapabilityError";
  }
}
