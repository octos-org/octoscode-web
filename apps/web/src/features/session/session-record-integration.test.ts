import { describe, expect, it } from "vitest";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  type ConfigCapabilitiesListResult,
  type ConnectionStatus,
  type RpcNotification,
  type SessionHydrateParams,
  type SessionHydrateResult,
  type SessionOpenParams,
  type SessionOpenResult,
  type SessionOpened,
  type TurnStartParams,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { OctosUiProtocolError } from "@octos-org/octoscode-client/protocol";
import {
  SessionRecordManager,
  type SessionRecord,
} from "./session-record-manager.ts";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";
import type { TimelineEntry } from "../timeline/model.ts";

const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.SESSION_OPEN,
    CORE_UI_METHODS.SESSION_HYDRATE,
    CORE_UI_METHODS.TURN_START,
    CORE_UI_METHODS.TURN_INTERRUPT,
    CORE_UI_METHODS.APPROVAL_RESPOND,
    CORE_UI_METHODS.USER_QUESTION_RESPOND,
  ],
  supported_notifications: [],
  supported_features: [
    CORE_UI_FEATURES.PROJECTION_ENVELOPE_V2,
    CORE_UI_FEATURES.USER_QUESTION_V1,
  ],
};
function hydrate(
  sessionId: string,
  extra: Partial<SessionHydrateResult> = {},
): SessionHydrateResult {
  return {
    session_id: sessionId,
    cursor: { stream: sessionId, seq: 1 },
    turns: [],
    ...extra,
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
class PooledClient {
  status: ConnectionStatus = "connected";
  readonly starts: TurnStartParams[] = [];
  readonly opens: SessionOpenParams[] = [];
  readonly hydrates: SessionHydrateParams[] = [];
  readonly responses: unknown[] = [];
  readonly notifications = new Set<(n: RpcNotification) => void>();
  readonly statuses = new Set<(status: ConnectionStatus) => void>();
  startGate: ((params: TurnStartParams) => Promise<unknown>) | null = null;
  checkStart: (params: TurnStartParams) => void = () => undefined;
  openedFor: (sessionId: string) => SessionOpened = (sessionId) => ({
    session_id: sessionId,
    active_profile_id: "coding",
    workspace_root: "/srv/project",
    capabilities: caps,
  });
  hydratedFor: (
    sessionId: string,
  ) => SessionHydrateResult | Promise<SessionHydrateResult> = hydrate;
  async connect() {
    this.setStatus("connected");
  }
  disconnect() {
    this.setStatus("disconnected");
  }
  setStatus(status: ConnectionStatus) {
    this.status = status;
    const listeners = [...this.statuses];
    for (const listener of listeners) listener(status);
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
    return { capabilities: caps };
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
  async startTurn(params: TurnStartParams): Promise<unknown> {
    this.checkStart(params);
    this.starts.push(structuredClone(params));
    return this.startGate ? this.startGate(params) : {};
  }
  readonly driverGetRequests: Array<{
    sessionId: string;
    operations: unknown;
  }> = [];
  driverGetHandler:
    | ((sessionId: string, operations: unknown) => Promise<unknown> | unknown)
    | null = null;
  /** When set, externalDriverCommands itself waits on this gate (LOADER hang). */
  loaderGate: Promise<void> | null = null;
  /** When true, driverGet hangs at the PAGE level with a deferred control. */
  driverGetHandlerNeverSettles = false;
  /** Loader-entry observers keyed by the real session ID each call captured. */
  readonly loaderEntries: Array<{
    sessionId: string;
    resolve: () => void;
  }> = [];
  /** Resolves when a real driverGet call has ENTERED (page-level hang). */
  readonly driverGetEntered: Array<() => void> = [];
  /** Pending never-settling page promises' deferred controls, in call order. */
  readonly pendingPages: Array<{
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  /** Every REAL session argument each loader call received. */
  readonly loaderSessionArgs: string[] = [];
  async externalDriverCommands(
    sessionId: string,
    _profileId: string,
    _capabilities: UiProtocolCapabilities,
  ): Promise<
    import("@octos-org/octoscode-client/external-driver").ExternalDriverReadCommands
  > {
    // The gate is captured BEFORE the await so each loader holds ITS OWN
    // gate even if a later open changes the field.
    const capturedGate = this.loaderGate;
    // Capture the REAL per-call session identity BEFORE any await: a later
    // open on the same pooled client must never retarget a pending loader.
    const loaderSessionId = sessionId;
    this.loaderSessionArgs.push(loaderSessionId);
    for (let i = this.loaderEntries.length - 1; i >= 0; i -= 1) {
      const entry = this.loaderEntries[i]!;
      if (entry.sessionId !== loaderSessionId) continue;
      this.loaderEntries.splice(i, 1); // unmatched observers are RETAINED
      entry.resolve();
    }
    if (capturedGate !== null) await capturedGate;
    return {
      driverGet: async (
        options: Parameters<
          import("@octos-org/octoscode-client/external-driver").ExternalDriverCommands["driverGet"]
        >[0],
      ) => {
        this.driverGetRequests.push({
          sessionId: loaderSessionId,
          operations: structuredClone(options?.operations),
        });
        for (const signal of this.driverGetEntered.splice(0)) signal();
        // A handler that never settles leaves its deferred here so tests
        // can LATE-resolve/reject the actual old input after settlement.
        // Entry signals fire BEFORE this so observers see real entry.
        if (this.driverGetHandlerNeverSettles) {
          return new Promise<unknown>((resolve, reject) => {
            this.pendingPages.push({ resolve, reject });
          }) as Promise<
            import("@octos-org/octoscode-client/external-driver").SessionDriverGetWithOperationsView
          >;
        }
        const request = this.driverGetHandler;
        if (request === null) throw new Error("driverGet not configured");
        return request(loaderSessionId, options?.operations) as Promise<
          import("@octos-org/octoscode-client/external-driver").SessionDriverGetWithOperationsView
        >;
      },
      nextExpectedRevision: () => 0,
    };
  }
  async interruptTurn(): Promise<unknown> {
    return {};
  }
  async respondApproval(params: { approval_id: string }): Promise<unknown> {
    this.responses.push(params);
    return { approval_id: params.approval_id, accepted: true };
  }
  async respondUserQuestion(params: { question_id: string }): Promise<unknown> {
    this.responses.push(params);
    return { question_id: params.question_id, accepted: true };
  }
  emit(notification: RpcNotification) {
    const listeners = [...this.notifications];
    for (const listener of listeners) listener(notification);
  }
}
function config(sessionId: string): SessionConnectionInput {
  return {
    endpoint: "ws://server.test/ui",
    token: "",
    sessionId,
    profileId: "coding",
    cwd: "/srv/project",
  };
}
function harness(client = new PooledClient()) {
  const pool = { client, epoch: 1, allowStart: true };
  const view = {
    timeline: [] as TimelineEntry[],
    events: [] as string[],
    errors: [] as string[],
  };
  let manager: SessionRecordManager<PooledClient>;
  const mirror = () => {
    view.timeline = [...(manager.selected()?.timeline ?? [])];
  };
  manager = new SessionRecordManager<PooledClient>({
    pooledClient: () => pool.client,
    authorityEpoch: () => pool.epoch,
    onSelectedEvent: (event) => {
      view.events.push(event.type);
      mirror();
      if (event.type === "session-hydrate") {
        expect(manager.selected()?.runtime.getSnapshot().phase).toBe(
          "recovering",
        );
      }
    },
    onSelectedSnapshot: mirror,
    onBackgroundActivity: () => undefined,
    cursorFor: (scope) =>
      manager.get(scope)?.runtime.getSnapshot().recovery.cursor,
    validateServerCapabilities: (value) => {
      if (!value) throw new Error("missing capabilities");
    },
    validateSessionCapabilities: (value) => {
      if (!value) throw new Error("missing capabilities");
    },
    controllerDependencies: (scope, recordClient) => {
      const ready = () => {
        const snapshot = manager.get(scope)?.runtime.getSnapshot();
        return (
          snapshot?.phase === "ready" &&
          snapshot.status === "connected" &&
          snapshot.recovery.phase === "healthy" &&
          recordClient()?.status === "connected"
        );
      };
      return {
        client: () => recordClient() as never,
        sessionId: () => scope.sessionId,
        canEnqueue: ready,
        canStart: () => ready() && pool.allowStart,
        canInterrupt: ready,
        // The manager must own this reducer and intercept this presentation callback.
        setTimeline: () => {
          throw new Error("record timeline escaped into presentation");
        },
        setConnectionError: (error) => view.errors.push(error),
      };
    },
  });
  client.checkStart = (params) => {
    const record = manager
      .records()
      .find((record) => record.scope.sessionId === params.session_id);
    expect(record?.runtime.getSnapshot()).toMatchObject({
      phase: "ready",
      status: "connected",
      recovery: { phase: "healthy" },
    });
  };
  return { manager, pool, view, client };
}
async function open(h: ReturnType<typeof harness>, sessionId: string) {
  return h.manager.openOnRecord(
    config(sessionId),
    h.pool.client,
    new AbortController().signal,
  );
}
function enqueue(record: SessionRecord<PooledClient>, turnId: string) {
  expect(record.controller.enqueueTurn({ turnId, text: turnId })).toBe(true);
}
function envelope(
  sessionId: string,
  turnId: string,
  seq: number,
  type: string,
  data: unknown,
): RpcNotification {
  return {
    jsonrpc: "2.0",
    method: CORE_UI_METHODS.PROJECTION_ENVELOPE,
    params: {
      session_id: sessionId,
      thread_id: sessionId,
      turn_id: turnId,
      seq,
      cursor: { stream: sessionId, seq: seq + 1 },
      payload: { type, data },
    },
  };
}
function terminal(sessionId: string, turnId: string, seq = 1) {
  return envelope(sessionId, turnId, seq, "turn_terminal", {
    outcome: "completed",
  });
}
async function flush(rounds = 20) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}
function starts(client: PooledClient) {
  return client.starts.map(({ session_id, turn_id }) => [session_id, turn_id]);
}
function rows(record: SessionRecord<PooledClient>) {
  return record.timeline.map(({ id, body }) => [id, body]);
}

describe("SessionRecordManager real record/controller/runtime integration", () => {
  const coreMessageHydrate = (id: string, state = "active", turnId = "A1") =>
    hydrate(id, {
      cursor: { stream: id, seq: 10 },
      turns: [{ turn_id: turnId, thread_id: turnId, state }],
      // Actual rc11 omits message.turn_id and does not replay assistant receipts.
      messages: [
        {
          seq: 1,
          role: "assistant",
          content: "canonical from hydrate",
          thread_id: turnId,
          message_id: "m1",
          persisted_at: "",
          media: [],
        },
      ],
      replayed_envelopes: [],
      replayed_tool_envelopes: [],
    });

  it("preserves a witnessed segment identity through Core-shaped owner rehydrate, without freezing the next active segment", async () => {
    const h = harness();
    const a = await open(h, "A");
    h.client.emit(
      envelope("A", "A1", 1, "assistant_persisted", {
        text: "before hydrate",
        assistant_segment_id: "segment-1",
        meta: { message_id: "m1" },
      }),
    );
    h.client.hydratedFor = coreMessageHydrate;
    await h.manager.recoverRecords(new AbortController().signal);
    h.client.emit(
      envelope("A", "A1", 10, "assistant_delta", {
        text: "late suffix",
        assistant_segment_id: "segment-1",
      }),
    );
    expect(
      a.timeline
        .filter((entry) => entry.kind === "assistant")
        .map((entry) => entry.body),
    ).toEqual(["canonical from hydrate"]);
    h.client.emit(
      envelope("A", "A1", 11, "assistant_delta", {
        text: "legitimate next segment",
        assistant_segment_id: "segment-2",
      }),
    );
    expect(
      a.timeline
        .filter((entry) => entry.kind === "assistant")
        .map((entry) => entry.body),
    ).toEqual(["canonical from hydrate", "legitimate next segment"]);
  });

  it.each(["candidate", "recovery"])(
    "uses covered buffered persisted identity only during %s; never replaces hydrate prose or emits a live notification",
    async (mode) => {
      const h = harness();
      const a = mode === "recovery" ? await open(h, "A") : null;
      if (a) h.manager.select(a.scope);
      const gate = deferred<SessionHydrateResult>();
      h.client.hydratedFor = () => gate.promise;
      const operation = a
        ? a.runtime.rehydrateSession(a.runtime.currentAuthority()!, () => true)
        : open(h, "A");
      await flush();
      h.client.emit(
        envelope("B", "A1", 1, "assistant_persisted", {
          text: "foreign",
          assistant_segment_id: "foreign-segment",
          meta: { message_id: "m1" },
        }),
      );
      h.client.emit(
        envelope("A", "A1", 2, "assistant_persisted", {
          text: "stale buffered body must not win",
          assistant_segment_id: "segment-1",
          meta: { message_id: "m1" },
        }),
      );
      gate.resolve(coreMessageHydrate("A"));
      const result = await operation;
      const record = a ?? (result as SessionRecord<PooledClient>);
      expect(
        record.timeline
          .filter((entry) => entry.kind === "assistant")
          .map((entry) => entry.body),
      ).toEqual(["canonical from hydrate"]);
      expect(h.view.events.filter((type) => type === "notification")).toEqual(
        [],
      );
      h.client.emit(
        envelope("A", "A1", 10, "assistant_delta", {
          text: "late suffix",
          assistant_segment_id: "segment-1",
        }),
      );
      expect(
        record.timeline
          .filter((entry) => entry.kind === "assistant")
          .map((entry) => entry.body),
      ).toEqual(["canonical from hydrate"]);
      expect(
        record.timeline.find((entry) => entry.messageId === "m1")?.streamId,
      ).not.toContain("foreign");
    },
  );

  it("retains a hydrated terminal fence through thread-to-turn mapping without blocking another turn", async () => {
    const h = harness();
    h.client.hydratedFor = (id) => coreMessageHydrate(id, "errored");
    const a = await open(h, "A");
    h.client.emit(
      envelope("A", "A1", 10, "assistant_delta", {
        text: "ghost suffix",
        assistant_segment_id: "unseen",
      }),
    );
    h.client.emit(
      envelope("A", "A1", 11, "reasoning_delta", { text: "ghost thinking" }),
    );
    expect(
      a.timeline
        .filter((entry) => entry.kind === "assistant")
        .map((entry) => entry.body),
    ).toEqual(["canonical from hydrate"]);
    expect(a.timeline.some((entry) => entry.status === "running")).toBe(false);
    h.client.emit(
      envelope("A", "A2", 12, "assistant_delta", {
        text: "other turn",
        assistant_segment_id: "unseen",
      }),
    );
    expect(a.timeline.at(-1)).toMatchObject({
      body: "other turn",
      turnId: "A2",
      status: "running",
    });
  });

  it("does not carry a previous message identity into another turn that reuses its id", async () => {
    const h = harness();
    const a = await open(h, "A");
    h.client.emit(
      envelope("A", "A1", 1, "assistant_persisted", {
        text: "old owner",
        assistant_segment_id: "segment-1",
        meta: { message_id: "m1" },
      }),
    );
    h.client.hydratedFor = (id) => coreMessageHydrate(id, "active", "A2");
    await h.manager.recoverRecords(new AbortController().signal);
    expect(a.timeline.find((entry) => entry.messageId === "m1")).toMatchObject({
      body: "canonical from hydrate",
      turnId: "A2",
    });
    expect(
      a.timeline.find((entry) => entry.messageId === "m1")?.streamId,
    ).toBeUndefined();
  });

  it.each(["candidate", "recovery"])(
    "advances covered identity frame ordering between buffered deltas during %s without a false recovery gap",
    async (mode) => {
      const h = harness();
      const a = mode === "recovery" ? await open(h, "A") : null;
      if (a) h.manager.select(a.scope);
      const beforeHydrates = h.client.hydrates.length;
      const gate = deferred<SessionHydrateResult>();
      h.client.hydratedFor = () => gate.promise;
      const operation = a
        ? a.runtime.rehydrateSession(a.runtime.currentAuthority()!, () => true)
        : open(h, "A");
      await flush();
      h.client.emit(
        envelope("A", "A1", 1, "assistant_delta", {
          text: "prefix",
          assistant_segment_id: "segment-1",
        }),
      );
      h.client.emit(
        envelope("A", "A1", 2, "assistant_persisted", {
          text: "covered prose",
          assistant_segment_id: "segment-1",
          meta: { message_id: "m1" },
        }),
      );
      h.client.emit(
        envelope("A", "A1", 3, "assistant_delta", {
          text: "suffix",
          assistant_segment_id: "segment-1",
        }),
      );
      gate.resolve(coreMessageHydrate("A"));
      const result = await operation;
      const record = a ?? (result as SessionRecord<PooledClient>);
      await flush();
      expect(h.client.hydrates.length - beforeHydrates).toBe(1);
      expect(record.runtime.getSnapshot()).toMatchObject({
        phase: "ready",
        recovery: { phase: "healthy" },
      });
      expect(
        record.timeline
          .filter((entry) => entry.kind === "assistant")
          .map((entry) => entry.body),
      ).toEqual(["canonical from hydrate"]);
      // Upstream #29: recovery-buffered frames at or below the hydrate cursor
      // (seq 10) are already covered by hydrate and are dropped, not replayed.
      if (a)
        expect(
          h.view.events.filter((type) => type === "notification"),
        ).toHaveLength(0);
    },
  );

  it("keeps a post-head buffered persisted receipt on the live path", async () => {
    const h = harness();
    const a = await open(h, "A");
    h.manager.select(a.scope);
    const gate = deferred<SessionHydrateResult>();
    h.client.hydratedFor = () => gate.promise;
    const operation = a.runtime.rehydrateSession(
      a.runtime.currentAuthority()!,
      () => true,
    );
    h.client.emit(
      envelope("A", "A1", 10, "assistant_persisted", {
        text: "new canonical after snapshot",
        assistant_segment_id: "segment-1",
        meta: { message_id: "m1" },
      }),
    );
    gate.resolve(coreMessageHydrate("A"));
    await operation;
    expect(a.timeline.find((entry) => entry.messageId === "m1")?.body).toBe(
      "new canonical after snapshot",
    );
    expect(
      h.view.events.filter((type) => type === "notification"),
    ).toHaveLength(1);
  });

  it("rejects same-client epoch changes before buffered identity can commit into the record", async () => {
    const h = harness();
    const a = await open(h, "A");
    h.manager.select(a.scope);
    const before = [...a.timeline];
    const gate = deferred<SessionHydrateResult>();
    h.client.hydratedFor = () => gate.promise;
    const operation = a.runtime.rehydrateSession(
      a.runtime.currentAuthority()!,
      () => true,
    );
    h.client.emit(
      envelope("A", "A1", 1, "assistant_persisted", {
        text: "must stay retired",
        assistant_segment_id: "segment-1",
        meta: { message_id: "m1" },
      }),
    );
    h.pool.epoch++;
    gate.resolve(coreMessageHydrate("A"));
    await operation;
    expect(a.timeline).toEqual(before);
    expect(h.view.events.filter((type) => type === "session-hydrate")).toEqual(
      [],
    );
    h.manager.retireAll();
    h.client.hydratedFor = coreMessageHydrate;
    const replacement = await open(h, "A");
    expect(
      replacement.timeline.find((entry) => entry.messageId === "m1")?.streamId,
    ).toBeUndefined();
  });

  it("drops buffered identity when the captured runtime generation is suspended", async () => {
    const h = harness();
    const a = await open(h, "A");
    const gate = deferred<SessionHydrateResult>();
    h.client.hydratedFor = () => gate.promise;
    const authority = a.runtime.currentAuthority()!;
    const operation = a.runtime.rehydrateSession(authority, () => true);
    const rejected = expect(operation).rejects.toThrow("changed");
    h.client.emit(
      envelope("A", "A1", 1, "assistant_persisted", {
        text: "old generation",
        assistant_segment_id: "segment-1",
        meta: { message_id: "m1" },
      }),
    );
    a.runtime.suspendTransport(authority);
    gate.resolve(coreMessageHydrate("A"));
    await rejected;
    expect(a.timeline).toEqual([]);
    expect(a.payload?.hydrated.messages).toBeUndefined();
  });

  it("does not invent a turn owner for conflicting hydrated thread identities", async () => {
    const h = harness();
    const gate = deferred<SessionHydrateResult>();
    h.client.hydratedFor = () => gate.promise;
    const operation = open(h, "A");
    await flush();
    h.client.emit(
      envelope("A", "A1", 1, "assistant_persisted", {
        text: "not authority",
        assistant_segment_id: "segment-1",
        meta: { message_id: "m1" },
      }),
    );
    gate.resolve({
      ...coreMessageHydrate("A"),
      turns: [
        { turn_id: "A1", thread_id: "A1", state: "active" },
        { turn_id: "A2", thread_id: "A1", state: "active" },
      ],
    });
    const a = await operation;
    expect(
      a.timeline.find((entry) => entry.messageId === "m1")?.turnId,
    ).toBeUndefined();
    expect(
      a.timeline.find((entry) => entry.messageId === "m1")?.streamId,
    ).toBeUndefined();
  });

  it("reconciles Core's hydrate thread identity with replayed user and persisted assistant messages exactly once", async () => {
    const h = harness();
    h.client.hydratedFor = (id) =>
      hydrate(id, {
        cursor: { stream: id, seq: 10 },
        turns: [{ turn_id: "A1", thread_id: "A1", state: "completed" }],
        messages: [
          {
            seq: 0,
            role: "user",
            content: "A1",
            thread_id: "A1",
            persisted_at: "",
            media: [],
          },
          {
            seq: 1,
            role: "assistant",
            content: "hello",
            thread_id: "A1",
            message_id: "m1",
            reasoning_content: "thinking",
            persisted_at: "",
            media: [],
          },
        ],
      });
    const a = await open(h, "A");
    h.manager.select(a.scope);
    h.client.emit(envelope("A", "A1", 1, "user_message", { text: "A1" }));
    h.client.emit(envelope("A", "A1", 2, "assistant_delta", { text: "hello" }));
    h.client.emit(
      envelope("A", "A1", 3, "reasoning_delta", { text: "thinking" }),
    );
    h.client.emit(
      envelope("A", "A1", 4, "assistant_persisted", {
        text: "hello",
        meta: { message_id: "m1" },
      }),
    );
    expect(rows(a)).toEqual([
      ["user:A1", "A1"],
      ["reasoning:m1", "thinking"],
      ["hydrated:m1", "hello"],
    ]);
    await h.manager.recoverRecords(new AbortController().signal);
    expect(h.client.opens.at(-1)?.after).toEqual({ stream: "A", seq: 10 });
    expect(h.client.hydrates.at(-1)).not.toHaveProperty("after");
    expect(rows(a)).toEqual([
      ["user:A1", "A1"],
      ["reasoning:m1", "thinking"],
      ["hydrated:m1", "hello"],
    ]);
  });

  it("publishes successful eviction after deletion, with no ghost record or stale selected owner", async () => {
    const h = harness();
    const a = await open(h, "A");
    const b = await open(h, "B");
    h.manager.select(a.scope);
    const snapshots: Array<{ ids: string[]; selected: string | null }> = [];
    const off = h.manager.subscribe(() =>
      snapshots.push({
        ids: h.manager.records().map((record) => record.scope.sessionId),
        selected: h.manager.selected()?.scope.sessionId ?? null,
      }),
    );
    h.manager.evict(b.scope);
    expect(snapshots.at(-1)).toEqual({ ids: ["A"], selected: "A" });
    h.manager.evict(a.scope);
    expect(snapshots.at(-1)).toEqual({ ids: [], selected: null });
    const count = snapshots.length;
    h.manager.evict(a.scope);
    expect(snapshots).toHaveLength(count);
    expect(h.client.status).toBe("connected");
    off();
  });

  it("keeps a closed selected peer transcript visible and excludes its discarded queue from reconnect", async () => {
    const h = harness();
    const a = await open(h, "A");
    const b = await open(h, "B");
    h.manager.select(a.scope);
    enqueue(a, "A1");
    enqueue(a, "A2");
    const before = [...a.timeline];
    expect(h.manager.closeRetainedRecord(a)).toBe(true);
    expect(h.manager.closeRetainedRecord(a)).toBe(false);
    expect(h.manager.selected()).toBe(a);
    expect(a.closed).toBe(true);
    expect(a.timeline).toEqual(before);
    expect(a.payload?.opened.session_id).toBe("A");
    expect(a.runtime.getSnapshot()).toMatchObject({
      phase: "disconnected",
      error: "This peer Session is closed.",
    });
    expect(a.queue.snapshot()).toEqual({ active: null, pending: [] });
    expect(a.controller.enqueueTurn({ turnId: "A3", text: "A3" })).toBe(false);
    await expect(open(h, "A")).rejects.toThrow("closed");
    expect(
      (await h.manager.recoverRecords(new AbortController().signal)).map(
        (result) => result.sessionId,
      ),
    ).toEqual(["B"]);
    expect(b.runtime.getSnapshot().phase).toBe("ready");
    expect(starts(h.client)).toEqual([["A", "A1"]]);
    expect(a.timeline).toEqual(before);
    h.manager.evict(a.scope);
    const replacement = await open(h, "A");
    expect(h.manager.closeRetainedRecord(a)).toBe(false);
    expect(replacement.closed).toBe(false);
  });

  it("retains a failed history refresh lease and notification binding for a refresh-only retry", async () => {
    const h = harness();
    const a = await open(h, "A");
    const authority = a.runtime.currentAuthority()!;
    const lease = h.manager.acquireHistoryMutation(a, authority, {
      workspaceWide: false,
    })!;
    h.client.hydratedFor = async () => {
      throw new Error("temporary hydrate failure");
    };
    await expect(
      h.manager.rehydrateRecord(a, authority, lease),
    ).rejects.toThrow("temporary");
    expect(lease.isCurrent()).toBe(true);
    expect(h.client.notifications.size).toBe(1);
    expect(
      a.controller.enqueueTurn({ turnId: "blocked", text: "blocked" }),
    ).toBe(false);
    h.client.hydratedFor = (id) => hydrate(id);
    await h.manager.rehydrateRecord(a, authority, lease);
    lease.release();
    h.client.emit(
      envelope("A", "external", 1, "assistant_delta", {
        text: "live after retry",
      }),
    );
    expect(rows(a)).toEqual([
      ["assistant:external:default", "live after retry"],
    ]);
  });

  it("rejects a foreign Session's history hydrate before changing the source timeline", async () => {
    const h = harness();
    const a = await open(h, "A");
    const authority = a.runtime.currentAuthority()!;
    const lease = h.manager.acquireHistoryMutation(a, authority, {
      workspaceWide: false,
    })!;
    h.client.hydratedFor = () =>
      hydrate("B", {
        messages: [
          {
            seq: 1,
            role: "user",
            content: "foreign",
            turn_id: "foreign",
            persisted_at: "",
            media: [],
          },
        ],
      });
    await expect(
      h.manager.rehydrateRecord(a, authority, lease),
    ).rejects.toThrow("expected A");
    expect(rows(a)).toEqual([]);
    lease.release();
  });

  it("reserves an idle Session through canonical history refresh without changing the selected record", async () => {
    const h = harness();
    const a = await open(h, "A");
    const b = await open(h, "B");
    h.manager.select(b.scope);
    const authority = a.runtime.currentAuthority()!;
    const lease = h.manager.acquireHistoryMutation(a, authority, {
      workspaceWide: false,
    })!;
    expect(lease.isCurrent()).toBe(true);
    expect(
      a.controller.enqueueTurn({ turnId: "blocked", text: "blocked" }),
    ).toBe(false);
    expect(
      h.manager.acquireHistoryMutation(a, authority, { workspaceWide: false }),
    ).toBeNull();
    h.client.hydratedFor = (id) =>
      hydrate(id, {
        messages: [
          {
            seq: 1,
            role: "user",
            content: "restored",
            turn_id: "restored",
            persisted_at: "",
            media: [],
          },
        ],
      });
    await h.manager.rehydrateRecord(a, authority, lease);
    expect(rows(a)).toEqual([["user:restored", "restored"]]);
    expect(a.runtime.currentAuthority()).toBe(authority);
    expect(h.manager.selected()).toBe(b);
    expect(h.view.timeline).toEqual([]);
    lease.release();
    expect(lease.isCurrent()).toBe(false);
    enqueue(a, "allowed");
  });

  it("makes workspace history reservation atomic against every record queue and pending interaction", async () => {
    const h = harness();
    const a = await open(h, "A");
    const b = await open(h, "B");
    const authority = a.runtime.currentAuthority()!;
    enqueue(b, "B1");
    enqueue(b, "B2");
    expect(
      h.manager.acquireHistoryMutation(a, authority, { workspaceWide: true }),
    ).toBeNull();
    h.client.emit(terminal("B", "B1", 1));
    h.client.emit(terminal("B", "B2", 2));
    const lease = h.manager.acquireHistoryMutation(a, authority, {
      workspaceWide: true,
    })!;
    expect(lease).not.toBeNull();
    expect(
      b.controller.enqueueTurn({ turnId: "blocked", text: "blocked" }),
    ).toBe(false);
    lease.release();
    h.client.emit({
      jsonrpc: "2.0",
      method: CORE_UI_METHODS.APPROVAL_REQUESTED,
      params: {
        session_id: "B",
        turn_id: "external",
        approval_id: "ap",
        tool_name: "shell",
        title: "Run?",
        body: "command",
      },
    });
    expect(
      h.manager.acquireHistoryMutation(a, authority, { workspaceWide: true }),
    ).toBeNull();
  });

  it("rejects a delayed history hydrate after source runtime generation changes on the same pooled client", async () => {
    const h = harness();
    const a = await open(h, "A");
    const authority = a.runtime.currentAuthority()!;
    const lease = h.manager.acquireHistoryMutation(a, authority, {
      workspaceWide: false,
    })!;
    const pending = deferred<SessionHydrateResult>();
    h.client.hydratedFor = () => pending.promise;
    const refresh = h.manager.rehydrateRecord(a, authority, lease);
    const rejected = expect(refresh).rejects.toThrow();
    a.runtime.suspendTransport(authority);
    h.client.hydratedFor = (id) => hydrate(id);
    await open(h, "A");
    expect(lease.isCurrent()).toBe(false);
    pending.resolve(
      hydrate("A", {
        messages: [
          {
            seq: 1,
            role: "user",
            content: "stale history",
            turn_id: "stale",
            persisted_at: "",
            media: [],
          },
        ],
      }),
    );
    await rejected;
    expect(rows(a)).toEqual([]);
    expect(a.runtime.getSnapshot().phase).toBe("ready");
  });

  it("rechecks the history lease at hydrate commit and fork candidate commit", async () => {
    const h = harness();
    const a = await open(h, "A");
    const authority = a.runtime.currentAuthority()!;
    const lease = h.manager.acquireHistoryMutation(a, authority, {
      workspaceWide: false,
    })!;
    const pending = deferred<SessionHydrateResult>();
    h.client.hydratedFor = () => pending.promise;
    const fork = h.manager.openOnRecord(
      config("fork"),
      h.client,
      new AbortController().signal,
      lease.isCurrent,
    );
    const rejected = expect(fork).rejects.toThrow("authority changed");
    await flush();
    lease.release();
    pending.resolve(hydrate("fork"));
    await rejected;
    expect(h.manager.records().map((record) => record.scope.sessionId)).toEqual(
      ["A"],
    );
    const reacquired = h.manager.acquireHistoryMutation(a, authority, {
      workspaceWide: false,
    })!;
    const refreshGate = deferred<SessionHydrateResult>();
    h.client.hydratedFor = () => refreshGate.promise;
    const refresh = h.manager.rehydrateRecord(a, authority, reacquired);
    const refreshRejected = expect(refresh).rejects.toThrow();
    reacquired.release();
    refreshGate.resolve(hydrate("A"));
    await refreshRejected;
    expect(a.runtime.getSnapshot().phase).toBe("error");
  });

  it("admits caller UUID once and folds optimistic, canonical echo, and legacy twins exactly once", async () => {
    const h = harness();
    const a = await open(h, "A");
    h.manager.select(a.scope);
    enqueue(a, "A1");
    expect(a.controller.enqueueTurn({ turnId: "A1", text: "duplicate" })).toBe(
      false,
    );
    h.client.emit(envelope("A", "A1", 1, "user_message", { text: "A1" }));
    const delta = envelope("A", "A1", 2, "assistant_delta", { text: "hello" });
    h.client.emit(delta);
    h.client.emit(delta);
    h.client.emit({
      jsonrpc: "2.0",
      method: CORE_UI_METHODS.MESSAGE_DELTA,
      params: { session_id: "A", turn_id: "A1", text: "hello" },
    });
    h.client.emit(terminal("A", "A1", 3));
    h.client.emit({
      jsonrpc: "2.0",
      method: CORE_UI_METHODS.TURN_COMPLETED,
      params: { session_id: "A", turn_id: "A1" },
    });
    await flush();
    expect(starts(h.client)).toEqual([["A", "A1"]]);
    expect(rows(a)).toEqual([
      ["user:A1", "A1"],
      ["assistant:A1:default", "hello"],
      ["terminal:A1", ""],
    ]);
    expect(h.view.timeline).toEqual(a.timeline);
  });

  it("settles A's rejected unacknowledged start after selection moves to B", async () => {
    const h = harness();
    const a = await open(h, "A");
    h.manager.select(a.scope);
    const rpc = deferred<unknown>();
    h.client.startGate = () => rpc.promise;
    enqueue(a, "A1");
    const b = await open(h, "B");
    h.manager.select(b.scope);
    // A definite server rejection is a JSON-RPC protocol error. Upstream
    // v0.10.0 keeps a plain transport Error/timeout pending as an unknown
    // outcome ("does not treat a transport failure as a rejected start").
    rpc.reject(new OctosUiProtocolError(-32000, "Core rejected A1"));
    await flush();
    expect(a.queue.snapshot().active).toBeNull();
    expect(rows(a)).toEqual([
      ["user:A1", "A1"],
      ["send-error:A1", "Core rejected A1"],
    ]);
    expect(b.timeline).toEqual([]);
    expect(h.view.timeline).toEqual([]);
  });

  it("keeps busy healthy selection on the same record and drains A in the background", async () => {
    const h = harness();
    const a = await open(h, "A");
    h.manager.select(a.scope);
    enqueue(a, "A1");
    enqueue(a, "A2");
    const b = await open(h, "B");
    h.manager.select(b.scope);
    const authority = a.runtime.currentAuthority();
    const count = h.client.hydrates.length;
    h.manager.select(a.scope);
    h.manager.select(b.scope);
    expect(h.client.hydrates).toHaveLength(count);
    expect(a.runtime.currentAuthority()).toBe(authority);
    h.client.emit(terminal("A", "A1"));
    await flush();
    expect(starts(h.client)).toEqual([
      ["A", "A1"],
      ["A", "A2"],
    ]);
    expect(rows(a)).toEqual([
      ["user:A1", "A1"],
      ["terminal:A1", ""],
      ["user:A2", "A2"],
    ]);
    expect(b.timeline).toEqual([]);
    expect(h.view.timeline).toEqual([]);
  });

  it("freezes all records on loss, ignores old RPC rejection, and resumes A2 only after ready then A3 after A2 terminal", async () => {
    const h = harness();
    const a = await open(h, "A");
    h.manager.select(a.scope);
    const oldRpc = deferred<unknown>();
    h.client.startGate = ({ turn_id }) =>
      turn_id === "A1" ? oldRpc.promise : Promise.resolve({});
    enqueue(a, "A1");
    enqueue(a, "A2");
    enqueue(a, "A3");
    const b = await open(h, "B");
    h.manager.select(b.scope);
    h.client.setStatus("disconnected");
    expect(a.runtime.currentAuthority()).toBeNull();
    expect(b.runtime.currentAuthority()).toBeNull();
    oldRpc.reject(new Error("old socket lost"));
    await flush();
    expect(a.queue.snapshot()).toEqual({
      active: { turnId: "A1", text: "A1" },
      pending: [
        { turnId: "A2", text: "A2" },
        { turnId: "A3", text: "A3" },
      ],
    });
    const recovery = deferred<SessionHydrateResult>();
    h.client.hydratedFor = (id) =>
      id === "A" ? recovery.promise : hydrate(id);
    h.client.setStatus("connected");
    const recovered = h.manager.recoverRecords(new AbortController().signal);
    await flush();
    expect(starts(h.client)).toEqual([["A", "A1"]]);
    expect(b.runtime.currentAuthority()).toBeNull();
    recovery.resolve(
      hydrate("A", {
        cursor: { stream: "A", seq: 9 },
        turns: [{ turn_id: "A1", state: "interrupted" }],
        messages: [
          {
            seq: 1,
            role: "user",
            content: "A1",
            turn_id: "A1",
            persisted_at: "",
            media: [],
          },
        ],
      }),
    );
    expect((await recovered).map((result) => result.state)).toEqual([
      "rehydrated",
      "rehydrated",
    ]);
    expect(starts(h.client)).toEqual([
      ["A", "A1"],
      ["A", "A2"],
    ]);
    // Upstream v0.10.0 renders the hydrated interrupted A1 as a stopped row.
    expect(rows(a)).toEqual([
      ["user:A1", "A1"],
      ["terminal:A1", "This turn was stopped before it completed."],
      ["user:A2", "A2"],
    ]);
    h.client.emit(terminal("A", "A2", 10));
    await flush();
    expect(starts(h.client)).toEqual([
      ["A", "A1"],
      ["A", "A2"],
      ["A", "A3"],
    ]);
    expect(rows(a)).toEqual([
      ["user:A1", "A1"],
      ["terminal:A1", "This turn was stopped before it completed."],
      ["user:A2", "A2"],
      ["terminal:A2", ""],
      ["user:A3", "A3"],
    ]);
    expect(h.view.timeline).toEqual(b.timeline);
    expect(b.timeline).toEqual([]);
    expect(h.client.opens.at(-2)?.after).toEqual({ stream: "A", seq: 1 });
  });

  it.each(["active", "unknown", "absent"])(
    "never replays an ambiguous accepted A1 when hydrate reports %s",
    async (state) => {
      const h = harness();
      const a = await open(h, "A");
      const oldRpc = deferred<unknown>();
      h.client.startGate = () => oldRpc.promise;
      enqueue(a, "A1");
      enqueue(a, "A2");
      h.client.setStatus("disconnected");
      h.client.setStatus("connected");
      h.client.hydratedFor = (id) =>
        hydrate(id, {
          turns: state === "absent" ? [] : [{ turn_id: "A1", state }],
        });
      await h.manager.recoverRecords(new AbortController().signal);
      oldRpc.reject(new Error("late rejected RPC"));
      await flush();
      expect(starts(h.client)).toEqual([["A", "A1"]]);
      expect(a.queue.snapshot().active?.turnId).toBe("A1");
      expect(a.queue.snapshot().pending.map((turn) => turn.turnId)).toEqual([
        "A2",
      ]);
      expect(rows(a)).toEqual([["user:A1", "A1"]]);
    },
  );

  it("retains a never-sent queue head through hydrate and starts it at ready", async () => {
    const h = harness();
    const a = await open(h, "A");
    h.pool.allowStart = false;
    enqueue(a, "A1");
    enqueue(a, "A2");
    expect(starts(h.client)).toEqual([]);
    h.client.setStatus("disconnected");
    h.client.setStatus("connected");
    h.pool.allowStart = true;
    await h.manager.recoverRecords(new AbortController().signal);
    expect(starts(h.client)).toEqual([["A", "A1"]]);
    expect(a.queue.snapshot().pending.map((turn) => turn.turnId)).toEqual([
      "A2",
    ]);
  });

  it("preserves a never-sent queue behind a different server-active turn discovered at hydrate", async () => {
    const h = harness();
    const a = await open(h, "A");
    h.pool.allowStart = false;
    enqueue(a, "A1");
    enqueue(a, "A2");
    h.client.hydratedFor = (id) =>
      hydrate(id, { turns: [{ turn_id: "external", state: "active" }] });
    h.pool.allowStart = true;
    await h.manager.recoverRecords(new AbortController().signal);
    expect(starts(h.client)).toEqual([]);
    expect(a.queue.snapshot()).toEqual({
      active: { turnId: "external", text: "" },
      pending: [
        { turnId: "A1", text: "A1" },
        { turnId: "A2", text: "A2" },
      ],
    });
    h.client.emit(terminal("A", "external"));
    expect(starts(h.client)).toEqual([["A", "A1"]]);
    expect(a.queue.snapshot().pending.map((turn) => turn.turnId)).toEqual([
      "A2",
    ]);
  });

  it("ignores 4097 foreign canonical envelopes while A's recovery hydrate is deferred", async () => {
    const h = harness();
    const a = await open(h, "A");
    const b = await open(h, "B");
    h.manager.select(b.scope);
    const recovery = deferred<SessionHydrateResult>();
    h.client.hydratedFor = (id) =>
      id === "A" ? recovery.promise : hydrate(id);
    h.client.emit({
      jsonrpc: "2.0",
      method: CORE_UI_METHODS.REPLAY_LOSSY,
      params: { session_id: "A", dropped_count: 1 },
    });
    for (let seq = 1; seq <= 4097; seq += 1) {
      h.client.emit(envelope("B", "B1", seq, "assistant_delta", { text: "x" }));
    }
    expect(a.runtime.getSnapshot()).toMatchObject({
      phase: "recovering",
      error: null,
    });
    expect(rows(a)).toEqual([]);
    expect(rows(b)).toEqual([["assistant:B1:default", "x".repeat(4097)]]);
    recovery.resolve(hydrate("A"));
    await flush();
    expect(a.runtime.getSnapshot()).toMatchObject({
      phase: "ready",
      error: null,
    });
    expect(h.client.status).toBe("connected");
    expect(rows(a)).toEqual([]);
  });

  it("hydrates the full interaction payload and resolves the captured background record", async () => {
    const h = harness();
    const a = await open(h, "A");
    const b = await open(h, "B");
    h.manager.select(b.scope);
    h.client.emit({
      jsonrpc: "2.0",
      method: CORE_UI_METHODS.APPROVAL_REQUESTED,
      params: {
        session_id: "A",
        turn_id: "A1",
        approval_id: "ap1",
        tool_name: "shell",
        title: "Run tests?",
        body: "pnpm test",
        typed_details: { command: "pnpm test" },
      },
    });
    expect(a.interactions.getSnapshot().approval?.body).toBe("pnpm test");
    expect(a.interactions.current(a.scope)?.unread).toBe(true);
    expect(b.interactions.getSnapshot().approval).toBeNull();
    h.manager.select(a.scope);
    const respond = a.interactions.respondApproval;
    h.manager.select(b.scope);
    await respond("approve", "turn");
    expect(h.client.responses).toEqual([
      {
        session_id: "A",
        approval_id: "ap1",
        decision: "approve",
        approval_scope: "turn",
      },
    ]);
    expect(a.interactions.current(a.scope)).toBeNull();
    expect(b.timeline).toEqual([]);
  });

  it.each(["epoch", "client", "evict", "abort"])(
    "rejects a recovery superseded by %s and releases staging listeners",
    async (change) => {
      const h = harness();
      const a = await open(h, "A");
      const pending = deferred<SessionHydrateResult>();
      h.client.hydratedFor = () => pending.promise;
      const abort = new AbortController();
      const recovery = h.manager.recoverRecords(abort.signal);
      await flush();
      if (change === "epoch") h.pool.epoch += 1;
      if (change === "client") h.pool.client = new PooledClient();
      if (change === "evict") h.manager.evict(a.scope);
      if (change === "abort") abort.abort();
      pending.resolve(hydrate("A"));
      expect((await recovery)[0]?.state).toBe("failed");
      expect(a.runtime.currentAuthority()).toBeNull();
      expect(h.client.notifications.size).toBe(0);
    },
  );

  it.each(["profile", "workspace"])(
    "rejects recovery with the wrong confirmed %s",
    async (change) => {
      const h = harness();
      const a = await open(h, "A");
      h.client.openedFor = (session_id) => ({
        session_id,
        active_profile_id: change === "profile" ? "other" : "coding",
        workspace_root: change === "workspace" ? "/other" : "/srv/project",
        capabilities: caps,
      });
      expect(
        (await h.manager.recoverRecords(new AbortController().signal))[0]
          ?.state,
      ).toBe("failed");
      expect(a.runtime.currentAuthority()).toBeNull();
    },
  );

  it("does not report recovery success if candidate replay fails before ready", async () => {
    const h = harness();
    const a = await open(h, "A");
    const pending = deferred<SessionHydrateResult>();
    h.client.hydratedFor = () => pending.promise;
    const recovering = h.manager.recoverRecords(new AbortController().signal);
    await flush();
    // Malformed canonical traffic starts another recovery, so this resume has not succeeded.
    h.client.emit({
      jsonrpc: "2.0",
      method: CORE_UI_METHODS.PROJECTION_ENVELOPE,
      params: { session_id: "A", malformed: true },
    });
    pending.resolve(hydrate("A"));
    expect((await recovering)[0]?.state).toBe("failed");
    await flush();
    expect(a.runtime.getSnapshot().phase).toBe("error");
    expect(h.client.status).toBe("connected");
  });

  it("rejects an auth change during initial open without leaking staging listeners", async () => {
    const h = harness();
    h.client.hydratedFor = (id) => {
      h.pool.epoch += 1;
      return hydrate(id);
    };
    await expect(open(h, "A")).rejects.toThrow("authority changed");
    expect(h.manager.records()).toEqual([]);
    expect(h.client.notifications.size).toBe(0);
  });
});

// ---- Read-only driver discovery on the ACTUAL manager (B grant) ----------

const driverCaps: UiProtocolCapabilities = {
  ...caps,
  supported_methods: [...(caps.supported_methods ?? []), "session/driver/get"],
  supported_features: [
    ...(caps.supported_features ?? []),
    "external_driver_v1",
  ],
};

function discoveryPage(
  rows: Array<{ operationId: string; slug: string; lifecycle: string }>,
  over: Record<string, unknown> = {},
) {
  return {
    mode: "external",
    binding: {
      driverId: "d1",
      epoch: 1,
      revision: 2,
      leaseExpiresAtMs: 0,
      acceptedWork: [],
    },
    recovery: "none",
    operations: {
      kind: "page",
      page: Object.freeze({
        items: Object.freeze(
          rows.map((row) => ({
            operationId: row.operationId,
            kind: "peer_dispatch",
            acceptance: {
              model: "glm-5.3",
              modelLane: "external-master",
              workspaceRoot: "/srv/project",
              scopedGoal: null,
              adoptedTurnId: "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01",
              adoptedSessionId: `coding:local:tui#peer-${row.slug}`,
              slug: row.slug,
              acceptedAtMs: 1,
              payloadDigest: "d".repeat(64),
            },
            lifecycle: row.lifecycle,
            createdAtMs: 1,
          })),
        ),
        snapshot: "snap-1",
        observedRevision: "7",
        complete: rows.length === 0,
        nextCursor: null,
        ...over,
      }),
    },
  };
}

/** Capture and count ACTUAL process-level unhandled rejections across a
 * bounded real event-loop flush (two macrotask ticks). The listener is
 * removed in the returned cleanup — never left attached to the runner. */
async function flushAndCountUnhandled(): Promise<{
  reasons: unknown[];
  cleanup: () => void;
}> {
  const reasons: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  const flush = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };
  await flush();
  return {
    reasons,
    cleanup: () => {
      process.off("unhandledRejection", onUnhandled);
    },
  };
}

/** Scoped timer-ownership tracker for discovery tests: records every
 * setTimeout handle created while active; tests assert walk-owned timers
 * are removed. The fixture's own watchdog is registered and cleared too. */
class TrackedTimers {
  #handles = new Set<ReturnType<typeof setTimeout>>();
  #origSet = globalThis.setTimeout.bind(globalThis);
  #origClear = globalThis.clearTimeout.bind(globalThis);
  #active = false;
  arm(): void {
    this.#active = true;
  }
  setTimeout = ((handler: () => void, ms?: number) => {
    const wrapped = () => {
      // Firing removes the handle from accounting BEFORE the handler runs,
      // so fired product timers do not inflate outstanding() counts.
      this.#handles.delete(handle);
      handler();
    };
    const handle = this.#origSet(wrapped, ms);
    if (this.#active) this.#handles.add(handle);
    return handle;
  }) as typeof setTimeout;
  clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    this.#origClear(handle);
    this.#handles.delete(handle);
  }) as typeof clearTimeout;
  outstanding(): number {
    return this.#handles.size;
  }
  restore(): void {
    this.#active = false;
    // Snapshot the captured handles: clearing one must never skip another
    // during this teardown loop.
    const handles = Array.from(this.#handles);
    for (const handle of handles) this.#origClear(handle);
    this.#handles.clear();
    globalThis.setTimeout = this.#origSet;
    globalThis.clearTimeout = this.#origClear;
  }
  install(): void {
    globalThis.setTimeout = this.setTimeout;
    globalThis.clearTimeout = this.clearTimeout;
  }
}

/**
 * Bounded labeled waits whose OWN watchdog timers are scheduled through the
 * PRE-INSTALL original setTimeout, so their cleanup never pollutes the
 * product-deadline baseline accounting. cancel() runs on success AND
 * failure; the testrunner 5s timeout stays a last resort, never cleanup.
 */
class BoundedWatchdog {
  #origSet = globalThis.setTimeout.bind(globalThis);
  #origClear = globalThis.clearTimeout.bind(globalThis);
  #pending = new Set<ReturnType<typeof setTimeout>>();
  wait(label: string, promise: Promise<unknown>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const handle = this.#origSet(() => {
        this.#pending.delete(handle);
        reject(new Error(`${label}: bounded wait timed out`));
      }, 2000);
      this.#pending.add(handle);
      Promise.resolve(promise).then(
        () => {
          this.#origClear(handle);
          this.#pending.delete(handle);
          resolve();
        },
        (reason: unknown) => {
          this.#origClear(handle);
          this.#pending.delete(handle);
          reject(reason);
        },
      );
    });
  }
  cancel(): void {
    const pending = Array.from(this.#pending);
    for (const handle of pending) this.#origClear(handle);
    this.#pending.clear();
  }
}

describe("SessionRecordManager read-only driver discovery", () => {
  function driverHarness(
    handler: PooledClient["driverGetHandler"],
    openedCaps = driverCaps,
  ) {
    const client = new PooledClient();
    client.openedFor = (sessionId) => ({
      session_id: sessionId,
      active_profile_id: "coding",
      workspace_root: "/srv/project",
      capabilities: openedCaps,
    });
    client.driverGetHandler = handler;
    const h = harness(client);
    return { h, client };
  }

  async function openOnly(h: ReturnType<typeof harness>, sessionId: string) {
    return open(h, sessionId);
  }

  async function settledInventory(
    record: SessionRecord<PooledClient>,
  ): Promise<void> {
    for (let i = 0; i < 50 && record.driverInventory.kind === "loading"; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(record.driverInventory.kind).not.toBe("loading");
  }

  async function settledOpen(h: ReturnType<typeof harness>, sessionId: string) {
    const record = await open(h, sessionId);
    // The session-ready walk is in-flight; settle it deterministically.
    if (record.driverInventoryWalk !== null) {
      await record.driverInventoryWalk;
    }
    return record;
  }

  it("session-ready refreshes ONLY the ready record; no turns, no selection effects", async () => {
    const { h, client } = driverHarness(async () => discoveryPage([]));
    const a = await settledOpen(h, "s-a");
    expect(a.driverInventory.kind).toBe("complete");
    expect(client.starts).toEqual([]);
    expect(a.driverInventoryRefresh).toBe(1);
  });

  it("P2m: a refresh of a SETTLED record never dips readiness back to unavailable", async () => {
    // Run 15 (:538): the release path's P2i refresh blanked `complete` to
    // `loading`, `deriveControlReadiness` projected `unavailable`, and the
    // console/seat gate (SessionControlBar.tsx:853/865) UNMOUNTED both seats —
    // destroying the console's own `useState` staging. The explicit re-acquire
    // then restored the seat with EMPTY staging, so Dispatch stayed disabled.
    // A re-walk of an already-known inventory is not a reason to show nothing.
    //
    // Asserted on the DIP itself (not on `controlReadiness`: this fixture's caps
    // advertise `session/driver/get` + `external_driver_v1` but not
    // `peer/control`, so readiness is `unavailable` by design here). The dip is
    // exactly the mechanism the bar's gate reads.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { h } = driverHarness(async () => {
      calls += 1;
      if (calls === 2) await gate; // the explicit REFRESH stalls
      return discoveryPage([]);
    });
    const a = await settledOpen(h, "s-readiness");
    expect(a.driverInventory.kind).toBe("complete");
    const settled = a.driverInventory;
    const refresh = h.manager.refreshDriverInventory(a.scope);
    // While the refresh is IN FLIGHT the last known disclosure stays visible:
    // the MOMENT it collapsed to `loading` the console unmounted (run 15).
    expect(a.driverInventory).toEqual(settled);
    release();
    expect(await refresh).toEqual(
      expect.objectContaining({ kind: "complete" }),
    );
    expect(a.driverInventory.kind).toBe("complete");
  });

  it("P2m: a NEVER-settled record still shows `loading` (cold start unchanged)", async () => {
    const gate = new Promise<void>(() => undefined); // never released
    const { h } = driverHarness(async () => {
      await gate;
      return discoveryPage([]);
    });
    const a = await openOnly(h, "s-never-settled");
    expect(a.driverInventory.kind).toBe("loading");
    h.manager.suspendRecords();
  });

  it("capability-off sends ZERO discovery RPCs and stays unavailable", async () => {
    const { h, client } = driverHarness(async () => {
      throw new Error("must not be called");
    }, caps);
    const record = await settledOpen(h, "s-nocaps");
    expect(record.driverInventory).toEqual({ kind: "unavailable" });
    expect(client.driverGetRequests).toEqual([]);
  });

  it("select/reselect sends no discovery RPCs and never resets state", async () => {
    const { h, client } = driverHarness(async () => discoveryPage([]));
    const a = await settledOpen(h, "s-a");
    const before = a.driverInventory;
    const count = client.driverGetRequests.length;
    h.manager.select(a.scope);
    h.manager.select(a.scope);
    expect(a.driverInventory).toBe(before);
    expect(client.driverGetRequests.length).toBe(count);
  });

  it("records a multi-page inventory exactly once per row, terminal included", async () => {
    let call = 0;
    const { h } = driverHarness(async () => {
      call += 1;
      if (call === 1)
        return discoveryPage(
          [
            { operationId: "op-1", slug: "a", lifecycle: "terminal" },
            { operationId: "op-2", slug: "b", lifecycle: "started" },
          ],
          { complete: false, nextCursor: "c-1" },
        );
      return discoveryPage([], { complete: true, nextCursor: null });
    });
    const record = await settledOpen(h, "s-multi");
    expect(record.driverInventory).toMatchObject({ kind: "complete" });
    if (record.driverInventory.kind === "complete") {
      expect(record.driverInventory.rows.map((r) => r.operationId)).toEqual([
        "op-1",
        "op-2",
      ]);
    }
  });

  it("a refused chain (cursor reset) never yields empty-complete; error state", async () => {
    const { ExternalDriverRefusalError } =
      await import("@octos-org/octoscode-client/external-driver");
    const { h } = driverHarness(async () => {
      throw new ExternalDriverRefusalError(
        "session/driver/get",
        "driver_operations_cursor_reset",
      );
    });
    const record = await settledOpen(h, "s-refused");
    expect(record.driverInventory).toEqual({
      kind: "error",
      reason: "refused",
      refusal: "driver_operations_cursor_reset",
    });
  });

  it("overlapping refreshes: latest wins, stale success never lands", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { h } = driverHarness(async () => {
      calls += 1;
      if (calls === 1) await gate; // first (session-ready) walk stalls
      return discoveryPage([]);
    });
    const record = await open(h, "s-overlap");
    // Capture the FIRST (session-ready) walk before the refresh replaces
    // the record's in-flight pointer with the newer walk's promise.
    const firstWalk = record.driverInventoryWalk;
    expect(firstWalk).not.toBeNull();
    // Second explicit refresh supersedes the stalled session-ready walk.
    const second = h.manager.refreshDriverInventory(record.scope);
    release();
    const firstOutcome = await firstWalk!;
    expect(firstOutcome).toEqual({ kind: "error", reason: "stale" });
    const outcome = await second;
    expect(outcome.kind).toBe("complete");
    expect(record.driverInventory.kind).toBe("complete");
  });

  it("eviction invalidates a late response without touching others", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { h } = driverHarness(async () => {
      await gate;
      return discoveryPage([]);
    });
    const a = await open(h, "s-evict");
    const b = await open(h, "s-keep");
    h.manager.evict(a.scope);
    release();
    await a.driverInventoryWalk;
    expect(h.manager.get(a.scope)).toBeNull();
    // The retained record's walk is untouched by the eviction's stale settle.
    await b.driverInventoryWalk;
    expect(b.driverInventory.kind).toBe("complete");
  });

  it("lifecycle table: 4 actions x LOADER/PAGE boundary — entry observed, old walk settles stale while its REAL input stays UNSETTLED, zero/one page RPCs, exact timer baseline", async () => {
    const actions: Array<{
      name: string;
      act: (
        record: SessionRecord<PooledClient>,
        h: ReturnType<typeof harness>,
      ) => void;
    }> = [
      {
        name: "suspendRecords",
        act: (_r, h) => void h.manager.suspendRecords(),
      },
      {
        name: "closeRetainedRecord",
        act: (r, h) => void h.manager.closeRetainedRecord(r),
      },
      { name: "evict", act: (r, h) => void h.manager.evict(r.scope) },
      { name: "retireAll", act: (_r, h) => void h.manager.retireAll() },
    ];
    for (const boundary of ["loader", "page"] as const) {
      for (const { name, act } of actions) {
        const watchdog = new BoundedWatchdog();
        const timers = new TrackedTimers();
        timers.install();
        timers.arm();
        const { h, client } = driverHarness(async () =>
          discoveryPage([], { complete: true }),
        );
        try {
          const baseline = timers.outstanding();
          const sessionId = `s-lc-${boundary}-${name}`;
          const entered =
            boundary === "loader"
              ? new Promise<void>((resolve) => {
                  client.loaderEntries.push({ sessionId, resolve });
                })
              : new Promise<void>((resolve) => {
                  client.driverGetEntered.push(resolve);
                });
          if (boundary === "loader") {
            client.loaderGate = deferred<void>().promise; // NEVER released
          } else {
            client.driverGetHandlerNeverSettles = true;
          }
          const rec = await openOnly(h, sessionId);
          await watchdog.wait(`${name}/${boundary} entry`, entered);
          if (boundary === "page") {
            expect(client.pendingPages.length).toBe(1);
            // Keep the ACTUAL page input UNSETTLED — held, never settled.
            void client.pendingPages.shift();
            client.driverGetHandlerNeverSettles = false;
          }
          const oldWalk = rec.driverInventoryWalk!;
          act(rec, h);
          await watchdog.wait(`${name}/${boundary} old walk`, oldWalk);
          expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
          expect(rec.driverInventory.kind).not.toBe("loading");
          expect(rec.driverInventoryWalk).toBeNull();
          // LOADER boundary: ZERO page RPCs ever issued. PAGE boundary:
          // exactly ONE page RPC — still unsettled.
          expect(client.driverGetRequests.length).toBe(
            boundary === "loader" ? 0 : 1,
          );
          expect(timers.outstanding()).toBe(baseline);
          expect(client.status).toBe("connected");
        } finally {
          watchdog.cancel();
          h.manager.suspendRecords();
          timers.restore();
        }
      }
    }
  });

  it("a NEWER walk settles complete while the older hung one never lands", async () => {
    const deferred: Array<() => void> = [];
    let calls = 0;
    const { h } = driverHarness(async () => {
      const mine = calls;
      calls += 1;
      if (mine === 0) {
        // older walk: NEVER settles (only cancellation clears its loading)
        await new Promise<void>(() => undefined);
      }
      if (mine === 1) {
        await new Promise<void>((r) => {
          deferred.push(r);
        });
      }
      return discoveryPage([]);
    });
    const a = await openOnly(h, "s-overlap2");
    expect(a.driverInventory.kind).toBe("loading");
    const older = a.driverInventoryWalk;
    expect(older).not.toBeNull();
    const newer = h.manager.refreshDriverInventory(a.scope); // newer walk
    // The superseded walk must settle stale without its gate resolving.
    expect(
      await Promise.race([
        older,
        new Promise((_, rej) =>
          setTimeout(
            () => rej(new Error("overlap: old walk never settled")),
            500,
          ),
        ),
      ]),
    ).toEqual({ kind: "error", reason: "stale" });
    // Let the newer walk reach its gated page deterministically.
    await new Promise((r) => setTimeout(r, 0));
    expect(deferred.length).toBe(1);
    deferred[0]!();
    expect(await newer).toEqual(expect.objectContaining({ kind: "complete" }));
    // Releasing the older gate (it never resolves anyway) cannot clobber.
    await new Promise((r) => setTimeout(r, 0));
    expect(a.driverInventory.kind).toBe("complete");
    expect(a.driverInventoryWalk).toBeNull();
  });

  it("REQUIREMENT: three records on ONE pool, B selected, A+C refresh concurrently", async () => {
    let calls = 0;
    const gates: Array<() => void> = [];
    const { h } = driverHarness(async () => {
      const mine = calls;
      calls += 1;
      if (mine < 2) {
        await new Promise<void>((r) => {
          gates.push(r);
        });
      }
      return discoveryPage([]);
    });
    const a = await openOnly(h, "s-a");
    const c = await openOnly(h, "s-c");
    const b = await settledOpen(h, "s-b");
    h.manager.select(b.scope);
    expect(b.selected).toBe(true);
    expect(a.driverInventory.kind).toBe("loading");
    expect(c.driverInventory.kind).toBe("loading");
    // B (selected) completed its own refresh; A and C remain in-flight.
    expect(b.driverInventory.kind).toBe("complete");
    // settle A and C: only their own records update
    for (const gate of gates) gate();
    await a.driverInventoryWalk;
    await c.driverInventoryWalk;
    expect(a.driverInventory.kind).toBe("complete");
    expect(c.driverInventory.kind).toBe("complete");
    expect(
      h.manager
        .records()
        .map((r) => r.scope.sessionId)
        .sort(),
    ).toEqual(["s-a", "s-b", "s-c"]);
  });

  it("(1) TRUE loader hang: driverGet NEVER started; cancel settles old walk (all lifecycles)", async () => {
    for (const { name, act } of [
      {
        name: "suspend",
        act: (_r: SessionRecord<PooledClient>, h: ReturnType<typeof harness>) =>
          void h.manager.suspendRecords(),
      },
      {
        name: "close",
        act: (
          rec: SessionRecord<PooledClient>,
          h: ReturnType<typeof harness>,
        ) => void h.manager.closeRetainedRecord(rec),
      },
      {
        name: "evict",
        act: (
          rec: SessionRecord<PooledClient>,
          h: ReturnType<typeof harness>,
        ) => void h.manager.evict(rec.scope),
      },
      {
        name: "retireAll",
        act: (
          _rec: SessionRecord<PooledClient>,
          h: ReturnType<typeof harness>,
        ) => void h.manager.retireAll(),
      },
    ] as const) {
      const { h, client } = driverHarness(async () => discoveryPage([]));
      client.loaderGate = new Promise<void>(() => undefined); // LOADER hangs
      const a = await openOnly(h, `s-loader-${name}`);
      expect(a.driverInventory.kind).toBe("loading");
      const oldWalk = a.driverInventoryWalk!;
      act(a, h);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      // driverGet was NEVER started for a loader hang.
      expect(client.driverGetRequests.length).toBe(0);
      expect(a.driverInventory.kind).not.toBe("loading");
      expect(h.client.status).toBe("connected");
    }
  });

  it("(1b) TRUE page hang: waits for driverGet ENTERED before cancel settles", async () => {
    const { h, client } = driverHarness(
      () => new Promise<never>(() => undefined),
    );
    const entered = new Promise<void>((resolve) => {
      client.driverGetEntered.push(resolve);
    });
    const a = await openOnly(h, "s-page-entered");
    await entered; // a real driverGet call has started
    const oldWalk = a.driverInventoryWalk!;
    h.manager.suspendRecords();
    expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
    expect(a.driverInventory.kind).not.toBe("loading");
  });

  it("(1c) overlap replacement cancels an actually ENTERED deferred old LOADER walk whose gate stays pending; newer walk completes independently", async () => {
    const watchdog = new BoundedWatchdog();
    const { h, client } = driverHarness(async () => discoveryPage([]));
    try {
      // Old walk's LOADER gate stays pending FOREVER — never released.
      const gate = deferred<void>();
      client.loaderGate = gate.promise;
      const enteredOld = new Promise<void>((resolve) => {
        client.loaderEntries.push({ sessionId: "s-overlap-loader", resolve });
      });
      const a = await openOnly(h, "s-overlap-loader");
      await watchdog.wait("old loader entry", enteredOld);
      const oldWalk = a.driverInventoryWalk!;
      // NEWER walk gets an independent UNGATED loader (field is per-call
      // captured before the await, so clearing it now cannot affect the old
      // loader that already captured its own pending gate).
      client.loaderGate = null;
      const newer = h.manager.refreshDriverInventory(a.scope);
      // Old settles stale while its underlying gate input is STILL pending.
      await watchdog.wait("old walk", oldWalk);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      await watchdog.wait("newer walk", newer);
      expect(await newer).toEqual(
        expect.objectContaining({ kind: "complete" }),
      );
      expect(a.driverInventory.kind).toBe("complete");
      // Gate intentionally left unresolved; manager consumed the stale walk.
    } finally {
      watchdog.cancel();
      h.manager.suspendRecords();
    }
  });

  it("(1d) LATE loader RESOLVE after old walk settled stale: consumed, newer view unchanged", async () => {
    const watchdog = new BoundedWatchdog();
    const { h, client } = driverHarness(async () => discoveryPage([]));
    let unhandledCleanup: (() => void) | null = null;
    try {
      const gate = deferred<void>();
      client.loaderGate = gate.promise;
      const enteredOld = new Promise<void>((resolve) => {
        client.loaderEntries.push({ sessionId: "s-late-loader", resolve });
      });
      const a = await openOnly(h, "s-late-loader");
      await watchdog.wait("old loader entry", enteredOld);
      const oldWalk = a.driverInventoryWalk!;
      client.loaderGate = null;
      const newer = h.manager.refreshDriverInventory(a.scope);
      await watchdog.wait("old walk", oldWalk);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      await watchdog.wait("newer walk", newer);
      expect(await newer).toEqual(
        expect.objectContaining({ kind: "complete" }),
      );
      // Capture the EXACT newer completed inventory object BEFORE any late
      // settlement; the late event must not replace or mutate it.
      const newerInventory = a.driverInventory;
      // Only AFTER old+newer settled: LATE-resolve the actual old input.
      gate.resolve();
      const flush = await flushAndCountUnhandled();
      unhandledCleanup = flush.cleanup;
      // Late resolution is consumed: no walk mutation, no extra page RPC,
      // exact newer completed view object intact, connection unchanged.
      expect(a.driverInventory).toBe(newerInventory); // object identity
      expect(a.driverInventory).toEqual(newerInventory); // deep equality
      expect(a.driverInventoryWalk).toBeNull();
      expect(client.driverGetRequests.length).toBe(1);
      expect(client.status).toBe("connected");
      expect(flush.reasons).toEqual([]); // ZERO process unhandled rejections
    } finally {
      unhandledCleanup?.();
      watchdog.cancel();
      h.manager.suspendRecords();
    }
  });

  it("(1f) LATE page SUCCESS after old walk settled stale: genuine completed old page consumed, newer view unchanged", async () => {
    const watchdog = new BoundedWatchdog();
    // Distinguishable NEWER row: proves the surviving view is the NEWER
    // walk's, and a late old page cannot clobber it.
    const { h, client } = driverHarness(() =>
      discoveryPage(
        [{ operationId: "op-new", slug: "new-row", lifecycle: "started" }],
        { complete: true },
      ),
    );
    client.driverGetHandlerNeverSettles = true;
    const entered = new Promise<void>((resolve) => {
      client.driverGetEntered.push(resolve);
    });
    let unhandledCleanup: (() => void) | null = null;
    try {
      const a = await openOnly(h, "s-late-page");
      await watchdog.wait("old page entry", entered);
      // EXACT old deferred control captured while present — no optional
      // skip — BEFORE re-enabling new requests.
      expect(client.pendingPages.length).toBe(1);
      const oldDeferred = client.pendingPages.shift()!;
      client.driverGetHandlerNeverSettles = false;
      const oldWalk = a.driverInventoryWalk!;
      const newer = h.manager.refreshDriverInventory(a.scope);
      await watchdog.wait("newer walk", newer);
      expect(await newer).toEqual(
        expect.objectContaining({ kind: "complete" }),
      );
      // Capture the EXACT newer completed inventory (with the NEWER row)
      // BEFORE the late old settlement.
      const newerInventory = a.driverInventory;
      expect(newerInventory).toEqual(
        expect.objectContaining({
          kind: "complete",
          rows: [expect.objectContaining({ operationId: "op-new" })],
        }),
      );
      await watchdog.wait("old walk", oldWalk);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      // Only AFTER settlement: LATE-resolve the actual old page call with a
      // GENUINE valid but DISTINGUISHABLE old page (op-old row).
      const flush = await flushAndCountUnhandled();
      unhandledCleanup = flush.cleanup;
      oldDeferred.resolve(
        discoveryPage(
          [{ operationId: "op-old", slug: "old-row", lifecycle: "terminal" }],
          { complete: true },
        ),
      );
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(a.driverInventory).toBe(newerInventory); // object identity
      expect(a.driverInventory).toEqual(newerInventory); // deep equality
      expect(a.driverInventoryWalk).toBeNull();
      expect(client.driverGetRequests.length).toBe(2);
      expect(client.status).toBe("connected");
      expect(flush.reasons).toEqual([]); // ZERO process unhandled rejections
    } finally {
      unhandledCleanup?.();
      watchdog.cancel();
      h.manager.suspendRecords();
    }
  });

  it("(1g) LATE page REJECT(undefined) after old walk settled stale: consumed, no unhandled rejection", async () => {
    const watchdog = new BoundedWatchdog();
    const { h, client } = driverHarness(() =>
      discoveryPage(
        [{ operationId: "op-new-g", slug: "new-row-g", lifecycle: "started" }],
        { complete: true },
      ),
    );
    let unhandledCleanup: (() => void) | null = null;
    try {
      client.driverGetHandlerNeverSettles = true;
      const entered = new Promise<void>((resolve) => {
        client.driverGetEntered.push(resolve);
      });
      const a = await openOnly(h, "s-late-page-rej");
      await watchdog.wait("old page entry", entered);
      // EXACT old deferred control — no optional skip.
      expect(client.pendingPages.length).toBe(1);
      const oldDeferred = client.pendingPages.shift()!;
      client.driverGetHandlerNeverSettles = false;
      const oldWalk = a.driverInventoryWalk!;
      const newer = h.manager.refreshDriverInventory(a.scope);
      await watchdog.wait("newer walk", newer);
      expect(await newer).toEqual(
        expect.objectContaining({ kind: "complete" }),
      );
      const newerInventory = a.driverInventory;
      await watchdog.wait("old walk", oldWalk);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      // Only AFTER settlement: LATE-REJECT the actual old page input with
      // undefined; the walk must consume it without unhandled rejection.
      const flush = await flushAndCountUnhandled();
      unhandledCleanup = flush.cleanup;
      oldDeferred.reject(undefined);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(a.driverInventory).toBe(newerInventory); // object identity
      expect(a.driverInventory).toEqual(newerInventory); // deep equality
      expect(a.driverInventoryWalk).toBeNull();
      expect(client.driverGetRequests.length).toBe(2);
      expect(client.status).toBe("connected");
      expect(flush.reasons).toEqual([]); // ZERO process unhandled rejections
    } finally {
      unhandledCleanup?.();
      watchdog.cancel();
      h.manager.suspendRecords();
    }
  });

  it("(1e) LATE loader REJECT(undefined) after old walk settled stale: consumed, no unhandled rejection", async () => {
    const watchdog = new BoundedWatchdog();
    const { h, client } = driverHarness(async () => discoveryPage([]));
    let unhandledCleanup: (() => void) | null = null;
    try {
      const gate = deferred<void>();
      client.loaderGate = gate.promise;
      const entered = new Promise<void>((resolve) => {
        client.loaderEntries.push({ sessionId: "s-late-loader-rej", resolve });
      });
      const a = await openOnly(h, "s-late-loader-rej");
      await watchdog.wait("old loader entry", entered);
      const oldWalk = a.driverInventoryWalk!;
      client.loaderGate = null;
      const newer = h.manager.refreshDriverInventory(a.scope);
      await watchdog.wait("old walk", oldWalk);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      await watchdog.wait("newer walk", newer);
      expect(await newer).toEqual(
        expect.objectContaining({ kind: "complete" }),
      );
      const newerInventory = a.driverInventory;
      // Only AFTER settlement: LATE-reject the actual old loader input.
      const flush = await flushAndCountUnhandled();
      unhandledCleanup = flush.cleanup;
      gate.reject(undefined);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(a.driverInventory).toBe(newerInventory); // object identity
      expect(a.driverInventory).toEqual(newerInventory); // deep equality
      expect(a.driverInventoryWalk).toBeNull();
      expect(client.driverGetRequests.length).toBe(1);
      expect(client.status).toBe("connected");
      expect(flush.reasons).toEqual([]); // ZERO process unhandled rejections
    } finally {
      unhandledCleanup?.();
      watchdog.cancel();
      h.manager.suspendRecords();
    }
  });

  it("(2a) EXACT timer baseline: entered hung LOADER holds ZERO driverGet + exactly ONE owned deadline timer; suspend settles stale; baseline restores EXACTLY; gate NEVER released", async () => {
    const watchdog = new BoundedWatchdog();
    const timers = new TrackedTimers();
    timers.install();
    timers.arm();
    const { h, client } = driverHarness(async () => discoveryPage([]));
    try {
      const baseline = timers.outstanding();
      const loaderEntered = (sessionId: string) =>
        new Promise<void>((resolve) => {
          client.loaderEntries.push({ sessionId, resolve });
        });
      const gate = deferred<void>();
      client.loaderGate = gate.promise; // gate BEFORE open; NEVER released
      const entered = loaderEntered("s-timer-loader");
      const a = await openOnly(h, "s-timer-loader");
      await watchdog.wait("loader entry", entered); // loader actually ENTERED and hung
      // Hung at the LOADER: no driverGet page call was ever issued.
      expect(client.driverGetRequests.length).toBe(0);
      // Exactly the loader race's OWN single deadline timer is outstanding.
      expect(timers.outstanding()).toBe(baseline + 1);
      const oldWalk = a.driverInventoryWalk!;
      h.manager.suspendRecords();
      await watchdog.wait("old walk", oldWalk);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      // EXACT restore: the walk-owned deadline timer is gone, back to the
      // pre-walk baseline, with the gate NEVER released.
      expect(timers.outstanding()).toBe(baseline);
      expect(client.driverGetRequests.length).toBe(0);
    } finally {
      watchdog.cancel(); // bounded-wait cleanup on success AND failure
      h.manager.suspendRecords(); // retire fixture: no async manager work survives
      timers.restore(); // cleanup only AFTER baseline assertions
    }
  });

  it("(2b) EXACT timer baseline: entered hung PAGE holds exactly page+outer TWO deadline timers; suspend settles stale; baseline restores EXACTLY; page NEVER released", async () => {
    const watchdog = new BoundedWatchdog();
    const timers = new TrackedTimers();
    timers.install();
    timers.arm();
    const { h, client } = driverHarness(
      () => new Promise<never>(() => undefined),
    );
    try {
      const baseline = timers.outstanding();
      const entered = new Promise<void>((resolve) => {
        client.driverGetEntered.push(resolve);
      });
      const a = await openOnly(h, "s-timer-page");
      await watchdog.wait("page entry", entered); // real driverGet ENTERED, hung
      expect(client.driverGetRequests.length).toBe(1);
      // Exactly page race + outer walk race = TWO deadline timers.
      expect(timers.outstanding()).toBe(baseline + 2);
      const oldWalk = a.driverInventoryWalk!;
      h.manager.suspendRecords();
      await watchdog.wait("old walk", oldWalk);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      // EXACT restore while the page promise NEVER resolves.
      expect(timers.outstanding()).toBe(baseline);
      expect(client.driverGetRequests.length).toBe(1);
    } finally {
      watchdog.cancel();
      h.manager.suspendRecords();
      timers.restore();
    }
  });

  it("(2c) EXACT timer baseline: normal completed walk restores EXACT pre-walk baseline", async () => {
    const watchdog = new BoundedWatchdog();
    const timers = new TrackedTimers();
    timers.install();
    timers.arm();
    const { h, client } = driverHarness(async () => discoveryPage([]));
    try {
      const baseline = timers.outstanding();
      const a = await openOnly(h, "s-timer-normal");
      await watchdog.wait("walk", a.driverInventoryWalk!);
      expect(a.driverInventory.kind).toBe("complete");
      expect(timers.outstanding()).toBe(baseline);
      expect(client.driverGetRequests.length).toBe(1);
    } finally {
      watchdog.cancel();
      h.manager.suspendRecords();
      timers.restore();
    }
  });

  // ---- REAL fence evidence: each case mutates ONE real authority input in
  // the SAME harness (no second harness, no private-field tampering, no
  // suspend/retire as the invalidation cause), captures the exact old walk,
  // and settles the ACTUAL old input only AFTER replacement. ----

  it("(3a) POOL fence: replacing h.pool.client with a second real PooledClient invalidates the old walk; old input settles stale with zero page-on; new open on the exact new client completes", async () => {
    const watchdog = new BoundedWatchdog();
    const { h, client } = driverHarness(() =>
      discoveryPage([], { complete: true }),
    );
    let unhandledCleanup: (() => void) | null = null;
    try {
      // LOADER-boundary fence: old walk hangs at its own captured gate.
      const gate = deferred<void>();
      client.loaderGate = gate.promise;
      const enteredOld = new Promise<void>((resolve) => {
        client.loaderEntries.push({ sessionId: "s-fence-pool", resolve });
      });
      const a = await openOnly(h, "s-fence-pool");
      await watchdog.wait("old loader entry", enteredOld);
      const oldWalk = a.driverInventoryWalk!;
      client.loaderGate = null; // old loader keeps its CAPTURED gate
      // Replace the pool's client — NO suspend/retire first.
      const replacement = new PooledClient();
      replacement.openedFor = (sessionId) => ({
        session_id: sessionId,
        active_profile_id: "coding",
        workspace_root: "/srv/project",
        capabilities: driverCaps,
      });
      replacement.driverGetHandler = async () =>
        discoveryPage([], { complete: true });
      h.pool.client = replacement;
      const flush = await flushAndCountUnhandled();
      unhandledCleanup = flush.cleanup;
      gate.resolve();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      // Old walk must settle stale WITHOUT any cancellation call — the
      // POOL replacement alone fenced it, surfaced when its input settled.
      await watchdog.wait("old walk", oldWalk);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      // Loader-hung old walk: ZERO page requests ever issued by it.
      expect(client.driverGetRequests.length).toBe(0);
      expect(a.driverInventory.kind).not.toBe("loading");
      expect(flush.reasons).toEqual([]);
      // Open the SAME session on the exact replacement client; it completes.
      const reopened = await h.manager.openOnRecord(
        config("s-fence-pool"),
        h.pool.client,
        new AbortController().signal,
      );
      expect(h.pool.client).toBe(replacement);
      await settledInventory(reopened);
      expect(reopened.driverInventory.kind).toBe("complete");
      // The late-settled old input cannot clobber the new completed view.
      expect(replacement.driverGetRequests.map((r) => r.sessionId)).toEqual([
        "s-fence-pool",
      ]);
    } finally {
      unhandledCleanup?.();
      watchdog.cancel();
      h.manager.suspendRecords();
    }
  });

  it("(3b) EPOCH fence: raising h.pool.epoch with SAME client invalidates the old walk; old input settles stale; reopen under the new epoch yields a distinct record with a healthy view", async () => {
    const watchdog = new BoundedWatchdog();
    const { h, client } = driverHarness(() =>
      discoveryPage([], { complete: true }),
    );
    let unhandledCleanup: (() => void) | null = null;
    try {
      const gate = deferred<void>();
      client.loaderGate = gate.promise;
      const enteredOld = new Promise<void>((resolve) => {
        client.loaderEntries.push({ sessionId: "s-fence-epoch", resolve });
      });
      const a = await openOnly(h, "s-fence-epoch");
      await watchdog.wait("old loader entry", enteredOld);
      const oldWalk = a.driverInventoryWalk!;
      client.loaderGate = null; // old loader keeps its CAPTURED gate
      // Raise the epoch — SAME client, NO cancellation.
      h.pool.epoch = 2;
      const flush = await flushAndCountUnhandled();
      unhandledCleanup = flush.cleanup;
      gate.resolve();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      // EPOCH raise alone fenced it, surfaced when its input settled.
      await watchdog.wait("old walk", oldWalk);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      expect(client.driverGetRequests.length).toBe(0);
      expect(a.driverInventory.kind).not.toBe("loading");
      expect(flush.reasons).toEqual([]);
      // Reopen under the NEW epoch: scope carries the new epoch → a
      // DISTINCT record identity with a healthy current view.
      const reopened = await h.manager.openOnRecord(
        config("s-fence-epoch"),
        h.pool.client,
        new AbortController().signal,
      );
      expect(reopened).not.toBe(a);
      expect(reopened.scope.authorityEpoch).toBe(2);
      expect(a.scope.authorityEpoch).toBe(1);
      await settledInventory(reopened);
      expect(reopened.driverInventory.kind).toBe("complete");
      expect(reopened.runtime.getSnapshot()).toMatchObject({
        phase: "ready",
        status: "connected",
      });
      expect(a.driverInventory.kind).not.toBe("loading");
    } finally {
      unhandledCleanup?.();
      watchdog.cancel();
      h.manager.suspendRecords();
    }
  });

  it("(3c) GENERATION fence: same-client runtime authority generation changes via real disconnect; isCurrent(old) is false and the old walk settles stale; a fresh open completes", async () => {
    const watchdog = new BoundedWatchdog();
    const { h, client } = driverHarness(() =>
      discoveryPage([], { complete: true }),
    );
    let unhandledCleanup: (() => void) | null = null;
    try {
      client.driverGetHandlerNeverSettles = true;
      const entered = new Promise<void>((resolve) => {
        client.driverGetEntered.push(resolve);
      });
      const a = await openOnly(h, "s-fence-gen");
      await watchdog.wait("old page entry", entered);
      expect(client.pendingPages.length).toBe(1);
      const oldDeferred = client.pendingPages.shift()!;
      client.driverGetHandlerNeverSettles = false;
      const oldWalk = a.driverInventoryWalk!;
      const oldAuthority = a.runtime.currentAuthority()!;
      expect(oldAuthority).not.toBeNull();
      // Real supported lifecycle: runtime disconnect bumps the authority
      // generation (no manager suspend involved).
      a.runtime.disconnect();
      expect(a.runtime.isCurrent(oldAuthority)).toBe(false);
      const flush = await flushAndCountUnhandled();
      unhandledCleanup = flush.cleanup;
      oldDeferred.resolve(discoveryPage([], { complete: true }));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      // GENERATION change alone fenced it, surfaced when its input settled.
      await watchdog.wait("old walk", oldWalk);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      expect(client.driverGetRequests.length).toBe(1); // one original page RPC only
      expect(a.driverInventory.kind).not.toBe("loading");
      expect(flush.reasons).toEqual([]);
      // Fresh open through the SAME client creates a new authority; it
      // completes normally (generation, not token-only, is what fenced).
      const reopened = await h.manager.openOnRecord(
        config("s-fence-gen"),
        h.pool.client,
        new AbortController().signal,
      );
      await settledInventory(reopened);
      expect(reopened.driverInventory.kind).toBe("complete");
      // Generation PROOF, not just isCurrent(old)===false: the fresh
      // authority's own generation differs and IS current for the record.
      const newAuthority = reopened.runtime.currentAuthority()!;
      expect(newAuthority).not.toBeNull();
      expect(newAuthority.generation).not.toBe(oldAuthority.generation);
      expect(reopened.runtime.isCurrent(newAuthority)).toBe(true);
      expect(reopened.runtime.isCurrent(oldAuthority)).toBe(false);
    } finally {
      unhandledCleanup?.();
      watchdog.cancel();
      h.manager.suspendRecords();
    }
  });

  it("(3d) ENDPOINT transition: openOnRecord with a different endpoint yields a distinct scope/record; joint epoch/pool lifecycle fences the old walk; no cross-record rows", async () => {
    const watchdog = new BoundedWatchdog();
    const { h, client } = driverHarness(() =>
      discoveryPage([], { complete: true }),
    );
    let unhandledCleanup: (() => void) | null = null;
    try {
      const gate = deferred<void>();
      client.loaderGate = gate.promise;
      const enteredOld = new Promise<void>((resolve) => {
        client.loaderEntries.push({ sessionId: "s-fence-endpoint", resolve });
      });
      const a = await openOnly(h, "s-fence-endpoint");
      await watchdog.wait("old loader entry", enteredOld);
      const oldWalk = a.driverInventoryWalk!;
      client.loaderGate = null; // old loader keeps its CAPTURED gate; the
      // OTHER record's own walk must not hang on the same field.
      const oldScope = a.scope;
      expect(oldScope.endpoint).toBe("ws://server.test/ui");
      // Joint application transition: new endpoint arrives WITH a new epoch
      // (auth/endpoint changes swap both in the app).
      h.pool.epoch = 2;
      // The OTHER record's walk returns a DISTINCT NONEMPTY row — empty
      // arrays cannot prove row separation.
      client.driverGetHandler = async () =>
        discoveryPage(
          [
            {
              operationId: "op-endpoint-new",
              slug: "row-endpoint-new",
              lifecycle: "started",
            },
          ],
          { complete: true },
        );
      const other = await h.manager.openOnRecord(
        { ...config("s-fence-endpoint"), endpoint: "ws://other.test/ui" },
        h.pool.client,
        new AbortController().signal,
      );
      expect(other).not.toBe(a);
      expect(other.scope.endpoint).toBe("ws://other.test/ui");
      expect(other.scope).not.toBe(oldScope);
      // scope is frozen: the transition must not mutate the old record.
      expect(a.scope).toBe(oldScope);
      expect(a.scope.endpoint).toBe("ws://server.test/ui");
      const flush = await flushAndCountUnhandled();
      unhandledCleanup = flush.cleanup;
      gate.resolve();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      // The old walk was fenced by the JOINT endpoint+epoch/pool lifecycle,
      // surfaced when its input settled.
      await watchdog.wait("old walk", oldWalk);
      expect(await oldWalk).toEqual({ kind: "error", reason: "stale" });
      // The old LOADER-hung walk issued ZERO page RPCs; the OTHER record's
      // completed walk is the only page consumer on this shared client.
      expect(client.driverGetRequests.map((r) => r.sessionId)).toEqual([
        "s-fence-endpoint",
      ]);
      expect(a.driverInventory.kind).not.toBe("loading");
      expect(flush.reasons).toEqual([]);
      // The OTHER record completes its own discovery; no cross-record rows.
      await settledInventory(other);
      expect(other.driverInventory.kind).toBe("complete");
      const otherInv = other.driverInventory as unknown as {
        kind: "complete";
        rows: Array<{ operationId: string }>;
      };
      expect(otherInv.rows.map((r) => r.operationId)).toEqual([
        "op-endpoint-new",
      ]);
      // OLD/NEW inventory separation: the old record never published rows.
      expect(a.driverInventory).toEqual({ kind: "error", reason: "stale" });
    } finally {
      unhandledCleanup?.();
      watchdog.cancel();
      h.manager.suspendRecords();
    }
  });

  it("(4a) admission: missing METHOD, missing FEATURE, and missing client commands FUNCTION each issue ZERO discovery RPCs (session-ready AND manual refresh) with explicit unavailable", async () => {
    const baseCaps = (
      over: Partial<UiProtocolCapabilities>,
    ): UiProtocolCapabilities => ({
      ...driverCaps,
      ...over,
    });
    const cases = [
      {
        name: "method-missing",
        caps: baseCaps({
          supported_methods: [...(caps.supported_methods ?? [])],
        }),
      },
      {
        name: "feature-missing",
        caps: baseCaps({
          supported_features: [...(caps.supported_features ?? [])],
        }),
      },
    ] as const;
    for (const { name, caps: caseCaps } of cases) {
      const { h, client } = driverHarness(
        async () => discoveryPage([], { complete: true }),
        caseCaps,
      );
      const rec = await open(h, `s-admit-${name}`);
      await settledInventory(rec);
      expect(client.driverGetRequests.length).toBe(0);
      expect(client.loaderSessionArgs.length).toBe(0);
      expect(rec.driverInventory).toEqual({ kind: "unavailable" });
      await h.manager.refreshDriverInventory(rec.scope);
      expect(client.driverGetRequests.length).toBe(0);
      expect(client.loaderSessionArgs.length).toBe(0);
      expect(rec.driverInventory).toEqual({ kind: "unavailable" });
      expect(client.starts.length).toBe(0);
      expect(client.status).toBe("connected");
      h.manager.suspendRecords();
    }
    // Missing client commands FUNCTION: actually REMOVE the optional method
    // from the fixture instance (caps remain fully advertised).
    const { h: hFn, client: cFn } = driverHarness(async () =>
      discoveryPage([], { complete: true }),
    );
    // Instance-level shadow with undefined: a class METHOD lives on the
    // prototype, so `delete` is a no-op — an own property equal to
    // undefined actually hides it (typeof undefined !== "function").
    (cFn as { externalDriverCommands?: unknown }).externalDriverCommands =
      undefined;
    const fnRec = await open(hFn, "s-admit-fn-missing");
    await settledInventory(fnRec);
    expect(cFn.driverGetRequests.length).toBe(0);
    expect(cFn.loaderSessionArgs.length).toBe(0);
    expect(fnRec.driverInventory).toEqual({ kind: "unavailable" });
    await hFn.manager.refreshDriverInventory(fnRec.scope);
    expect(cFn.driverGetRequests.length).toBe(0);
    expect(cFn.loaderSessionArgs.length).toBe(0);
    expect(fnRec.driverInventory).toEqual({ kind: "unavailable" });
    expect(cFn.starts.length).toBe(0);
    expect(cFn.status).toBe("connected");
    hFn.manager.suspendRecords();
  });

  it("(4b) regression: A/C loaders stay pending while B opens LAST; every loader and driverGet keeps its own exact session ID", async () => {
    const pageIds: string[] = [];
    const { h, client } = driverHarness((sessionId) => {
      pageIds.push(sessionId);
      return discoveryPage([]);
    });
    // Bounded wait: fail fast with a label instead of hanging the file.
    const boundedWait = async (label: string, wait: Promise<unknown>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          wait,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`${label}: bounded wait timed out`)),
              2000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    // Per-session deferred LOADER gates on the PLAIN instance field. The
    // fixture captures the gate BEFORE its await, so each loader holds its
    // OWN gate even when a later open replaces the field; B gets null.
    const gates: Record<string, () => void> = {};
    const gateFor = (sessionId: string) => {
      const gate = deferred<void>();
      gates[sessionId] = gate.resolve;
      client.loaderGate = gate.promise; // BEFORE this session's open
    };
    const loaderEntered = (sessionId: string) =>
      new Promise<void>((resolve) => {
        client.loaderEntries.push({ sessionId, resolve });
      });
    try {
      gateFor("s-a");
      const enteredA = loaderEntered("s-a"); // observer BEFORE the open
      const a = await openOnly(h, "s-a");
      await boundedWait("loader entry A", enteredA); // deterministic: A's
      // loader has ENTERED (and captured its own gate) before C's gate is
      // installed — no reliance on open's microtask ordering.
      gateFor("s-c");
      const enteredC = loaderEntered("s-c"); // observer BEFORE the open
      const c = await openOnly(h, "s-c");
      await boundedWait("loader entry C", enteredC); // C entered before B
      client.loaderGate = null; // B's loader (entered last) has NO gate
      const enteredB = loaderEntered("s-b"); // observer BEFORE the open
      const b = await openOnly(h, "s-b"); // B opens LAST, ungated
      await boundedWait("loader entry B", enteredB);
      // A/C have entered loaders but issued ZERO page RPCs; B (opened last,
      // ungated) already completed its own discovery.
      expect(pageIds).toEqual(["s-b"]);
      expect(client.driverGetRequests.map((r) => r.sessionId)).toEqual(["s-b"]);
      expect(a.driverInventory.kind).toBe("loading");
      expect(c.driverInventory.kind).toBe("loading");
      await settledInventory(b);
      h.manager.select(b.scope);
      expect(b.selected).toBe(true);
      expect(a.driverInventory.kind).toBe("loading");
      expect(c.driverInventory.kind).toBe("loading");
      // Release C then A independently; their own driverGet closures must
      // target C then A (page request order B, C, A).
      gates["s-c"]!();
      await boundedWait("walk C", Promise.resolve(c.driverInventoryWalk));
      gates["s-a"]!();
      await boundedWait("walk A", Promise.resolve(a.driverInventoryWalk));
      // Loader ENTRY order is A, C, B; page REQUEST order is B, C, A — each
      // call kept its own real ID even though B was the last open.
      expect(client.loaderSessionArgs).toEqual(["s-a", "s-c", "s-b"]);
      expect(client.driverGetRequests.map((r) => r.sessionId)).toEqual([
        "s-b",
        "s-c",
        "s-a",
      ]);
      expect(pageIds).toEqual(["s-b", "s-c", "s-a"]);
      expect(a.driverInventory.kind).toBe("complete");
      expect(c.driverInventory.kind).toBe("complete");
      expect(b.driverInventory.kind).toBe("complete");
    } finally {
      // Cleanup on ANY failure: release every gate, clear the field, and
      // drain observers so nothing pending outlives this test.
      for (const release of Object.values(gates)) release();
      client.loaderGate = null;
      for (const entry of client.loaderEntries.splice(0)) entry.resolve();
    }
  });

  it("(4c) THREE records on ONE pool: A/C discovery pending while B completes+selected; real scoped projections, background drain, selection switches without resets, distinct per-record rows", async () => {
    const watchdog = new BoundedWatchdog();
    const { h, client } = driverHarness(() =>
      discoveryPage(
        [{ operationId: "op-b", slug: "row-b", lifecycle: "started" }],
        { complete: true },
      ),
    );
    const rowFor = (suffix: string) =>
      discoveryPage(
        [
          {
            operationId: `op-${suffix}`,
            slug: `row-${suffix}`,
            lifecycle: "started",
          },
        ],
        { complete: true },
      );
    try {
      const gates: Record<string, () => void> = {};
      const gateFor = (sessionId: string) => {
        const gate = deferred<void>();
        gates[sessionId] = gate.resolve;
        client.loaderGate = gate.promise;
      };
      const loaderEntered = (sessionId: string) =>
        new Promise<void>((resolve) => {
          client.loaderEntries.push({ sessionId, resolve });
        });
      gateFor("s-a");
      const enteredA = loaderEntered("s-a");
      const a = await openOnly(h, "s-a");
      await watchdog.wait("A loader entry", enteredA);
      gateFor("s-c");
      const enteredC = loaderEntered("s-c");
      const c = await openOnly(h, "s-c");
      await watchdog.wait("C loader entry", enteredC);
      client.loaderGate = null; // B's loader has NO gate
      const enteredB = loaderEntered("s-b");
      const b = await openOnly(h, "s-b");
      await watchdog.wait("B loader entry", enteredB);
      // B completes its own discovery and is selected while A/C pending.
      await settledInventory(b);
      h.manager.select(b.scope);
      expect(b.selected).toBe(true);
      expect(a.driverInventory.kind).toBe("loading");
      expect(c.driverInventory.kind).toBe("loading");
      // Real scoped projection events while A/C discovery STILL pending:
      // two enqueued background turns on A; deltas then terminal for A1.
      enqueue(a, "A1");
      enqueue(a, "A2");
      client.emit(envelope("s-a", "A1", 1, "assistant_delta", { text: "x" }));
      client.emit(envelope("s-a", "A1", 2, "assistant_delta", { text: "y" }));
      client.emit(terminal("s-a", "A1", 3));
      await flush();
      expect(starts(client)).toEqual([
        ["s-a", "A1"],
        ["s-a", "A2"],
      ]);
      expect(rows(a)).toEqual([
        ["user:A1", "A1"],
        ["assistant:A1:default", "xy"],
        ["terminal:A1", ""],
        ["user:A2", "A2"],
      ]);
      expect(b.timeline).toEqual([]);
      // Selection switches across all three and back with NO resets.
      const hydratesBefore = client.hydrates.length;
      const walkCount = client.driverGetRequests.length;
      h.manager.select(a.scope);
      expect(a.selected).toBe(true);
      h.manager.select(c.scope);
      expect(c.selected).toBe(true);
      h.manager.select(b.scope);
      expect(b.selected).toBe(true);
      expect(a.selected).toBe(false);
      expect(client.hydrates.length).toBe(hydratesBefore);
      expect(client.driverGetRequests.length).toBe(walkCount);
      // While A/C discovery STILL pending, settle C then A independently.
      client.driverGetHandler = async () => rowFor("c");
      gates["s-c"]!();
      await watchdog.wait("C walk", c.driverInventoryWalk!);
      client.driverGetHandler = async () => rowFor("a");
      gates["s-a"]!();
      await watchdog.wait("A walk", a.driverInventoryWalk!);
      const opIdsOf = (rec: typeof a) => {
        expect(rec.driverInventory).toEqual(
          expect.objectContaining({ kind: "complete" }),
        );
        const inv = rec.driverInventory as unknown as {
          rows: Array<{ operationId: string }>;
        };
        return inv.rows.map((r) => r.operationId);
      };
      expect(opIdsOf(a)).toEqual(["op-a"]);
      expect(opIdsOf(c)).toEqual(["op-c"]);
      expect(opIdsOf(b)).toEqual(["op-b"]);
      expect(client.loaderSessionArgs).toEqual(["s-a", "s-c", "s-b"]);
      expect(starts(client)).toEqual([
        ["s-a", "A1"],
        ["s-a", "A2"],
      ]);
      expect(client.status).toBe("connected");
    } finally {
      watchdog.cancel();
      h.manager.suspendRecords();
    }
  });
});
