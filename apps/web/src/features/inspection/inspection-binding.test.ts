import { describe, expect, it, vi } from "vitest";
import {
  OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { createInspectionCommands } from "@octos-org/octoscode-client/inspection";
import { SessionRecordManager } from "../session/session-record-manager.ts";
import { createInspectionBinding } from "./inspection-binding.ts";
import { createInspectionController } from "./inspection-controller.ts";
const A = "coding:local:A";
const B = "coding:local:B";
const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    "session/open",
    "session/hydrate",
    "turn/start",
    "thread/graph/get",
    "turn/state/get",
    "approval/scopes/list",
  ],
  supported_features: ["state.thread_graph.v1", "state.turn_state_get.v1"],
  supported_notifications: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function harness() {
  const client = new OctosUiClient({ endpoint: "ws://server.test/ui" });
  const pool = { client, epoch: 1 };
  vi.spyOn(client, "status", "get").mockReturnValue("connected");
  vi.spyOn(client, "subscribeStatus").mockImplementation((fn) => {
    fn("connected");
    return () => undefined;
  });
  vi.spyOn(client, "subscribeErrors").mockReturnValue(() => undefined);
  vi.spyOn(client, "subscribeNotifications").mockReturnValue(() => undefined);
  vi.spyOn(client, "listConfigCapabilities").mockResolvedValue({
    capabilities: caps,
  });
  vi.spyOn(client, "openSession").mockImplementation(async (params) => ({
    opened: {
      session_id: params.session_id,
      active_profile_id: params.profile_id ?? "coding",
      workspace_root: params.cwd ?? "/srv/project",
      capabilities: caps,
    },
  }));
  const hydrate = vi
    .spyOn(client, "hydrateSession")
    .mockImplementation(async (params) => ({
      session_id: params.session_id,
      cursor: { stream: params.session_id, seq: 0 },
      messages: [],
      turns: [],
    }));
  const rpc = vi.fn(
    async (_method: string, params: unknown): Promise<unknown> => {
      const owner = (params as { session_id: string }).session_id;
      return {
        session_id: owner,
        cursor: { stream: owner, seq: 0 },
        threads: [],
        orphans: [],
      };
    },
  );
  const factory = vi
    .spyOn(client, "inspectionCommands")
    .mockImplementation(
      async (sessionId, profileId, capabilities, authority = client) =>
        createInspectionCommands(
          { request: rpc },
          { sessionId, profileId, authority },
          capabilities,
        ),
    );
  const manager = new SessionRecordManager({
    pooledClient: () => pool.client,
    authorityEpoch: () => pool.epoch,
    onSelectedEvent: () => undefined,
    onSelectedSnapshot: () => undefined,
    onBackgroundActivity: () => undefined,
    cursorFor: () => undefined,
    validateServerCapabilities: () => undefined,
    validateSessionCapabilities: () => undefined,
    controllerDependencies: (scope, owner) => ({
      client: owner,
      sessionId: () => scope.sessionId,
      canEnqueue: () => true,
      canStart: () => false,
      canInterrupt: () => false,
      setTimeline: () => {
        throw new Error("Inspection escaped the record reducer");
      },
      setConnectionError: () => undefined,
    }),
  });
  const open = (sessionId: string) =>
    manager.openOnRecord(
      {
        endpoint: "ws://server.test/ui",
        token: "",
        sessionId,
        profileId: "coding",
        cwd: "/srv/project",
      },
      client,
      new AbortController().signal,
    );
  return { client, pool, manager, open, hydrate, factory, rpc };
}
describe("inspection binding on the actual persistent record engine", () => {
  it("reads the captured background owner without selection, hydrate, timeline, or queue writes", async () => {
    const h = harness();
    const a = await h.open(A);
    const b = await h.open(B);
    h.manager.select(b.scope);
    a.queue.enqueue({
      turnId: "00000000-0000-4000-8000-000000000001",
      text: "first",
    });
    a.queue.enqueue({
      turnId: "00000000-0000-4000-8000-000000000002",
      text: "queued",
    });
    const before = a.queue.snapshot();
    const timeline = a.timeline;
    const binding = createInspectionBinding({
      manager: h.manager,
      record: a,
      isSourceCurrent: () =>
        h.pool.client === h.client && h.pool.epoch === a.scope.authorityEpoch,
    });
    const commands = await binding.commands();
    expect(await commands.readThreadGraph()).toMatchObject({ session_id: A });
    expect(h.manager.selected()).toBe(b);
    expect(a.queue.snapshot()).toEqual(before);
    expect(a.timeline).toBe(timeline);
    expect(h.hydrate).toHaveBeenCalledTimes(2);
    expect(h.rpc).toHaveBeenCalledWith("thread/graph/get", { session_id: A });
    h.manager.retireAll();
  });
  it("rejects same-client epoch rotation while a lazy factory is pending", async () => {
    const h = harness();
    const record = await h.open(A);
    const binding = createInspectionBinding({
      manager: h.manager,
      record,
      isSourceCurrent: () =>
        h.pool.client === h.client &&
        h.pool.epoch === record.scope.authorityEpoch,
    });
    const delayed =
      deferred<Awaited<ReturnType<OctosUiClient["inspectionCommands"]>>>();
    h.factory.mockImplementationOnce(
      async (sessionId, profileId, capabilities, authority = h.client) => {
        const commands = createInspectionCommands(
          { request: h.rpc },
          { sessionId, profileId, authority },
          capabilities,
        );
        await delayed.promise;
        return commands;
      },
    );
    const task = binding.commands();
    h.pool.epoch += 1;
    delayed.resolve(
      createInspectionCommands(
        { request: h.rpc },
        { sessionId: A, profileId: "coding", authority: {} },
        caps,
      ),
    );
    await expect(task).rejects.toThrow("authority changed");
    expect(h.rpc).not.toHaveBeenCalled();
    h.manager.retireAll();
  });
  it("retiring the actual record discards an in-flight response without resurrecting its view", async () => {
    const h = harness();
    const record = await h.open(A);
    const controller = createInspectionController(
      createInspectionBinding({
        manager: h.manager,
        record,
        isSourceCurrent: () =>
          h.pool.client === h.client &&
          h.pool.epoch === record.scope.authorityEpoch,
      }),
    );
    const off = controller.subscribe(() => undefined);
    const reply = deferred<unknown>();
    h.rpc.mockReturnValue(reply.promise);
    const read = controller.load({ kind: "threads" });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    h.manager.retireAll();
    reply.resolve({
      session_id: A,
      cursor: { stream: A, seq: 0 },
      threads: [],
      orphans: [],
    });
    await read;
    expect(controller.getSnapshot()).toMatchObject({
      phase: "retired",
      result: null,
    });
    off();
  });
  it.each(["threads", "turn", "approval-scopes"] as const)(
    "fences direct %s reads before RPC and after reply on same-client source change",
    async (kind) => {
      const h = harness();
      const record = await h.open(A);
      const binding = createInspectionBinding({
        manager: h.manager,
        record,
        isSourceCurrent: () =>
          h.pool.client === h.client &&
          h.pool.epoch === record.scope.authorityEpoch,
      });
      const commands = await binding.commands();
      const response = deferred<unknown>();
      h.rpc.mockReturnValue(response.promise);
      const turnId = "00000000-0000-4000-8000-000000000011";
      const read = () =>
        kind === "threads"
          ? commands.readThreadGraph()
          : kind === "turn"
            ? commands.readTurnState(turnId)
            : commands.readApprovalScopes();
      const pending = read();
      expect(h.rpc).toHaveBeenCalledTimes(1);
      h.pool.epoch += 1;
      response.resolve(
        kind === "threads"
          ? {
              session_id: A,
              cursor: { stream: A, seq: 0 },
              threads: [],
              orphans: [],
            }
          : kind === "turn"
            ? { session_id: A, turn_id: turnId, state: "unknown" }
            : { scopes: [] },
      );
      await expect(pending).rejects.toThrow("authority changed");
      await expect(read()).rejects.toThrow("authority changed");
      expect(h.rpc).toHaveBeenCalledTimes(1);
      h.manager.retireAll();
    },
  );
});
