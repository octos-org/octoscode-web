import { describe, expect, it, vi } from "vitest";
import type { ExternalDriverCommands } from "@octos-org/octoscode-client/external-driver";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
} from "@octos-org/octoscode-client/external-driver";
import {
  acquirePeerControlFence,
  derivePeerControlSeat,
  peerControlAcquireInput,
  peerControlAcquireParams,
  peerControlTargetFor,
} from "./use-octos-session.ts";
import type { DriverInventoryState } from "./driver-discovery.ts";
import type { PeerControlTarget } from "../control/peer-control-commands.ts";

/**
 * Seat-wiring RED (grant 0840). The bar (grant 0745) already mounts
 * `PeerControlPanel` behind `peerControl.readiness === "ready"`, but no caller
 * ever builds a `PeerControlSeat` and no acquire ever mints the fence, so the
 * mount is unreachable. These tests pin the DERIVATION the hook now owns:
 * fail-closed on caps, on the observed external binding, on a missing acquire,
 * and on a missing target — and a real seat when all four hold. Pure inputs, so
 * they run under node (apps/web has no jsdom).
 */
const TURN = "11111111-1111-1111-1111-111111111111";

const ADMITTING: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["session/open", EXTERNAL_DRIVER_METHODS.PEER_CONTROL],
  supported_notifications: [],
  supported_features: [EXTERNAL_DRIVER_V1_FEATURE],
};

/** peer/control advertised but the driver feature is NOT: gate stays off. */
const NO_FEATURE: UiProtocolCapabilities = {
  ...ADMITTING,
  supported_features: [],
};

const EXTERNAL: DriverInventoryState = {
  kind: "complete",
  snapshot: "snap-1",
  observedRevision: "12",
  rows: [],
  completedAtMs: 1,
  disclosure: {
    mode: "external",
    recovery: "none",
    binding: {
      driverId: "drv-1",
      epoch: 7,
      revision: 12,
      leaseExpiresAtMs: 1_700_000_000_000,
    },
  },
};

const INTERNAL: DriverInventoryState = {
  ...EXTERNAL,
  disclosure: { mode: "internal", recovery: "none", binding: null },
};

const ACQUIRE = {
  capability: { driverId: "drv-1", epoch: 7, reveal: () => "tok-secret" },
  binding: {
    driverId: "drv-1",
    epoch: 7,
    revision: 12,
    leaseExpiresAtMs: 1_700_000_000_000,
    acceptedWork: ["dispatch-op-1"],
  },
  pendingWork: ["dispatch-op-1"],
  recovery: "none" as const,
};

const TARGET: PeerControlTarget = {
  controlOperationId: "ctl-op-1",
  targetOperationId: "dispatch-op-1",
  expectedTurnId: TURN,
};

const commands = (): ExternalDriverCommands =>
  ({
    peerControl: vi.fn(async () => ({})),
  }) as unknown as ExternalDriverCommands;

const sources = (
  overrides: Partial<Parameters<typeof derivePeerControlSeat>[0]>,
) => ({
  capabilities: ADMITTING,
  driverInventory: EXTERNAL,
  acquire: ACQUIRE,
  commands: commands(),
  target: TARGET,
  ...overrides,
});

describe("derivePeerControlSeat — fail-closed seat derivation", () => {
  it("is null when the caps do not admit peer/control + external_driver_v1", () => {
    expect(
      derivePeerControlSeat(sources({ capabilities: NO_FEATURE })),
    ).toBeNull();
    expect(
      derivePeerControlSeat(sources({ capabilities: undefined })),
    ).toBeNull();
  });

  it("is null unless the inventory is KNOWN", () => {
    // P2d: the gate is caps + a KNOWN inventory, not an already-observed
    // EXTERNAL binding — otherwise a cold `internal` session could never seat.
    expect(
      derivePeerControlSeat(
        sources({ driverInventory: { kind: "unavailable" } }),
      ),
    ).toBeNull();
    expect(
      derivePeerControlSeat(sources({ driverInventory: { kind: "loading" } })),
    ).toBeNull();
  });

  it("seats from a COLD internal inventory once a capability is acquired", () => {
    expect(
      derivePeerControlSeat(sources({ driverInventory: INTERNAL })),
    ).not.toBeNull();
  });

  it("is null without an acquired control capability", () => {
    expect(derivePeerControlSeat(sources({ acquire: null }))).toBeNull();
    expect(derivePeerControlSeat(sources({ commands: null }))).toBeNull();
  });

  it("is null without a target identity", () => {
    expect(derivePeerControlSeat(sources({ target: null }))).toBeNull();
  });

  it("builds the seat from admitted caps + the acquired binding", () => {
    const leaf = commands();
    const seat = derivePeerControlSeat(sources({ commands: leaf }));
    expect(seat).not.toBeNull();
    expect(seat?.readiness).toBe("ready");
    expect(seat?.capabilities).toBe(ADMITTING);
    expect(seat?.leaf).toBe(leaf);
    // The proof is passed through, never minted here and never rendered.
    expect(seat?.fence).toEqual({
      driverId: "drv-1",
      epoch: 7,
      controlToken: "tok-secret",
    });
    expect(seat?.target).toBe(TARGET);
    expect(seat?.state).toEqual({ kind: "idle" });
  });
});

describe("peerControlAcquireParams — CAS input for the acquire", () => {
  it("reuses the caller-held driverId and revision for the acquire CAS", () => {
    expect(
      peerControlAcquireParams({ driverId: "drv-1", revision: 12 }),
    ).toEqual({ driverId: "drv-1", expectedRevision: 12, leaseSeconds: 120 });
  });
});

// P2e (grant 2930) moved the CAS SOURCE to the stable browser driver id plus
// the observed revision; the acquire-CAS suite itself now lives in
// `peer-control-acquire-cas.test.ts`. This file keeps only the seat's own
// derivation, which is unchanged.

describe("peerControlTargetFor — target identity from the acquired binding", () => {
  it("takes the target operation from the acquire's pending work", () => {
    expect(
      peerControlTargetFor({
        acquire: ACQUIRE,
        turnId: TURN,
        newOperationId: () => "ctl-op-1",
      }),
    ).toEqual({
      controlOperationId: "ctl-op-1",
      targetOperationId: "dispatch-op-1",
      expectedTurnId: TURN,
    });
  });

  it("uses the pending work, not an older acceptedWork entry", () => {
    const target = peerControlTargetFor({
      acquire: {
        ...ACQUIRE,
        binding: {
          ...ACQUIRE.binding,
          acceptedWork: ["older-op", "dispatch-op-1"],
        },
      },
      turnId: TURN,
      newOperationId: () => "ctl-op-1",
    });
    expect(target?.targetOperationId).toBe("dispatch-op-1");
  });

  it("is null without a pending target operation or a protocol-UUID turn", () => {
    expect(
      peerControlTargetFor({
        acquire: { ...ACQUIRE, pendingWork: [] },
        turnId: TURN,
        newOperationId: () => "ctl-op-1",
      }),
    ).toBeNull();
    expect(
      peerControlTargetFor({
        acquire: ACQUIRE,
        turnId: "not-a-uuid",
        newOperationId: () => "ctl-op-1",
      }),
    ).toBeNull();
    expect(
      peerControlTargetFor({
        acquire: null,
        turnId: TURN,
        newOperationId: () => "ctl-op-1",
      }),
    ).toBeNull();
  });
});

describe("acquirePeerControlFence — one fenced acquire", () => {
  it("sends exactly one CAS acquire and returns the same-driver view", async () => {
    const driverAcquire = vi.fn(async () => ACQUIRE);
    const view = await acquirePeerControlFence({
      commands: { driverAcquire },
      acquire: { driverId: "drv-1", revision: 12 },
      isCurrent: () => true,
    });
    expect(view).toBe(ACQUIRE);
    expect(driverAcquire).toHaveBeenCalledTimes(1);
    expect(driverAcquire).toHaveBeenCalledWith({
      driverId: "drv-1",
      expectedRevision: 12,
      leaseSeconds: 120,
    });
  });

  it("fails closed to null on a foreign driver, a stale fence, or a refusal", async () => {
    const foreign = await acquirePeerControlFence({
      commands: {
        driverAcquire: async () => ({
          ...ACQUIRE,
          capability: { ...ACQUIRE.capability, driverId: "drv-OTHER" },
        }),
      },
      acquire: { driverId: "drv-1", revision: 12 },
      isCurrent: () => true,
    });
    expect(foreign).toBeNull();

    const stale = await acquirePeerControlFence({
      commands: { driverAcquire: async () => ACQUIRE },
      acquire: { driverId: "drv-1", revision: 12 },
      isCurrent: () => false,
    });
    expect(stale).toBeNull();

    const refused = await acquirePeerControlFence({
      commands: {
        driverAcquire: async () => {
          throw new Error("refused");
        },
      },
      acquire: { driverId: "drv-1", revision: 12 },
      isCurrent: () => true,
    });
    expect(refused).toBeNull();
  });
});

describe("seat wiring — sourced end-to-end from one observed disclosure", () => {
  it("builds a ready seat from caps + disclosure + one acquire + a target", async () => {
    const leaf = commands();
    const input = peerControlAcquireInput({
      driverId: "drv-1",
      driverInventory: EXTERNAL,
    });
    const acquire = await acquirePeerControlFence({
      commands: { driverAcquire: async () => ACQUIRE },
      acquire: input!,
      isCurrent: () => true,
    });
    const target = peerControlTargetFor({
      acquire,
      turnId: TURN,
      newOperationId: () => "ctl-op-1",
    });
    const seat = derivePeerControlSeat({
      capabilities: ADMITTING,
      driverInventory: EXTERNAL,
      acquire,
      commands: leaf,
      target,
    });
    expect(seat?.readiness).toBe("ready");
    expect(seat?.leaf).toBe(leaf);
    expect(seat?.fence).toEqual({
      driverId: "drv-1",
      epoch: 7,
      controlToken: "tok-secret",
    });
    expect(seat?.target?.targetOperationId).toBe("dispatch-op-1");
    expect(seat?.target?.expectedTurnId).toBe(TURN);
  });

  it("yields no seat when the caps gate is off", async () => {
    const seat = derivePeerControlSeat({
      capabilities: NO_FEATURE,
      driverInventory: EXTERNAL,
      acquire: ACQUIRE,
      commands: commands(),
      target: TARGET,
    });
    expect(seat).toBeNull();
  });
});
