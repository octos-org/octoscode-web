import { describe, expect, it, vi } from "vitest";
import { OctosUiClient } from "@octos-org/octoscode-client";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  SessionRecordManager,
  deriveControlReadiness,
  type SessionRecordManagerOptions,
} from "./session-record-manager.ts";
import type { ActiveSessionAuthority } from "./active-session-runtime.ts";
import type { DriverInventoryState } from "./driver-discovery.ts";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";

/**
 * P2d cold-start row: the record's `controlReadiness` is a DERIVED, fail-closed
 * projection. It reads `ready` when the LIVE authority advertises BOTH
 * `peer/control` and `external_driver_v1` AND the driver inventory is KNOWN
 * (`complete` — ANY mode, binding present or absent), so a COLD internal session
 * can still reach the seat and acquire it. Every other combination — unknown
 * caps, a missing half, an unavailable/loading/failed walk — projects
 * `unavailable`; nothing here grants authority by default.
 */

class Client extends OctosUiClient {
  constructor() {
    super({ endpoint: "ws://127.0.0.1:1" });
  }
  override get status() {
    return "connected" as const;
  }
}

const config = (sessionId = "s1"): SessionConnectionInput => ({
  endpoint: "ws://127.0.0.1:1",
  token: "",
  cwd: "/repo",
  profileId: "dev",
  sessionId,
});

const scope = (sessionId = "s1") => ({
  endpoint: "ws://127.0.0.1:1",
  workspaceRoot: "/repo",
  profileId: "dev",
  sessionId,
  authorityEpoch: 1,
});

const BASE_CAPS: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["session/open", "peer/control"],
  supported_notifications: [],
  supported_features: ["external_driver_v1"],
};

const COMPLETE_EXTERNAL: DriverInventoryState = {
  kind: "complete",
  snapshot: "snap-1",
  observedRevision: "3",
  rows: [{ operationId: "op-1", slug: "peer-pane", lifecycle: "open" }],
  completedAtMs: 1_700_000_000_000,
  disclosure: { mode: "external", recovery: "none", binding: null },
};

const COMPLETE_INTERNAL: DriverInventoryState = {
  ...COMPLETE_EXTERNAL,
  disclosure: { mode: "internal", recovery: "none", binding: null },
};

/** A KNOWN inventory with an OBSERVED external binding (retained/parked). */
const COMPLETE_BOUND: DriverInventoryState = {
  ...COMPLETE_EXTERNAL,
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

function authority(
  capabilities: UiProtocolCapabilities | undefined,
): ActiveSessionAuthority<Client> {
  return {
    generation: 1,
    client: new Client(),
    config: config(),
    sessionId: "s1",
    profileId: "dev",
    cwd: "/repo",
    capabilities,
    opened: null,
  };
}

function harness() {
  const client = new Client();
  const options: SessionRecordManagerOptions<Client> = {
    pooledClient: () => client,
    authorityEpoch: () => 1,
    onSelectedEvent: () => {},
    onSelectedSnapshot: () => {},
    onBackgroundActivity: () => {},
    controllerDependencies: (recordScope, getClient) => ({
      client: getClient,
      sessionId: () => recordScope.sessionId,
      canEnqueue: () => true,
      canStart: () => false,
      canInterrupt: () => false,
      setTimeline: () => {},
      setConnectionError: () => {},
    }),
    cursorFor: () => undefined,
    validateServerCapabilities: () => {},
    validateSessionCapabilities: () => {},
  };
  const manager = new SessionRecordManager<Client>(options);
  return { manager, record: manager.ensure(scope()) };
}

describe("deriveControlReadiness (pure, fail-closed)", () => {
  it("is unavailable when capabilities are unknown", () => {
    expect(
      deriveControlReadiness({
        capabilities: undefined,
        driverInventory: COMPLETE_EXTERNAL,
      }),
    ).toBe("unavailable");
  });

  it("is unavailable when the peer/control method is not advertised", () => {
    expect(
      deriveControlReadiness({
        capabilities: {
          ...BASE_CAPS,
          supported_methods: ["session/open"],
        },
        driverInventory: COMPLETE_EXTERNAL,
      }),
    ).toBe("unavailable");
  });

  it("is unavailable when external_driver_v1 is not advertised", () => {
    expect(
      deriveControlReadiness({
        capabilities: { ...BASE_CAPS, supported_features: [] },
        driverInventory: COMPLETE_EXTERNAL,
      }),
    ).toBe("unavailable");
  });

  it("is unavailable until the inventory is KNOWN", () => {
    for (const driverInventory of [
      { kind: "unavailable" },
      { kind: "loading" },
      { kind: "error", reason: "stale" },
      { kind: "error", reason: "unknown" },
      { kind: "error", reason: "refused" },
    ] as DriverInventoryState[]) {
      expect(
        deriveControlReadiness({
          capabilities: BASE_CAPS,
          driverInventory,
        }),
      ).toBe("unavailable");
    }
  });

  it("is ready on a COLD internal inventory (binding absent, mode internal)", () => {
    // P2d: a cold real Core reports driver mode `internal` with NO binding —
    // never a retained external one. Readiness must NOT depend on an already
    // observed external binding, or the seat is unreachable forever.
    expect(
      deriveControlReadiness({
        capabilities: BASE_CAPS,
        driverInventory: COMPLETE_INTERNAL,
      }),
    ).toBe("ready");
  });

  it("is ready with a KNOWN external binding too", () => {
    expect(
      deriveControlReadiness({
        capabilities: BASE_CAPS,
        driverInventory: COMPLETE_BOUND,
      }),
    ).toBe("ready");
  });
});

describe("record.controlReadiness (derived, on the snapshot)", () => {
  it("defaults to unavailable on a fresh record", () => {
    const { record } = harness();
    expect(record.controlReadiness).toBe("unavailable");
  });

  it("is unavailable without a live authority, even with an external binding", () => {
    const { record } = harness();
    record.driverInventory = COMPLETE_EXTERNAL;
    expect(record.controlReadiness).toBe("unavailable");
  });

  it("is unavailable with an external binding but non-admitting caps", () => {
    const { record } = harness();
    record.driverInventory = COMPLETE_EXTERNAL;
    vi.spyOn(record.runtime, "currentAuthority").mockReturnValue(
      authority({ ...BASE_CAPS, supported_features: [] }),
    );
    expect(record.controlReadiness).toBe("unavailable");
  });

  it("is ready with admitting caps on a COLD internal inventory", () => {
    const { record } = harness();
    record.driverInventory = COMPLETE_INTERNAL;
    vi.spyOn(record.runtime, "currentAuthority").mockReturnValue(
      authority(BASE_CAPS),
    );
    expect(record.controlReadiness).toBe("ready");
  });

  it("is ready when admitting caps AND an external binding agree", () => {
    const { record } = harness();
    record.driverInventory = COMPLETE_EXTERNAL;
    vi.spyOn(record.runtime, "currentAuthority").mockReturnValue(
      authority(BASE_CAPS),
    );
    expect(record.controlReadiness).toBe("ready");
  });

  it("is ready on a COLD internal inventory (no binding) with admitting caps", () => {
    const { record } = harness();
    record.driverInventory = COMPLETE_INTERNAL;
    vi.spyOn(record.runtime, "currentAuthority").mockReturnValue(
      authority(BASE_CAPS),
    );
    expect(record.controlReadiness).toBe("ready");
  });
});

/**
 * P2d: the seat must be able to acquire from a COLD session, so the record
 * exposes the OBSERVED binding (or null) for the CAS. An unbound/unknown
 * inventory exposes null — the caller then CASes `expected_revision = 0`.
 */
describe("record observed driver binding (for the acquire CAS)", () => {
  it("exposes null binding/revision before any walk", () => {
    const { record } = harness();
    expect(record.observedDriverBinding).toBeNull();
    expect(record.observedDriverRevision).toBeNull();
  });

  it("exposes null binding/revision for a COLD internal inventory", () => {
    const { record } = harness();
    record.driverInventory = COMPLETE_INTERNAL;
    expect(record.observedDriverBinding).toBeNull();
    expect(record.observedDriverRevision).toBeNull();
  });

  it("exposes the OBSERVED external binding + its public revision", () => {
    const { record } = harness();
    record.driverInventory = COMPLETE_BOUND;
    expect(record.observedDriverBinding).toEqual({
      driverId: "drv-1",
      epoch: 7,
      revision: 12,
      leaseExpiresAtMs: 1_700_000_000_000,
    });
    expect(record.observedDriverRevision).toBe(12);
  });

  it("exposes null while the walk is unavailable/loading/failed", () => {
    const { record } = harness();
    for (const driverInventory of [
      { kind: "unavailable" },
      { kind: "loading" },
      { kind: "error", reason: "refused" },
    ] as DriverInventoryState[]) {
      record.driverInventory = driverInventory;
      expect(record.observedDriverBinding).toBeNull();
      expect(record.observedDriverRevision).toBeNull();
    }
  });
});
