import { describe, expect, it } from "vitest";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
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

/**
 * B-resume 2137 Web concurrency proof: three retained records on ONE pooled
 * client, two queued turns each, one blocked on a REAL approval while the
 * others progress; repeated selection switches; foreign interrupt/decision
 * isolation; real steer dispatch; reconnect with a pending interaction;
 * enabled-discovery noninterference. The fixture is a minimal transport
 * double — ALL queue/ledger/controller/folding logic under test is the REAL
 * SessionRecordManager stack.
 */
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

const driverCaps: UiProtocolCapabilities = {
  ...caps,
  supported_methods: [...(caps.supported_methods ?? []), "session/driver/get"],
  supported_features: [
    ...(caps.supported_features ?? []),
    "external_driver_v1",
  ],
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

function completeDiscoveryPage(opId?: string) {
  const row = (id: string) => ({
    operationId: id,
    kind: "peer_dispatch",
    acceptance: {
      model: "glm-5.3",
      modelLane: "external-master",
      workspaceRoot: "/srv/project",
      scopedGoal: null,
      adoptedTurnId: "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01",
      adoptedSessionId: `coding:local:tui#peer-${id}`,
      slug: id,
      acceptedAtMs: 1,
      payloadDigest: "d".repeat(64),
    },
    lifecycle: "started",
    createdAtMs: 1,
  });
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
      page: {
        items: opId === undefined ? [] : [row(opId)],
        snapshot: "snap-1",
        observedRevision: "7",
        complete: true,
        nextCursor: null,
      },
    },
  };
}

class PooledClient {
  status: ConnectionStatus = "connected";
  readonly starts: TurnStartParams[] = [];
  readonly interrupts: Array<unknown[]> = [];
  readonly steers: Array<{
    session_id: string;
    expected_turn_id: string;
    text: string;
  }> = [];
  readonly responses: unknown[] = [];
  readonly notifications = new Set<(n: RpcNotification) => void>();
  readonly statuses = new Set<(status: ConnectionStatus) => void>();
  readonly startEntered: Array<(params: TurnStartParams) => void> = [];
  readonly driverGetRequests: Array<{ sessionId: string }> = [];
  readonly loaderSessionArgs: string[] = [];
  driverGetHandler: (sessionId: string) => Promise<unknown> = async () =>
    completeDiscoveryPage();
  openedFor: (sessionId: string) => SessionOpened = (sessionId) => ({
    session_id: sessionId,
    active_profile_id: "coding",
    workspace_root: "/srv/project",
    capabilities: caps,
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
    // Snapshot BEFORE dispatch: a listener may subscribe (and be invoked
    // synchronously) while another listener is running.
    const listeners = Array.from(this.statuses);
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
  async listConfigCapabilities(): Promise<{
    capabilities: UiProtocolCapabilities;
  }> {
    return { capabilities: caps };
  }
  async openSession(params: SessionOpenParams): Promise<SessionOpenResult> {
    return { opened: this.openedFor(params.session_id) };
  }
  async hydrateSession(
    params: SessionHydrateParams,
  ): Promise<SessionHydrateResult> {
    return this.hydratedFor(params.session_id);
  }
  async startTurn(params: TurnStartParams): Promise<unknown> {
    this.starts.push(structuredClone(params));
    for (const entered of this.startEntered.splice(0)) entered(params);
    return {};
  }
  async interruptTurn(...args: unknown[]): Promise<unknown> {
    this.interrupts.push(structuredClone(args));
    return {};
  }
  async steerCommands() {
    return {
      steer: async (expectedTurnId: string, _text: string) => {
        return { turn_id: expectedTurnId, steered: true };
      },
    };
  }
  async respondApproval(params: {
    approval_id: string;
    session_id?: string;
    decision?: string;
    approval_scope?: string;
  }): Promise<unknown> {
    this.responses.push(params);
    return {
      approval_id: params.approval_id,
      accepted: true,
      status: "resumed",
      runtime_resumed: true,
    };
  }
  async respondUserQuestion(params: { question_id: string }): Promise<unknown> {
    this.responses.push(params);
    return {
      question_id: params.question_id,
      accepted: true,
      runtime_resumed: true,
    };
  }
  async externalDriverCommands(
    sessionId: string,
    _profileId: string,
    _capabilities: UiProtocolCapabilities,
  ): Promise<
    import("@octos-org/octoscode-client/external-driver").ExternalDriverReadCommands
  > {
    this.loaderSessionArgs.push(sessionId);
    return {
      driverGet: async () => {
        this.driverGetRequests.push({ sessionId });
        return this.driverGetHandler(sessionId) as Promise<
          import("@octos-org/octoscode-client/external-driver").SessionDriverGetWithOperationsView
        >;
      },
      nextExpectedRevision: () => 0,
    };
  }
  emit(notification: RpcNotification) {
    // Snapshot BEFORE dispatch: a listener may (un)subscribe during emit.
    const listeners = Array.from(this.notifications);
    for (const listener of listeners) listener(notification);
  }
}

async function boundedWait(label: string, wait: Promise<unknown>) {
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
  let manager: SessionRecordManager<PooledClient>;
  manager = new SessionRecordManager<PooledClient>({
    pooledClient: () => pool.client,
    authorityEpoch: () => pool.epoch,
    onSelectedEvent: () => undefined,
    onSelectedSnapshot: () => undefined,
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
        setTimeline: () => {
          throw new Error("record timeline escaped into presentation");
        },
        setConnectionError: () => undefined,
        steer: async (request: {
          sessionId: string;
          expectedTurnId: string;
          text: string;
          markSent(): void;
        }) => {
          const pooled = recordClient() as unknown as PooledClient;
          const commands = await pooled.steerCommands();
          request.markSent();
          const result = await commands.steer(
            request.expectedTurnId,
            request.text,
          );
          pooled.steers.push({
            session_id: request.sessionId,
            expected_turn_id: request.expectedTurnId,
            text: request.text,
          });
          return result;
        },
      };
    },
  });
  return { manager, pool, client };
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

function terminal(sessionId: string, turnId: string, seq: number) {
  return envelope(sessionId, turnId, seq, "turn_terminal", {
    outcome: "completed",
  });
}

function approvalRequested(
  sessionId: string,
  turnId: string,
  approvalId: string,
): RpcNotification {
  return {
    jsonrpc: "2.0",
    method: CORE_UI_METHODS.APPROVAL_REQUESTED,
    params: {
      session_id: sessionId,
      turn_id: turnId,
      approval_id: approvalId,
      tool_name: "shell",
      title: "Run?",
      body: `body-${approvalId}`,
      typed_details: { command: `cmd-${approvalId}` },
    },
  };
}

async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function starts(client: PooledClient) {
  return client.starts.map(({ session_id, turn_id }) => [session_id, turn_id]);
}

function rows(record: SessionRecord<PooledClient>) {
  return record.timeline.map(({ id, body }) => [id, body]);
}

describe("SessionRecordManager three-record concurrency", () => {
  it("A blocked on a REAL approval while B/C drain exactly once; second starts gated on OBSERVED entry; selection switches never reset; foreign interrupt/decision and genuinely-stale cursor events stay isolated", async () => {
    const h = harness();
    try {
      const a = await open(h, "A");
      const b = await open(h, "B");
      const c = await open(h, "C");
      enqueue(a, "A1");
      enqueue(a, "A2");
      enqueue(b, "B1");
      enqueue(b, "B2");
      enqueue(c, "C1");
      enqueue(c, "C2");
      expect(starts(h.client)).toEqual([
        ["A", "A1"],
        ["B", "B1"],
        ["C", "C1"],
      ]);
      // A's active turn hits a REAL approval; only A's ledger is waiting.
      h.client.emit(approvalRequested("A", "A1", "ap-A1"));
      expect(a.interactions.getSnapshot().approval?.body).toBe("body-ap-A1");
      expect(b.interactions.getSnapshot().approval).toBeNull();
      expect(c.interactions.getSnapshot().approval).toBeNull();
      // Repeated selection switches while A is blocked.
      for (const record of [b, c, a, c, b, a, b]) {
        h.manager.select(record.scope);
      }
      expect(b.selected).toBe(true);
      expect(a.selected).toBe(false);
      // B: finish B1; the B2 start OBSERVER is registered BEFORE the event
      // that advances the queue (B1's terminal).
      h.client.emit(envelope("B", "B1", 1, "assistant_delta", { text: "b1" }));
      const b2Entered = new Promise<void>((resolve) => {
        h.client.startEntered.push(() => resolve());
      });
      h.client.emit(terminal("B", "B1", 2));
      await b2Entered;
      expect(starts(h.client)).toContainEqual(["B", "B2"]);
      // FOREIGN-to-A interrupt: interrupting B's active turn records ONE
      // interrupt referencing B/B2 and never touches A's queue.
      await b.controller.interrupt();
      expect(h.client.interrupts.length).toBe(1);
      expect(JSON.stringify(h.client.interrupts[0])).toContain("B");
      expect(JSON.stringify(h.client.interrupts[0])).toContain("B2");
      expect(starts(h.client).filter(([s]) => s === "A")).toEqual([
        ["A", "A1"],
      ]);
      h.client.emit(terminal("B", "B2", 3));
      // C likewise: observer before C1's terminal, then C2's own terminal.
      h.client.emit(envelope("C", "C1", 1, "assistant_delta", { text: "c1" }));
      const c2Entered = new Promise<void>((resolve) => {
        h.client.startEntered.push(() => resolve());
      });
      h.client.emit(terminal("C", "C1", 2));
      await c2Entered;
      expect(starts(h.client)).toContainEqual(["C", "C2"]);
      h.client.emit(terminal("C", "C2", 3));
      await flush();
      expect(starts(h.client)).toEqual([
        ["A", "A1"],
        ["B", "B1"],
        ["C", "C1"],
        ["B", "B2"],
        ["C", "C2"],
      ]);
      // A's second turn NEVER started while blocked.
      expect(starts(h.client).filter(([s]) => s === "A")).toEqual([
        ["A", "A1"],
      ]);
      // FOREIGN resolution: B-scoped decision for A's approval id must NOT
      // clear A's pending interaction.
      h.client.emit({
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.APPROVAL_DECIDED,
        params: {
          session_id: "B",
          approval_id: "ap-A1",
          decision: "approve",
        },
      });
      await flush();
      expect(a.interactions.getSnapshot().approval?.body).toBe("body-ap-A1");
      // GENUINELY stale: fold a live delta (seq 10 → cursor 11), then
      // re-emit seq 10 — its cursor (11) is not past the stored one, so it
      // must be dropped (no duplicate row).
      h.client.emit(envelope("A", "A1", 10, "assistant_delta", { text: "a1" }));
      await flush();
      expect(rows(a)).toEqual([
        ["user:A1", "A1"],
        ["assistant:A1:default", "a1"],
      ]);
      h.client.emit(
        envelope("A", "A1", 10, "assistant_delta", { text: "dup" }),
      );
      await flush();
      expect(rows(a)).toEqual([
        ["user:A1", "A1"],
        ["assistant:A1:default", "a1"],
      ]);
      // Resolve A's OWN approval; A1 completes; A2 starts exactly once
      // (observer before A1's terminal).
      await a.interactions.respondApproval("approve", "turn");
      expect(h.client.responses).toEqual([
        {
          session_id: "A",
          approval_id: "ap-A1",
          decision: "approve",
          approval_scope: "turn",
        },
      ]);
      const a2Entered = new Promise<void>((resolve) => {
        h.client.startEntered.push(() => resolve());
      });
      h.client.emit(terminal("A", "A1", 11));
      await a2Entered;
      h.client.emit(terminal("A", "A2", 12));
      await flush();
      expect(starts(h.client)).toEqual([
        ["A", "A1"],
        ["B", "B1"],
        ["C", "C1"],
        ["B", "B2"],
        ["C", "C2"],
        ["A", "A2"],
      ]);
      // Exact OWNING timelines; no cross-session contamination.
      expect(rows(a)).toEqual([
        ["user:A1", "A1"],
        ["assistant:A1:default", "a1"],
        ["terminal:A1", "completed"],
        ["user:A2", "A2"],
        ["terminal:A2", "completed"],
      ]);
      expect(rows(b)).toEqual([
        ["user:B1", "B1"],
        ["assistant:B1:default", "b1"],
        ["terminal:B1", "completed"],
        ["user:B2", "B2"],
        ["terminal:B2", "completed"],
      ]);
      expect(rows(c)).toEqual([
        ["user:C1", "C1"],
        ["assistant:C1:default", "c1"],
        ["terminal:C1", "completed"],
        ["user:C2", "C2"],
        ["terminal:C2", "completed"],
      ]);
      expect(h.client.status).toBe("connected");
    } finally {
      h.manager.suspendRecords();
    }
  });

  it("STEER: submitTurn with steering enabled dispatches dependencies.steer with the exact accepted UUID and session; foreign records unaffected", async () => {
    const h = harness();
    try {
      const a = await open(h, "A");
      const b = await open(h, "B");
      const aTurn = "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01";
      const bTurn = "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d02";
      enqueue(a, aTurn);
      enqueue(b, bTurn);
      expect(starts(h.client)).toEqual([
        ["A", aTurn],
        ["B", bTurn],
      ]);
      // Wait for A's start ACCEPTANCE before steering: the dispatch must
      // have completed (dispatchingTurnIdNow null) per product gating.
      await flush();
      expect(a.controller.dispatchingTurnIdNow()).toBeNull();
      const bRowsBefore = rows(b);
      expect(bRowsBefore).toEqual([[`user:${bTurn}`, bTurn]]);
      // Steering enabled + submitTurn on the ACCEPTED active UUID with NO
      // pending queue behind it. The CANDIDATE is a DISTINCT fresh UUID —
      // the product rejects a duplicate of the already-admitted active ID —
      // while the dispatch targets the accepted active UUID (expectedTurnId).
      const steerCandidate = "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d03";
      a.controller.setSteeringEnabled(true);
      expect(
        a.controller.submitTurn({
          turnId: steerCandidate,
          text: "steer text A",
        }),
      ).toBe(true);
      await flush();
      expect(
        h.client.steers.map(({ session_id, expected_turn_id, text }) => [
          session_id,
          expected_turn_id,
          text,
        ]),
      ).toEqual([["A", aTurn, "steer text A"]]);
      // Steer started no new turn and never touched B.
      expect(starts(h.client)).toEqual([
        ["A", aTurn],
        ["B", bTurn],
      ]);
      expect(b.controller.queueSnapshot().pending).toEqual([]);
      // B's SNAPSHOT is unchanged by A's steer: its own user row stays and
      // nothing drained or reset (not an empty-timeline claim).
      expect(rows(b)).toEqual(bRowsBefore);
      expect(b.controller.dispatchingTurnIdNow()).toBeNull();
      expect(h.client.interrupts).toEqual([]);
    } finally {
      h.manager.suspendRecords();
    }
  });

  it("RECONNECT with a pending interaction: canonical hydrate restores the blocked approval; enqueue stays blocked until resolution", async () => {
    const h = harness();
    try {
      const a = await open(h, "A");
      enqueue(a, "A1");
      h.client.emit(approvalRequested("A", "A1", "ap-re"));
      expect(a.interactions.getSnapshot().approval?.body).toBe("body-ap-re");
      h.manager.suspendRecords();
      // The REOPEN hydrate carries the pending approval + an active turn.
      h.client.hydratedFor = (id) =>
        hydrate(id, {
          cursor: { stream: id, seq: 5 },
          turns: [{ turn_id: "A1", thread_id: "A1", state: "active" }],
          pending_approvals: [
            {
              session_id: "A",
              turn_id: "A1",
              approval_id: "ap-re",
              tool_name: "shell",
              title: "Run?",
              body: "body-ap-re",
              typed_details: { command: "cmd-ap-re" },
            },
          ],
        });
      const reopened = await h.manager.openOnRecord(
        config("A"),
        h.pool.client,
        new AbortController().signal,
      );
      expect(reopened).toBe(a);
      await flush();
      expect(reopened.interactions.getSnapshot().approval?.body).toBe(
        "body-ap-re",
      );
      // Queue ADMISSION may stay allowed while the interaction blocks; the
      // proof is NO start/drain until the owner terminal event.
      expect(
        reopened.controller.enqueueTurn({ turnId: "A2", text: "A2" }),
      ).toBe(true);
      await flush();
      expect(starts(h.client).filter(([s]) => s === "A")).toEqual([
        ["A", "A1"],
      ]);
      await reopened.interactions.respondApproval("approve", "turn");
      expect(h.client.responses).toEqual([
        {
          session_id: "A",
          approval_id: "ap-re",
          decision: "approve",
          approval_scope: "turn",
        },
      ]);
      const a2Entered = new Promise<void>((resolve) => {
        h.client.startEntered.push(() => resolve());
      });
      h.client.emit(terminal("A", "A1", 6));
      await boundedWait("reconnect A2 start", a2Entered);
      h.client.emit(terminal("A", "A2", 7));
      await flush();
      expect(starts(h.client)).toEqual([
        ["A", "A1"],
        ["A", "A2"],
      ]);
      expect(h.client.status).toBe("connected");
    } finally {
      h.manager.suspendRecords();
    }
  });

  it("ENABLED discovery completes its walk but NEVER starts a turn, interrupt, or steer across three records", async () => {
    const client = new PooledClient();
    client.openedFor = (sessionId) => ({
      session_id: sessionId,
      active_profile_id: "coding",
      workspace_root: "/srv/project",
      capabilities: driverCaps,
    });
    const h = harness(client);
    try {
      // DISTINCT nonempty rows per session (op-A/op-B/op-C), not one shared id.
      client.driverGetHandler = async (sessionId) =>
        completeDiscoveryPage(`op-${sessionId}`);
      const a = await open(h, "A");
      const b = await open(h, "B");
      const c = await open(h, "C");
      // Await ALL THREE actual walk promises (bounded), not a loading poll.
      await boundedWait("A walk", Promise.resolve(a.driverInventoryWalk!));
      await boundedWait("B walk", Promise.resolve(b.driverInventoryWalk!));
      await boundedWait("C walk", Promise.resolve(c.driverInventoryWalk!));
      const opIds = (rec: SessionRecord<PooledClient>) => {
        expect(rec.driverInventory).toEqual(
          expect.objectContaining({ kind: "complete" }),
        );
        const inv = rec.driverInventory as unknown as {
          rows: Array<{ operationId: string }>;
        };
        return inv.rows.map((row) => row.operationId);
      };
      expect(opIds(a)).toEqual(["op-A"]);
      expect(opIds(b)).toEqual(["op-B"]);
      expect(opIds(c)).toEqual(["op-C"]);
      // Discovery completing on three records started ZERO turns/RPCs.
      expect(starts(client)).toEqual([]);
      expect(client.interrupts).toEqual([]);
      expect(client.steers).toEqual([]);
      expect(client.status).toBe("connected");
    } finally {
      h.manager.suspendRecords();
    }
  });
});
