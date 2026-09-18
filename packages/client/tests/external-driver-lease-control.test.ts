import { describe, expect, it } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
  ExternalDriverCapabilityError,
  ExternalDriverProtocolError,
  createExternalDriverCommands,
} from "../src/external-driver.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

/**
 * 2044: bounded regression coverage for the LEASE surface itself, exercised
 * through the REAL `createExternalDriverCommands` factory. It pins the FROZEN
 * `SessionDriverReleaseResult` shape (next=internal => binding ABSENT;
 * next=external => parked binding PRESENT with lease 0), binds an acquire
 * receipt to the caller's captured `driverId`, and proves expectations are
 * captured BEFORE the await (post-send args mutation cannot retarget). WIRE
 * fields mirror Rust `ui_protocol.rs` (octos @ 38eca094 dirty M); proof is
 * always an explicit caller synthetic fixture, never a real token.
 */

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

const GET = EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_GET;
const ALL_METHODS = Object.values(EXTERNAL_DRIVER_METHODS);

/** Full positive control capability: every advertised method + the feature.
 * `PEER_CONTROL` is now part of `EXTERNAL_DRIVER_METHODS`, so `Object.values`
 * already covers the whole surface. */
const FULL_CAPS = caps(ALL_METHODS, [EXTERNAL_DRIVER_V1_FEATURE]);

/** Synthetic proof — a fixed, obviously-not-real fixture. Never persisted. */
const PROOF = "proof-synthetic-fixture";

const SESSION = "dev:local:tui#peer-abc";
const SCOPE = { profileId: "dev", topic: "peer-abc" };

type ReleaseArgs = {
  driverId: string;
  epoch: number;
  controlToken: string;
  expectedRevision: number;
  next: "internal" | "external";
};

const FENCE = { driverId: "driver-b", epoch: 8, controlToken: PROOF };

const ACQUIRE_ARGS = {
  driverId: "driver-b",
  expectedRevision: 0,
  leaseSeconds: 300,
};

const RELEASE_EXTERNAL_ARGS: ReleaseArgs = {
  ...FENCE,
  expectedRevision: 16,
  next: "external",
};

const RELEASE_INTERNAL_ARGS: ReleaseArgs = {
  ...FENCE,
  expectedRevision: 16,
  next: "internal",
};

const BINDING_WIRE = {
  driver_id: "driver-b",
  epoch: 8,
  revision: 16,
  lease_expires_at_ms: 1_700_000_000_000,
  accepted_work: ["op-dispatch-1"],
};

const ACQUIRE_REPLY = {
  control_token: PROOF,
  binding: BINDING_WIRE,
  pending_work: [],
  recovery: "none",
};

/** Parked external release: durable mode stays external, NO live lease. */
const RELEASE_EXTERNAL_REPLY = {
  mode: "external",
  binding: { ...BINDING_WIRE, lease_expires_at_ms: 0 },
  recovery: "none",
};

/** Release-to-internal: binding is ABSENT (unlike get, which retains it). */
const RELEASE_INTERNAL_REPLY = {
  mode: "internal",
  recovery: "none",
};

function harness(capabilities: UiProtocolCapabilities, reply: () => unknown) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const commands = createExternalDriverCommands(
    {
      request: async (method, params) => {
        calls.push({ method, params });
        return reply();
      },
    },
    SESSION,
    capabilities,
    SCOPE,
  );
  return { calls, commands };
}

/** Assert-and-score a typed, bounded rejection: the RPC was actually sent, the
 * rejection is not success, and the raw receipt/proof is never echoed. */
async function expectLeaseRejected(
  promise: Promise<unknown>,
  calls: Array<{ method: string; params: unknown }>,
  method: string,
): Promise<void> {
  let error: unknown;
  let settled = false;
  try {
    await promise;
    settled = true;
  } catch (caught) {
    error = caught;
  }
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe(method);
  expect(settled).toBe(false);
  expect(error).toBeInstanceOf(ExternalDriverProtocolError);
  const message = (error as Error).message;
  expect(message).not.toContain(PROOF);
  expect(message).not.toContain("sha256:");
}

describe("driverRelease enforces the FROZEN mode-specific shape", () => {
  it("accepts an external release: parked binding present with lease 0", async () => {
    const { calls, commands } = harness(FULL_CAPS, () =>
      structuredClone(RELEASE_EXTERNAL_REPLY),
    );
    const result = await commands.driverRelease(RELEASE_EXTERNAL_ARGS);
    expect(calls[0]?.method).toBe(
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_RELEASE,
    );
    expect(calls[0]?.params).toMatchObject({
      session_id: SESSION,
      topic: "peer-abc",
      driver_id: "driver-b",
      epoch: 8,
      control_token: PROOF,
      expected_revision: 16,
      next: "external",
    });
    expect(result.mode).toBe("external");
    expect(result.binding?.leaseExpiresAtMs).toBe(0);
    // The release receipt never echoes the controller proof.
    expect(JSON.stringify(result)).not.toContain(PROOF);
  });

  it("accepts an internal release: binding is ABSENT (never retained)", async () => {
    const { calls, commands } = harness(FULL_CAPS, () =>
      structuredClone(RELEASE_INTERNAL_REPLY),
    );
    const result = await commands.driverRelease(RELEASE_INTERNAL_ARGS);
    expect(calls[0]?.method).toBe(
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_RELEASE,
    );
    expect(calls[0]?.params).toMatchObject({ next: "internal" });
    expect(result.mode).toBe("internal");
    expect(result.binding).toBeNull();
  });

  it("rejects a FOREIGN next: requested internal but reply says external", async () => {
    const { calls, commands } = harness(FULL_CAPS, () =>
      structuredClone(RELEASE_EXTERNAL_REPLY),
    );
    await expectLeaseRejected(
      commands.driverRelease(RELEASE_INTERNAL_ARGS),
      calls,
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_RELEASE,
    );
  });

  it("rejects external next with a MISSING parked binding", async () => {
    const { calls, commands } = harness(FULL_CAPS, () =>
      structuredClone({ mode: "external", recovery: "none" }),
    );
    await expectLeaseRejected(
      commands.driverRelease(RELEASE_EXTERNAL_ARGS),
      calls,
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_RELEASE,
    );
  });

  it("rejects a parked binding that still carries a live lease", async () => {
    const { calls, commands } = harness(FULL_CAPS, () =>
      structuredClone({
        mode: "external",
        binding: { ...BINDING_WIRE, lease_expires_at_ms: 1_700_000_000_000 },
        recovery: "none",
      }),
    );
    await expectLeaseRejected(
      commands.driverRelease(RELEASE_EXTERNAL_ARGS),
      calls,
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_RELEASE,
    );
  });

  it("rejects an internal reply that wrongly carries a binding", async () => {
    const { calls, commands } = harness(FULL_CAPS, () =>
      structuredClone({
        mode: "internal",
        binding: { ...BINDING_WIRE, lease_expires_at_ms: 0 },
        recovery: "none",
      }),
    );
    await expectLeaseRejected(
      commands.driverRelease(RELEASE_INTERNAL_ARGS),
      calls,
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_RELEASE,
    );
  });
});

describe("driverAcquire binds the receipt to the captured caller driverId", () => {
  it("accepts a receipt whose binding.driver_id equals the caller's", async () => {
    const { calls, commands } = harness(FULL_CAPS, () =>
      structuredClone(ACQUIRE_REPLY),
    );
    const result = await commands.driverAcquire(ACQUIRE_ARGS);
    expect(calls[0]?.method).toBe(
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_ACQUIRE,
    );
    expect(result.capability.driverId).toBe("driver-b");
    expect(result.capability.epoch).toBe(8);
    expect(result.capability.reveal()).toBe(PROOF);
  });

  it("rejects a FOREIGN driver's receipt (no capability handed back)", async () => {
    const { calls, commands } = harness(FULL_CAPS, () =>
      structuredClone({
        ...ACQUIRE_REPLY,
        binding: { ...BINDING_WIRE, driver_id: "driver-foreign" },
      }),
    );
    await expectLeaseRejected(
      commands.driverAcquire(ACQUIRE_ARGS),
      calls,
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_ACQUIRE,
    );
  });
});

describe("lease expectations are captured BEFORE the await", () => {
  it("post-send mutation of caller args cannot retarget wire or decode", async () => {
    const args: ReleaseArgs = { ...RELEASE_EXTERNAL_ARGS };
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = createExternalDriverCommands(
      {
        request: async (method, params) => {
          calls.push({ method, params });
          // Mutate the ORIGINAL args AFTER the wire was built and the expected
          // `next`/fence captured — a re-read would now see "internal"/"evil".
          args.driverId = "driver-evil";
          args.next = "internal";
          return structuredClone(RELEASE_EXTERNAL_REPLY);
        },
      },
      SESSION,
      FULL_CAPS,
      SCOPE,
    );
    const result = await commands.driverRelease(args);
    expect(calls[0]?.params).toMatchObject({
      driver_id: "driver-b",
      next: "external",
    });
    // Decode used the CAPTURED "external", so the external reply still decodes.
    expect(result.mode).toBe("external");
    expect(JSON.stringify(calls[0]?.params)).not.toContain("evil");
  });
});

describe("lease proof stays redacted and gating stays offline", () => {
  it("the acquire capability exposes no enumerable proof and errors never echo it", async () => {
    const { commands } = harness(FULL_CAPS, () =>
      structuredClone(ACQUIRE_REPLY),
    );
    const result = await commands.driverAcquire(ACQUIRE_ARGS);
    expect(JSON.stringify(result)).not.toContain(PROOF);
    expect(Object.keys(result.capability)).not.toContain("controlToken");
    expect(Object.values(result.capability)).not.toContain(PROOF);

    const { calls, commands: broken } = harness(FULL_CAPS, () =>
      structuredClone({ ...ACQUIRE_REPLY, control_token: 12345 }),
    );
    await expectLeaseRejected(
      broken.driverAcquire(ACQUIRE_ARGS),
      calls,
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_ACQUIRE,
    );
  });

  it("driverRelease fails closed when the feature is absent (zero wire)", async () => {
    const { calls, commands } = harness(caps(ALL_METHODS, []), () =>
      structuredClone(RELEASE_EXTERNAL_REPLY),
    );
    await expect(
      commands.driverRelease(RELEASE_EXTERNAL_ARGS),
    ).rejects.toBeInstanceOf(ExternalDriverCapabilityError);
    expect(calls).toEqual([]);
  });

  it("driverRelease fails closed when its method is unadvertised (zero wire)", async () => {
    const { calls, commands } = harness(
      caps([GET], [EXTERNAL_DRIVER_V1_FEATURE]),
      () => structuredClone(RELEASE_EXTERNAL_REPLY),
    );
    await expect(
      commands.driverRelease(RELEASE_EXTERNAL_ARGS),
    ).rejects.toBeInstanceOf(ExternalDriverCapabilityError);
    expect(calls).toEqual([]);
  });
});
