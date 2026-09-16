import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DriverAcquireView } from "@octos-org/octoscode-client/external-driver";
import {
  PEER_CONTROL_LEASE_SECONDS,
  PEER_CONTROL_RENEW_INTERVAL_MS,
  PEER_DRIVER_ID_PREFIX,
  PEER_DRIVER_ID_STORAGE_KEY,
  peerControlAcquireInput,
  peerControlAcquireParams,
  peerControlFenceStaleIn,
  peerControlRenewParams,
  stablePeerDriverId,
} from "./use-octos-session.ts";
import type { DriverInventoryState } from "./driver-discovery.ts";

/**
 * P2e RED (grant 2930): the seat's acquire from a COLD session.
 *
 * A cold real Core reports driver mode `internal` with NO binding (P2d made
 * readiness `ready` there), so the acquire must be sourced from the CLIENT's own
 * STABLE per-browser-profile driver id — never from an observed binding, which a
 * cold session does not have — and CAS `expected_revision` = the OBSERVED
 * revision or 0 when unbound. The token/epoch stay in the acquire view (memory
 * only; `reveal()` is the single read). While the seat is held it must RENEW on
 * an interval WELL INSIDE the lease, release with `next:"external"`, and drop the
 * seat + render the bounded label on `driver_fence_stale` from ANY op.
 *
 * Pure inputs only, so this runs under node (apps/web has no jsdom); the hook
 * wiring in `use-octos-session.ts` is pinned by source text, the same way the
 * sibling seat/supply suites pin it.
 */
const UUID = "11111111-1111-4111-8111-111111111111";
const WEB_ID = `${PEER_DRIVER_ID_PREFIX}${UUID}`;

const memoryStorage = (seed: Record<string, string> = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    entries: () => Object.fromEntries(map),
  };
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
      driverId: "synthetic-driver-session-1",
      epoch: 7,
      revision: 12,
      leaseExpiresAtMs: 1_700_000_000_000,
    },
  },
};

/** The COLD shape: known inventory, driver mode `internal`, NO binding. */
const INTERNAL: DriverInventoryState = {
  ...EXTERNAL,
  disclosure: { mode: "internal", recovery: "none", binding: null },
};

const ACQUIRE: DriverAcquireView = {
  capability: { driverId: WEB_ID, epoch: 7, reveal: () => "tok-secret" },
  binding: {
    driverId: WEB_ID,
    epoch: 7,
    revision: 0,
    leaseExpiresAtMs: 1_700_000_000_000,
    acceptedWork: [],
  },
  pendingWork: ["dispatch-op-1"],
  recovery: "none",
};

describe("stablePeerDriverId — one id per browser profile, persisted", () => {
  it("returns an already-persisted stable id unchanged (no re-mint)", () => {
    const storage = memoryStorage({ [PEER_DRIVER_ID_STORAGE_KEY]: WEB_ID });
    expect(stablePeerDriverId(storage, () => "unused")).toBe(WEB_ID);
    expect(storage.entries()).toEqual({ [PEER_DRIVER_ID_STORAGE_KEY]: WEB_ID });
  });

  it("mints AND persists `octoscode-web:<uuid>` when nothing is stored", () => {
    const storage = memoryStorage();
    expect(stablePeerDriverId(storage, () => UUID)).toBe(WEB_ID);
    expect(storage.entries()).toEqual({ [PEER_DRIVER_ID_STORAGE_KEY]: WEB_ID });
  });

  it("replaces a malformed stored value instead of reusing it", () => {
    const storage = memoryStorage({
      [PEER_DRIVER_ID_STORAGE_KEY]: "not-a-uuid",
    });
    expect(stablePeerDriverId(storage, () => UUID)).toBe(WEB_ID);
    expect(storage.entries()).toEqual({ [PEER_DRIVER_ID_STORAGE_KEY]: WEB_ID });
  });

  it("fails OPEN to an ephemeral id when storage is absent or throws", () => {
    expect(stablePeerDriverId(null, () => UUID)).toBe(WEB_ID);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(stablePeerDriverId(throwing, () => UUID)).toBe(WEB_ID);
  });
});

describe("peerControlAcquireParams — the bounded lease", () => {
  it("asks for the 120s seat lease", () => {
    expect(PEER_CONTROL_LEASE_SECONDS).toBe(120);
    expect(peerControlAcquireParams({ driverId: WEB_ID, revision: 0 })).toEqual(
      {
        driverId: WEB_ID,
        expectedRevision: 0,
        leaseSeconds: 120,
      },
    );
  });
});

describe("peerControlAcquireInput — CAS from the stable id + observed revision", () => {
  it("CASes the observed revision against the browser's stable driver id", () => {
    expect(
      peerControlAcquireInput({ driverId: WEB_ID, driverInventory: EXTERNAL }),
    ).toEqual({ driverId: WEB_ID, revision: 12 });
  });

  it("CASes revision 0 from a COLD internal inventory (seat is reachable)", () => {
    expect(
      peerControlAcquireInput({ driverId: WEB_ID, driverInventory: INTERNAL }),
    ).toEqual({ driverId: WEB_ID, revision: 0 });
  });

  it("is null for an UNKNOWN walk or an empty driver id (no acquire)", () => {
    for (const driverInventory of [
      { kind: "unavailable" },
      { kind: "loading" },
      { kind: "error", reason: "stale" },
    ] as readonly DriverInventoryState[]) {
      expect(
        peerControlAcquireInput({ driverId: WEB_ID, driverInventory }),
      ).toBeNull();
    }
    expect(
      peerControlAcquireInput({ driverId: "", driverInventory: INTERNAL }),
    ).toBeNull();
  });
});

describe("peerControlRenewParams — renew WELL INSIDE the lease", () => {
  it("renews with the caller-held fence and the bounded lease", () => {
    expect(peerControlRenewParams(ACQUIRE)).toEqual({
      driverId: WEB_ID,
      epoch: 7,
      controlToken: "tok-secret",
      leaseSeconds: 120,
    });
  });

  it("is null with no held fence (no frame at all)", () => {
    expect(peerControlRenewParams(null)).toBeNull();
  });

  it("renews at an interval well inside the lease", () => {
    expect(PEER_CONTROL_RENEW_INTERVAL_MS).toBeGreaterThan(0);
    // Two full renew periods must fit inside ONE lease, so a single missed
    // tick can never let the server-side lease lapse.
    expect(PEER_CONTROL_RENEW_INTERVAL_MS * 2).toBeLessThanOrEqual(
      PEER_CONTROL_LEASE_SECONDS * 1000,
    );
  });
});

describe("peerControlFenceStaleIn — the bounded stale signal", () => {
  it("reads the typed kind off the seat's own bounded refusal state", () => {
    expect(
      peerControlFenceStaleIn({
        kind: "refused",
        refusalKind: "driver_fence_stale",
      }),
    ).toBe(true);
  });

  it("is false for a receipt, a sending seat, idle, or another refusal kind", () => {
    expect(peerControlFenceStaleIn({ kind: "idle" })).toBe(false);
    expect(peerControlFenceStaleIn({ kind: "sending", command: "steer" })).toBe(
      false,
    );
    expect(
      peerControlFenceStaleIn({
        kind: "refused",
        refusalKind: "driver_model_unavailable",
      }),
    ).toBe(false);
  });
});

describe("the seat wiring sends the cold acquire / renew / stale drop", () => {
  const source = readFileSync(
    new URL("./use-octos-session.ts", import.meta.url),
    "utf8",
  );

  it("sources the acquire driver id from the stable browser id, not the disclosure", () => {
    expect(source).toContain("stablePeerDriverId(");
    expect(source).toContain("peerControlAcquireInput({");
    expect(source).toContain("driverId: controlDriverId");
  });

  it("renews on an interval with the caller-held fence", () => {
    expect(source).toContain("PEER_CONTROL_RENEW_INTERVAL_MS");
    expect(source).toContain("peerControlRenewParams(");
    expect(source).toContain("driverRenew(params)");
  });

  it("drops the seat and shows the bounded label on a stale fence", () => {
    expect(source).toContain("const dropControlSeat = ");
    expect(source).toContain("peerControlFenceStaleIn(");
    expect(source).toContain('refusalKind: "driver_fence_stale"');
  });

  it('releases the seat with next:"external" and never a raw token store', () => {
    expect(source).toContain('next: "external"');
    expect(source).not.toContain("localStorage.setItem(PEER_CONTROL");
  });
});
