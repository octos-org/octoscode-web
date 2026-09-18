import { describe, expect, it, vi } from "vitest";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  OctosUiClient,
  isRecord,
  type RpcNotification,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { createHistoryCommands } from "@octos-org/octoscode-client/history";
import { SessionRecordManager } from "../session/session-record-manager.ts";
import {
  NATIVE_REVIEW_BLOCK_REASONS,
  createNativeReviewBinding,
  nativeReviewSupported,
} from "./native-review.ts";

const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.SESSION_OPEN,
    CORE_UI_METHODS.SESSION_HYDRATE,
    CORE_UI_METHODS.TURN_START,
    CORE_UI_METHODS.REVIEW_START,
  ],
  supported_notifications: [],
  supported_features: [CORE_UI_FEATURES.REVIEW_START_V1],
};
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
function harness(capabilities = caps) {
  const client = new OctosUiClient({ endpoint: "ws://server.test/ui" });
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
  vi.spyOn(client, "openSession").mockImplementation(async (params) => ({
    opened: {
      session_id: params.session_id,
      active_profile_id: "coding",
      workspace_root: "/srv/project",
      capabilities,
    },
  }));
  vi.spyOn(client, "hydrateSession").mockImplementation(async (params) => ({
    session_id: params.session_id,
    cursor: { stream: params.session_id, seq: 1 },
    turns: [],
    messages: [],
  }));
  const start = vi.spyOn(client, "startTurn").mockResolvedValue({});
  const rpc = vi.fn(async (method: string, params: unknown) => {
    if (method !== CORE_UI_METHODS.REVIEW_START || !isRecord(params))
      throw new Error("Unexpected review RPC");
    return {
      accepted: true,
      session_id: params.session_id,
      turn_id: params.turn_id,
      workflow: "code_review",
      backend: "native",
      agent_count: 3,
    };
  });
  const factory = vi
    .spyOn(client, "historyCommands")
    .mockImplementation(async (sessionId, confirmedCaps) =>
      createHistoryCommands({ request: rpc }, sessionId, confirmedCaps),
    );
  let manager: SessionRecordManager<OctosUiClient>;
  manager = new SessionRecordManager({
    pooledClient: () => client,
    authorityEpoch: () => 1,
    onSelectedEvent: () => undefined,
    onSelectedSnapshot: () => undefined,
    onBackgroundActivity: () => undefined,
    cursorFor: () => undefined,
    validateServerCapabilities: () => undefined,
    validateSessionCapabilities: () => undefined,
    controllerDependencies: (scope, recordClient) => ({
      client: recordClient,
      sessionId: () => scope.sessionId,
      canEnqueue: () => true,
      canStart: () => true,
      canInterrupt: () => true,
      setTimeline: () => {
        throw new Error("Escaped record reducer");
      },
      setConnectionError: () => undefined,
      async startReview(request) {
        const record = manager.get(scope);
        const authority = record?.runtime.currentAuthority();
        if (
          !record ||
          !authority?.capabilities ||
          authority.client !== request.client ||
          scope.sessionId !== request.sessionId
        )
          throw new Error("Review record unavailable");
        const commands = await request.client.historyCommands(
          request.sessionId,
          authority.capabilities,
        );
        if (
          !request.isCurrent() ||
          !record.runtime.isCurrent(authority) ||
          manager.get(scope) !== record
        )
          throw new Error("Review authority changed");
        request.markSent();
        return commands.startReview(request.turnId, request.prompt);
      },
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
  return { client, manager, factory, rpc, start, open, notifications };
}

describe("native review confirmed-record binding", () => {
  it("requires the generated review method AND feature and respects explicit unsupported", () => {
    expect(nativeReviewSupported(caps)).toBe(true);
    expect(nativeReviewSupported(undefined)).toBe(false);
    expect(nativeReviewSupported({ ...caps, supported_features: [] })).toBe(
      false,
    );
    expect(nativeReviewSupported({ ...caps, supported_methods: [] })).toBe(
      false,
    );
    expect(
      nativeReviewSupported({
        ...caps,
        unsupported: [
          { method: CORE_UI_METHODS.REVIEW_START, reason: "disabled" },
        ],
      }),
    ).toBe(false);
  });

  it("sends one native UUID for A after B is selected without focus mutation or turn/start", async () => {
    const h = harness();
    const a = await h.open("coding:local:A");
    const b = await h.open("coding:local:B");
    h.manager.select(a.scope);
    const binding = createNativeReviewBinding({
      manager: h.manager,
      record: a,
    });
    h.manager.select(b.scope);
    const turnId = binding.start("  check error paths  ");
    expect(() => binding.start("duplicate")).toThrow("active turn");
    await flush();
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith(
      CORE_UI_METHODS.REVIEW_START,
      {
        session_id: a.scope.sessionId,
        turn_id: turnId,
        delivery: "inline",
        prompt: "check error paths",
      },
    );
    expect(h.start).not.toHaveBeenCalled();
    expect(h.manager.selected()).toBe(b);
    expect(a.controller.backgroundHandoffTurn()).toMatchObject({
      turnId,
      state: "running",
    });
    expect(a.timeline.some((row) => row.title === "Native code review")).toBe(
      true,
    );
    expect(b.timeline).toEqual([]);
  });

  it("shares the real record FIFO and drains ordinary prompts on review terminal", async () => {
    const h = harness();
    const a = await h.open("coding:local:A");
    const b = await h.open("coding:local:B");
    h.manager.select(b.scope);
    const turnId = createNativeReviewBinding({
      manager: h.manager,
      record: a,
    }).start("");
    a.controller.enqueueTurn({ turnId: "next", text: "follow up" });
    await flush();
    expect(h.start).not.toHaveBeenCalled();
    for (const listener of h.notifications)
      listener({
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.TURN_COMPLETED,
        params: { session_id: a.scope.sessionId, turn_id: turnId },
      });
    await flush();
    expect(h.start).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        session_id: a.scope.sessionId,
        turn_id: "next",
      }),
    );
    expect(h.manager.selected()).toBe(b);
    expect(a.controller.snapshot().active?.turnId).toBe("next");
  });

  it("keeps unsupported, queued, and waiting interactions out of native review", async () => {
    const unavailable = harness({ ...caps, supported_features: [] });
    const record = await unavailable.open("coding:local:A");
    expect(() =>
      createNativeReviewBinding({ manager: unavailable.manager, record }).start(
        "",
      ),
    ).toThrow("does not advertise");
    expect(unavailable.factory).not.toHaveBeenCalled();
    const h = harness();
    const active = await h.open("coding:local:A");
    const binding = createNativeReviewBinding({
      manager: h.manager,
      record: active,
    });
    active.interactions.observe(
      active.scope,
      {
        kind: "approval",
        generation: active.runtime.currentAuthority()!.generation,
        turnId: "waiting",
        requestId: "approval",
        title: "Confirm?",
      },
      { background: true },
    );
    expect(() => binding.start("")).toThrow("questions");
    active.interactions.clear();
    active.controller.enqueuePrompt("first");
    active.controller.enqueuePrompt("second");
    expect(() => binding.start("")).toThrow("queued prompts");
    expect(h.factory).not.toHaveBeenCalled();
  });

  it("rejects stale and closed record bindings", async () => {
    const h = harness();
    const record = await h.open("coding:local:A");
    const binding = createNativeReviewBinding({ manager: h.manager, record });
    await h.open(record.scope.sessionId);
    expect(binding.isCurrent()).toBe(false);
    expect(() => binding.start("")).toThrow("authority changed");
    const current = createNativeReviewBinding({ manager: h.manager, record });
    h.manager.closeRetainedRecord(record);
    expect(current.isCurrent()).toBe(false);
    expect(() => current.start("")).toThrow("authority changed");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("does not dispatch a resolved factory after its owning record is evicted", async () => {
    const h = harness();
    const record = await h.open("coding:local:A");
    const gate =
      deferred<Awaited<ReturnType<OctosUiClient["historyCommands"]>>>();
    h.factory.mockReturnValueOnce(gate.promise);
    createNativeReviewBinding({ manager: h.manager, record }).start("");
    h.manager.evict(record.scope);
    gate.resolve(
      createHistoryCommands({ request: h.rpc }, record.scope.sessionId, caps),
    );
    await flush();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.manager.records()).toEqual([]);
  });

  it("pins one typed reason per blocking state; idle plus capability is the only unblocked combination", async () => {
    // Server does not advertise the review capability.
    const unavailable = harness({ ...caps, supported_features: [] });
    const unsupportedRecord = await unavailable.open("coding:local:A");
    const unsupported = createNativeReviewBinding({
      manager: unavailable.manager,
      record: unsupportedRecord,
    });
    expect(unsupported.blockedReason()).toBe(
      NATIVE_REVIEW_BLOCK_REASONS.capabilityUnsupported,
    );

    // Idle record on a capable server is the ONLY unblocked combination.
    const h = harness();
    const record = await h.open("coding:local:A");
    const binding = createNativeReviewBinding({ manager: h.manager, record });
    expect(binding.blockedReason()).toBeNull();

    // A running or queued ordinary turn is one typed busy reason.
    record.controller.enqueuePrompt("first");
    record.controller.enqueuePrompt("second");
    const busy = binding.blockedReason();
    expect(busy).toBe(NATIVE_REVIEW_BLOCK_REASONS.sessionBusy);
    expect(busy).toContain("queued prompts");

    // A pending approval/question is its own distinct typed reason.
    const waiting = harness();
    const waitingRecord = await waiting.open("coding:local:A");
    const waitingBinding = createNativeReviewBinding({
      manager: waiting.manager,
      record: waitingRecord,
    });
    waitingRecord.interactions.observe(
      waitingRecord.scope,
      {
        kind: "approval",
        generation: waitingRecord.runtime.currentAuthority()!.generation,
        turnId: "waiting",
        requestId: "approval",
        title: "Confirm?",
      },
      { background: true },
    );
    const pending = waitingBinding.blockedReason();
    expect(pending).toBe(NATIVE_REVIEW_BLOCK_REASONS.sessionPendingInteraction);
    expect(pending).toContain("questions");
    // RED boundary: the pre-fix build returns ONE shared combined prose for
    // both withholding causes, so these two states are indistinguishable.
    // A specific typed reason per state means the two literals must differ.
    expect(pending).not.toBe(busy);
    waitingRecord.interactions.clear();
    expect(waitingBinding.blockedReason()).toBeNull();
  });

  it("keeps a previous selection's stale authority typed-blocked and never dispatches its late start", async () => {
    const h = harness();
    const record = await h.open("coding:local:A");
    const binding = createNativeReviewBinding({ manager: h.manager, record });
    const gate =
      deferred<Awaited<ReturnType<OctosUiClient["historyCommands"]>>>();
    h.factory.mockReturnValueOnce(gate.promise);
    // Admitted while idle; review/start is still in flight when the Session's
    // authority is replaced by re-opening the same Session.
    binding.start("");
    await h.open(record.scope.sessionId);
    expect(binding.isCurrent()).toBe(false);
    expect(binding.blockedReason()).toBe(
      NATIVE_REVIEW_BLOCK_REASONS.authorityChanged,
    );
    gate.resolve(
      createHistoryCommands({ request: h.rpc }, record.scope.sessionId, caps),
    );
    await flush();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
