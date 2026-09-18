import { describe, expect, it, vi } from "vitest";
import {
  CORE_UI_METHODS,
  OctosUiClient,
  type RpcNotification,
  type SessionHydrateResult,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { LazySessionRecordManager } from "./lazy-session-record-manager.ts";
import {
  SessionRecordManager,
  type SessionRecord,
} from "./session-record-manager.ts";
import type { ActiveSessionAuthority } from "./active-session-runtime.ts";
import { SessionPeerCoordinator } from "./session-peer-coordinator.ts";
import { admitAgentSpawn } from "../autonomy/agent-spawn-admission.ts";
import { composeAgentSpawn } from "../autonomy/agent-spawn.ts";
import {
  createPeerCommands,
  PEER_METHODS,
} from "@octos-org/octoscode-client/peers";

const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.SESSION_OPEN,
    CORE_UI_METHODS.SESSION_HYDRATE,
    CORE_UI_METHODS.TURN_START,
    CORE_UI_METHODS.AGENT_LIST,
    PEER_METHODS.PREPARE,
    PEER_METHODS.GATHER,
  ],
  supported_notifications: [PEER_METHODS.STAGED, PEER_METHODS.CLOSED],
  supported_features: [],
};
function hydrated(sessionId: string, text = sessionId): SessionHydrateResult {
  return {
    session_id: sessionId,
    cursor: { stream: sessionId, seq: 1 },
    turns: [],
    messages: [
      {
        seq: 1,
        role: "assistant",
        content: text,
        persisted_at: "2026-09-06T00:00:00Z",
        media: [],
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function flush() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

/** A real loaded engine: no mock of openOnRecord, hydrate, queue, or reducer. */
function harness() {
  const client = new OctosUiClient({ endpoint: "ws://server.test/ui" });
  const listeners = new Set<(notification: RpcNotification) => void>();
  vi.spyOn(client, "status", "get").mockReturnValue("connected");
  vi.spyOn(client, "subscribeStatus").mockImplementation((listener) => {
    listener("connected");
    return () => undefined;
  });
  vi.spyOn(client, "subscribeErrors").mockReturnValue(() => undefined);
  vi.spyOn(client, "subscribeNotifications").mockImplementation((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  vi.spyOn(client, "listConfigCapabilities").mockResolvedValue({
    capabilities,
  });
  const openRpc = vi
    .spyOn(client, "openSession")
    .mockImplementation(async (params) => ({
      opened: {
        session_id: params.session_id,
        active_profile_id: "coding",
        workspace_root: params.cwd ?? "/srv/project",
        capabilities,
      },
    }));
  vi.spyOn(client, "peerCommands").mockImplementation(
    async (sessionId, profileId, caps, authority = client) =>
      createPeerCommands(
        {
          request: async () => {
            throw new Error("No peer mutation RPC expected");
          },
        },
        { sessionId, profileId, authority },
        caps,
      ),
  );
  const hydrate = vi
    .spyOn(client, "hydrateSession")
    .mockImplementation(async (params) => hydrated(params.session_id));
  const starts = vi.spyOn(client, "startTurn").mockResolvedValue({});
  const changed = vi.fn();
  let forward: (
    record: SessionRecord<OctosUiClient>,
    authority: ActiveSessionAuthority<OctosUiClient>,
    notification: RpcNotification,
  ) => void = () => undefined;
  const loader = vi.fn(
    async () =>
      (
        options: ConstructorParameters<
          typeof SessionRecordManager<OctosUiClient>
        >[0],
      ) =>
        new SessionRecordManager(options),
  );
  const manager = new LazySessionRecordManager<OctosUiClient>(
    {
      pooledClient: () => client,
      authorityEpoch: () => 1,
      onSelectedEvent: changed,
      onSelectedSnapshot: changed,
      onBackgroundActivity: changed,
      onRecordNotification: (record, authority, notification) =>
        forward(record, authority, notification),
      cursorFor: () => undefined,
      validateServerCapabilities: () => undefined,
      validateSessionCapabilities: () => undefined,
      controllerDependencies: (scope, getClient) => ({
        client: getClient,
        sessionId: () => scope.sessionId,
        canEnqueue: () => true,
        canStart: () => true,
        canInterrupt: () => true,
        setTimeline: () => {
          throw new Error("Unexpected selected reducer");
        },
        setConnectionError: () => undefined,
      }),
    },
    loader,
  );
  const open = (sessionId: string) =>
    manager.openOnRecord(
      {
        endpoint: "ws://server.test/ui",
        token: "",
        profileId: "coding",
        cwd: "/srv/project",
        sessionId,
      },
      client,
      new AbortController().signal,
    );
  return {
    manager,
    client,
    hydrate,
    starts,
    loader,
    changed,
    open,
    openRpc,
    emit(notification: RpcNotification) {
      // Subscriptions may change during delivery; newly bound listeners must
      // not receive an older transport frame a second time.
      const recipients = [...listeners];
      for (const listener of recipients) listener(notification);
    },
    setRecordNotification(callback: typeof forward) {
      forward = callback;
    },
  };
}

describe("root integration acceptance: real lazy engine commit authority", () => {
  it("forwards a revoked peer/master commit guard through the lazy facade before child installation", async () => {
    const h = harness();
    const master = await h.open("coding:local:master");
    h.manager.select(master.scope);
    const late = deferred<SessionHydrateResult>();
    h.hydrate.mockReturnValueOnce(late.promise);
    let current = true;
    const opening = h.manager.openOnRecord(
      {
        endpoint: "ws://server.test/ui",
        token: "",
        profileId: "coding",
        cwd: "/srv/project",
        sessionId: "coding:local:child",
      },
      h.client,
      new AbortController().signal,
      () => current,
    );
    const rejected = expect(opening).rejects.toThrow(/authority|opening/i);
    await flush();
    current = false;
    late.resolve(hydrated("coding:local:child"));
    await rejected;
    expect(h.manager.records()).toEqual([master]);
    expect(h.manager.selected()).toBe(master);
    h.manager.retireAll();
  });

  it("does not install a late candidate when suspension changes the facade epoch on the same client", async () => {
    const h = harness();
    const existing = await h.open("coding:local:existing");
    h.manager.select(existing.scope);
    const late = deferred<SessionHydrateResult>();
    h.hydrate.mockReturnValueOnce(late.promise);
    const opening = h.open("coding:local:late");
    const rejected = expect(opening).rejects.toThrow(/authority|opening/i);
    await flush();
    expect(h.loader).toHaveBeenCalledOnce();
    h.manager.suspendRecords();
    late.resolve(hydrated("coding:local:late", "must never install"));
    await rejected;
    expect(h.manager.records()).toEqual([existing]);
    expect(h.manager.selected()).toBe(existing);
    expect(h.starts).not.toHaveBeenCalled();
    h.manager.retireAll();
  });

  it("does not overwrite a retained record's timeline with a stale same-record candidate after suspension", async () => {
    const h = harness();
    const existing = await h.open("coding:local:existing");
    h.manager.select(existing.scope);
    const before = existing.timeline;
    const late = deferred<SessionHydrateResult>();
    h.hydrate.mockReturnValueOnce(late.promise);
    const opening = h.open(existing.scope.sessionId);
    const rejected = expect(opening).rejects.toThrow(/authority|opening/i);
    await flush();
    h.manager.suspendRecords();
    late.resolve(hydrated(existing.scope.sessionId, "stale overwrite"));
    await rejected;
    expect(existing.timeline).toBe(before);
    expect(existing.runtime.getSnapshot().phase).not.toBe("ready");
    h.manager.retireAll();
  });
});

describe("native agent spawn uses captured idle-only ordinary admission", () => {
  it("sends one exact native prompt with captured effort and no composer media", async () => {
    const h = harness();
    const owner = await h.open("coding:local:spawn-owner");
    h.manager.select(owner.scope);
    owner.controller.setSteeringEnabled(true);
    const prompt = composeAgentSpawn(2, "Inspect fixture only")!;
    expect(
      admitAgentSpawn(
        owner,
        () => h.manager.selected() === owner,
        prompt,
        "high",
      ),
    ).toBe(true);
    await flush();
    expect(h.starts).toHaveBeenCalledOnce();
    expect(h.starts.mock.calls[0]?.[0]).toMatchObject({
      session_id: owner.scope.sessionId,
      input: [{ kind: "text", text: prompt }],
      reasoning_effort: "high",
    });
    expect(h.starts.mock.calls[0]?.[0]?.input).toEqual([
      { kind: "text", text: prompt },
    ]);
    expect(admitAgentSpawn(owner, () => true, prompt)).toBe(false);
    h.manager.retireAll();
  });
  it("rejects a stale selected view and suspended or retired owner without affecting B", async () => {
    const h = harness();
    const a = await h.open("coding:local:spawn-a");
    const b = await h.open("coding:local:spawn-b");
    h.manager.select(b.scope);
    expect(
      admitAgentSpawn(a, () => h.manager.selected() === a, "Spawn work"),
    ).toBe(false);
    h.manager.select(a.scope);
    h.manager.suspendRecords();
    expect(admitAgentSpawn(a, () => true, "Spawn work")).toBe(false);
    h.manager.retireAll();
    expect(admitAgentSpawn(a, () => false, "Spawn work")).toBe(false);
    expect(h.starts).not.toHaveBeenCalled();
    expect(b.controller.queueSnapshot().pending).toEqual([]);
  });
  it("rechecks native agent capability at dispatch even when a stale form was visible", async () => {
    const h = harness();
    const owner = await h.open("coding:local:spawn-unavailable");
    h.manager.select(owner.scope);
    const snapshot = owner.runtime.getSnapshot();
    const restricted = {
      ...capabilities,
      supported_methods: [CORE_UI_METHODS.TURN_START],
    };
    vi.spyOn(owner.runtime, "getSnapshot").mockReturnValue({
      ...snapshot,
      session: { ...snapshot.session!, capabilities: restricted },
    });
    expect(admitAgentSpawn(owner, () => true, "Spawn work")).toBe(false);
    expect(h.starts).not.toHaveBeenCalled();
    h.manager.retireAll();
  });
  it("respects the real engine's history write lease and preserves FIFO admission", async () => {
    const h = harness();
    const owner = await h.open("coding:local:spawn-lease");
    h.manager.select(owner.scope);
    const engine = h.manager.engineFor(owner)!;
    const lease = engine.acquireHistoryMutation(
      owner,
      owner.runtime.currentAuthority()!,
      { workspaceWide: false },
    )!;
    expect(lease).not.toBeNull();
    expect(admitAgentSpawn(owner, () => true, "Spawn work")).toBe(false);
    expect(owner.controller.queueSnapshot()).toEqual({
      active: null,
      pending: [],
    });
    lease.release();
    expect(admitAgentSpawn(owner, () => true, "Spawn work")).toBe(true);
    await flush();
    expect(h.starts).toHaveBeenCalledOnce();
    h.manager.retireAll();
  });
});

const masterId = "coding:local:tui";
const childId = "coding:local:tui#peer-review";
function lifecycle(method: string = PEER_METHODS.STAGED): RpcNotification {
  return {
    jsonrpc: "2.0",
    method,
    params: {
      session_id: masterId,
      profile_id: "coding",
      slug: "review",
      topic: "peer-review",
      cwd: "/srv/project/peer",
      brief_path: "/peers/review/brief.md",
      brief: "Review error handling",
    },
  };
}

function installPeerHost(h: ReturnType<typeof harness>) {
  const openPeer = vi.fn(
    async (
      request: import("../peers/peer-manager.ts").PeerOpenRequest,
      client: OctosUiClient,
    ) =>
      h.manager.openOnRecord(
        {
          endpoint: "ws://server.test/ui",
          token: "",
          sessionId: request.sessionId,
          profileId: request.profileId,
          cwd: request.cwd,
        },
        client,
        request.signal,
        request.isCurrent,
      ),
  );
  const coordinator = new SessionPeerCoordinator<
    OctosUiClient,
    SessionRecord<OctosUiClient>
  >({
    isRetained: (record) =>
      h.manager.get(record.scope) === record && !record.closed,
    subscribeRecords: h.manager.subscribe,
    openPeer,
    closePeer: (record) => {
      h.manager.evict(record.scope);
    },
  });
  coordinator.setTransport(h.client);
  const observer = coordinator.notificationObserver(h.client);
  const offFrames = h.client.subscribeNotifications(observer);
  const offRecords = h.manager.subscribe(() => {
    for (const record of h.manager.records()) coordinator.bind(record);
  });
  h.setRecordNotification((record, authority, notification) => {
    if (
      authority.client !== h.client ||
      (notification.method !== PEER_METHODS.STAGED &&
        notification.method !== PEER_METHODS.CLOSED)
    )
      return;
    coordinator.bind(record);
    observer(notification);
  });
  h.hydrate.mockImplementation(async (params) => ({
    ...hydrated(params.session_id),
    messages: [],
  }));
  return {
    coordinator,
    openPeer,
    dispose() {
      offFrames();
      offRecords();
      coordinator.clear();
      h.manager.retireAll();
    },
  };
}

describe("root integration acceptance: confirmed candidate peer replay", () => {
  it("delivers staged replay received before a master exists and starts the exact peer once", async () => {
    const h = harness();
    const peerHost = installPeerHost(h);
    h.openRpc.mockImplementationOnce(async () => {
      expect(h.manager.records()).toEqual([]);
      h.emit(lifecycle());
      return {
        opened: {
          session_id: masterId,
          active_profile_id: "coding",
          workspace_root: "/srv/project",
          capabilities,
        },
      };
    });
    const master = await h.open(masterId);
    await vi.waitFor(() => expect(h.starts).toHaveBeenCalledOnce());
    expect(h.starts.mock.calls[0]![0].session_id).toBe(childId);
    expect(peerHost.openPeer).toHaveBeenCalledOnce();
    expect(h.manager.selected()).toBeNull();
    h.emit(lifecycle());
    await flush();
    expect(h.starts).toHaveBeenCalledOnce();
    expect(peerHost.coordinator.get(master)).not.toBeNull();
    peerHost.dispose();
  });

  it.each(["staged then closed", "closed then staged"])(
    "preserves initial %s ordering without kickoff",
    async (order) => {
      const h = harness();
      const peerHost = installPeerHost(h);
      h.openRpc.mockImplementationOnce(async () => {
        for (const method of order === "staged then closed"
          ? [PEER_METHODS.STAGED, PEER_METHODS.CLOSED]
          : [PEER_METHODS.CLOSED, PEER_METHODS.STAGED])
          h.emit(lifecycle(method));
        return {
          opened: {
            session_id: masterId,
            active_profile_id: "coding",
            workspace_root: "/srv/project",
            capabilities,
          },
        };
      });
      const master = await h.open(masterId);
      await flush();
      await vi.dynamicImportSettled();
      await flush();
      const rows = peerHost.coordinator.get(master)!.getSnapshot().peers;
      if (order === "staged then closed")
        expect(rows[0]?.status).toBe("closed");
      else expect(rows).toEqual([]); // An earlier close is a tombstone, not a fabricated roster row.
      h.emit(lifecycle());
      await flush();
      expect(h.starts).not.toHaveBeenCalled();
      expect(peerHost.openPeer).not.toHaveBeenCalled();
      peerHost.dispose();
    },
  );

  it("never delivers unconfirmed candidate replay after session/open rejects its scope", async () => {
    const h = harness();
    const peerHost = installPeerHost(h);
    h.openRpc.mockImplementationOnce(async () => {
      h.emit(lifecycle());
      return {
        opened: {
          session_id: masterId,
          active_profile_id: "foreign",
          workspace_root: "/srv/project",
          capabilities,
        },
      };
    });
    await expect(h.open(masterId)).rejects.toThrow("another Profile");
    await flush();
    expect(h.manager.records()).toEqual([]);
    expect(peerHost.openPeer).not.toHaveBeenCalled();
    expect(h.starts).not.toHaveBeenCalled();
    peerHost.dispose();
  });
});
