/**
 * P2i RED (grant 3050): a COLD acquire must HOLD the seat.
 *
 * Live analysis (evidence/native-deepseek-web-pc-p2h-acquire-live-3040.md)
 * against the real Core: the `session/driver/acquire` reply is a valid RESULT
 * that the client decoder accepts, and the client then DISCARDS it — the old
 * target identity demanded BOTH a protocol-UUID live turn AND a non-empty
 * `pending_work`, and a cold master session has NEITHER (Core omits
 * `pending_work` entirely via serde `skip_serializing_if = Vec::is_empty`), so
 * `seatHeld` stayed false and the console never enabled Dispatch/Release. A
 * second cause: the binding badge rendered from the OBSERVED inventory
 * disclosure, which nothing re-walks after a successful acquire.
 *
 * The fixture below is the LIVE JSON SHAPE from the P2h probe with the control
 * token REPLACED by a fixture value (never copy a real token into a test).
 * apps/web has no jsdom, so the pure decisions are asserted directly and the
 * hook wiring is pinned by source text — the same discipline the sibling
 * seat/CAS suites use. No sleeps, no test-only product export.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
  createExternalDriverCommands,
  type DriverAcquireView,
} from "@octos-org/octoscode-client/external-driver";
import {
  peerControlBindingFor,
  peerControlSeatFromAcquire,
  peerControlTargetFor,
} from "./use-octos-session.ts";
import type { DriverInventoryState } from "./driver-discovery.ts";

const MASTER = "dev:local:tui#peer-abc";
const PROFILE = "dev";
const WEB_ID = "octoscode-web:11111111-1111-4111-8111-111111111111";
const TURN = "11111111-1111-1111-1111-111111111111";

const CAPS: UiProtocolCapabilities = {
  version: { protocol: "octos/ui-protocol", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 1,
  supported_methods: [
    EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_GET,
    EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_ACQUIRE,
    EXTERNAL_DRIVER_METHODS.PEER_CONTROL,
  ],
  supported_notifications: [],
  supported_features: [EXTERNAL_DRIVER_V1_FEATURE],
};

/**
 * The LIVE cold `session/driver/acquire` result (P2h probe, token replaced).
 * `pending_work` is ABSENT: the Core omits it for an empty vector, and the
 * decoder tolerates the absence (maps it to `[]`).
 */
const LIVE_COLD_ACQUIRE_REPLY: Record<string, unknown> = {
  control_token: "fixture-control-token",
  binding: {
    driver_id: WEB_ID,
    epoch: 4,
    revision: 1,
    lease_expires_at_ms: 1_700_000_600_000,
    workspace_root: "/workspace",
  },
  recovery: "none",
};

/** The LIVE cold `session/driver/get` disclosure: `internal`, NO binding. */
const COLD_INVENTORY: DriverInventoryState = {
  kind: "complete",
  snapshot: "snap-cold",
  observedRevision: "0",
  rows: [],
  completedAtMs: 1,
  disclosure: { mode: "internal", recovery: "none", binding: null },
};

/** One decoded cold acquire through the REAL client leaf + a fake transport. */
async function coldAcquire(): Promise<{
  view: DriverAcquireView;
  frame: ReturnType<typeof vi.fn>;
  commands: ReturnType<typeof createExternalDriverCommands>;
}> {
  const frame = vi.fn(
    async (_method: string, _params: unknown) => LIVE_COLD_ACQUIRE_REPLY,
  );
  const commands = createExternalDriverCommands(
    { request: (method, params) => frame(method, params) },
    MASTER,
    CAPS,
    { profileId: PROFILE, topic: "peer-abc" },
  );
  const view = await commands.driverAcquire({
    driverId: WEB_ID,
    expectedRevision: 0,
    leaseSeconds: 120,
  });
  return { view, frame, commands };
}

describe("the live cold acquire decodes — and is NOT discarded", () => {
  it("decodes the live shape (pending_work absent) through the REAL leaf", async () => {
    const { view, frame } = await coldAcquire();
    expect(frame).toHaveBeenCalledTimes(1);
    expect(frame.mock.calls[0]?.[0]).toBe(
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_ACQUIRE,
    );
    // The absent `pending_work` is an EMPTY list, never a decode failure.
    expect(view.pendingWork).toEqual([]);
    expect(view.binding).toMatchObject({
      driverId: WEB_ID,
      epoch: 4,
      revision: 1,
    });
    // The proof is reachable only through the opaque capability.
    expect(view.capability.reveal()).toBe("fixture-control-token");
  });

  it("HOLDS the seat on a cold acquire with no pending work and no live turn", async () => {
    const { view, commands } = await coldAcquire();
    const seat = peerControlSeatFromAcquire({
      view,
      commands,
      turnId: null,
      newOperationId: () => "ctl-op-1",
    });
    // The seat is HELD: a valid acquire result is the ONLY requirement.
    expect(seat).not.toBeNull();
    expect(seat?.view).toBe(view);
    expect(seat?.commands).toBe(commands);
    // ...and it carries NO target: a cold acquire has no pending work/turn.
    expect(seat?.target).toBeNull();
  });

  it("still fails CLOSED: no acquire result or no leaf ⇒ no seat", async () => {
    const { view, commands } = await coldAcquire();
    expect(
      peerControlSeatFromAcquire({
        view: null,
        commands,
        turnId: TURN,
        newOperationId: () => "ctl-op-1",
      }),
    ).toBeNull();
    expect(
      peerControlSeatFromAcquire({
        view,
        commands: null,
        turnId: TURN,
        newOperationId: () => "ctl-op-1",
      }),
    ).toBeNull();
  });

  it("builds the target at the ACTION site, and only when a turn can carry it", async () => {
    const { view } = await coldAcquire();
    // The seat no longer demands a target; the per-action builder still does.
    expect(
      peerControlTargetFor({
        acquire: view,
        turnId: TURN,
        newOperationId: () => "ctl-op-1",
      }),
    ).toBeNull();
    const withWork: DriverAcquireView = {
      ...view,
      pendingWork: ["dispatch-op-1"],
    };
    expect(
      peerControlTargetFor({
        acquire: withWork,
        turnId: TURN,
        newOperationId: () => "ctl-op-1",
      }),
    ).toEqual({
      controlOperationId: "ctl-op-1",
      targetOperationId: "dispatch-op-1",
      expectedTurnId: TURN,
    });
  });
});

describe("the binding badge reads the ACQUIRE's own binding", () => {
  it("uses the held acquire's binding even when the disclosure has none", async () => {
    const { view, commands } = await coldAcquire();
    const seat = peerControlSeatFromAcquire({
      view,
      commands,
      turnId: null,
      newOperationId: () => "ctl-op-1",
    });
    const binding = peerControlBindingFor({
      seat,
      driverInventory: COLD_INVENTORY,
    });
    expect(binding).toEqual({
      driverId: WEB_ID,
      epoch: 4,
      revision: 1,
      leaseExpiresAtMs: 1_700_000_600_000,
    });
  });

  it("falls back to the OBSERVED disclosure only when no seat is held", () => {
    const observed = {
      driverId: "drv-observed",
      epoch: 9,
      revision: 12,
      leaseExpiresAtMs: 0,
    };
    expect(
      peerControlBindingFor({
        seat: null,
        driverInventory: {
          ...(COLD_INVENTORY as Extract<
            DriverInventoryState,
            { kind: "complete" }
          >),
          disclosure: { mode: "external", recovery: "none", binding: observed },
        },
      }),
    ).toEqual(observed);
    // A cold disclosure with no seat discloses nothing — never a fabrication.
    expect(
      peerControlBindingFor({ seat: null, driverInventory: COLD_INVENTORY }),
    ).toBeNull();
  });
});

describe("the seat wiring holds the acquire and refreshes the inventory", () => {
  const source = readFileSync(
    new URL("./use-octos-session.ts", import.meta.url),
    "utf8",
  );

  it("no longer discards a valid acquire for want of a target", () => {
    expect(source).not.toContain("if (view === null || target === null)");
    expect(source).toContain("peerControlSeatFromAcquire({");
  });

  it("re-walks the driver inventory after the acquire and after a release", () => {
    expect(source).toContain("refreshDriverInventory(");
    const refreshes = source.match(/refreshControlInventory\(\)/g) ?? [];
    // ONE post-acquire + ONE in the shared release path. P3 (grant 3120 §b)
    // CONSOLIDATED the two release seams (the console's Release and
    // `peers.releaseSeat`) onto ONE `releaseControlSeat`, so the release refresh
    // is single-sourced — a second copy would mean the latch was bypassed again.
    expect(refreshes.length).toBe(2);
    const afterAcquire = source.slice(
      source.indexOf("peerControlSeatFromAcquire({"),
    );
    expect(afterAcquire.slice(0, 700)).toContain("refreshControlInventory()");
  });

  it("LATCHES a release so the post-release walk cannot re-acquire the seat", () => {
    // The run-13 :535 defect: release -> walk -> RE-ACQUIRE -> walk, because the
    // post-release refresh re-fired the acquire effect with the hold refs
    // cleared. The latch is the guard that makes Release stick.
    expect(source).toContain("controlReleasedRef");
    expect(source).toContain("parkControlSeat(");
    expect(source).toContain("acquireControlSeat(");
    // The guard sits at the HEAD of the acquire effect (before any acquire), and
    // the explicit re-acquire is the effect's own dep.
    const effect = source.slice(
      source.indexOf("const controlDriverId = stablePeerDriverId("),
      source.indexOf("const [controlState, setControlState]"),
    );
    expect(effect).toContain("controlReleasedRef.current === record");
    expect(
      effect.slice(0, effect.indexOf("controlReleasedRef.current === record")),
    ).not.toContain("driverAcquire(");
    expect(effect).toContain("controlAcquireEpoch,");
  });

  it("never drops a live lease because a walk is transiently unknown", () => {
    // The acquire effect must not clear the seat on a null CAS revision: the
    // post-acquire refresh itself sets `loading` mid-walk.
    const effect = source.slice(
      source.indexOf("const controlDriverId = stablePeerDriverId("),
      source.indexOf("const [controlState, setControlState]"),
    );
    expect(effect).toContain("if (controlRevision === null) return;");
    expect(effect).not.toContain("controlRevision === null ||");
  });
});
