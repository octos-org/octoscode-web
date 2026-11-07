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
import { PEER_METHODS } from "@octos-org/octoscode-client/peers";
import {
  ExternalDriverRefusalError,
  type DriverAcquireView,
  type ExternalDriverCommands,
  type PeerDispatchReceiptView,
} from "@octos-org/octoscode-client/external-driver";
import type { PeerDispatchParams } from "../control/peer-dispatch-commands.ts";
import { LazySessionRecordManager } from "./lazy-session-record-manager.ts";
import {
  SessionRecordManager,
  type SessionRecord,
} from "./session-record-manager.ts";
import type { SessionRuntimeScope } from "./session-scope.ts";
import {
  peerAdoptSeamForRecord,
  performPeerDispatch,
} from "./use-octos-session.ts";

/**
 * ONE `peer/dispatch` through the composition the hook wires: the LAZY record
 * facade, `peerAdoptSeamForRecord(facade, master)`, `performPeerDispatch` and
 * the engine's `adoptOnRecord`, over a recording client. The Fleet e2e drives
 * the same chain in a browser; these cases pin what it cannot see.
 *
 * Why it is shaped this way (P1 grant 2810, P2j grant 3120, P2L grant 3220):
 * the record installed is the SERVER-adopted identity from the receipt, never
 * one the client minted, and the adopted turn is already running in Core, so
 * it must not become a queue head the ready drain would send again. A replayed
 * receipt is idempotent. Anything that fails — an unadvertised lane, no held
 * fence, a refusal from Core, or a master the facade does not retain — adopts
 * nothing and fabricates no record. Before changing the seam, check that a
 * foreign record still resolves NULL: adopting it would attach a peer to the
 * wrong owner.
 */

const MASTER = "coding:local:tui";
const ADOPTED = "coding:local:tui#peer-alpha";
const TURN = "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01";
const ENDPOINT = "ws://server.test/ui";
const PROFILE = "coding";
const WORKSPACE = "/srv/project";
const OPERATION = "op-dispatch-1";
const KEYS = ["lane-primary", "lane-review"];

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

/** Minimal pooled transport: the SAME socket the dispatch receipt arrived on. */
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
    return { capabilities: CAPS };
  }
  async openSession(params: SessionOpenParams): Promise<SessionOpenResult> {
    this.opens.push(params);
    return {
      opened: {
        session_id: params.session_id,
        active_profile_id: PROFILE,
        workspace_root: WORKSPACE,
        capabilities: CAPS,
      } satisfies SessionOpened,
    };
  }
  async hydrateSession(
    params: SessionHydrateParams,
  ): Promise<SessionHydrateResult> {
    this.hydrates.push(params);
    return {
      session_id: params.session_id,
      cursor: { stream: params.session_id, seq: 1 },
      turns: [],
    };
  }
  async startTurn(): Promise<unknown> {
    return {};
  }
  async interruptTurn(): Promise<unknown> {
    return {};
  }
}

/** The REAL lazy facade over the REAL engine, with the master Session open. */
async function harness() {
  const client = new PooledClient();
  const manager = new LazySessionRecordManager<PooledClient>(
    {
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
      controllerDependencies: (scope, getClient) => ({
        client: () => getClient() as never,
        sessionId: () => scope.sessionId,
        canEnqueue: () => true,
        canStart: () => true,
        canInterrupt: () => true,
        setTimeline: () => undefined,
        setConnectionError: () => undefined,
      }),
    },
    async () =>
      (
        options: ConstructorParameters<
          typeof SessionRecordManager<PooledClient>
        >[0],
      ) =>
        new SessionRecordManager(options),
  );
  const master = await manager.openOnRecord(
    {
      endpoint: ENDPOINT,
      token: "",
      profileId: PROFILE,
      cwd: WORKSPACE,
      sessionId: MASTER,
    },
    client,
    new AbortController().signal,
  );
  // `peerAdoptSeamForRecord` reads `adoptOnRecord` off the engine by name, so
  // the spy must be in place before the seam is resolved.
  const adoptOnRecord = vi.spyOn(manager.engineFor(master)!, "adoptOnRecord");
  return { client, manager, master, adoptOnRecord };
}

/** The scope the hook builds from the receipt's adopted id + workspace. */
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

/** ONE dispatch through the hook's seam; the leaf answers `answer`. */
async function dispatch(
  h: Awaited<ReturnType<typeof harness>>,
  answer: PeerDispatchReceiptView | Error = receipt(),
  plan: {
    laneKey?: string;
    acquire?: DriverAcquireView | null;
    owner?: SessionRecord<PooledClient>;
  } = {},
) {
  const peerDispatch = vi.fn(async (_params: PeerDispatchParams) => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const scope = vi.fn(activeScope);
  const outcome = await performPeerDispatch<SessionRecord<PooledClient>>({
    commands: { peerDispatch } as Pick<ExternalDriverCommands, "peerDispatch">,
    acquire: plan.acquire === undefined ? ACQUIRE : plan.acquire,
    laneKeys: KEYS,
    laneKey: plan.laneKey ?? "lane-review",
    operationId: OPERATION,
    seed: { brief: "Review this", slug: "review", prompt: "kickoff text" },
    adopt: await peerAdoptSeamForRecord<
      SessionRecord<PooledClient>,
      SessionRecord<PooledClient>
    >(h.manager, plan.owner ?? h.master),
    scope,
  });
  return { outcome, peerDispatch, scope };
}

describe("peer/dispatch adopts the server's identity through the lazy facade", () => {
  it("installs the adopted record from ONE accepted receipt, its turn live and never resent", async () => {
    const h = await harness();
    const { outcome, peerDispatch, scope } = await dispatch(h);
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

    // The adopt half got the RECEIPT's identity and the live scope.
    expect(scope).toHaveBeenCalledWith(ADOPTED, WORKSPACE);
    expect(h.adoptOnRecord).toHaveBeenCalledTimes(1);
    expect(h.adoptOnRecord.mock.calls[0]?.[0]).toEqual({
      adoptedSessionId: ADOPTED,
      adoptedTurnId: TURN,
      scope: activeScope(ADOPTED, WORKSPACE),
    });

    // The record is installed, ready, and opened ONLY on the adopted id.
    const record = outcome.record;
    expect(h.manager.records()).toEqual([h.master, record]);
    expect(record.scope.sessionId).toBe(ADOPTED);
    expect(record.closed).toBe(false);
    expect(record.runtime.getSnapshot()).toMatchObject({
      phase: "ready",
      status: "connected",
    });
    expect(record.runtime.getSnapshot().session?.sessionId).toBe(ADOPTED);
    expect(h.client.opens.map((params) => params.session_id)).toEqual([
      MASTER,
      ADOPTED,
    ]);

    // Core started the turn BEFORE this client opened the record: it is the
    // LIVE turn, never a queue head the ready drain would resend.
    expect(record.controller.backgroundHandoffTurn()).toEqual({
      turnId: TURN,
      state: "running",
    });
    expect(record.controller.queueSnapshot().active).toBeNull();
    h.manager.retireAll();
  });

  it("resolves a duplicate:true replay to the SAME record with no second open", async () => {
    const h = await harness();
    const first = await dispatch(h, receipt({ duplicate: false }));
    const second = await dispatch(h, receipt({ duplicate: true }));

    expect(first.outcome.kind).toBe("accepted");
    expect(second.outcome.kind).toBe("accepted");
    if (first.outcome.kind !== "accepted" || second.outcome.kind !== "accepted")
      return;
    expect(second.outcome.record).toBe(first.outcome.record);
    expect(h.adoptOnRecord).toHaveBeenCalledTimes(2);
    // Idempotent: one adopted row, one open, one hydrate — the turn still live.
    expect(h.manager.records()).toHaveLength(2);
    expect(h.client.opens.map((params) => params.session_id)).toEqual([
      MASTER,
      ADOPTED,
    ]);
    expect(
      h.client.hydrates.filter((params) => params.session_id === ADOPTED),
    ).toHaveLength(1);
    expect(second.outcome.record.controller.backgroundHandoffTurn()).toEqual({
      turnId: TURN,
      state: "running",
    });
    expect(second.outcome.record.controller.queueSnapshot().active).toBeNull();
    h.manager.retireAll();
  });

  it.each([
    [
      "an unadvertised lane",
      { laneKey: "glm-5.3" },
      receipt(),
      0,
      "driver_model_unavailable",
    ],
    [
      "no held control fence",
      { acquire: null },
      receipt(),
      0,
      "driver_fence_stale",
    ],
    [
      "Core's typed refusal",
      {},
      new ExternalDriverRefusalError("peer/dispatch", "driver_fence_stale"),
      1,
      "driver_fence_stale",
    ],
  ] as const)(
    "%s adopts nothing and fabricates no record",
    async (_name, plan, answer, frames, refusalKind) => {
      const h = await harness();
      const { outcome, peerDispatch } = await dispatch(h, answer, plan);
      expect(outcome).toEqual({ kind: "refused", refusalKind });
      expect(peerDispatch).toHaveBeenCalledTimes(frames);
      expect(h.adoptOnRecord).not.toHaveBeenCalled();
      expect(h.manager.records()).toEqual([h.master]);
      expect(h.client.opens.map((params) => params.session_id)).toEqual([
        MASTER,
      ]);
      h.manager.retireAll();
    },
  );

  it("never adopts for a master the facade does not retain: no seam, no frame", async () => {
    const h = await harness();
    const foreign = { scope: h.master.scope } as SessionRecord<PooledClient>;
    const { outcome, peerDispatch } = await dispatch(h, receipt(), {
      owner: foreign,
    });
    expect(outcome).toEqual({ kind: "unknown" });
    expect(peerDispatch).not.toHaveBeenCalled();
    expect(h.adoptOnRecord).not.toHaveBeenCalled();
    expect(h.manager.records()).toEqual([h.master]);
    h.manager.retireAll();
  });
});
