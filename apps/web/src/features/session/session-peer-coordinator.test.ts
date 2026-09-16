import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OctosUiClient,
  type TurnStartParams,
  type UiProtocolCapabilities,
  type SessionHydrateResult,
} from "@octos-org/octoscode-client";
import {
  createPeerCommands,
  PEER_METHODS,
  type PeerCommands,
} from "@octos-org/octoscode-client/peers";
import { createQueueBackedTurnController } from "../composer/use-turn-controller.ts";
import { PromptTurnQueue } from "../composer/turn-queue.ts";
import { foldNotification, type TimelineEntry } from "../timeline/model.ts";
import type { PeerOpenRequest } from "../peers/peer-manager.ts";
import { ExternalDriverRefusalError } from "@octos-org/octoscode-client/external-driver";
import {
  SessionPeerCoordinator,
  type PeerCoordinatorRecord,
  type PeerDispatchStart,
} from "./session-peer-coordinator.ts";
import type { SessionControlReadiness } from "./session-record-manager.ts";

const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [PEER_METHODS.PREPARE, PEER_METHODS.GATHER],
  supported_notifications: [PEER_METHODS.STAGED, PEER_METHODS.CLOSED],
  supported_features: [],
};
const identity = "dev:local:tui#peer-review";
const stage = (master = "dev:local:tui", slug = "review") => ({
  method: PEER_METHODS.STAGED,
  params: {
    session_id: master,
    profile_id: "dev",
    slug,
    topic: `peer-${slug}`,
    cwd: "/repo/wt",
    brief_path: `/peers/${slug}/brief.md`,
    brief: "Review this",
  },
});
const close = () => ({ ...stage(), method: PEER_METHODS.CLOSED });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Client extends OctosUiClient {
  connected = true;
  starts: TurnStartParams[] = [];
  gate = deferred<unknown>();
  factory: ((commands: PeerCommands) => Promise<PeerCommands>) | null = null;
  constructor() {
    super({ endpoint: "ws://127.0.0.1:1" });
  }
  override get status() {
    return this.connected ? ("connected" as const) : ("disconnected" as const);
  }
  override async peerCommands(
    sessionId: string,
    profileId: string,
    capabilities: UiProtocolCapabilities,
    authority: object = this,
  ) {
    const commands = createPeerCommands(
      {
        request: async () => {
          throw new Error("Unexpected fixture RPC");
        },
      },
      { sessionId, profileId, authority },
      capabilities,
    );
    return this.factory ? this.factory(commands) : commands;
  }
  override async startTurn(params: TurnStartParams) {
    this.starts.push(params);
    return this.gate.promise;
  }
}
function record(
  client: Client,
  sessionId: string,
  emit: () => void,
  cwd = "/repo",
) {
  let runtimeClient = client,
    generation = 1,
    phase = "ready",
    canEnqueue = true;
  let readiness: SessionControlReadiness = "unavailable";
  const hydrated: SessionHydrateResult = {
    session_id: sessionId,
    cursor: { stream: sessionId, seq: 0 },
    turns: [],
    messages: [],
  };
  const queue = new PromptTurnQueue();
  let timeline: TimelineEntry[] = [];
  const controller = createQueueBackedTurnController({
    dependenciesRef: {
      current: {
        client: () => runtimeClient,
        sessionId: () => sessionId,
        canEnqueue: () => canEnqueue,
        canStart: () =>
          phase === "ready" && runtimeClient.status === "connected",
        canInterrupt: () => false,
        setTimeline: (update) => {
          timeline = typeof update === "function" ? update(timeline) : update;
        },
        setConnectionError: () => {},
        onDispatchState: emit,
      },
    },
    queueRef: { current: queue },
    sync: emit,
  });
  return {
    scope: {
      endpoint: "ws://127.0.0.1:1",
      workspaceRoot: cwd,
      profileId: "dev",
      sessionId,
      authorityEpoch: 1,
    },
    runtime: {
      currentAuthority: () => ({
        client: runtimeClient,
        generation,
        capabilities: caps,
      }),
      getSnapshot: () => ({ phase, status: runtimeClient.status }),
    },
    controller,
    payload: { hydrated },
    get timeline() {
      return timeline;
    },
    selected: Boolean(false),
    get controlReadiness(): SessionControlReadiness {
      return readiness;
    },
    reconnect(next: Client) {
      runtimeClient = next;
      generation += 1;
    },
    setPhase(next: string) {
      phase = next;
    },
    setReadiness(next: SessionControlReadiness) {
      readiness = next;
    },
    rejectEnqueue() {
      canEnqueue = false;
    },
    terminal(turnId: string) {
      timeline = foldNotification(timeline, {
        jsonrpc: "2.0",
        method: "turn/completed",
        params: { session_id: sessionId, turn_id: turnId },
      });
      controller.settleTurn(turnId);
      emit();
    },
  } satisfies PeerCoordinatorRecord<Client> & {
    selected: boolean;
    reconnect(next: Client): void;
    setPhase(next: string): void;
    setReadiness(next: SessionControlReadiness): void;
    rejectEnqueue(): void;
    terminal(turnId: string): void;
  };
}
type Record = ReturnType<typeof record>;
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
});
function setup(
  options: {
    timeoutMs?: number;
    bufferLimit?: number;
    /** Receipt facts the dispatch stub reports (design 1120 §3-4). */
    dispatchReceipt?: (
      request: PeerOpenRequest,
      operationId: string,
    ) => {
      adoptedSessionId?: string;
      adoptedTurnId?: string;
      /** The receipt's OWN adopted slug, when the server adopts a DIFFERENT
       *  slug than the locally staged one (finding 2920 (b)). */
      slug?: string;
      duplicate?: boolean;
      operationId?: string;
    };
    /** Fail the first N dispatches with a typed refusal before succeeding. */
    dispatchFails?: number;
  } = {},
) {
  const dispatchFails = options.dispatchFails ?? 0;
  const dispatchReceipt: (
    request: PeerOpenRequest,
    operationId: string,
  ) => {
    adoptedSessionId?: string;
    adoptedTurnId?: string;
    slug?: string;
    duplicate?: boolean;
    operationId?: string;
  } = options.dispatchReceipt ?? (() => ({}));
  const client = new Client();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const retained = new Set<Record>();
  const master = record(client, "dev:local:tui", emit);
  retained.add(master);
  const opened: Record[] = [],
    requests: PeerOpenRequest[] = [],
    closed: Record[] = [];
  let customize: (peer: Record) => void = () => {};
  let openGate: Promise<void> | null = null;
  let dispatchGate: Promise<void> | null = null;
  const dispatched: Array<{ request: PeerOpenRequest; operationId: string }> =
    [];
  let remainingFailures = dispatchFails;
  const coordinator = new SessionPeerCoordinator<Client, Record>({
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
    ...(options.bufferLimit === undefined
      ? {}
      : { bufferLimit: options.bufferLimit }),
    isRetained: (entry) => retained.has(entry),
    subscribeRecords: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    openPeer: async (request, source) => {
      requests.push(request);
      const peer = record(source, request.sessionId, emit, request.cwd);
      customize(peer);
      opened.push(peer);
      retained.add(peer);
      if (openGate) await openGate;
      return peer;
    },
    closePeer: (peer) => {
      closed.push(peer);
      if (!peer.selected) retained.delete(peer);
    },
    dispatchPeer: async (request, operationId, source) => {
      dispatched.push({ request, operationId });
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new ExternalDriverRefusalError(
          "peer/dispatch",
          "driver_busy_handover",
        );
      }
      if (dispatchGate) await dispatchGate;
      const facts = dispatchReceipt(request, operationId);
      const adoptedSessionId = facts.adoptedSessionId ?? request.sessionId;
      const peer = record(source, adoptedSessionId, emit, request.cwd);
      customize(peer);
      opened.push(peer);
      retained.add(peer);
      return {
        record: peer,
        operationId: facts.operationId ?? operationId,
        adoptedSessionId,
        adoptedTurnId: facts.adoptedTurnId ?? request.turnId,
        // The receipt's OWN adopted slug is authoritative for the row (b). The
        // harness default mirrors the server ADOPTING a DIFFERENT slug than the
        // locally staged one, which is exactly the divergence finding (b) names.
        slug: facts.slug ?? request.slug,
        duplicate: facts.duplicate ?? false,
      } satisfies PeerDispatchStart<Record>;
    },
  });
  coordinator.setTransport(client);
  const manager = coordinator.bind(master)!;
  cleanup.push(() => coordinator.clear());
  return {
    client,
    coordinator,
    master,
    manager,
    retained,
    opened,
    requests,
    closed,
    dispatched,
    emit,
    listeners,
    addMaster(sessionId: string) {
      const entry = record(client, sessionId, emit);
      retained.add(entry);
      coordinator.bind(entry);
      return entry;
    },
    customize(fn: (peer: Record) => void) {
      customize = fn;
    },
    deferOpen(promise: Promise<void>) {
      openGate = promise;
    },
    deferDispatch(promise: Promise<void>) {
      dispatchGate = promise;
    },
    send: coordinator.notificationObserver(client),
  };
}
async function until(check: () => void) {
  await vi.waitFor(check, { interval: 5, timeout: 1500 });
}

describe("record-owned native peer coordinator", () => {
  it("fails closed when multiple retained workspace incarnations claim one wire owner", async () => {
    const h = setup();
    const other = h.addMaster(h.master.scope.sessionId);
    other.scope.workspaceRoot = "/other-workspace";
    expect(h.send(stage())).toBe(false);
    expect(h.coordinator.getError(h.master)).toContain("ambiguous");
    expect(h.coordinator.getError(other)).toContain("ambiguous");
    await vi.dynamicImportSettled();
    expect(h.client.starts).toHaveLength(0);
  });
  it("routes a background master's staged event without focus changes and requires real controller acceptance", async () => {
    const h = setup();
    const selected = h.addMaster("other-master");
    selected.selected = true;
    h.send(stage());
    await until(() => expect(h.client.starts).toHaveLength(1));
    expect(h.manager.snapshot().peers[0]?.status).toBe("opening");
    expect(h.coordinator.get(selected)?.snapshot().peers).toEqual([]);
    expect(selected.selected).toBe(true);
    expect(h.master.selected).toBe(false);
    expect(h.client.starts[0]?.session_id).toBe(identity);
    expect(h.client.starts[0]?.turn_id).toBe(h.requests[0]?.turnId);
    expect(h.opened[0]?.controller.activeTurnOwnership()).toBe("dispatching");
    h.client.gate.resolve({});
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("started"),
    );
    expect(h.opened[0]?.controller.activeTurnOwnership()).toBe("local-owner");
    expect(h.listeners.size).toBe(0);
  });

  it("buffers staged then closed during factory loading without a kickoff", async () => {
    const h = setup();
    const factory = deferred<PeerCommands>();
    const next = new Client();
    next.factory = () => factory.promise;
    h.master.reconnect(next);
    h.coordinator.setTransport(next);
    const send = h.coordinator.notificationObserver(next);
    send(stage());
    send(close());
    expect(h.requests).toHaveLength(0);
    factory.resolve(
      createPeerCommands(
        { request: async () => null },
        {
          sessionId: h.master.scope.sessionId,
          profileId: "dev",
          authority: h.master,
        },
        caps,
      ),
    );
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("closed"),
    );
    expect(h.requests).toHaveLength(0);
    expect(next.starts).toHaveLength(0);
  });

  it("retains manager/roster across reconnect and never replays a stale source, including same-client reuse", async () => {
    const h = setup();
    h.send(stage());
    await until(() => expect(h.client.starts).toHaveLength(1));
    h.coordinator.setTransport(null);
    h.master.reconnect(h.client);
    h.coordinator.setTransport(h.client);
    expect(h.coordinator.bind(h.master)).toBe(h.manager);
    expect(h.send(stage("dev:local:tui", "stale"))).toBe(false);
    const send = h.coordinator.notificationObserver(h.client);
    send(stage());
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("unknown"),
    );
    expect(h.client.starts).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
  });

  it("drops old command-factory results and their buffered events after a transport change", async () => {
    const h = setup();
    const old = new Client(),
      oldFactory = deferred<PeerCommands>();
    old.factory = () => oldFactory.promise;
    h.master.reconnect(old);
    h.coordinator.setTransport(old);
    h.coordinator.notificationObserver(old)(stage());
    const fresh = new Client();
    h.master.reconnect(fresh);
    h.coordinator.setTransport(fresh);
    oldFactory.resolve(
      createPeerCommands(
        { request: async () => null },
        {
          sessionId: h.master.scope.sessionId,
          profileId: "dev",
          authority: h.master,
        },
        caps,
      ),
    );
    await vi.dynamicImportSettled();
    expect(h.requests).toHaveLength(0);
    h.coordinator.notificationObserver(fresh)(stage());
    await until(() => expect(fresh.starts).toHaveLength(1));
    expect(old.starts).toHaveLength(0);
  });

  it.each(["completed", "active"])(
    "does not auto-kickoff a hydrated peer with %s history",
    async (state) => {
      const h = setup();
      h.customize((peer) => {
        peer.payload.hydrated.turns = [{ turn_id: "previous", state }];
      });
      h.send(stage());
      await until(() =>
        expect(h.manager.snapshot().peers[0]?.status).toBe("unknown"),
      );
      expect(h.client.starts).toHaveLength(0);
      expect(h.manager.snapshot().peers[0]?.canRetry).toBe(false);
    },
  );

  it("waits for the exact turn receipt; local enqueue and a foreign receipt are insufficient", async () => {
    const h = setup({ timeoutMs: 80 });
    h.send(stage());
    await until(() => expect(h.client.starts).toHaveLength(1));
    const peer = h.opened[0]!;
    peer.controller.restoreTransportOwnership({
      turnId: "foreign",
      state: "running",
    });
    h.emit();
    expect(h.manager.snapshot().peers[0]?.status).toBe("opening");
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("unknown"),
    );
    expect(h.manager.snapshot().peers[0]?.canRetry).toBe(false);
    expect(h.listeners.size).toBe(0);
  });

  it("reports a synchronous admission rejection as not-started, not unknown", async () => {
    const h = setup();
    h.customize((peer) => peer.rejectEnqueue());
    h.send(stage());
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("failed"),
    );
    expect(h.manager.snapshot().peers[0]?.canRetry).toBe(true);
    expect(h.client.starts).toHaveLength(0);
    expect(h.listeners.size).toBe(0);
  });

  it("accepts the exact canonical terminal receipt when it beats the start RPC response", async () => {
    const h = setup();
    h.send(stage());
    await until(() => expect(h.client.starts).toHaveLength(1));
    const peer = h.opened[0]!;
    peer.terminal("foreign");
    expect(h.manager.snapshot().peers[0]?.status).toBe("opening");
    peer.terminal(h.requests[0]!.turnId);
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("started"),
    );
    expect(peer.controller.backgroundHandoffTurn()).toBeNull();
    expect(h.listeners.size).toBe(0);
  });

  it("does not enqueue while the actual peer runtime is recovering", async () => {
    const h = setup();
    h.customize((peer) => peer.setPhase("recovering"));
    h.send(stage());
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("failed"),
    );
    expect(h.client.starts).toHaveLength(0);
    expect(h.opened[0]?.controller.queueSnapshot().active).toBeNull();
  });

  it("does not admit a wrong-workspace peer returned from an open callback", async () => {
    const h = setup();
    h.customize((peer) => {
      peer.scope.workspaceRoot = "/foreign";
    });
    h.send(stage());
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("failed"),
    );
    expect(h.client.starts).toHaveLength(0);
    h.send(close());
    expect(h.closed).toHaveLength(0);
  });

  it("bounds an unresolved command factory with a visible inert failure", async () => {
    const h = setup({ timeoutMs: 50 }),
      next = new Client();
    next.factory = () => new Promise(() => {});
    h.master.reconnect(next);
    h.coordinator.setTransport(next);
    h.coordinator.notificationObserver(next)(stage());
    await until(() =>
      expect(h.coordinator.getError(h.master)).toContain("could not be loaded"),
    );
    expect(h.manager.canPrepare()).toBe(false);
    expect(next.starts).toHaveLength(0);
  });

  it("close during open invalidates the kickoff and closes only the matching late record", async () => {
    const h = setup(),
      gate = deferred<void>();
    h.deferOpen(gate.promise);
    h.send(stage());
    await until(() => expect(h.requests).toHaveLength(1));
    h.send(close());
    expect(h.requests[0]?.signal.aborted).toBe(true);
    gate.resolve();
    await until(() => expect(h.closed).toEqual(h.opened));
    expect(h.retained.has(h.master)).toBe(true);
    expect(h.client.starts).toHaveLength(0);
    expect(h.manager.snapshot().peers[0]?.status).toBe("closed");
  });

  it("a close preserves the selected peer through the host's exact-record callback", async () => {
    const h = setup();
    h.send(stage());
    await until(() => expect(h.client.starts).toHaveLength(1));
    const peer = h.opened[0]!;
    peer.selected = true;
    h.send(close());
    expect(h.closed).toEqual([peer]);
    expect(h.retained.has(peer)).toBe(true);
    expect(peer.selected).toBe(true);
    expect(h.retained.has(h.master)).toBe(true);
    expect(h.listeners.size).toBe(0);
  });

  it("bounds factory backlog with a visible inert failure, not silent dropped lifecycle", async () => {
    const h = setup({ bufferLimit: 1 }),
      next = new Client(),
      factory = deferred<PeerCommands>();
    next.factory = () => factory.promise;
    h.master.reconnect(next);
    h.coordinator.setTransport(next);
    const send = h.coordinator.notificationObserver(next);
    send(stage());
    send(close());
    expect(h.coordinator.getError(h.master)).toContain("backlog exceeded");
    expect(h.manager.canPrepare()).toBe(false);
    factory.resolve(
      createPeerCommands(
        { request: async () => null },
        {
          sessionId: h.master.scope.sessionId,
          profileId: "dev",
          authority: h.master,
        },
        caps,
      ),
    );
    await vi.dynamicImportSettled();
    expect(h.requests).toHaveLength(0);
  });

  it("retirement cancels only its owner and cannot repaint a replacement same-ID master", async () => {
    const h = setup(),
      gate = deferred<void>();
    h.deferOpen(gate.promise);
    h.send(stage());
    await until(() => expect(h.requests).toHaveLength(1));
    h.retained.delete(h.master);
    h.coordinator.retire(h.master);
    const replacement = h.addMaster(h.master.scope.sessionId);
    gate.resolve();
    await vi.dynamicImportSettled();
    expect(h.coordinator.get(h.master)).toBeNull();
    expect(h.coordinator.get(replacement)?.snapshot().peers).toEqual([]);
    expect(h.client.starts).toHaveLength(0);
  });
  it("resolves a focused PEER to the OWNER master's manager, not the peer's own empty one", async () => {
    const h = setup();
    h.send(stage());
    await until(() => expect(h.client.starts).toHaveLength(1));
    h.client.gate.resolve({});
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("started"),
    );
    const peer = h.opened[0]!;
    // A focused peer record is never bound itself; its roster lives in the
    // MASTER binding whose `opened` map holds it. Reading the peer's OWN
    // (absent) binding would hand the composer an EMPTY roster.
    expect(h.coordinator.get(peer)).toBe(h.manager);
    expect(h.coordinator.get(peer)?.snapshot().peers).toHaveLength(1);
    // A master still resolves its OWN manager.
    expect(h.coordinator.get(h.master)).toBe(h.manager);
    // A foreign/unknown record resolves nothing (fail-closed).
    const unknown = record(h.client, "unknown:session", h.emit);
    expect(h.coordinator.get(unknown)).toBeNull();
  });

  it("resolves the ACTIVE record's manager for the console sink exactly as the seat's Steer does (P2g 3030)", async () => {
    // Clause (b) of grant 3030: the console's staged dispatch resolves the
    // ACTIVE (selected) record's manager through the SAME `get(record)` path the
    // seat's Steer uses (the 2520 owner-manager precedent). A null here is the
    // silent early return the run-12 triage found, so the resolution is pinned
    // for BOTH the master and a peer focused on it.
    const h = setup();
    h.master.selected = true;
    h.master.setReadiness("ready");
    expect(h.coordinator.get(h.master)).toBe(h.manager);
    h.send(stage());
    await until(() => expect(h.dispatched).toHaveLength(1));
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("started"),
    );
    // The focused PEER still resolves the OWNER master's manager — never a
    // silent null for the console's staging sink.
    const peer = h.opened[0]!;
    expect(h.coordinator.get(peer)).toBe(h.manager);
  });

  it("routes a peer's OWN Session events into that row's activity axis", async () => {
    const h = setup();
    h.master.setReadiness("ready");
    h.send(stage());
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("started"),
    );
    // The peer's OWN Session id (adopted scope), not the master's.
    const peerSessionId = h.opened[0]!.scope.sessionId;
    const frame = (method: string, params: object) => ({ method, params });
    expect(
      h.send(
        frame("turn/started", { session_id: peerSessionId, turn_id: "t1" }),
      ),
    ).toBe(true);
    expect(h.manager.snapshot().peers[0]?.activity).toBe("live");
    h.send(
      frame("approval/requested", {
        session_id: peerSessionId,
        turn_id: "t1",
        approval_id: "a1",
        tool_name: "shell",
        title: "Approve",
        body: "Run it",
      }),
    );
    expect(h.manager.snapshot().peers[0]).toMatchObject({
      activity: "blocked",
      requestId: "a1",
      requestKind: "approval",
    });
    h.send(
      frame("approval/decided", {
        session_id: peerSessionId,
        approval_id: "a1",
      }),
    );
    expect(h.manager.snapshot().peers[0]?.activity).toBe("live");
    h.send(
      frame("progress/updated", {
        session_id: peerSessionId,
        turn_id: "t1",
        metadata: {
          kind: "token_cost_update",
          token_cost: { output_tokens: 7 },
        },
      }),
    );
    expect(h.manager.snapshot().peers[0]?.outputTokens).toBe(7);
    h.send(
      frame("turn/completed", { session_id: peerSessionId, turn_id: "t1" }),
    );
    expect(h.manager.snapshot().peers[0]?.activity).toBe("done");
  });
});

it("prunes only the named record's finished rows (parity 2500 §2)", async () => {
  const h = setup();
  h.master.setReadiness("ready");
  h.send(stage());
  await until(() =>
    expect(h.manager.snapshot().peers[0]?.status).toBe("started"),
  );
  const peerSessionId = h.opened[0]!.scope.sessionId;
  h.send({
    method: "turn/completed",
    params: { session_id: peerSessionId, turn_id: "t1" },
  });
  expect(h.manager.snapshot().peers[0]?.activity).toBe("done");
  // The named (ACTIVE) record's roster is pruned...
  expect(h.coordinator.clearFinished(h.master)).toBe(1);
  expect(h.manager.snapshot().peers).toHaveLength(0);
  // ...and a re-run reports 0 with nothing left to clear.
  expect(h.coordinator.clearFinished(h.master)).toBe(0);
});

it("never prunes a live row and leaves a foreign record's roster alone", async () => {
  const h = setup();
  const other = h.addMaster("other-master");
  h.master.setReadiness("ready");
  h.send(stage());
  await until(() =>
    expect(h.manager.snapshot().peers[0]?.status).toBe("started"),
  );
  const peerSessionId = h.opened[0]!.scope.sessionId;
  h.send({
    method: "turn/started",
    params: { session_id: peerSessionId, turn_id: "t1" },
  });
  expect(h.manager.snapshot().peers[0]?.activity).toBe("live");
  expect(h.coordinator.clearFinished(h.master)).toBe(0);
  expect(h.manager.snapshot().peers).toHaveLength(1);
  // The other master owns no bound rows: fail-closed 0, never a throw.
  expect(h.coordinator.clearFinished(other)).toBe(0);
});

describe("peer dispatch adoption (build 1230)", () => {
  it("stages through the dispatch leaf — and NOT session/open — when the seat is ready", async () => {
    const h = setup();
    h.master.setReadiness("ready");
    h.send(stage());
    await until(() => expect(h.dispatched).toHaveLength(1));
    expect(h.requests).toHaveLength(0);
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("started"),
    );
  });
  it("keeps the session/open path byte-identical when the seat is unavailable", async () => {
    const h = setup();
    h.master.setReadiness("unavailable");
    h.send(stage());
    await until(() => expect(h.requests).toHaveLength(1));
    expect(h.dispatched).toHaveLength(0);
  });
  it("stamps the accepted receipt's operationId onto the started row", async () => {
    const h = setup({
      dispatchReceipt: () => ({ operationId: "op-accepted-dispatch" }),
    });
    h.master.setReadiness("ready");
    h.send(stage());
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("started"),
    );
    expect(h.manager.snapshot().peers[0]?.operationId).toBe(
      "op-accepted-dispatch",
    );
  });
  it("resolves a duplicate:true replay as started with that same operationId", async () => {
    const h = setup({ dispatchReceipt: () => ({ duplicate: true }) });
    h.master.setReadiness("ready");
    h.send(stage());
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("started"),
    );
    expect(h.manager.snapshot().peers).toHaveLength(1);
    const sent = h.dispatched[0]!.operationId;
    expect(h.manager.snapshot().peers[0]?.operationId).toBe(sent);
  });
  it("keys the opened record by the SERVER-adopted session id", async () => {
    const h = setup({
      dispatchReceipt: () => ({
        adoptedSessionId: "dev:local:tui#peer-adopted",
      }),
    });
    h.master.setReadiness("ready");
    h.send(stage());
    await until(() => expect(h.dispatched).toHaveLength(1));
    expect(h.opened[0]?.scope.sessionId).toBe("dev:local:tui#peer-adopted");
  });
  it("renders a typed refusal as a retryable failure and REUSES the minted operationId", async () => {
    const h = setup({ dispatchFails: 1 });
    h.master.setReadiness("ready");
    h.send(stage());
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("failed"),
    );
    expect(h.manager.snapshot().peers[0]?.canRetry).toBe(true);
    await h.manager.retryOpen(identity);
    await until(() => expect(h.dispatched).toHaveLength(2));
    expect(h.dispatched[1]!.operationId).toBe(h.dispatched[0]!.operationId);
    expect(h.manager.snapshot().peers[0]?.status).toBe("started");
  });
  it("keeps an authority change after acceptance unknown and NOT retryable, never not-started", async () => {
    const h = setup(),
      gate = deferred<void>();
    h.deferDispatch(gate.promise);
    h.master.setReadiness("ready");
    h.send(stage());
    await until(() => expect(h.dispatched).toHaveLength(1));
    // The server already accepted the dispatch; losing the transport here must
    // never resolve not-started (which would invite a duplicate re-stage).
    h.coordinator.setTransport(null);
    gate.resolve();
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("unknown"),
    );
    expect(h.manager.snapshot().peers[0]?.canRetry).toBe(false);
  });

  it("keys the roster row by the receipt's ADOPTED slug, not the staging slug (2920 (b))", async () => {
    // The server ADOPTS the peer identity (design 1120 §3): the dispatch
    // receipt may name a DIFFERENT slug than the locally pre-computed staging
    // slug the request carried (the mock stages `synthetic-peer` while the
    // staged pick is random). The row the dock/roster renders must key on the
    // RECEIPT's slug, or the activity fixture and the row slug diverge.
    const h = setup({
      dispatchReceipt: () => ({ slug: "synthetic-peer" }),
    });
    h.master.setReadiness("ready");
    h.send(stage());
    await until(() =>
      expect(h.manager.snapshot().peers[0]?.status).toBe("started"),
    );
    const row = h.manager.snapshot().peers[0];
    expect(row?.slug).toBe("synthetic-peer");
    // The staging slug ("review") is NOT what the adopted row discloses.
    expect(row?.slug).not.toBe("review");
  });
});
