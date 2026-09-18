import { describe, expect, it, vi } from "vitest";
import {
  CORE_UI_METHODS,
  OctosUiClient,
  type RpcNotification,
  type SessionHydrateResult,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { APPUI_SNAPSHOT_METHODS } from "@octos-org/octoscode-client/history";
import { SessionRecordManager } from "../session/session-record-manager.ts";
import { conversationCheckpoints } from "./checkpoints.ts";
import {
  createHistoryBinding,
  historySupported,
  type HistoryCommands,
} from "./history-binding.ts";
import { HistoryCoordinator } from "./history-coordinator.ts";

const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.SESSION_OPEN,
    CORE_UI_METHODS.SESSION_HYDRATE,
    CORE_UI_METHODS.SESSION_ROLLBACK,
    CORE_UI_METHODS.SESSION_FORK,
    CORE_UI_METHODS.TURN_START,
    APPUI_SNAPSHOT_METHODS.LIST,
    APPUI_SNAPSHOT_METHODS.RESTORE,
  ],
  supported_notifications: [],
  supported_features: [],
};
const A = "coding:local:A";
const B = "coding:local:B";
function thread(
  sessionId: string,
  prompts = ["earlier", "target"],
): SessionHydrateResult {
  return {
    session_id: sessionId,
    cursor: { stream: sessionId, seq: 10 },
    turns: [],
    messages: prompts.map((content, index) => ({
      seq: index,
      role: "user",
      thread_id: `thread-${index}`,
      message_id: `message-${index}`,
      content,
      persisted_at: "2026-09-06T00:00:00Z",
      media: [],
    })),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let index = 0; index < 25; index += 1) await Promise.resolve();
}

/** Real client public-method spies; real record manager/runtime/controller/queue. */
function harness(capabilities = caps) {
  const client = new OctosUiClient({ endpoint: "ws://server.test/ui" });
  const pool = { client, epoch: 1, allowStart: true };
  const histories = new Map<string, SessionHydrateResult>();
  const notifications = new Set<(event: RpcNotification) => void>();
  vi.spyOn(client, "status", "get").mockReturnValue("connected");
  vi.spyOn(client, "subscribeStatus").mockImplementation((listener) => {
    listener("connected");
    return () => undefined;
  });
  vi.spyOn(client, "subscribeErrors").mockReturnValue(() => undefined);
  vi.spyOn(client, "subscribeNotifications").mockImplementation((listener) => {
    notifications.add(listener);
    return () => {
      notifications.delete(listener);
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
        active_profile_id: params.profile_id ?? "coding",
        workspace_root: params.cwd ?? "/srv/project",
        capabilities,
      },
    }));
  const hydrateRpc = vi
    .spyOn(client, "hydrateSession")
    .mockImplementation(
      async (params) =>
        histories.get(params.session_id) ?? thread(params.session_id),
    );
  const startRpc = vi.spyOn(client, "startTurn").mockResolvedValue({});
  const commandsBySession = new Map<string, HistoryCommands>();
  function commandsFor(sessionId: string) {
    let commands = commandsBySession.get(sessionId);
    if (commands) return commands;
    commands = {
      listSnapshots: vi.fn(async () => ({
        session_id: sessionId,
        enabled: true,
        available: true,
        snapshots: [
          { id: "snapshot-1", label: "Before edit", timestamp_unix: 1 },
        ],
      })),
      restoreSnapshot: vi.fn(async (snapshotId: string) => ({
        session_id: sessionId,
        restored: snapshotId,
        snapshots: [],
      })),
      rewind: vi.fn(async (numTurns: number) => {
        const prior = histories.get(sessionId) ?? thread(sessionId);
        const next = {
          ...prior,
          messages: prior.messages?.slice(0, -numTurns) ?? [],
        };
        histories.set(sessionId, next);
        return { dropped_turns: numTurns, thread: next };
      }),
      fork: vi.fn(async (name: string) => {
        const child = `coding:local:${name}`;
        const prior = histories.get(sessionId) ?? thread(sessionId);
        histories.set(child, {
          ...prior,
          session_id: child,
          cursor: { stream: child, seq: 10 },
        });
        return {
          parent_session_id: sessionId,
          new_session_id: child,
          copied_messages: prior.messages?.length ?? 0,
        };
      }),
      startReview: vi.fn(async () => {
        throw new Error("Review is outside history");
      }),
    };
    commandsBySession.set(sessionId, commands);
    return commands;
  }
  const factory = vi
    .spyOn(client, "historyCommands")
    .mockImplementation(async (sessionId) => commandsFor(sessionId));
  let manager: SessionRecordManager<OctosUiClient>;
  manager = new SessionRecordManager({
    pooledClient: () => pool.client,
    authorityEpoch: () => pool.epoch,
    onSelectedEvent: () => undefined,
    onSelectedSnapshot: () => undefined,
    onBackgroundActivity: () => undefined,
    cursorFor: () => undefined,
    validateServerCapabilities: () => undefined,
    validateSessionCapabilities: () => undefined,
    controllerDependencies: (scope, recordClient) => {
      const ready = () =>
        manager.get(scope)?.runtime.getSnapshot().phase === "ready";
      return {
        client: recordClient,
        sessionId: () => scope.sessionId,
        canEnqueue: ready,
        canStart: () => ready() && pool.allowStart,
        canInterrupt: ready,
        setTimeline: () => {
          throw new Error("Escaped record reducer");
        },
        setConnectionError: () => undefined,
      };
    },
  });
  const open = (
    sessionId: string,
    profileId = "coding",
    cwd = "/srv/project",
  ) =>
    manager.openOnRecord(
      {
        endpoint: "ws://server.test/ui",
        token: "",
        sessionId,
        profileId,
        cwd,
      },
      client,
      new AbortController().signal,
    );
  return {
    client,
    pool,
    histories,
    notifications,
    openRpc,
    hydrateRpc,
    startRpc,
    factory,
    commandsFor,
    manager,
    open,
  };
}

describe("record-scoped history coordinator", () => {
  it("rewinds and reconciles A's actual timeline/controller after selection changes to B", async () => {
    const h = harness();
    const a = await h.open(A);
    const b = await h.open(B);
    h.manager.select(a.scope);
    const queue = a.queue;
    const controller = a.controller;
    const response = deferred<Awaited<ReturnType<HistoryCommands["rewind"]>>>();
    const rewind = vi
      .mocked(h.commandsFor(A).rewind)
      .mockReturnValue(response.promise);
    const applyPrefill = vi.fn(() => true);
    const binding = createHistoryBinding({
      manager: h.manager,
      record: a,
      applyPrefill,
    });
    const coordinator = new HistoryCoordinator(binding, "rewind");
    const off = coordinator.subscribe(() => undefined);
    const checkpoint = conversationCheckpoints(thread(A))[0]!;
    const task = coordinator.apply({ mode: "rewind", checkpoint });
    await flush();
    expect(rewind).toHaveBeenCalledWith(1);
    h.manager.select(b.scope);
    h.histories.set(A, thread(A, ["earlier"]));
    response.resolve({
      dropped_turns: 1,
      thread: thread(A, ["ignored response projection"]),
    });
    await task;
    expect(h.manager.selected()).toBe(b);
    expect(a.queue).toBe(queue);
    expect(a.controller).toBe(controller);
    expect(a.timeline.map((row) => row.body)).toEqual(["earlier"]);
    expect(b.timeline.map((row) => row.body)).toEqual(["earlier", "target"]);
    expect(a.controller.snapshot()).toEqual({ active: null, pending: [] });
    expect(applyPrefill).toHaveBeenCalledWith(a.scope, "target");
    expect(coordinator.getSnapshot()).toMatchObject({
      completed: true,
      prefillApplied: true,
    });
    off();
  });

  it("reserves the actual queue before the lazy commands factory resolves", async () => {
    const h = harness();
    const record = await h.open(A);
    const gate = deferred<HistoryCommands>();
    h.factory.mockReturnValue(gate.promise);
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record }),
      "rewind",
    );
    const task = coordinator.apply({
      mode: "rewind",
      checkpoint: conversationCheckpoints(thread(A))[0]!,
    });
    expect(
      record.controller.enqueueTurn({
        turnId: "unsent",
        text: "must not disappear",
      }),
    ).toBe(false);
    expect(h.startRpc).not.toHaveBeenCalled();
    gate.resolve(h.commandsFor(A));
    await task;
    expect(coordinator.getSnapshot().completed).toBe(true);
    expect(
      record.controller.enqueueTurn({ turnId: "next", text: "now allowed" }),
    ).toBe(true);
  });

  it("blocks active and queued work before sending any history RPC", async () => {
    const h = harness();
    const record = await h.open(A);
    h.pool.allowStart = false;
    record.controller.enqueueTurn({ turnId: "first", text: "first" });
    record.controller.enqueueTurn({ turnId: "second", text: "second" });
    const before = record.queue.snapshot();
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record }),
      "rewind",
    );
    await coordinator.apply({
      mode: "rewind",
      checkpoint: conversationCheckpoints(thread(A))[0]!,
    });
    expect(h.factory).not.toHaveBeenCalled();
    expect(record.queue.snapshot()).toEqual(before);
    expect(coordinator.getSnapshot().error).toContain("queued prompts");
  });

  it("workspace undo blocks busy sibling profiles but not a different workspace", async () => {
    const h = harness();
    const a = await h.open(A);
    const sibling = await h.open("review:local:B", "review");
    h.pool.allowStart = false;
    sibling.controller.enqueueTurn({
      turnId: "busy",
      text: "editing same files",
    });
    const binding = createHistoryBinding({ manager: h.manager, record: a });
    const coordinator = new HistoryCoordinator(binding, "undo");
    await coordinator.apply({ mode: "undo", snapshotId: "snapshot-1" });
    expect(h.commandsFor(A).restoreSnapshot).not.toHaveBeenCalled();
    const elsewhere = await h.open(
      "coding:local:elsewhere",
      "coding",
      "/srv/other",
    );
    expect(
      createHistoryBinding({
        manager: h.manager,
        record: elsewhere,
      }).blockedReason("undo"),
    ).toBeNull();
  });

  it("undo reconciles the owner without replacing conversation contents", async () => {
    const h = harness();
    const record = await h.open(A);
    h.hydrateRpc.mockClear();
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record }),
      "undo",
    );
    await coordinator.apply({ mode: "undo", snapshotId: "snapshot-1" });
    expect(h.commandsFor(A).restoreSnapshot).toHaveBeenCalledExactlyOnceWith(
      "snapshot-1",
    );
    expect(h.hydrateRpc).toHaveBeenCalledOnce();
    expect(record.timeline.map((row) => row.body)).toEqual([
      "earlier",
      "target",
    ]);
    expect(coordinator.getSnapshot().notice).toContain(
      "Conversation history was not changed",
    );
  });

  it("retained closed peer tombstones do not block another record's workspace undo", async () => {
    const h = harness();
    const owner = await h.open(A);
    const peer = await h.open("coding:local:tui#peer-closed");
    const peerBinding = createHistoryBinding({
      manager: h.manager,
      record: peer,
    });
    expect(h.manager.closeRetainedRecord(peer)).toBe(true);
    expect(peerBinding.isCurrent()).toBe(false);
    const binding = createHistoryBinding({ manager: h.manager, record: owner });
    expect(binding.blockedReason("undo")).toBeNull();
    const coordinator = new HistoryCoordinator(binding, "undo");
    await coordinator.apply({ mode: "undo", snapshotId: "snapshot-1" });
    expect(coordinator.getSnapshot().completed).toBe(true);
    expect(h.commandsFor(A).restoreSnapshot).toHaveBeenCalledOnce();
    expect(peer.closed).toBe(true);
  });

  it("recomputes checkpoint identity against fresh history and refuses a replaced target", async () => {
    const h = harness();
    const record = await h.open(A);
    const checkpoint = conversationCheckpoints(thread(A))[0]!;
    h.histories.set(A, thread(A, ["earlier", "replacement"]));
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record }),
      "rewind",
    );
    await coordinator.apply({ mode: "rewind", checkpoint });
    expect(h.commandsFor(A).rewind).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot().error).toContain("History changed");
  });

  it("preserves an occupied owning draft and exposes the removed prompt", async () => {
    const h = harness();
    const record = await h.open(A);
    const applyPrefill = vi.fn(() => false);
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record, applyPrefill }),
      "rewind",
    );
    await coordinator.apply({
      mode: "rewind",
      checkpoint: conversationCheckpoints(thread(A))[0]!,
    });
    expect(coordinator.getSnapshot()).toMatchObject({
      completed: true,
      prefill: "target",
      prefillApplied: false,
    });
  });

  it("continues canonical reconciliation after the dialog unmounts without selecting the owner", async () => {
    const h = harness();
    const a = await h.open(A);
    const b = await h.open(B);
    h.manager.select(b.scope);
    const gate = deferred<Awaited<ReturnType<HistoryCommands["rewind"]>>>();
    vi.mocked(h.commandsFor(A).rewind).mockReturnValue(gate.promise);
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record: a }),
      "rewind",
    );
    const off = coordinator.subscribe(() => undefined);
    const task = coordinator.apply({
      mode: "rewind",
      checkpoint: conversationCheckpoints(thread(A))[0]!,
    });
    await flush();
    off();
    h.histories.set(A, thread(A, []));
    gate.resolve({ dropped_turns: 1, thread: thread(A, []) });
    await task;
    expect(a.timeline).toEqual([]);
    expect(h.manager.selected()).toBe(b);
    expect(
      a.controller.enqueueTurn({ turnId: "next", text: "lease released" }),
    ).toBe(true);
  });

  it("opens the server's exact fork identity in the background without a kickoff", async () => {
    const h = harness();
    const a = await h.open(A);
    const b = await h.open(B);
    h.manager.select(b.scope);
    h.openRpc.mockClear();
    h.hydrateRpc.mockClear();
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record: a }),
      "fork",
    );
    await coordinator.apply({ mode: "fork", name: "branch" });
    expect(h.openRpc).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        session_id: "coding:local:branch",
        profile_id: "coding",
        cwd: "/srv/project",
      }),
    );
    expect(
      h.hydrateRpc.mock.calls.map(([params]) => params.session_id),
    ).toEqual([A, "coding:local:branch"]);
    expect(
      h.manager
        .records()
        .find((record) => record.scope.sessionId === "coding:local:branch")
        ?.timeline,
    ).toHaveLength(2);
    expect(h.manager.selected()).toBe(b);
    expect(h.startRpc).not.toHaveBeenCalled();
  });

  it.each(["factory", "fresh history", "mutation", "canonical refresh"])(
    "fences %s results after owner eviction",
    async (stage) => {
      const h = harness();
      const record = await h.open(A);
      const binding = createHistoryBinding({ manager: h.manager, record });
      const coordinator = new HistoryCoordinator(binding, "rewind");
      const commandGate = deferred<HistoryCommands>();
      const historyGate = deferred<SessionHydrateResult>();
      const mutationGate =
        deferred<Awaited<ReturnType<HistoryCommands["rewind"]>>>();
      if (stage === "factory") h.factory.mockReturnValue(commandGate.promise);
      if (stage === "fresh history")
        h.hydrateRpc.mockReturnValue(historyGate.promise);
      if (stage === "mutation")
        vi.mocked(h.commandsFor(A).rewind).mockReturnValue(
          mutationGate.promise,
        );
      if (stage === "canonical refresh")
        h.hydrateRpc
          .mockResolvedValueOnce(thread(A))
          .mockReturnValueOnce(historyGate.promise);
      const task = coordinator.apply({
        mode: "rewind",
        checkpoint: conversationCheckpoints(thread(A))[0]!,
      });
      await flush();
      h.manager.evict(record.scope);
      const before = record.timeline;
      commandGate.resolve(h.commandsFor(A));
      historyGate.resolve(thread(A, ["foreign late result"]));
      mutationGate.resolve({ dropped_turns: 1, thread: thread(A, []) });
      await task;
      expect(binding.isCurrent()).toBe(false);
      expect(record.timeline).toBe(before);
      expect(h.manager.records()).toEqual([]);
      expect(coordinator.getSnapshot().completed).toBe(false);
      if (stage === "factory" || stage === "fresh history")
        expect(h.commandsFor(A).rewind).not.toHaveBeenCalled();
    },
  );

  it("fences an old binding after the same record is reopened on the same client", async () => {
    const h = harness();
    const record = await h.open(A);
    const gate = deferred<HistoryCommands>();
    h.factory.mockReturnValue(gate.promise);
    const binding = createHistoryBinding({ manager: h.manager, record });
    const coordinator = new HistoryCoordinator(binding, "fork");
    const task = coordinator.apply({ mode: "fork", name: "branch" });
    await h.open(A);
    gate.resolve(h.commandsFor(A));
    await task;
    expect(binding.isCurrent()).toBe(false);
    expect(h.commandsFor(A).fork).not.toHaveBeenCalled();
  });

  it("does not install a late fork after its parent's generation changes during child open", async () => {
    const h = harness();
    const record = await h.open(A);
    const childGate = deferred<SessionHydrateResult>();
    h.hydrateRpc.mockImplementation(async (params) =>
      params.session_id === A ? thread(A) : childGate.promise,
    );
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record }),
      "fork",
    );
    const task = coordinator.apply({ mode: "fork", name: "branch" });
    await flush();
    await h.open(A);
    childGate.resolve(thread("coding:local:branch"));
    await task;
    expect(h.manager.records().map((item) => item.scope.sessionId)).toEqual([
      A,
    ]);
    expect(h.startRpc).not.toHaveBeenCalled();
  });

  it("retries failed canonical refresh without repeating an accepted rollback", async () => {
    const h = harness();
    const record = await h.open(A);
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record }),
      "rewind",
    );
    const off = coordinator.subscribe(() => undefined);
    h.hydrateRpc
      .mockResolvedValueOnce(thread(A))
      .mockRejectedValueOnce(new Error("refresh lost"));
    const selection = {
      mode: "rewind" as const,
      checkpoint: conversationCheckpoints(thread(A))[0]!,
    };
    await coordinator.apply(selection);
    expect(coordinator.getSnapshot()).toMatchObject({
      canRetryRefresh: true,
      completed: false,
    });
    expect(record.runtime.getSnapshot().phase).toBe("error");
    expect(
      record.controller.enqueueTurn({ turnId: "unsafe", text: "wait" }),
    ).toBe(false);
    await coordinator.apply(selection);
    await coordinator.retryRefresh();
    expect(h.commandsFor(A).rewind).toHaveBeenCalledOnce();
    expect(coordinator.getSnapshot()).toMatchObject({
      canRetryRefresh: false,
      completed: true,
    });
    expect(record.runtime.getSnapshot().phase).toBe("ready");
    expect(record.timeline.map((row) => row.body)).toEqual(["earlier"]);
    off();
  });

  it("does not replay an ambiguous rollback, even on repeated confirm", async () => {
    const h = harness();
    const record = await h.open(A);
    vi.mocked(h.commandsFor(A).rewind).mockRejectedValue(
      new Error("response lost"),
    );
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record }),
      "rewind",
    );
    const selection = {
      mode: "rewind" as const,
      checkpoint: conversationCheckpoints(thread(A))[0]!,
    };
    await coordinator.apply(selection);
    await coordinator.apply(selection);
    expect(h.commandsFor(A).rewind).toHaveBeenCalledOnce();
    expect(coordinator.getSnapshot()).toMatchObject({
      uncertain: true,
      completed: false,
    });
  });

  it("blocks a waiting interaction even without a locally active turn", async () => {
    const h = harness();
    const record = await h.open(A);
    record.interactions.observe(
      record.scope,
      {
        kind: "approval",
        generation: record.runtime.currentAuthority()!.generation,
        turnId: "waiting",
        requestId: "approval-1",
        title: "Run command?",
      },
      { background: true },
    );
    expect(record.queue.snapshot().active).toBeNull();
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record }),
      "fork",
    );
    await coordinator.apply({ mode: "fork", name: "branch" });
    expect(h.factory).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot().error).toContain("questions");
  });

  it.each(["epoch", "client"] as const)(
    "fences mutation after pooled %s changes during factory resolution",
    async (change) => {
      const h = harness();
      const record = await h.open(A);
      const gate = deferred<HistoryCommands>();
      h.factory.mockReturnValue(gate.promise);
      const coordinator = new HistoryCoordinator(
        createHistoryBinding({ manager: h.manager, record }),
        "fork",
      );
      const task = coordinator.apply({ mode: "fork", name: "branch" });
      if (change === "epoch") h.pool.epoch += 1;
      else
        h.pool.client = new OctosUiClient({ endpoint: "ws://other.test/ui" });
      gate.resolve(h.commandsFor(A));
      await task;
      expect(h.commandsFor(A).fork).not.toHaveBeenCalled();
      expect(coordinator.getSnapshot().completed).toBe(false);
    },
  );

  it.each(["workspace", "profile", "missing workspace"])(
    "rejects a fork opened with a foreign %s without installing it",
    async (mismatch) => {
      const h = harness();
      const record = await h.open(A);
      h.openRpc.mockResolvedValue({
        opened: {
          session_id: "coding:local:branch",
          active_profile_id: mismatch === "profile" ? "other" : "coding",
          ...(mismatch !== "missing workspace"
            ? {
                workspace_root:
                  mismatch === "workspace" ? "/srv/elsewhere" : "/srv/project",
              }
            : {}),
          capabilities: caps,
        },
      });
      const coordinator = new HistoryCoordinator(
        createHistoryBinding({ manager: h.manager, record }),
        "fork",
      );
      const off = coordinator.subscribe(() => undefined);
      await coordinator.apply({ mode: "fork", name: "branch" });
      expect(h.manager.records()).toEqual([record]);
      expect(coordinator.getSnapshot()).toMatchObject({
        completed: false,
        canRetryRefresh: true,
        forkedSessionId: "coding:local:branch",
      });
      expect(h.commandsFor(A).fork).toHaveBeenCalledOnce();
      off();
    },
  );

  it("retries a rejected child open using the acknowledged identity, never forks twice", async () => {
    const h = harness();
    const record = await h.open(A);
    h.openRpc.mockRejectedValueOnce(new Error("open temporarily unavailable"));
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record }),
      "fork",
    );
    const off = coordinator.subscribe(() => undefined);
    await coordinator.apply({ mode: "fork", name: "branch" });
    expect(coordinator.getSnapshot().canRetryRefresh).toBe(true);
    await coordinator.retryRefresh();
    expect(h.commandsFor(A).fork).toHaveBeenCalledOnce();
    expect(coordinator.getSnapshot().completed).toBe(true);
    expect(h.manager.records()).toHaveLength(2);
    off();
  });

  it("drops a stale list load and retains a stable snapshot between changes", async () => {
    const h = harness();
    const record = await h.open(A);
    const binding = createHistoryBinding({ manager: h.manager, record });
    const coordinator = new HistoryCoordinator(binding, "undo");
    expect(coordinator.getSnapshot()).toBe(coordinator.getSnapshot());
    const gate =
      deferred<Awaited<ReturnType<HistoryCommands["listSnapshots"]>>>();
    vi.mocked(h.commandsFor(A).listSnapshots).mockReturnValue(gate.promise);
    const task = coordinator.load();
    await flush();
    h.manager.evict(record.scope);
    gate.resolve({
      session_id: A,
      enabled: true,
      available: true,
      snapshots: [
        { id: "late", label: "private old scope", timestamp_unix: 1 },
      ],
    });
    await task;
    expect(coordinator.getSnapshot().snapshots).toBeNull();
  });

  it("rejects foreign hydration before rollback and foreign fork parent before opening", async () => {
    const h = harness();
    const record = await h.open(A);
    const binding = createHistoryBinding({ manager: h.manager, record });
    h.hydrateRpc.mockResolvedValueOnce(thread(B));
    const rewind = new HistoryCoordinator(binding, "rewind");
    await rewind.apply({
      mode: "rewind",
      checkpoint: conversationCheckpoints(thread(A))[0]!,
    });
    expect(h.commandsFor(A).rewind).not.toHaveBeenCalled();
    vi.mocked(h.commandsFor(A).fork).mockResolvedValue({
      parent_session_id: B,
      new_session_id: "coding:local:branch",
      copied_messages: 2,
    });
    h.openRpc.mockClear();
    const fork = new HistoryCoordinator(binding, "fork");
    await fork.apply({ mode: "fork", name: "branch" });
    expect(h.openRpc).not.toHaveBeenCalled();
  });

  it.each(["undo", "rewind", "fork"] as const)(
    "gates %s on generated methods and canonical refresh",
    async (mode) => {
      expect(historySupported(caps, mode)).toBe(true);
      const missing = {
        ...caps,
        supported_methods: caps.supported_methods.filter(
          (method) => method !== CORE_UI_METHODS.SESSION_HYDRATE,
        ),
      };
      expect(historySupported(missing, mode)).toBe(false);
      const h = harness(missing);
      const record = await h.open(A);
      const coordinator = new HistoryCoordinator(
        createHistoryBinding({ manager: h.manager, record }),
        mode,
      );
      await coordinator.apply(
        mode === "undo"
          ? { mode, snapshotId: "snapshot-1" }
          : mode === "fork"
            ? { mode, name: "branch" }
            : { mode, checkpoint: conversationCheckpoints(thread(A))[0]! },
      );
      expect(h.factory).not.toHaveBeenCalled();
      expect(coordinator.getSnapshot().error).toContain(
        "required history methods",
      );
    },
  );
});
