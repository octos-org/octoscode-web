import { describe, expect, it } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
  ExternalDriverProtocolError,
  createExternalDriverCommands,
} from "../src/external-driver.ts";
import type {
  DriverAcquireParams,
  DriverAcquireView,
  DriverControlFence,
  DriverRenewParams,
  PeerDispatchReceiptView,
} from "../src/external-driver.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";
import { makeCaps } from "./fixtures/caps.ts";
import {
  ACQUIRE_REPLY,
  FENCE as SHARED_FENCE,
  PROOF,
} from "./fixtures/external-driver-wire.ts";

/**
 * 1907 RED: the requested Web external-control surface (driverAcquire,
 * driverRenew, driverRelease, peerDispatch, peerControl, wakeClaim, wakeAck)
 * does not yet exist on `createExternalDriverCommands`'s result. This file
 * freezes the missing-surface contract. Each method is reached through an
 * OPTIONAL test-local surface so a not-yet-implemented method is an
 * intentional RUNTIME assertion failure, never an unknown-import or
 * TypeScript compile error. WIRE FIELDS below mirror the current Rust
 * ui_protocol.rs (octos @ 38eca094 dirty M) — synthetic proof only, never a
 * real token, and proof is always passed explicitly by the caller.
 */

/** Test-local widening: control methods are optional so their absence is a
 * runtime RED, while the existing read-only surface stays untouched. */
interface ExternalDriverControlSurface {
  driverAcquire?: (...args: unknown[]) => Promise<unknown>;
  driverRenew?: (...args: unknown[]) => Promise<unknown>;
  driverRelease?: (...args: unknown[]) => Promise<unknown>;
  peerDispatch?: (...args: unknown[]) => Promise<unknown>;
  peerControl?: (...args: unknown[]) => Promise<unknown>;
  wakeClaim?: (...args: unknown[]) => Promise<unknown>;
  wakeAck?: (...args: unknown[]) => Promise<unknown>;
}

function caps(methods: string[], features: string[]): UiProtocolCapabilities {
  return makeCaps({ family: "driver", methods, features });
}

type DispatchTargetInput =
  | { kind: "new_brief"; brief: string }
  | { kind: "existing_slug"; slug: string };

interface PeerDispatchArgs extends DriverControlFence {
  operationId: string;
  model: string;
  dispatch: DispatchTargetInput;
  kickoffInput?: readonly { kind: "text"; text: string }[];
}

const GET = EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_GET;

const ALL_METHODS = Object.values(EXTERNAL_DRIVER_METHODS);

/**
 * `EXTERNAL_DRIVER_METHODS` currently has only SEVEN names and lacks
 * PEER_CONTROL, so `Object.values(...)` is NOT full positive control
 * capability. The literal wire name is added here — no invented export, no
 * false-capability fixture.
 */
const PEER_CONTROL_WIRE = "peer/control";

const CONTROL_METHODS_ADVERTISED = [...ALL_METHODS, PEER_CONTROL_WIRE];

const FULL_CONTROL_CAPS = caps(CONTROL_METHODS_ADVERTISED, [
  EXTERNAL_DRIVER_V1_FEATURE,
]);

const NEVER_BOUND_INTERNAL = {
  mode: "internal",
  binding: null,
  recovery: "none",
};

const FENCE: DriverControlFence = { ...SHARED_FENCE };

const ACQUIRE_ARGS: DriverAcquireParams = {
  driverId: "driver-b",
  expectedRevision: 0,
  leaseSeconds: 300,
};

const RENEW_ARGS: DriverRenewParams = { ...FENCE, leaseSeconds: 300 };

const DISPATCH_ARGS: PeerDispatchArgs = {
  ...FENCE,
  operationId: "op-dispatch-1",
  model: "deepseek-chat",
  dispatch: { kind: "new_brief", brief: "do the thing" },
};

function harness(
  capabilities: UiProtocolCapabilities,
  sessionId = "dev:local:tui#peer-abc",
  reply: () => unknown = () => structuredClone(NEVER_BOUND_INTERNAL),
) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const commands = createExternalDriverCommands(
    {
      request: async (method, params) => {
        calls.push({ method, params });
        return reply();
      },
    },
    sessionId,
    capabilities,
    { profileId: "dev", topic: "peer-abc" },
  );
  return {
    calls,
    commands,
    control: commands as unknown as ExternalDriverControlSurface,
  };
}

/** Assert-and-narrow: a missing method is an intentional RUNTIME failure with
 * a method-specific message, never an import/compile error. */
function requireMethod(
  control: ExternalDriverControlSurface,
  name: keyof ExternalDriverControlSurface,
): (...args: unknown[]) => Promise<unknown> {
  const fn = control[name];
  expect(
    typeof fn,
    `${String(name)} must be exposed on createExternalDriverCommands' result`,
  ).toBe("function");
  return fn as (...args: unknown[]) => Promise<unknown>;
}

async function invoke(
  control: ExternalDriverControlSurface,
  name: keyof ExternalDriverControlSurface,
  args: unknown,
): Promise<unknown> {
  return requireMethod(control, name)(args);
}

/** Methods gated by the negotiated `external_driver_v1` feature. */
const CONTROL_METHODS = [
  "driverAcquire",
  "driverRenew",
  "driverRelease",
  "peerDispatch",
  "peerControl",
  "wakeClaim",
  "wakeAck",
] as const satisfies readonly (keyof ExternalDriverControlSurface)[];

/** Per-method fixture arguments, so the gate loop exercises real params. */

/** Wire-side method names. `peer/control` is deliberately NOT in the current
 * `EXTERNAL_DRIVER_METHODS` map (ui_protocol.rs declares it; the TS slice has
 * not added it yet) — pinned here from the Rust source so the test never
 * depends on an invented export. */
const WIRE_METHOD: Record<(typeof CONTROL_METHODS)[number], string> = {
  driverAcquire: "session/driver/acquire",
  driverRenew: "session/driver/renew",
  driverRelease: "session/driver/release",
  peerDispatch: "peer/dispatch",
  peerControl: "peer/control",
  wakeClaim: "session/wake/claim",
  wakeAck: "session/wake/ack",
};

/**
 * A malformed-receipt negative MUST prove the RPC was actually sent and that the
 * rejection came from DECODING — never a missing-method assertion masquerading
 * as a decode failure. Existence is asserted OUTSIDE the catch, the wire send is
 * counted, and the rejection must be bounded/typed and must NOT be success.
 */
async function expectDecodeRejected(
  name: (typeof CONTROL_METHODS)[number],
  args: unknown,
  reply: () => unknown,
): Promise<void> {
  const { calls, control } = harness(FULL_CONTROL_CAPS, undefined, reply);
  requireMethod(control, name);
  let error: unknown;
  let settled = false;
  try {
    await invoke(control, name, args);
    settled = true;
  } catch (caught) {
    error = caught;
  }
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe(WIRE_METHOD[name]);
  expect(settled).toBe(false);
  expect(error).toBeInstanceOf(ExternalDriverProtocolError);
  const message = (error as Error).message;
  // Bounded: the raw malformed receipt is never echoed back.
  expect(message).not.toContain(PROOF);
  expect(message).not.toContain("sha256:");
}

// ACQUIRE_REPLY / BINDING_WIRE / PROOF: see ./fixtures/external-driver-wire.ts
// (the wire contract is pinned once for the control + lease files together).

const RENEW_REPLY = { lease_expires_at_ms: 1_700_000_300_000 };

describe("driverAcquire is explicit and get-revision-based", () => {
  it("sends the captured scope, fence id, expected_revision and lease", async () => {
    const { calls, control } = harness(FULL_CONTROL_CAPS, undefined, () =>
      // Plain JSON wire reply — the factory decodes it into the public result.
      structuredClone(ACQUIRE_REPLY),
    );
    const result = (await invoke(
      control,
      "driverAcquire",
      ACQUIRE_ARGS,
    )) as DriverAcquireView;
    expect(calls).toEqual([
      {
        method: WIRE_METHOD.driverAcquire,
        params: {
          session_id: "dev:local:tui#peer-abc",
          topic: "peer-abc",
          driver_id: "driver-b",
          expected_revision: 0,
          lease_seconds: 300,
        },
      },
    ]);
    // The raw WIRE reply carries a plain `control_token`; the PUBLIC decoded
    // result must expose it only through the opaque closure-backed capability.
    expect(result.capability.reveal()).toBe(PROOF);
    expect(result.capability.driverId).toBe("driver-b");
    expect(result.capability.epoch).toBe(8);
    expect(result.pendingWork).toEqual([]);
  });
});

const DISPATCH_REPLY = {
  operation_id: "op-dispatch-1",
  state: "accepted",
  model: "deepseek-chat",
  model_lane: "deepseek-chat",
  workspace_root: "/ws/peer-abc",
  adopted_turn_id: "3f1c9d2a-4b6e-4c1a-9f2d-7a5e8b0c1d2e",
  adopted_session_id: "dev:local:tui#peer-abc",
  slug: "abc",
  duplicate: false,
  accepted_at_ms: 1_700_000_000_000,
  payload_digest: "sha256:deadbeef",
};

describe("peerDispatch / peerControl carry immutable receipts", () => {
  it("dispatch sends the fence, operation id, exact model and target", async () => {
    const { calls, control } = harness(FULL_CONTROL_CAPS, undefined, () =>
      structuredClone(DISPATCH_REPLY),
    );
    const result = (await invoke(
      control,
      "peerDispatch",
      DISPATCH_ARGS,
    )) as PeerDispatchReceiptView;
    expect(calls[0]?.method).toBe(WIRE_METHOD.peerDispatch);
    expect(calls[0]?.params).toMatchObject({
      session_id: "dev:local:tui#peer-abc",
      topic: "peer-abc",
      driver_id: "driver-b",
      epoch: 8,
      control_token: PROOF,
      operation_id: "op-dispatch-1",
      model: "deepseek-chat",
      dispatch: { kind: "new_brief", brief: "do the thing" },
    });
    expect(result.state).toBe("accepted");
    expect(result.adoptedSessionId).toBe("dev:local:tui#peer-abc");
    expect(result.slug).toBe("abc");
    // Native identity: the adopted session must be EXACTLY base + `#peer-<slug>`.
    expect(result.adoptedSessionId).toBe(`dev:local:tui#peer-${result.slug}`);
    expect(result.duplicate).toBe(false);
  });
});

describe("decoders reject malformed native identity (no silent fallback)", () => {
  it("dispatch rejects an adopted session that contradicts its slug", async () => {
    await expectDecodeRejected("peerDispatch", DISPATCH_ARGS, () =>
      structuredClone({
        ...DISPATCH_REPLY,
        adopted_session_id: "dev:local:tui#peer-other",
      }),
    );
  });

  // The decidable-content rule (payload XOR continuation_ref) is owned by
  // external-driver-wake-control.test.ts at the parser level; the wire path
  // funnels through that same parser, so no separate wire-level dupe here.
});

describe("no implicit acquisition, fallback or proof leakage", () => {
  it("driverGet stays read-only: it never acquires and carries no proof", async () => {
    const { calls, commands } = harness(FULL_CONTROL_CAPS);
    await commands.driverGet();
    expect(calls).toEqual([
      {
        method: GET,
        params: { session_id: "dev:local:tui#peer-abc", topic: "peer-abc" },
      },
    ]);
    expect(calls.some((c) => c.method !== GET)).toBe(false);
  });

  it("refuses a control call with NO proof argument, offline (zero wire traffic)", async () => {
    const { calls, control } = harness(FULL_CONTROL_CAPS, undefined, () =>
      structuredClone(RENEW_REPLY),
    );
    const renew = requireMethod(control, "driverRenew");
    const { controlToken: _omit, ...noProof } = RENEW_ARGS;
    let error: unknown;
    let settled = false;
    try {
      await renew(noProof);
      settled = true;
    } catch (caught) {
      error = caught;
    }
    expect(settled).toBe(false);
    expect(error).toBeInstanceOf(ExternalDriverProtocolError);
    // Refused BEFORE any wire send: there is no ambient/global token store to
    // fall back to. Behaviour (offline refusal + zero RPC) is the proof — a
    // bare `globalThis.localStorage === undefined` proves nothing on its own.
    expect(calls).toEqual([]);
  });
});
