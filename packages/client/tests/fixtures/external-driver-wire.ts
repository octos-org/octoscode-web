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

import { expect } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
  ExternalDriverProtocolError,
  createExternalDriverCommands,
} from "../../src/external-driver.ts";
import type { UiProtocolCapabilities } from "../../src/types.ts";
import { makeCaps } from "./caps.ts";

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

/** Captured master session of every control fixture; its wire base is `dev:local:tui`. */
export const DRIVER_SESSION = "dev:local:tui#peer-abc";

/** Protocol UUID of the turn a dispatch adopted. */
export const TURN = "3f1c9d2a-4b6e-4c1a-9f2d-7a5e8b0c1d2e";

/** Raw accepted `peer/dispatch` receipt: slug `abc` under the captured base. */
export const DISPATCH_REPLY = {
  operation_id: "op-dispatch-1",
  state: "accepted",
  model: "deepseek-chat",
  model_lane: "deepseek-chat",
  workspace_root: "/ws/peer-abc",
  adopted_turn_id: TURN,
  adopted_session_id: DRIVER_SESSION,
  slug: "abc",
  duplicate: false,
  accepted_at_ms: 1_700_000_000_000,
  payload_digest: "sha256:deadbeef",
};

export const DISPATCH_ARGS = {
  ...FENCE,
  operationId: "op-dispatch-1",
  model: "deepseek-chat",
  dispatch: { kind: "new_brief", brief: "do the thing" },
} as const;

export function driverCaps(
  methods: string[],
  features: string[],
): UiProtocolCapabilities {
  return makeCaps({ family: "driver", methods, features });
}

/** Every external-driver method plus `external_driver_v1`. */
export const FULL_DRIVER_CAPS = driverCaps(
  Object.values(EXTERNAL_DRIVER_METHODS),
  [EXTERNAL_DRIVER_V1_FEATURE],
);

/** The real `createExternalDriverCommands` over an RPC that records each call
 * and answers with `reply()`. */
export function driverHarness(
  reply: () => unknown = () => ({
    mode: "internal",
    binding: null,
    recovery: "none",
  }),
  capabilities = FULL_DRIVER_CAPS,
) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const commands = createExternalDriverCommands(
    {
      request: async (method, params) => {
        calls.push({ method, params });
        return reply();
      },
    },
    DRIVER_SESSION,
    capabilities,
    { profileId: "dev", topic: "peer-abc" },
  );
  return { calls, commands };
}

/** Settles `promise` and returns what it threw, or `null` if it resolved. */
export async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

/** The RPC was sent once to `method` and the reply was refused by decoding:
 * a typed, bounded error that echoes neither the proof nor a digest. */
export async function expectDecodeRejected(
  promise: Promise<unknown>,
  calls: Array<{ method: string; params: unknown }>,
  method: string,
): Promise<void> {
  const error = await capture(promise);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe(method);
  expect(error).toBeInstanceOf(ExternalDriverProtocolError);
  const message = (error as Error).message;
  expect(message).not.toContain(PROOF);
  expect(message).not.toContain("sha256:");
}
