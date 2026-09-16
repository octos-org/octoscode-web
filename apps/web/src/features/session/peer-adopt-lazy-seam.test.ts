/**
 * P2j RED (grant 3120, run-13 triage 3110): the adopt seam must resolve through
 * the LAZY FACADE.
 *
 * The product hook holds a `LazySessionRecordManager`, and `dispatchPeer`
 * (use-octos-session.ts:1396) handed that FACADE straight to `peerAdoptSeam`,
 * which reads `adoptOnRecord` BY NAME. That method lands on the inner ENGINE
 * (`session-record-manager.ts:594`); the facade only bridges it via
 * `engineFor(record)`. So the seam resolved NULL and `performPeerDispatch`
 * settled `unknown` BEFORE `commands.peerDispatch` — a held seat, advertised
 * lanes and an enabled Dispatch button, yet ZERO frames on the wire.
 *
 * These cases drive the REAL `LazySessionRecordManager` over the REAL
 * `SessionRecordManager` (the lazy engine is loaded by the SAME loader the hook
 * uses) and a recording fake client, so the facade/engine split is exercised
 * end to end rather than mocked. FAIL-CLOSED is part of the contract: a record
 * the facade no longer owns yields NULL and NO frame.
 */
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
  type DriverAcquireView,
  type ExternalDriverCommands,
  type PeerDispatchReceiptView,
} from "@octos-org/octoscode-client/external-driver";
import type {
  PeerDispatchParams,
  PeerDispatchSeed,
} from "../control/peer-dispatch-commands.ts";
import { LazySessionRecordManager } from "./lazy-session-record-manager.ts";
import {
  SessionRecordManager,
  type SessionRecord,
} from "./session-record-manager.ts";
import type { SessionRuntimeScope } from "./session-scope.ts";
import {
  peerAdoptSeam,
  peerAdoptSeamForRecord,
  performPeerDispatch,
} from "./use-octos-session.ts";

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

const SEED: PeerDispatchSeed = {
  brief: "Review this",
  slug: "review",
  prompt: "kickoff text",
};

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

/** The REAL lazy facade over the REAL engine — the hook's own composition. */
function harness() {
  const client = new PooledClient();
  const loader = vi.fn(
    async () =>
      (
        options: ConstructorParameters<
          typeof SessionRecordManager<PooledClient>
        >[0],
      ) =>
        new SessionRecordManager(options),
  );
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
    loader,
  );
  return { client, manager, loader };
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

async function openMaster(h: ReturnType<typeof harness>) {
  return h.manager.openOnRecord(
    {
      endpoint: ENDPOINT,
      token: "",
      profileId: PROFILE,
      cwd: WORKSPACE,
      sessionId: MASTER,
    },
    h.client,
    new AbortController().signal,
  );
}

function dispatch(
  adopt:
    | ((input: {
        adoptedSessionId: string;
        adoptedTurnId: string;
        scope: SessionRuntimeScope;
      }) => Promise<SessionRecord<PooledClient>>)
    | null,
) {
  const { commands, peerDispatch } = leaf(receipt());
  const outcome = performPeerDispatch<SessionRecord<PooledClient>>({
    commands,
    acquire: ACQUIRE,
    laneKeys: KEYS,
    laneKey: "lane-review",
    operationId: OPERATION,
    seed: SEED,
    adopt,
    scope: activeScope,
  });
  return { outcome, peerDispatch };
}

describe("P2j — the adopt seam resolves through the LAZY FACADE", () => {
  it("the facade ITSELF exposes no adopt half: handing it to peerAdoptSeam is NULL", async () => {
    const h = harness();
    const master = await openMaster(h);
    // The run-13 defect, pinned: `adoptOnRecord` lives on the ENGINE, and the
    // facade the hook holds has no such member.
    expect(peerAdoptSeam<SessionRecord<PooledClient>>(h.manager)).toBeNull();
    // ...while the engine it bridges to DOES carry it.
    expect(peerAdoptSeam(h.manager.engineFor(master)!)).not.toBeNull();
    expect(master.scope.sessionId).toBe(MASTER);
    h.manager.retireAll();
  });

  it("returns `unknown` and sends ZERO frames when the seam is the bare facade", async () => {
    const h = harness();
    // The master record is opened (so the actor's own open is on the wire), but
    // the supply site is handed ONLY the bare facade — the exact run-13 wiring.
    await openMaster(h);
    const { outcome, peerDispatch } = dispatch(
      peerAdoptSeam<SessionRecord<PooledClient>>(h.manager),
    );
    await expect(outcome).resolves.toEqual({ kind: "unknown" });
    // The enabled console dispatched nothing at all — the exact run-13 trace.
    expect(peerDispatch).not.toHaveBeenCalled();
    expect(h.client.opens.map((p) => p.session_id)).toEqual([MASTER]);
    h.manager.retireAll();
  });

  it("resolves through engineFor: ONE peer/dispatch frame + the adopted record installed", async () => {
    const h = harness();
    const master = await openMaster(h);
    const { outcome, peerDispatch } = dispatch(
      await peerAdoptSeamForRecord<
        SessionRecord<PooledClient>,
        SessionRecord<PooledClient>
      >(h.manager, master),
    );
    const settled = await outcome;
    expect(settled.kind).toBe("accepted");
    // EXACTLY ONE frame, carrying the operator's chosen lane.
    expect(peerDispatch).toHaveBeenCalledTimes(1);
    expect(peerDispatch.mock.calls[0]![0].model).toBe("lane-review");
    // The SERVER-adopted identity is installed as a REAL record.
    const adopted = h.manager
      .records()
      .find((record) => record.scope.sessionId === ADOPTED);
    expect(adopted).toBeDefined();
    expect(h.client.opens.map((p) => p.session_id)).toEqual([MASTER, ADOPTED]);
    h.manager.retireAll();
  });

  it("fails closed with NO frame for a record the facade no longer owns", async () => {
    const h = harness();
    const master = await openMaster(h);
    // A record the facade does not own: engineFor resolves null ⇒ the seam is
    // null ⇒ nothing is staged (never a fabricated record).
    const foreign = { scope: master.scope } as SessionRecord<PooledClient>;
    expect(h.manager.engineFor(foreign)).toBeNull();
    // P2L (grant 3220 §2): `ensureEngineFor` LOADS a merely-unloaded engine but
    // must STILL answer null for a record the facade genuinely does not retain.
    await expect(h.manager.ensureEngineFor(foreign)).resolves.toBeNull();
    await expect(
      peerAdoptSeamForRecord(h.manager, foreign),
    ).resolves.toBeNull();
    const { outcome, peerDispatch } = dispatch(null);
    await expect(outcome).resolves.toEqual({ kind: "unknown" });
    expect(peerDispatch).not.toHaveBeenCalled();
    h.manager.retireAll();
  });
});

/**
 * P2L RED (grant 3220 §3): the seam must survive the LIVE flow, which reaches
 * `peer/dispatch` WITHOUT any prior `/peer` staging (connect -> workspace record
 * -> acquire -> dispatch, no `peer-control-*` workspace special-casing). The
 * ticket's top suspect is that in that flow `peerAdoptSeamForRecord` hit an
 * UNLOADED lazy engine, resolved null, and fail-closed `unknown` BEFORE any
 * frame — the enabled-console/zero-frame trace of run 2850f. These cases drive
 * exactly that shape and assert ONE `peer/dispatch` frame.
 */
describe("P2L — the adopt seam ENSURES a merely-unloaded engine (live flow)", () => {
  it("resolves and sends ONE frame when the engine is unloaded at click time", async () => {
    const h = harness();
    const master = await openMaster(h);
    const engine = h.manager.engineFor(master);
    expect(engine).not.toBeNull();
    // The live probe: the facade's engine bridge answers null because nothing
    // forced the engine to load (no earlier peer staging), while `ensureEngineFor`
    // awaits the load and then bridges to the SAME engine.
    const unloaded = {
      engineFor: () => null,
      ensureEngineFor: async () => engine,
    };
    // RED before P2L §2: the bare probe yields null ⇒ the seam is null ⇒ no frame.
    const { outcome: none, peerDispatch: noFrame } = dispatch(
      await peerAdoptSeamForRecord<SessionRecord<PooledClient>>(
        { engineFor: () => null },
        master,
      ),
    );
    await expect(none).resolves.toEqual({ kind: "unknown" });
    expect(noFrame).not.toHaveBeenCalled();

    // GREEN after P2L §2: the ENSURE path loads the engine and stages ONCE.
    const seam = await peerAdoptSeamForRecord<
      SessionRecord<PooledClient>,
      SessionRecord<PooledClient>
    >(unloaded, master);
    expect(seam).not.toBeNull();
    const { outcome, peerDispatch } = dispatch(seam);
    expect((await outcome).kind).toBe("accepted");
    expect(peerDispatch).toHaveBeenCalledTimes(1);
    expect(peerDispatch.mock.calls[0]![0].model).toBe("lane-review");
    h.manager.retireAll();
  });
});
