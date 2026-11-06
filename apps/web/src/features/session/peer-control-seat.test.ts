import { describe, expect, it, vi } from "vitest";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
  createExternalDriverCommands,
  type DriverAcquireView,
} from "@octos-org/octoscode-client/external-driver";
import {
  PEER_CONTROL_LEASE_SECONDS,
  PEER_CONTROL_RENEW_INTERVAL_MS,
  PEER_DRIVER_ID_PREFIX,
  PEER_DRIVER_ID_STORAGE_KEY,
  acquirePeerControlFence,
  peerControlSeatFromAcquire,
  stablePeerDriverId,
} from "./use-octos-session.ts";

/**
 * The peer-control seat's own guards. The user chains — the caps gate, exactly
 * one frame per command, the operator's steer text and the adopted peer turn,
 * approval, the stale-fence drop, release before send — run end to end in
 * e2e/peer-control.spec.ts, e2e/peer-controller.spec.ts and
 * e2e/chat-handover.spec.ts. This file keeps what those cannot see: the live
 * Core reply shape through the real client leaf, the acquire CAS refusing a
 * foreign or stale answer, the renew timing, and the one value the seat
 * persists. apps/web has no jsdom, so these call the hook's pure seams.
 */
const MASTER = "dev:local:tui#peer-abc";
const UUID = "11111111-1111-4111-8111-111111111111";
const WEB_ID = `${PEER_DRIVER_ID_PREFIX}${UUID}`;

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
 * The live cold `session/driver/acquire` result (P2h probe, token replaced by
 * a fixture value). `pending_work` is ABSENT: the Core omits an empty vector
 * (serde `skip_serializing_if = Vec::is_empty`).
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

const ACQUIRE: DriverAcquireView = {
  capability: { driverId: WEB_ID, epoch: 7, reveal: () => "tok-secret" },
  binding: {
    driverId: WEB_ID,
    epoch: 7,
    revision: 12,
    leaseExpiresAtMs: 1_700_000_000_000,
    acceptedWork: ["dispatch-op-1"],
  },
  pendingWork: ["dispatch-op-1"],
  recovery: "none",
};

describe("a cold acquire from the live Core holds the seat", () => {
  it("decodes the reply without pending_work through the real leaf and holds the seat", async () => {
    // P2i: the old target check demanded pending work AND a live turn, and a
    // cold master session has neither, so a valid acquire was discarded.
    const frame = vi.fn(
      async (_method: string, _params: unknown) => LIVE_COLD_ACQUIRE_REPLY,
    );
    const commands = createExternalDriverCommands(
      { request: (method, params) => frame(method, params) },
      MASTER,
      CAPS,
      { profileId: "dev", topic: "peer-abc" },
    );
    const view = await commands.driverAcquire({
      driverId: WEB_ID,
      expectedRevision: 0,
      leaseSeconds: PEER_CONTROL_LEASE_SECONDS,
    });
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

    const seat = peerControlSeatFromAcquire({
      view,
      commands,
      turnId: null,
      newOperationId: () => "ctl-op-1",
    });
    expect(seat?.view).toBe(view);
    expect(seat?.commands).toBe(commands);
    // A cold acquire has no pending work or turn, so the seat has no target.
    expect(seat?.target).toBeNull();
  });
});

describe("the acquire CAS", () => {
  it("fails closed to null on a foreign driver, a stale record, or a refusal", async () => {
    const acquire = { driverId: WEB_ID, revision: 12 };
    const foreign = await acquirePeerControlFence({
      commands: {
        driverAcquire: async () => ({
          ...ACQUIRE,
          capability: { ...ACQUIRE.capability, driverId: "drv-OTHER" },
        }),
      },
      acquire,
      isCurrent: () => true,
    });
    expect(foreign).toBeNull();

    const stale = await acquirePeerControlFence({
      commands: { driverAcquire: async () => ACQUIRE },
      acquire,
      isCurrent: () => false,
    });
    expect(stale).toBeNull();

    const refused = await acquirePeerControlFence({
      commands: {
        driverAcquire: async () => {
          throw new Error("refused");
        },
      },
      acquire,
      isCurrent: () => true,
    });
    expect(refused).toBeNull();
  });
});

describe("the seat lease", () => {
  // Design (contract 2800 §1, see PEER_CONTROL_RENEW_INTERVAL_MS): the control
  // proof is minted once and never re-sent, so a lapsed lease silently loses
  // the seat. Two whole renew periods must fit in one lease, so one missed
  // tick (a throttled background tab, one slow round trip) cannot let it
  // lapse. Before lengthening the interval or shortening the lease, check how
  // late a background tab's timer can fire.
  it("fits two renew periods inside one lease", () => {
    expect(PEER_CONTROL_RENEW_INTERVAL_MS).toBeGreaterThan(0);
    expect(PEER_CONTROL_RENEW_INTERVAL_MS * 2).toBeLessThanOrEqual(
      PEER_CONTROL_LEASE_SECONDS * 1000,
    );
  });
});

describe("the stable driver id", () => {
  // Design (grant 2930, see PEER_DRIVER_ID_STORAGE_KEY): the Core binds the
  // lease to the driver id, so after a reload this browser must present the
  // same id or its own lease looks like another app holding the session. The
  // id is the only seat value written to storage; the control token stays in
  // memory behind `capability.reveal()`. Anything else added to this storage
  // needs the same review as persisting a credential.
  const memoryStorage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      entries: () => Object.fromEntries(map),
    };
  };

  it("persists only the driver id and reuses it after a reload", () => {
    const storage = memoryStorage();
    expect(stablePeerDriverId(storage, () => UUID)).toBe(WEB_ID);
    expect(stablePeerDriverId(storage, () => "unused")).toBe(WEB_ID);
    expect(storage.entries()).toEqual({ [PEER_DRIVER_ID_STORAGE_KEY]: WEB_ID });
  });
});
