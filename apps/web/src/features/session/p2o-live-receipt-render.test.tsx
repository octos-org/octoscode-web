/**
 * P2o RED→GREEN (grant 3410) — an ACCEPTED `peer/dispatch` must be VISIBLE.
 *
 * LIVE run 2850h (evidence native-glm-web-pc-p4-live-2850h.md) proved the wire
 * is complete: the console sends peer/prepare + peer/dispatch, the Core ACCEPTS
 * (slug op-d32a892810a4498bb87dce92f7b7d468, adopted session
 * <master>#peer-op-…, adopted turn 01a099dd-…, model_lane glm-53) and the
 * adopted Session is opened + hydrated on the same socket. YET the panel
 * rendered NO `[data-controller-state]` element afterwards, so the operator got
 * no confirmation and the harness could not follow the peer.
 *
 * ROOT CAUSE (this file pins it): the console's observable state had NO
 * `accepted` branch. A confirmed staging settles `{kind:"dispatched"}`, which
 * `peerControllerPanelState` folded into `peerControllerStateFrom(idle)` — i.e.
 * SILENCE. Run 2850g only looked different because its settle was the `unknown`
 * class (which DOES render). The receipt slug was also dropped: the sink's
 * `dispatched` carried no adopted identity, so even a rendered row could not be
 * keyed by the receipt's OWN slug (finding 2920 (b)).
 *
 * The fixture is the TOKEN-FREE LIVE receipt from the 2850h capture, driven
 * through the REAL leaf decoder, the REAL coordinator and the REAL record
 * manager.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CORE_UI_METHODS,
  type ConfigCapabilitiesListResult,
  type ConnectionStatus,
  type RpcNotification,
  type SessionHydrateParams,
  type SessionHydrateResult,
  type SessionOpenParams,
  type SessionOpenResult,
  type SessionOpened,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  createPeerCommands,
  PEER_METHODS,
  type PeerCommands,
} from "@octos-org/octoscode-client/peers";
import type { PeerPrepareParams } from "@octos-org/octoscode-client/peer-protocol";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
  createExternalDriverCommands,
  type DriverAcquireView,
} from "@octos-org/octoscode-client/external-driver";
import {
  peerControllerPanelState,
  peerControllerRosterRows,
} from "../control/peer-controller-staging.ts";
import { PeerControllerPanel } from "../control/PeerControllerPanel.tsx";
import type { PeerLanePickerState } from "../control/peer-lane-source.ts";
import type { DriverInventoryState } from "./driver-discovery.ts";
import { SessionPeerCoordinator } from "./session-peer-coordinator.ts";
import {
  SessionRecordManager,
  type SessionRecord,
} from "./session-record-manager.ts";
import type { ActiveSessionAuthority } from "./active-session-runtime.ts";
import type { PeerOpenRequest } from "../peers/peer-manager.ts";
import {
  peerAdoptSeam,
  performPeerDispatch,
  performStagedDispatch,
} from "./use-octos-session.ts";

/** The LIVE 2850h receipt facts, verbatim (token-free). */
const LIVE = {
  operationId: "64622dcf-6677-4216-91e6-c548bdaaafbf",
  slug: "op-d32a892810a4498bb87dce92f7b7d468",
  adoptedTurnId: "01a099dd-d17b-72c0-b345-753727a676fd",
  masterSessionId: "dev:api:web-1181050b-70e9-4a36-8ec7-cd178a9b48c5",
  profileId: "dev",
  workspaceRoot:
    "/Users/ychen/.octos/outer/web-parity-20260906.504DUp/octoscode-web",
  modelLane: "glm-53",
  model: "glm-5.3",
  acceptedAtMs: 1_789_287_846_267,
} as const;
const ADOPTED = `${LIVE.masterSessionId}#peer-${LIVE.slug}`;

/** The 2850h `peer/dispatch` RESULT frame (digest redacted by the capture). */
const LIVE_WIRE = {
  operation_id: LIVE.operationId,
  state: "accepted",
  model: LIVE.model,
  model_lane: LIVE.modelLane,
  workspace_root: LIVE.workspaceRoot,
  scoped_goal: null,
  adopted_turn_id: LIVE.adoptedTurnId,
  adopted_session_id: ADOPTED,
  slug: LIVE.slug,
  duplicate: false,
  accepted_at_ms: LIVE.acceptedAtMs,
  payload_digest: "9d5f0a120548c13dbe92",
} as const;

const LIVE_CAPS: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.SESSION_OPEN,
    CORE_UI_METHODS.SESSION_HYDRATE,
    CORE_UI_METHODS.TURN_START,
    CORE_UI_METHODS.TURN_INTERRUPT,
    PEER_METHODS.PREPARE,
    PEER_METHODS.GATHER,
    EXTERNAL_DRIVER_METHODS.PEER_CONTROL,
    EXTERNAL_DRIVER_METHODS.PEER_DISPATCH,
  ],
  supported_notifications: [PEER_METHODS.STAGED, PEER_METHODS.CLOSED],
  supported_features: [EXTERNAL_DRIVER_V1_FEATURE],
};

const LIVE_LANES: PeerLanePickerState = {
  kind: "ready",
  keys: [LIVE.modelLane],
};

const ACQUIRE: DriverAcquireView = {
  capability: { driverId: "drv-1", epoch: 7, reveal: () => "tok-secret" },
  binding: {
    driverId: "drv-1",
    epoch: 7,
    revision: 12,
    leaseExpiresAtMs: 1_700_000_000_000,
    acceptedWork: [LIVE.operationId],
  },
  pendingWork: [LIVE.operationId],
  recovery: "none" as const,
};

const COMPLETE_EXTERNAL: DriverInventoryState = {
  kind: "complete",
  snapshot: "snap-1",
  observedRevision: "3",
  rows: [{ operationId: LIVE.operationId, slug: LIVE.slug, lifecycle: "open" }],
  completedAtMs: 1_700_000_000_000,
  disclosure: { mode: "external", recovery: "none", binding: null },
};

const PEER = {
  slug: "p2o-review",
  topic: "peer-p2o-review",
  profile_id: LIVE.profileId,
  cwd: LIVE.workspaceRoot,
  brief_path: "/peers/p2o-review/brief.md",
};

function hydrate(sessionId: string): SessionHydrateResult {
  return {
    session_id: sessionId,
    cursor: { stream: sessionId, seq: 1 },
    turns: [],
  };
}

/** Minimal pooled transport, mirroring peer-dispatch-adopt-integration.test.ts. */
class PooledClient {
  status: ConnectionStatus = "connected";
  readonly opens: SessionOpenParams[] = [];
  readonly hydrates: SessionHydrateParams[] = [];
  readonly notifications = new Set<(n: RpcNotification) => void>();
  readonly statuses = new Set<(status: ConnectionStatus) => void>();
  async connect() {
    this.setStatus("connected");
  }
  disconnect() {
    this.setStatus("disconnected");
  }
  setStatus(status: ConnectionStatus) {
    this.status = status;
    for (const listener of Array.from(this.statuses)) listener(status);
  }
  subscribeStatus(listener: (status: ConnectionStatus) => void) {
    this.statuses.add(listener);
    listener(this.status);
    return () => this.statuses.delete(listener);
  }
  subscribeErrors() {
    return () => undefined;
  }
  subscribeNotifications(listener: (n: RpcNotification) => void) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }
  async listConfigCapabilities(): Promise<ConfigCapabilitiesListResult> {
    return { capabilities: LIVE_CAPS };
  }
  async openSession(params: SessionOpenParams): Promise<SessionOpenResult> {
    this.opens.push(params);
    return {
      opened: {
        session_id: params.session_id,
        active_profile_id: LIVE.profileId,
        workspace_root: LIVE.workspaceRoot,
        capabilities: LIVE_CAPS,
      } satisfies SessionOpened,
    };
  }
  async hydrateSession(
    params: SessionHydrateParams,
  ): Promise<SessionHydrateResult> {
    this.hydrates.push(params);
    return hydrate(params.session_id);
  }
  async startTurn(): Promise<unknown> {
    return {};
  }
  async interruptTurn(): Promise<unknown> {
    return {};
  }
  /** The real peer commands over an rpc that answers `peer/prepare`. */
  async peerCommands(
    sessionId: string,
    profileId: string,
    capabilities: UiProtocolCapabilities,
    authority: object = this,
  ): Promise<PeerCommands> {
    return createPeerCommands(
      {
        request: async (method: string) => {
          if (method !== PEER_METHODS.PREPARE)
            throw new Error(`unexpected peer rpc: ${method}`);
          return { ...PEER, peers: [PEER] };
        },
      },
      { sessionId, profileId, authority },
      capabilities,
    );
  }
}

/** The REAL leaf over the LIVE wire JSON: the receipt crosses the REAL fences. */
function liveLeaf() {
  // `createExternalDriverCommands` is the package's PUBLIC factory (the private
  // `createExternalDriverPeerCommands` leaf is not re-exported). It composes the
  // peer leaf over the same control context, so the LIVE wire JSON still crosses
  // the REAL decode fence (identity + lane echo + request-derived operation id).
  return createExternalDriverCommands(
    {
      request: async (_method: string, params: unknown) => ({
        ...LIVE_WIRE,
        // The Core echoes the caller's idempotency key verbatim.
        operation_id: (params as { operation_id: string }).operation_id,
      }),
    },
    LIVE.masterSessionId,
    LIVE_CAPS,
    { profileId: LIVE.profileId },
  );
}

function harness() {
  const client = new PooledClient();
  const manager = new SessionRecordManager<PooledClient>({
    pooledClient: () => client,
    authorityEpoch: () => 1,
    onSelectedEvent: () => undefined,
    onSelectedSnapshot: () => undefined,
    onBackgroundActivity: () => undefined,
    cursorFor: () => undefined,
    validateServerCapabilities: (value) => {
      if (!value) throw new Error("missing capabilities");
    },
    validateSessionCapabilities: (value) => {
      if (!value) throw new Error("missing capabilities");
    },
    controllerDependencies: (scope, recordClient) => ({
      client: () => recordClient() as never,
      sessionId: () => scope.sessionId,
      canEnqueue: () => true,
      canStart: () => true,
      canInterrupt: () => true,
      setTimeline: () => undefined,
      setConnectionError: () => undefined,
    }),
  });
  const master = manager.ensure({
    endpoint: "ws://server.test/ui",
    workspaceRoot: LIVE.workspaceRoot,
    profileId: LIVE.profileId,
    sessionId: LIVE.masterSessionId,
    authorityEpoch: 1,
  });
  const authority: ActiveSessionAuthority<PooledClient> = {
    generation: 1,
    client,
    config: {
      endpoint: "ws://server.test/ui",
      token: "",
      sessionId: LIVE.masterSessionId,
      profileId: LIVE.profileId,
      cwd: LIVE.workspaceRoot,
    },
    sessionId: LIVE.masterSessionId,
    profileId: LIVE.profileId,
    cwd: LIVE.workspaceRoot,
    capabilities: LIVE_CAPS,
    opened: null,
  };
  vi.spyOn(master.runtime, "currentAuthority").mockReturnValue(authority);
  master.driverInventory = COMPLETE_EXTERNAL;
  const leaf = liveLeaf();
  const requests: PeerOpenRequest[] = [];
  const coordinator = new SessionPeerCoordinator<
    PooledClient,
    SessionRecord<PooledClient>
  >({
    isRetained: (record) => manager.get(record.scope) === record,
    subscribeRecords: manager.subscribe,
    openPeer: async () => {
      throw new Error("session/open must not be used while the seat is ready");
    },
    closePeer: () => undefined,
    dispatchPeer: async (request, _operationId) => {
      requests.push(request);
      const outcome = await performPeerDispatch<SessionRecord<PooledClient>>({
        commands: leaf,
        acquire: ACQUIRE,
        laneKeys: [LIVE.modelLane],
        laneKey: LIVE.modelLane,
        operationId: LIVE.operationId,
        seed: {
          brief: request.brief,
          slug: request.slug,
          prompt: request.prompt,
        },
        adopt: peerAdoptSeam<SessionRecord<PooledClient>>(manager),
        scope: (adoptedSessionId, workspaceRoot) => ({
          endpoint: master.scope.endpoint,
          workspaceRoot: workspaceRoot || master.scope.workspaceRoot,
          profileId: request.profileId,
          sessionId: adoptedSessionId,
          authorityEpoch: master.scope.authorityEpoch,
        }),
      });
      if (outcome.kind !== "accepted")
        throw new Error(`peer dispatch did not confirm: ${outcome.kind}`);
      return {
        record: outcome.record,
        operationId: outcome.receipt.operationId,
        adoptedSessionId: outcome.receipt.adoptedSessionId,
        adoptedTurnId: outcome.receipt.adoptedTurnId,
        slug: outcome.receipt.slug,
        duplicate: outcome.receipt.duplicate,
      };
    },
  });
  coordinator.setTransport(client);
  const lazy = coordinator.bind(master)!;
  manager.select(master.scope);
  return { client, manager, master, coordinator, lazy, requests, leaf };
}

async function flush() {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

describe("P2o — a confirmed staging carries the ADOPTED receipt slug", () => {
  it("settles `dispatched` with the row's receipt slug + accepted operation id", async () => {
    const kickoff = vi.fn(async (_params: PeerPrepareParams) => ({
      peers: [],
    }));
    const selectLane = vi.fn();
    const outcome = await performStagedDispatch({
      manager: {
        kickoff,
        // After a confirmed start the manager's row IS the server-adopted one
        // (peer-manager.ts stamps `outcome.slug`/`outcome.operationId`), so the
        // sink must read them back instead of discarding the identity.
        getSnapshot: () => ({
          prepareError: null,
          peers: [
            {
              slug: LIVE.slug,
              status: "started",
              operationId: LIVE.operationId,
            },
          ],
        }),
      },
      laneKey: LIVE.modelLane,
      brief: "Reply with the single word READY and stop",
      title: "p2o",
      selectLane,
    });
    expect(selectLane).toHaveBeenCalledWith(LIVE.modelLane);
    expect(kickoff).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      kind: "dispatched",
      slug: LIVE.slug,
      operationId: LIVE.operationId,
    });
  });

  it("keeps a `session/open` settle identity-less (no accepted row without a receipt)", async () => {
    const outcome = await performStagedDispatch({
      manager: {
        kickoff: async () => ({ peers: [] }),
        // The legacy arm stamps `{status:"started"}` with NO operationId.
        getSnapshot: () => ({
          prepareError: null,
          peers: [{ slug: "review", status: "started", operationId: null }],
        }),
      },
      laneKey: LIVE.modelLane,
      brief: "b",
      title: "",
      selectLane: () => undefined,
    });
    expect(outcome).toEqual({ kind: "dispatched" });
  });
});

describe("P2o — an accepted dispatch renders on the master console", () => {
  it("folds a confirmed `dispatched` sink into a rendered `accepted` state", () => {
    // The LIVE defect: this returned `idle` (SILENCE) for a real acceptance.
    expect(
      peerControllerPanelState({
        control: { kind: "idle" },
        dispatchBusy: false,
        dispatchFailed: false,
        dispatchSink: {
          kind: "dispatched",
          slug: LIVE.slug,
          operationId: LIVE.operationId,
        },
      }),
    ).toEqual({
      kind: "accepted",
      slug: LIVE.slug,
      operationId: LIVE.operationId,
    });
  });

  it("an UNCONFIRMED staging still renders the bounded `unknown` row", () => {
    expect(
      peerControllerPanelState({
        control: { kind: "idle" },
        dispatchBusy: false,
        dispatchFailed: false,
        dispatchSink: { kind: "unknown", reason: "kickoff-mismatch" },
      }),
    ).toEqual({
      kind: "unknown",
      source: "dispatch",
      reason: "kickoff-mismatch",
    });
  });

  it("renders the accepted row with the receipt slug, never raw server copy", () => {
    const html = renderToStaticMarkup(
      <PeerControllerPanel
        capabilities={LIVE_CAPS}
        lanePicker={LIVE_LANES}
        seatHeld={true}
        binding={null}
        roster={[
          {
            slug: LIVE.slug,
            operationId: LIVE.operationId,
            turnId: LIVE.adoptedTurnId,
            // P2p (task 3530 §2): the row's activity axis is now required.
            activity: "live",
          },
        ]}
        state={{
          kind: "accepted",
          slug: LIVE.slug,
          operationId: LIVE.operationId,
        }}
      />,
    );
    expect(html).toContain('data-controller-state="accepted"');
    expect(html).toContain(`data-accepted-slug="${LIVE.slug}"`);
  });
});

describe("P2o — LIVE receipt end-to-end: master stays selected, row keys on the slug", () => {
  it("renders the accepted row on the MASTER console after ONE accepted dispatch", async () => {
    const h = harness();
    await flush();
    const sink = await performStagedDispatch({
      manager: h.lazy,
      laneKey: LIVE.modelLane,
      brief: "Reply with the single word READY and stop",
      title: "p2o",
      selectLane: () => undefined,
    });

    // (1) The console's OWN sink carries the receipt's adopted identity.
    expect(sink.kind).toBe("dispatched");
    expect(sink.kind === "dispatched" ? sink.slug : null).toBe(LIVE.slug);
    expect(h.requests).toHaveLength(1);

    // (2) The MASTER is still the SELECTED record: adopting the peer must never
    //     make the adopted Session the active view (the live top hypothesis).
    expect(h.manager.selected()).toBe(h.master);
    expect(
      h.manager.records().find((r) => r.scope.sessionId === ADOPTED),
    ).toBeDefined();

    // (3) The console's roster row is keyed by the receipt's OWN slug (2920 (b)).
    const rows = peerControllerRosterRows(h.lazy.snapshot().peers);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slug).toBe(LIVE.slug);
    expect(rows[0]?.operationId).toBe(LIVE.operationId);

    // (4) The panel RENDERS that accepted state on the master console.
    const state = peerControllerPanelState({
      control: { kind: "idle" },
      dispatchBusy: false,
      dispatchFailed: false,
      dispatchSink: sink,
    });
    const html = renderToStaticMarkup(
      <PeerControllerPanel
        capabilities={LIVE_CAPS}
        lanePicker={LIVE_LANES}
        seatHeld={true}
        binding={null}
        roster={rows}
        state={state}
      />,
    );
    expect(html).toContain('data-controller-state="accepted"');
    expect(html).toContain(`data-peer-row="${LIVE.slug}"`);
    expect(html).not.toContain('data-controller-state="unknown"');
  });
});
