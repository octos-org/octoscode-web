import { describe, expect, it, vi } from "vitest";
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
import {
  ExternalDriverRefusalError,
  type DriverAcquireView,
  type ExternalDriverCommands,
  type PeerDispatchReceiptView,
} from "@octos-org/octoscode-client/external-driver";
import type {
  PeerDispatchParams,
  PeerDispatchSeed,
} from "../control/peer-dispatch-commands.ts";
import { SessionPeerCoordinator } from "./session-peer-coordinator.ts";
import type { PeerOpenRequest } from "../peers/peer-manager.ts";
import type { DriverInventoryState } from "./driver-discovery.ts";
import {
  SessionRecordManager,
  type SessionRecord,
} from "./session-record-manager.ts";
import type { ActiveSessionAuthority } from "./active-session-runtime.ts";
import type { SessionRuntimeScope } from "./session-scope.ts";
import { peerAdoptSeam, performPeerDispatch } from "./use-octos-session.ts";

/**
 * P1 INTEGRATION (grant 2845): the two halves of P1 were built in parallel and
 * had never been run together.
 *
 *   • SUPPLIER — `performPeerDispatch` + `peerAdoptSeam` (use-octos-session.ts)
 *     turns a held fence + lane choice into ONE `peer/dispatch` frame, then
 *     installs the SERVER-adopted identity by resolving `adoptOnRecord` BY NAME
 *     off the record manager.
 *   • ADOPT — `SessionRecordManager.adoptOnRecord` installs the DECLARED
 *     adopted identity (no `session/open` staging-id equality assert).
 *
 * These drive the REAL supplier through the REAL `SessionRecordManager` (and,
 * for the last two cases, the REAL `SessionPeerCoordinator`), so the seam, the
 * receipt ids, the installed record and the live adopted turn are asserted end
 * to end. FAIL-CLOSED is part of the contract: a refused dispatch must leave
 * `adoptOnRecord` untouched — never a fabricated record for an unadopted id.
 */

const ADOPTED = "coding:local:tui#peer-alpha";
const TURN = "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01";
const ENDPOINT = "ws://server.test/ui";
const PROFILE = "coding";
const WORKSPACE = "/srv/project";
const MASTER = "coding:local:tui";
const OPERATION = "op-dispatch-1";
const KEYS = ["lane-primary", "lane-review"];

const ACQUIRE: DriverAcquireView = {
  capability: { driverId: "drv-1", epoch: 7, reveal: () => "tok-secret" },
  binding: {
    driverId: "drv-1",
    epoch: 7,
    revision: 12,
    leaseExpiresAtMs: 1_700_000_000_000,
    acceptedWork: [OPERATION],
  },
  pendingWork: [OPERATION],
  recovery: "none" as const,
};

const SEED: PeerDispatchSeed = {
  brief: "Review this",
  slug: "review",
  prompt: "kickoff text",
};

/** Admitting caps: the negotiation both peer commands AND the control seat need. */
const CAPS: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.SESSION_OPEN,
    CORE_UI_METHODS.SESSION_HYDRATE,
    CORE_UI_METHODS.TURN_START,
    CORE_UI_METHODS.TURN_INTERRUPT,
    PEER_METHODS.PREPARE,
    PEER_METHODS.GATHER,
    "peer/control",
  ],
  supported_notifications: [PEER_METHODS.STAGED, PEER_METHODS.CLOSED],
  supported_features: ["external_driver_v1"],
};

const COMPLETE_EXTERNAL: DriverInventoryState = {
  kind: "complete",
  snapshot: "snap-1",
  observedRevision: "3",
  rows: [{ operationId: OPERATION, slug: "peer-pane", lifecycle: "open" }],
  completedAtMs: 1_700_000_000_000,
  disclosure: { mode: "external", recovery: "none", binding: null },
};

function hydrate(
  sessionId: string,
  over: Partial<SessionHydrateResult> = {},
): SessionHydrateResult {
  return {
    session_id: sessionId,
    cursor: { stream: sessionId, seq: 1 },
    turns: [],
    ...over,
  };
}

/** The accepted `peer/dispatch` receipt (server-adopted identity). */
function receipt(
  over: Partial<PeerDispatchReceiptView> = {},
): PeerDispatchReceiptView {
  return {
    operationId: OPERATION,
    state: "accepted",
    model: "lane-review",
    modelLane: "lane-review",
    workspaceRoot: WORKSPACE,
    scopedGoal: null,
    adoptedTurnId: TURN,
    adoptedSessionId: ADOPTED,
    slug: "review",
    duplicate: false,
    acceptedAtMs: 1_700_000_000_000,
    payloadDigest: "digest-1",
    ...over,
  };
}

/** Minimal pooled transport, mirroring session-record-manager-adopt.test.ts. */
class PooledClient {
  status: ConnectionStatus = "connected";
  readonly opens: SessionOpenParams[] = [];
  readonly hydrates: SessionHydrateParams[] = [];
  readonly notifications = new Set<(n: RpcNotification) => void>();
  readonly statuses = new Set<(status: ConnectionStatus) => void>();
  openedFor: (sessionId: string) => SessionOpened = (sessionId) => ({
    session_id: sessionId,
    active_profile_id: PROFILE,
    workspace_root: WORKSPACE,
    capabilities: CAPS,
  });
  hydratedFor: (sessionId: string) => SessionHydrateResult = hydrate;
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
    return { capabilities: CAPS };
  }
  async openSession(params: SessionOpenParams): Promise<SessionOpenResult> {
    this.opens.push(params);
    return { opened: this.openedFor(params.session_id) };
  }
  async hydrateSession(
    params: SessionHydrateParams,
  ): Promise<SessionHydrateResult> {
    this.hydrates.push(params);
    return this.hydratedFor(params.session_id);
  }
  async startTurn(): Promise<unknown> {
    return {};
  }
  async interruptTurn(): Promise<unknown> {
    return {};
  }
  /** The coordinator's own command factory (real, over a null RPC port). */
  async peerCommands(
    sessionId: string,
    profileId: string,
    capabilities: UiProtocolCapabilities,
    authority: object = this,
  ): Promise<PeerCommands> {
    return createPeerCommands(
      { request: async () => null },
      { sessionId, profileId, authority },
      capabilities,
    );
  }
}

/** The REAL manager on the pooled fake (same options the adopt suite uses). */
function harness(client = new PooledClient()) {
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
    controllerDependencies: (recordScope, recordClient) => ({
      client: () => recordClient() as never,
      sessionId: () => recordScope.sessionId,
      canEnqueue: () => true,
      canStart: () => true,
      canInterrupt: () => true,
      setTimeline: () => undefined,
      setConnectionError: () => undefined,
    }),
  });
  return { manager, client };
}

/** The scope the SUPPLIER builds from the receipt's adopted id + workspace. */
const activeScope = (
  adoptedSessionId: string,
  workspaceRoot: string,
): SessionRuntimeScope => ({
  endpoint: ENDPOINT,
  workspaceRoot,
  profileId: PROFILE,
  sessionId: adoptedSessionId,
  authorityEpoch: 1,
});

/** A leaf answering ONE `peer/dispatch` with the given receipt (or throwing). */
function leaf(answer: PeerDispatchReceiptView | Error) {
  const peerDispatch = vi.fn(async (_params: PeerDispatchParams) => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return {
    commands: { peerDispatch } as Pick<ExternalDriverCommands, "peerDispatch">,
    peerDispatch,
  };
}

describe("P1 integration — supplier x adoptOnRecord (real manager, real seam)", () => {
  it("installs the adopted identity end to end from ONE accepted receipt", async () => {
    const h = harness();
    // Spy FIRST: `peerAdoptSeam` reads `manager.adoptOnRecord` by name at
    // resolution time, so the seam must capture the spied own-property.
    const adoptOnRecord = vi.spyOn(h.manager, "adoptOnRecord");
    // The seam resolves the manager's OWN method by name — that IS the meet.
    const adopt = peerAdoptSeam<SessionRecord<PooledClient>>(h.manager);
    expect(adopt).not.toBeNull();
    const { commands, peerDispatch } = leaf(receipt());
    const scope = vi.fn(activeScope);

    const outcome = await performPeerDispatch<SessionRecord<PooledClient>>({
      commands,
      acquire: ACQUIRE,
      laneKeys: KEYS,
      laneKey: "lane-review",
      operationId: OPERATION,
      seed: SEED,
      adopt,
      scope,
    });

    expect(outcome.kind).toBe("accepted");
    if (outcome.kind !== "accepted") return;

    // The frame carried the held fence, the minted operationId and the
    // REQUESTED lane key — never a locally resolved model.
    expect(peerDispatch).toHaveBeenCalledTimes(1);
    expect(peerDispatch.mock.calls[0]?.[0]).toMatchObject({
      driverId: "drv-1",
      epoch: 7,
      controlToken: "tok-secret",
      operationId: OPERATION,
      model: "lane-review",
    });

    // The supplier fed the ADOPT half the RECEIPT's identity + the live scope.
    expect(scope).toHaveBeenCalledWith(ADOPTED, WORKSPACE);
    expect(adoptOnRecord).toHaveBeenCalledTimes(1);
    expect(adoptOnRecord.mock.calls[0]?.[0]).toEqual({
      adoptedSessionId: ADOPTED,
      adoptedTurnId: TURN,
      scope: activeScope(ADOPTED, WORKSPACE),
    });

    // The record IS installed, ready, and opened ONLY on the adopted id.
    const record = outcome.record;
    expect(h.manager.records()).toEqual([record]);
    expect(h.manager.get(record.scope)).toBe(record);
    expect(record.scope.sessionId).toBe(ADOPTED);
    expect(record.closed).toBe(false);
    expect(record.runtime.getSnapshot()).toMatchObject({
      phase: "ready",
      status: "connected",
    });
    expect(record.runtime.getSnapshot().session?.sessionId).toBe(ADOPTED);
    expect(h.client.opens.map((params) => params.session_id)).toEqual([
      ADOPTED,
    ]);

    // Core started the turn BEFORE this client opened the record: it is the
    // LIVE turn, never a queue head the ready drain would resend.
    expect(record.controller.backgroundHandoffTurn()).toEqual({
      turnId: TURN,
      state: "running",
    });
    expect(record.controller.queueSnapshot().active).toBeNull();
  });

  it("resolves a duplicate:true replay to the SAME record with no second open", async () => {
    const h = harness();
    const adoptOnRecord = vi.spyOn(h.manager, "adoptOnRecord");
    const adopt = peerAdoptSeam<SessionRecord<PooledClient>>(h.manager);
    const run = (duplicate: boolean) => {
      const { commands } = leaf(receipt({ duplicate }));
      return performPeerDispatch<SessionRecord<PooledClient>>({
        commands,
        acquire: ACQUIRE,
        laneKeys: KEYS,
        laneKey: "lane-review",
        operationId: OPERATION,
        seed: SEED,
        adopt,
        scope: activeScope,
      });
    };

    const first = await run(false);
    const second = await run(true);

    expect(first.kind).toBe("accepted");
    expect(second.kind).toBe("accepted");
    if (first.kind !== "accepted" || second.kind !== "accepted") return;
    expect(second.record).toBe(first.record);
    expect(adoptOnRecord).toHaveBeenCalledTimes(2);
    // Idempotent: one row, one open, one hydrate — the adopted turn still live.
    expect(h.manager.records()).toHaveLength(1);
    expect(h.client.opens).toHaveLength(1);
    expect(h.client.hydrates).toHaveLength(1);
    expect(second.record.controller.backgroundHandoffTurn()).toEqual({
      turnId: TURN,
      state: "running",
    });
    expect(second.record.controller.queueSnapshot().active).toBeNull();
  });

  it("refuses an unknown lane typed and never calls adoptOnRecord", async () => {
    const h = harness();
    const adopt = peerAdoptSeam<SessionRecord<PooledClient>>(h.manager);
    const adoptOnRecord = vi.spyOn(h.manager, "adoptOnRecord");
    const { commands, peerDispatch } = leaf(receipt());

    const outcome = await performPeerDispatch<SessionRecord<PooledClient>>({
      commands,
      acquire: ACQUIRE,
      laneKeys: KEYS,
      laneKey: "glm-5.3",
      operationId: OPERATION,
      seed: SEED,
      adopt,
      scope: activeScope,
    });

    expect(outcome).toEqual({
      kind: "refused",
      refusalKind: "driver_model_unavailable",
    });
    expect(peerDispatch).not.toHaveBeenCalled();
    expect(adoptOnRecord).not.toHaveBeenCalled();
    expect(h.manager.records()).toHaveLength(0);
    expect(h.client.opens).toHaveLength(0);
  });

  it("refuses a missing control fence typed and never calls adoptOnRecord", async () => {
    const h = harness();
    const adopt = peerAdoptSeam<SessionRecord<PooledClient>>(h.manager);
    const adoptOnRecord = vi.spyOn(h.manager, "adoptOnRecord");
    const { commands, peerDispatch } = leaf(receipt());

    const outcome = await performPeerDispatch<SessionRecord<PooledClient>>({
      commands,
      acquire: null,
      laneKeys: KEYS,
      laneKey: "lane-review",
      operationId: OPERATION,
      seed: SEED,
      adopt,
      scope: activeScope,
    });

    expect(outcome).toEqual({
      kind: "refused",
      refusalKind: "driver_fence_stale",
    });
    expect(peerDispatch).not.toHaveBeenCalled();
    expect(adoptOnRecord).not.toHaveBeenCalled();
    expect(h.manager.records()).toHaveLength(0);
  });

  it("keeps a typed leaf refusal typed and never calls adoptOnRecord", async () => {
    const h = harness();
    const adopt = peerAdoptSeam<SessionRecord<PooledClient>>(h.manager);
    const adoptOnRecord = vi.spyOn(h.manager, "adoptOnRecord");
    const { commands, peerDispatch } = leaf(
      new ExternalDriverRefusalError("peer/dispatch", "driver_fence_stale"),
    );

    const outcome = await performPeerDispatch<SessionRecord<PooledClient>>({
      commands,
      acquire: ACQUIRE,
      laneKeys: KEYS,
      laneKey: "lane-review",
      operationId: OPERATION,
      seed: SEED,
      adopt,
      scope: activeScope,
    });

    expect(outcome).toEqual({
      kind: "refused",
      refusalKind: "driver_fence_stale",
    });
    // The frame WAS sent (lane and fence admitted) and the server refused it:
    // nothing was adopted, so no record is fabricated.
    expect(peerDispatch).toHaveBeenCalledTimes(1);
    expect(adoptOnRecord).not.toHaveBeenCalled();
    expect(h.manager.records()).toHaveLength(0);
  });
});

/**
 * The full staging path: the REAL coordinator stages a peer through
 * `dispatchPeer`, which is the REAL `performPeerDispatch` bound to
 * `peerAdoptSeam(manager)` — the same composition use-octos-session.ts wires —
 * and the row resolves off the SERVER-adopted identity.
 */
function staged() {
  return {
    method: PEER_METHODS.STAGED,
    params: {
      session_id: MASTER,
      profile_id: PROFILE,
      slug: "review",
      topic: "peer-review",
      cwd: WORKSPACE,
      brief_path: `/peers/review/brief.md`,
      brief: "Review this",
    },
  };
}

function coordinatorHarness(
  options: { laneKey?: string; answer?: PeerDispatchReceiptView | Error } = {},
) {
  const client = new PooledClient();
  const h = harness(client);
  const master = h.manager.ensure({
    endpoint: ENDPOINT,
    workspaceRoot: WORKSPACE,
    profileId: PROFILE,
    sessionId: MASTER,
    authorityEpoch: 1,
  });
  // The control seat is `ready` only with admitting caps AND an observed
  // external binding (deriveControlReadiness); project both onto the record.
  const authority: ActiveSessionAuthority<PooledClient> = {
    generation: 1,
    client,
    config: {
      endpoint: ENDPOINT,
      token: "",
      sessionId: MASTER,
      profileId: PROFILE,
      cwd: WORKSPACE,
    },
    sessionId: MASTER,
    profileId: PROFILE,
    cwd: WORKSPACE,
    capabilities: CAPS,
    opened: null,
  };
  vi.spyOn(master.runtime, "currentAuthority").mockReturnValue(authority);
  master.driverInventory = COMPLETE_EXTERNAL;

  const { commands, peerDispatch } = leaf(options.answer ?? receipt());
  const requests: PeerOpenRequest[] = [];
  const coordinator = new SessionPeerCoordinator<
    PooledClient,
    SessionRecord<PooledClient>
  >({
    isRetained: () => true,
    subscribeRecords: h.manager.subscribe,
    openPeer: async (request) => {
      requests.push(request);
      throw new Error("session/open must not be used while the seat is ready");
    },
    closePeer: () => undefined,
    dispatchPeer: async (request, operationId) => {
      requests.push(request);
      const outcome = await performPeerDispatch<SessionRecord<PooledClient>>({
        commands,
        acquire: ACQUIRE,
        laneKeys: KEYS,
        laneKey: options.laneKey ?? "lane-review",
        operationId,
        seed: {
          brief: request.brief,
          slug: request.slug,
          prompt: request.prompt,
        },
        adopt: peerAdoptSeam<SessionRecord<PooledClient>>(h.manager),
        scope: (adoptedSessionId, workspaceRoot) => ({
          endpoint: master.scope.endpoint,
          workspaceRoot: workspaceRoot || master.scope.workspaceRoot,
          profileId: request.profileId,
          sessionId: adoptedSessionId,
          authorityEpoch: master.scope.authorityEpoch,
        }),
      });
      if (outcome.kind === "refused")
        throw new ExternalDriverRefusalError(
          "peer/dispatch",
          outcome.refusalKind,
        );
      if (outcome.kind === "unknown")
        throw new Error("Peer dispatch could not be confirmed.");
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
  const peerManager = coordinator.bind(master);
  return {
    // `recordManager` keeps the SessionRecordManager; `...h` would otherwise
    // publish `manager` under the coordinator's peer-roster facade.
    ...h,
    master,
    coordinator,
    peerManager,
    requests,
    peerDispatch,
    send: coordinator.notificationObserver(client),
  };
}

describe("P1 integration — real coordinator stages through the real adopt half", () => {
  it("resolves the started row off the ADOPTED id installed by adoptOnRecord", async () => {
    const h = coordinatorHarness();
    expect(h.master.controlReadiness).toBe("ready");
    h.send(staged());

    await vi.waitFor(
      () => expect(h.peerManager?.snapshot().peers[0]?.status).toBe("started"),
      { interval: 5, timeout: 1500 },
    );

    // The frame went out through the leaf, not `session/open`...
    expect(h.peerDispatch).toHaveBeenCalledTimes(1);
    // ...and the REAL manager holds exactly the master + the adopted record.
    expect(h.peerManager!.snapshot().peers).toHaveLength(1);
    const installed = h.manager
      .records()
      .find((record) => record.scope.sessionId === ADOPTED);
    expect(installed).toBeDefined();
    expect(h.manager.records()).toHaveLength(2);
    expect(installed!.scope.sessionId).toBe(ADOPTED);
    expect(h.client.opens.map((params) => params.session_id)).toEqual([
      ADOPTED,
    ]);
    expect(installed!.controller.backgroundHandoffTurn()).toEqual({
      turnId: TURN,
      state: "running",
    });
  });

  it("fails the row typed on an unknown lane and installs NO record", async () => {
    const h = coordinatorHarness({ laneKey: "glm-5.3" });
    h.send(staged());

    await vi.waitFor(
      () => expect(h.peerManager?.snapshot().peers[0]?.status).toBe("failed"),
      { interval: 5, timeout: 1500 },
    );

    expect(h.peerDispatch).not.toHaveBeenCalled();
    // Only the MASTER record exists — no adopted record was installed.
    expect(h.manager.records()).toHaveLength(1);
    expect(h.manager.records()[0]?.scope.sessionId).toBe(MASTER);
    expect(h.client.opens).toHaveLength(0);
  });
});
