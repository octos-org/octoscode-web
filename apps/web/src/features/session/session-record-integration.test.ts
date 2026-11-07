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

// Real SessionRecordManager + controller + runtime on one pooled client
// (ADR 0020, ADR 0005). Guarded chains: hydrate/live identity reconciliation
// (no lost or doubled prose across rehydrate), eviction/close publication,
// history-lease atomicity and fencing, caller-UUID admission and twin
// folding, background FIFO drain, loss freeze without ambiguous replay, and
// recovery superseded by epoch/client/evict/abort or a scope mismatch.
describe("SessionRecordManager real record/controller/runtime integration", () => {
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
});
