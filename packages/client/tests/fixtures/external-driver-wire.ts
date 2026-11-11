/**
 * Shared external-driver wire fixtures (T-0588 C9).
 *
 * The control and lease test files both pinned the SAME synthetic fence /
 * binding / acquire reply against the Rust `SessionDriverAcquireResult` and
 * `DriverBindingWire` shapes (ui_protocol.rs). Centralizing the literals
 * keeps the two files from drifting apart on the same wire contract.
 *
 * Everything here is a SYNTHETIC fixture — the proof string is an
 * obviously-not-real placeholder, never persisted.
 */

export const PROOF = "proof-synthetic-fixture";

/** Captured control fence shared by every control method. */
export const FENCE = {
  driverId: "driver-b",
  epoch: 8,
  controlToken: PROOF,
};

/** Raw `DriverBindingWire` row (binding on the wire). */
export const BINDING_WIRE = {
  driver_id: "driver-b",
  epoch: 8,
  revision: 16,
  lease_expires_at_ms: 1_700_000_000_000,
  accepted_work: ["op-dispatch-1"],
};

/**
 * RAW WIRE `SessionDriverAcquireResult`: a plain enumerable `control_token`
 * string — the ONE deliberate wire exception where proof appears in the raw
 * reply. Every ordinary public view/error/storage path stays redacted; only
 * the factory's closure-backed capability exposes it.
 */
export const ACQUIRE_REPLY = {
  control_token: PROOF,
  binding: BINDING_WIRE,
  pending_work: [],
  recovery: "none",
};
