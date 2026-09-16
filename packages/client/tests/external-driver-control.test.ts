import { describe, expect, it } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
  ExternalDriverCapabilityError,
  ExternalDriverProtocolError,
  createExternalDriverCommands,
} from "../src/external-driver.ts";
import type { ExternalDriverCommands } from "../src/external-driver.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

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
  return {
    version: {
      protocol: "octos/ui-protocol",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 1,
    supported_methods: methods,
    supported_notifications: [],
    supported_features: features,
  };
}

/**
 * Test-local proposals mirroring the CURRENT Rust control types
 * (ui_protocol.rs, octos @ 38eca094 dirty M). These pin the wire contract the
 * Web client would send/receive; tests assert against these shapes. Proof
 * (`controlToken`) is ALWAYS an explicit caller argument — never read from
 * localStorage, a global, or any token store.
 */
interface ControlFenceArgs {
  driverId: string;
  epoch: number;
  controlToken: string;
}

interface DriverAcquireArgs {
  driverId: string;
  expectedRevision: number;
  leaseSeconds: number;
}

/**
 * Proposed per-response capability: an OPAQUE handle, not a plain field. The
 * token lives in a closure and is NOT an own enumerable property, so JSON /
 * debug / storage serialization of any public view cannot leak it; only an
 * explicit `reveal()` returns it. The direct acquire reply is the ONE
 * intentional secret-bearing response — it is never a discovery/receipt/get
 * view, and ordinary views must stay redacted.
 */
interface DriverControlCapability {
  readonly driverId: string;
  readonly epoch: number;
  reveal(): string;
}

interface DriverBindingView {
  driverId: string;
  epoch: number;
  revision: number;
  leaseExpiresAtMs: number;
  acceptedWork: readonly string[];
}

interface DriverAcquireView {
  capability: DriverControlCapability;
  binding: DriverBindingView;
  pendingWork: readonly string[];
  recovery: string;
}

interface DriverRenewArgs extends ControlFenceArgs {
  leaseSeconds: number;
}

interface DriverRenewView {
  leaseExpiresAtMs: number;
}

interface DriverReleaseArgs extends ControlFenceArgs {
  expectedRevision: number;
  next: "internal" | "external";
}

interface DriverReleaseView {
  mode: string;
  binding: DriverBindingView | null;
  recovery: string;
}

type DispatchTargetInput =
  | { kind: "new_brief"; brief: string }
  | { kind: "existing_slug"; slug: string };

interface PeerDispatchArgs extends ControlFenceArgs {
  operationId: string;
  model: string;
  dispatch: DispatchTargetInput;
  kickoffInput?: readonly { kind: "text"; text: string }[];
}

interface PeerDispatchView {
  operationId: string;
  state: string;
  model: string;
  modelLane: string;
  workspaceRoot: string;
  adoptedTurnId: string;
  adoptedSessionId: string;
  slug: string;
  duplicate: boolean;
  acceptedAtMs: number;
  payloadDigest: string;
}

interface PeerControlArgs extends ControlFenceArgs {
  operationId: string;
  targetOperationId: string;
  expectedTurnId: string;
  command: { kind: "steer"; input: readonly { kind: "text"; text: string }[] };
}

interface PeerControlView {
  operationId: string;
  state: string;
  targetOperationId: string;
  expectedTurnId: string;
  targetSessionId: string;
  slug: string;
  acceptedAtMs: number;
  payloadDigest: string;
  duplicate: boolean;
}

interface WakeClaimArgs extends ControlFenceArgs {
  mailboxCursor?: string;
}

interface WakeOccurrenceView {
  sequence: number;
  reasonKind: string;
  dedupeKey: string;
  payload?: unknown;
  continuationRef?: string;
  payloadDigest: string;
  createdAtMs: number;
}

interface WakeClaimView {
  occurrences: readonly WakeOccurrenceView[];
  claimToken: string;
  nextCursor: string;
  leaseExpiresAtMs: number;
}

interface WakeAckArgs extends ControlFenceArgs {
  claimToken: string;
  sequences: readonly number[];
  operationIds?: readonly string[];
}

interface WakeAckView {
  acknowledged: readonly number[];
}

const GET = EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_GET;

const ALL_METHODS = Object.values(EXTERNAL_DRIVER_METHODS);

const FULL_CAPS = caps([GET], [EXTERNAL_DRIVER_V1_FEATURE]);

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

/** Synthetic proof — a fixed, obviously-not-real fixture string. Never a real
 * control token, and never persisted anywhere. */
const PROOF = "proof-synthetic-fixture";

const FENCE: ControlFenceArgs = {
  driverId: "driver-b",
  epoch: 8,
  controlToken: PROOF,
};

const ACQUIRE_ARGS: DriverAcquireArgs = {
  driverId: "driver-b",
  expectedRevision: 0,
  leaseSeconds: 300,
};

const RENEW_ARGS: DriverRenewArgs = { ...FENCE, leaseSeconds: 300 };

const RELEASE_ARGS: DriverReleaseArgs = {
  ...FENCE,
  expectedRevision: 16,
  next: "external",
};

const DISPATCH_ARGS: PeerDispatchArgs = {
  ...FENCE,
  operationId: "op-dispatch-1",
  model: "deepseek-chat",
  dispatch: { kind: "new_brief", brief: "do the thing" },
};

const CONTROL_ARGS: PeerControlArgs = {
  ...FENCE,
  operationId: "op-control-1",
  targetOperationId: "op-dispatch-1",
  expectedTurnId: "3f1c9d2a-4b6e-4c1a-9f2d-7a5e8b0c1d2e",
  command: { kind: "steer", input: [{ kind: "text", text: "keep going" }] },
};

const CLAIM_ARGS: WakeClaimArgs = { ...FENCE };

const ACK_ARGS: WakeAckArgs = {
  ...FENCE,
  claimToken: "claim-synthetic-fixture",
  sequences: [1],
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

describe("external driver control surface (1907 RED)", () => {
  it("exposes driverAcquire on the factory result", () => {
    const { control } = harness(FULL_CAPS);
    expect(typeof control.driverAcquire).toBe("function");
  });

  it("keeps the read-only surface intact alongside the control methods", () => {
    const { commands } = harness(FULL_CAPS);
    const base: ExternalDriverCommands = commands;
    expect(typeof base.driverGet).toBe("function");
    expect(typeof base.nextExpectedRevision).toBe("function");
  });
});

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
const CONTROL_ARGS_BY_METHOD: Record<
  (typeof CONTROL_METHODS)[number],
  unknown
> = {
  driverAcquire: ACQUIRE_ARGS,
  driverRenew: RENEW_ARGS,
  driverRelease: RELEASE_ARGS,
  peerDispatch: DISPATCH_ARGS,
  peerControl: CONTROL_ARGS,
  wakeClaim: CLAIM_ARGS,
  wakeAck: ACK_ARGS,
};

describe("control methods gate on external_driver_v1 before any wire send", () => {
  for (const name of CONTROL_METHODS) {
    it(`${name} fails closed when the feature is missing`, async () => {
      const { calls, control } = harness(caps(CONTROL_METHODS_ADVERTISED, []));
      await expect(
        invoke(control, name, CONTROL_ARGS_BY_METHOD[name]),
      ).rejects.toBeInstanceOf(ExternalDriverCapabilityError);
      expect(calls).toEqual([]);
    });

    it(`${name} fails closed when its method is unadvertised`, async () => {
      const { calls, control } = harness(
        caps([GET], [EXTERNAL_DRIVER_V1_FEATURE]),
      );
      await expect(
        invoke(control, name, CONTROL_ARGS_BY_METHOD[name]),
      ).rejects.toBeInstanceOf(ExternalDriverCapabilityError);
      expect(calls).toEqual([]);
    });
  }

  // `peer/control` is NOT in EXTERNAL_DRIVER_METHODS, so it needs its own
  // explicit negatives rather than riding on Object.values(...).
  it("peerControl fails closed when advertised but the feature is missing", async () => {
    const { calls, control } = harness(caps(CONTROL_METHODS_ADVERTISED, []));
    await expect(
      invoke(control, "peerControl", CONTROL_ARGS),
    ).rejects.toBeInstanceOf(ExternalDriverCapabilityError);
    expect(calls).toEqual([]);
  });

  it("peerControl fails closed when the feature is on but peer/control is unadvertised", async () => {
    const withoutPeerControl = CONTROL_METHODS_ADVERTISED.filter(
      (method) => method !== PEER_CONTROL_WIRE,
    );
    const { calls, control } = harness(
      caps(withoutPeerControl, [EXTERNAL_DRIVER_V1_FEATURE]),
    );
    await expect(
      invoke(control, "peerControl", CONTROL_ARGS),
    ).rejects.toBeInstanceOf(ExternalDriverCapabilityError);
    expect(calls).toEqual([]);
  });
});

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

const BINDING_WIRE = {
  driver_id: "driver-b",
  epoch: 8,
  revision: 16,
  lease_expires_at_ms: 1_700_000_000_000,
  accepted_work: ["op-dispatch-1"],
};

/**
 * RAW WIRE reply: `rpc.request` returns untouched JSON, so the acquire fixture
 * is the actual Rust `SessionDriverAcquireResult` — a plain enumerable
 * `control_token` string. NO functions belong in wire JSON and NO capability
 * helper is defined here. The closure-backed capability is a PUBLIC decoded
 * result concern, exercised below by invoking the factory against this raw
 * fixture. This direct raw `control_token` is the ONE deliberate wire
 * exception; every ordinary public view/error/storage path stays redacted.
 */
const ACQUIRE_REPLY = {
  control_token: PROOF,
  binding: BINDING_WIRE,
  pending_work: [],
  recovery: "none",
};

const RENEW_REPLY = { lease_expires_at_ms: 1_700_000_300_000 };

const RELEASE_REPLY = {
  mode: "external",
  binding: { ...BINDING_WIRE, lease_expires_at_ms: 0 },
  recovery: "none",
};

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

  it("the decoded acquire capability is serialization-safe: no proof in JSON/debug", async () => {
    // Exercised through the REAL factory, not a fixture-local self-test: the
    // public result may reach the proof only via the opaque closure-backed
    // capability, so JSON/debug/keys/values of the result cannot leak it.
    const { control } = harness(FULL_CONTROL_CAPS, undefined, () =>
      structuredClone(ACQUIRE_REPLY),
    );
    const result = (await invoke(
      control,
      "driverAcquire",
      ACQUIRE_ARGS,
    )) as DriverAcquireView;
    expect(JSON.stringify(result)).not.toContain(PROOF);
    expect(String(result.capability)).not.toContain(PROOF);
    expect(Object.keys(result.capability)).not.toContain("controlToken");
    expect(Object.values(result.capability)).not.toContain(PROOF);
  });
});

describe("driverRenew and driverRelease use the exact live fence + proof", () => {
  it("renew sends driver_id/epoch/control_token and the bounded lease", async () => {
    const { calls, control } = harness(FULL_CONTROL_CAPS, undefined, () =>
      structuredClone(RENEW_REPLY),
    );
    const result = (await invoke(
      control,
      "driverRenew",
      RENEW_ARGS,
    )) as DriverRenewView;
    expect(calls).toEqual([
      {
        method: WIRE_METHOD.driverRenew,
        params: {
          session_id: "dev:local:tui#peer-abc",
          topic: "peer-abc",
          driver_id: "driver-b",
          epoch: 8,
          control_token: PROOF,
          lease_seconds: 300,
        },
      },
    ]);
    expect(result.leaseExpiresAtMs).toBe(1_700_000_300_000);
  });

  it("release sends the fence, expected_revision and explicit next mode", async () => {
    const { calls, control } = harness(FULL_CONTROL_CAPS, undefined, () =>
      structuredClone(RELEASE_REPLY),
    );
    const result = (await invoke(
      control,
      "driverRelease",
      RELEASE_ARGS,
    )) as DriverReleaseView;
    expect(calls).toEqual([
      {
        method: WIRE_METHOD.driverRelease,
        params: {
          session_id: "dev:local:tui#peer-abc",
          topic: "peer-abc",
          driver_id: "driver-b",
          epoch: 8,
          control_token: PROOF,
          expected_revision: 16,
          next: "external",
        },
      },
    ]);
    // Parked external binding is present with lease 0; proof never echoed.
    expect(result.mode).toBe("external");
    expect(result.binding?.leaseExpiresAtMs).toBe(0);
    expect(JSON.stringify(result)).not.toContain(PROOF);
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

const CONTROL_REPLY = {
  operation_id: "op-control-1",
  state: "accepted",
  target_operation_id: "op-dispatch-1",
  expected_turn_id: "3f1c9d2a-4b6e-4c1a-9f2d-7a5e8b0c1d2e",
  target_session_id: "dev:local:tui#peer-abc",
  slug: "abc",
  accepted_at_ms: 1_700_000_000_500,
  payload_digest: "sha256:cafef00d",
  duplicate: false,
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
    )) as PeerDispatchView;
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

  it("re-invoking the SAME operation re-encodes identically and keeps the ORIGINAL receipt", async () => {
    // SAME factory, SAME operation, invoked TWICE: first accepted, then a server
    // duplicate. This is client codec/serialization coverage — the client owns
    // no dedupe ledger or scheduler.
    let call = 0;
    const { calls, control } = harness(FULL_CONTROL_CAPS, undefined, () =>
      structuredClone(
        call++ === 0 ? DISPATCH_REPLY : { ...DISPATCH_REPLY, duplicate: true },
      ),
    );
    const first = (await invoke(
      control,
      "peerDispatch",
      DISPATCH_ARGS,
    )) as PeerDispatchView;
    const second = (await invoke(
      control,
      "peerDispatch",
      DISPATCH_ARGS,
    )) as PeerDispatchView;
    // Both sends actually happened, and the sent canonical params are identical.
    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe(WIRE_METHOD.peerDispatch);
    expect(calls[1]?.method).toBe(WIRE_METHOD.peerDispatch);
    expect(calls[1]?.params).toEqual(calls[0]?.params);
    expect(calls[0]?.params).toMatchObject({ operation_id: "op-dispatch-1" });
    // ONLY `duplicate` differs; every immutable receipt field is identical.
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const immutable = [
      "operationId",
      "state",
      "model",
      "modelLane",
      "workspaceRoot",
      "adoptedTurnId",
      "adoptedSessionId",
      "slug",
      "acceptedAtMs",
      "payloadDigest",
    ] as const satisfies readonly (keyof PeerDispatchView)[];
    for (const key of immutable) {
      expect(second[key]).toEqual(first[key]);
    }
    expect(second.operationId).toBe("op-dispatch-1");
    expect(second.payloadDigest).toBe(DISPATCH_REPLY.payload_digest);
  });

  it("control carries the accepted receipt facts and never the proof", async () => {
    const { calls, control } = harness(FULL_CONTROL_CAPS, undefined, () =>
      structuredClone(CONTROL_REPLY),
    );
    const result = (await invoke(
      control,
      "peerControl",
      CONTROL_ARGS,
    )) as PeerControlView;
    expect(calls[0]?.method).toBe(WIRE_METHOD.peerControl);
    expect(calls[0]?.params).toMatchObject({
      driver_id: "driver-b",
      epoch: 8,
      control_token: PROOF,
      operation_id: "op-control-1",
      target_operation_id: "op-dispatch-1",
      expected_turn_id: CONTROL_ARGS.expectedTurnId,
    });
    expect(result.state).toBe("accepted");
    expect(result.targetOperationId).toBe("op-dispatch-1");
    expect(JSON.stringify(result)).not.toContain(PROOF);
  });
});

const CLAIM_REPLY = {
  occurrences: [
    {
      sequence: 1,
      reason_kind: "child_complete",
      dedupe_key: "dedupe-1",
      payload: { goal_id: "g1" },
      payload_digest: "sha256:beef",
      created_at_ms: 1_700_000_000_000,
    },
  ],
  claim_token: "claim-synthetic-fixture",
  next_cursor: "cursor-2",
  lease_expires_at_ms: 1_700_000_060_000,
};

const ACK_REPLY = { acknowledged: [1] };

describe("wakeClaim / wakeAck are lease-bound and replayable", () => {
  it("claim sends the fence and treats the cursor as opaque", async () => {
    const { calls, control } = harness(FULL_CONTROL_CAPS, undefined, () =>
      structuredClone(CLAIM_REPLY),
    );
    const result = (await invoke(
      control,
      "wakeClaim",
      CLAIM_ARGS,
    )) as WakeClaimView;
    expect(calls[0]?.method).toBe(WIRE_METHOD.wakeClaim);
    expect(calls[0]?.params).toMatchObject({
      session_id: "dev:local:tui#peer-abc",
      topic: "peer-abc",
      driver_id: "driver-b",
      epoch: 8,
      control_token: PROOF,
    });
    // Omitted cursor is not invented; server supplies next_cursor.
    expect(calls[0]?.params).not.toHaveProperty("mailbox_cursor");
    expect(result.nextCursor).toBe("cursor-2");
    expect(result.claimToken).toBe("claim-synthetic-fixture");
    expect(result.occurrences[0]?.sequence).toBe(1);
  });

  it("ack echoes the claim token and decided sequences", async () => {
    const { calls, control } = harness(FULL_CONTROL_CAPS, undefined, () =>
      structuredClone(ACK_REPLY),
    );
    const result = (await invoke(control, "wakeAck", ACK_ARGS)) as WakeAckView;
    expect(calls[0]?.method).toBe(WIRE_METHOD.wakeAck);
    expect(calls[0]?.params).toMatchObject({
      driver_id: "driver-b",
      epoch: 8,
      control_token: PROOF,
      claim_token: "claim-synthetic-fixture",
      sequences: [1],
    });
    expect(result.acknowledged).toEqual([1]);
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

  it("dispatch rejects a malformed (non-UUID) adopted turn id", async () => {
    await expectDecodeRejected("peerDispatch", DISPATCH_ARGS, () =>
      structuredClone({ ...DISPATCH_REPLY, adopted_turn_id: "not-a-uuid" }),
    );
  });

  it("dispatch rejects a two-segment adopted topic", async () => {
    await expectDecodeRejected("peerDispatch", DISPATCH_ARGS, () =>
      structuredClone({
        ...DISPATCH_REPLY,
        adopted_session_id: "dev:local:tui#peer-abc#extra",
        slug: "abc#extra",
      }),
    );
  });

  it("control rejects a target session that contradicts its slug", async () => {
    await expectDecodeRejected("peerControl", CONTROL_ARGS, () =>
      structuredClone({
        ...CONTROL_REPLY,
        target_session_id: "dev:local:tui#peer-other",
      }),
    );
  });

  it("claim rejects an occurrence that is neither payload nor continuation_ref", async () => {
    await expectDecodeRejected("wakeClaim", CLAIM_ARGS, () =>
      structuredClone({
        ...CLAIM_REPLY,
        occurrences: [
          {
            sequence: 1,
            reason_kind: "child_complete",
            dedupe_key: "dedupe-1",
            payload_digest: "sha256:beef",
            created_at_ms: 1_700_000_000_000,
          },
        ],
      }),
    );
  });

  it("claim rejects an occurrence carrying BOTH payload and continuation_ref", async () => {
    await expectDecodeRejected("wakeClaim", CLAIM_ARGS, () =>
      structuredClone({
        ...CLAIM_REPLY,
        occurrences: [
          {
            sequence: 1,
            reason_kind: "child_complete",
            dedupe_key: "dedupe-1",
            payload: { goal_id: "g1" },
            continuation_ref: "ref-1",
            payload_digest: "sha256:beef",
            created_at_ms: 1_700_000_000_000,
          },
        ],
      }),
    );
  });

  it("refuses a captured scope whose profile contradicts a qualified session", () => {
    expect(() =>
      createExternalDriverCommands(
        { request: async () => structuredClone(NEVER_BOUND_INTERNAL) },
        "other:local:tui#peer-abc",
        FULL_CONTROL_CAPS,
        { profileId: "dev", topic: "peer-abc" },
      ),
    ).toThrow(ExternalDriverProtocolError);
  });

  it("refuses a captured topic that contradicts the session suffix", () => {
    expect(() =>
      createExternalDriverCommands(
        { request: async () => structuredClone(NEVER_BOUND_INTERNAL) },
        "dev:local:tui#peer-abc",
        FULL_CONTROL_CAPS,
        { profileId: "dev", topic: "peer-other" },
      ),
    ).toThrow(ExternalDriverProtocolError);
  });

  it("acquire rejects a reply missing its control_token", async () => {
    await expectDecodeRejected("driverAcquire", ACQUIRE_ARGS, () => {
      const { control_token: _drop, ...rest } = ACQUIRE_REPLY;
      return structuredClone(rest);
    });
  });

  it("acquire rejects a non-object reply", async () => {
    await expectDecodeRejected("driverAcquire", ACQUIRE_ARGS, () =>
      structuredClone("not-a-receipt"),
    );
  });

  it("renew rejects a reply missing lease_expires_at_ms", async () => {
    await expectDecodeRejected("driverRenew", RENEW_ARGS, () =>
      structuredClone({}),
    );
  });

  it("release rejects an unknown mode", async () => {
    await expectDecodeRejected("driverRelease", RELEASE_ARGS, () =>
      structuredClone({ ...RELEASE_REPLY, mode: "bogus" }),
    );
  });

  it("claim rejects a reply missing its claim_token", async () => {
    await expectDecodeRejected("wakeClaim", CLAIM_ARGS, () => {
      const { claim_token: _drop, ...rest } = CLAIM_REPLY;
      return structuredClone(rest);
    });
  });

  it("ack rejects a non-array acknowledged result", async () => {
    await expectDecodeRejected("wakeAck", ACK_ARGS, () =>
      structuredClone({ acknowledged: "1" }),
    );
  });
});

describe("receipt turn identifiers cover every Rust Uuid::parse_str form", () => {
  // uuid-1.20.0/src/parser.rs 147-164: hex digits are case-INsensitive, but the
  // `urn:uuid:` PREFIX is NOT. `isProtocolUuid` (protocol-id.ts) currently accepts
  // only the canonical hyphenated form, so the non-canonical POSITIVES below are
  // the INTENDED RED for the future command decoder — never a product GREEN claim.
  const acceptedForms = [
    "67e55044-10b1-426f-9247-bb680e5fe0c8", // canonical hyphenated
    "67E55044-10B1-426F-9247-BB680E5FE0C8", // uppercase HEX
    "67e5504410b1426f9247bb680e5fe0c8", // simple32
    "{67e55044-10b1-426f-9247-bb680e5fe0c8}", // braced hyphenated
    "urn:uuid:67e55044-10b1-426f-9247-bb680e5fe0c8", // lowercase urn:uuid: prefix
    "00000000-0000-0000-0000-000000000000", // nil
  ] as const;
  const rejectedPrefixForms = [
    "URN:UUID:67e55044-10b1-426f-9247-bb680e5fe0c8", // uppercase URN prefix
    "Urn:Uuid:67e55044-10b1-426f-9247-bb680e5fe0c8", // mixed-case URN prefix
  ] as const;

  for (const form of acceptedForms) {
    it(`dispatch decodes the accepted turn-id form ${form}`, async () => {
      const { control } = harness(FULL_CONTROL_CAPS, undefined, () =>
        structuredClone({ ...DISPATCH_REPLY, adopted_turn_id: form }),
      );
      const result = (await invoke(
        control,
        "peerDispatch",
        DISPATCH_ARGS,
      )) as PeerDispatchView;
      expect(result.adoptedTurnId).toBe(form);
    });

    it(`control decodes the accepted turn-id form ${form}`, async () => {
      const args = { ...CONTROL_ARGS, expectedTurnId: form };
      const { control } = harness(FULL_CONTROL_CAPS, undefined, () =>
        structuredClone({ ...CONTROL_REPLY, expected_turn_id: form }),
      );
      const result = (await invoke(
        control,
        "peerControl",
        args,
      )) as PeerControlView;
      expect(result.expectedTurnId).toBe(form);
    });
  }

  for (const form of rejectedPrefixForms) {
    it(`dispatch rejects the case-mismatched urn prefix ${form}`, async () => {
      await expectDecodeRejected("peerDispatch", DISPATCH_ARGS, () =>
        structuredClone({ ...DISPATCH_REPLY, adopted_turn_id: form }),
      );
    });

    it(`control rejects the case-mismatched urn prefix ${form}`, async () => {
      await expectDecodeRejected("peerControl", CONTROL_ARGS, () =>
        structuredClone({ ...CONTROL_REPLY, expected_turn_id: form }),
      );
    });
  }
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

  it("control methods require an explicitly supplied proof argument", async () => {
    const seen: unknown[] = [];
    const commands = createExternalDriverCommands(
      {
        request: async (_method, params) => {
          seen.push(params);
          return structuredClone(RENEW_REPLY);
        },
      },
      "dev:local:tui#peer-abc",
      FULL_CONTROL_CAPS,
      { profileId: "dev", topic: "peer-abc" },
    );
    const control = commands as unknown as ExternalDriverControlSurface;
    await invoke(control, "driverRenew", RENEW_ARGS);
    // The proof travelled ONLY because the caller passed it in args.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ control_token: PROOF });
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

  it("a rejected control RPC never echoes the raw server payload or proof", async () => {
    const rejectedCalls: Array<{ method: string; params: unknown }> = [];
    const secret = "PRIVATE-server-detail-and-token";
    const controller = createExternalDriverCommands(
      {
        request: async (method, params) => {
          rejectedCalls.push({ method, params });
          throw new Error(secret);
        },
      },
      "dev:local:tui#peer-abc",
      FULL_CONTROL_CAPS,
      { profileId: "dev", topic: "peer-abc" },
    );
    const control = controller as unknown as ExternalDriverControlSurface;
    // Existence is asserted OUTSIDE the catch: a missing method must FAIL here,
    // not be silently swallowed and misread as a rejected RPC.
    const dispatch = requireMethod(control, "peerDispatch");
    let error: unknown;
    let settled = false;
    try {
      await dispatch(DISPATCH_ARGS);
      settled = true;
    } catch (caught) {
      error = caught;
    }
    // The RPC WAS sent exactly once and the outcome was a bounded TYPED
    // rejection — never a success, never raw server text.
    expect(rejectedCalls).toHaveLength(1);
    expect(rejectedCalls[0]?.method).toBe(WIRE_METHOD.peerDispatch);
    expect(settled).toBe(false);
    expect(error).toBeInstanceOf(ExternalDriverProtocolError);
    const message = (error as Error).message;
    expect(message).not.toContain(secret);
    expect(message).not.toContain(PROOF);
  });
});

describe("captured scope is frozen at construction (no re-resolution)", () => {
  it("keeps the constructing session/topic for every control method", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    // A VALID exact scope whose topic matches the session suffix, so
    // construction SUCCEEDS — a construction throw is not control-surface RED.
    const scope = { profileId: "dev", topic: "peer-xyz" };
    const commands = createExternalDriverCommands(
      {
        request: async (method, params) => {
          calls.push({ method, params });
          return structuredClone(RENEW_REPLY);
        },
      },
      "dev:local:tui#peer-xyz",
      FULL_CONTROL_CAPS,
      scope,
    );
    // Retarget the ORIGINAL scope object AFTER construction: the factory
    // captured the confirmed profile/topic ONCE and must never re-resolve
    // them per request.
    (scope as { profileId: string; topic: string }).profileId = "evil";
    (scope as { profileId: string; topic: string }).topic = "peer-smuggled";
    const control = commands as unknown as ExternalDriverControlSurface;
    await invoke(control, "driverRenew", RENEW_ARGS);
    // The ACTUAL RPC carried the ORIGINAL captured session/topic.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe(WIRE_METHOD.driverRenew);
    expect(calls[0]?.params).toMatchObject({
      session_id: "dev:local:tui#peer-xyz",
      topic: "peer-xyz",
    });
    expect(JSON.stringify(calls[0]?.params)).not.toContain("evil");
    expect(JSON.stringify(calls[0]?.params)).not.toContain("peer-smuggled");
  });

  it("discloses no control token in the read-only get view", async () => {
    const { commands } = harness(FULL_CONTROL_CAPS);
    const view = await commands.driverGet();
    expect(JSON.stringify(view)).not.toContain(PROOF);
    expect(JSON.stringify(view)).not.toContain("control_token");
  });
});
