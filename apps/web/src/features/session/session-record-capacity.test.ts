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
 * Capacity 0525: the audit's P1 row ("capacity is only proven in e2e"). This
 * headless proof drives the REAL SessionRecordManager / ActiveSessionRuntime
 * with 12 Session records + 3 peer records live at once on ONE pooled
 * transport, each with its own FIFO queue, switching selection across all 15
 * in a scripted order while turns complete out of order. The fixture is a
 * minimal transport double — ALL queue/selection/ledger/folding logic is the
 * real manager stack.
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
  supported_features: [CORE_UI_FEATURES.PROJECTION_ENVELOPE_V2],
};

class PooledClient {
  /** Proves the 15 records share exactly ONE transport, never per-record sockets. */
  static constructed = 0;
  status: ConnectionStatus = "connected";
  readonly starts: TurnStartParams[] = [];
  readonly interrupts: Array<unknown[]> = [];
  readonly responses: unknown[] = [];
  readonly notifications = new Set<(n: RpcNotification) => void>();
  readonly statuses = new Set<(status: ConnectionStatus) => void>();
  readonly startEntered: Array<() => void> = [];
  constructor() {
    PooledClient.constructed += 1;
  }
  openedFor: (sessionId: string) => SessionOpened = (sessionId) => ({
    session_id: sessionId,
    active_profile_id: "coding",
    workspace_root: "/srv/project",
    capabilities: caps,
  });
  hydratedFor: (sessionId: string) => SessionHydrateResult = (sessionId) => ({
    session_id: sessionId,
    cursor: { stream: sessionId, seq: 1 },
    turns: [],
  });
  async connect() {
    this.setStatus("connected");
  }
  disconnect() {
    this.setStatus("disconnected");
  }
  setStatus(status: ConnectionStatus) {
    this.status = status;
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
  async listConfigCapabilities() {
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
    for (const entered of this.startEntered.splice(0)) entered();
    return {};
  }
  async interruptTurn(...args: unknown[]): Promise<unknown> {
    this.interrupts.push(structuredClone(args));
    return {};
  }
  async steerCommands() {
    return {
      steer: async (expectedTurnId: string, _text: string) => ({
        turn_id: expectedTurnId,
        steered: true,
      }),
    };
  }
  async respondApproval(params: { approval_id: string }): Promise<unknown> {
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
  emit(notification: RpcNotification) {
    const listeners = Array.from(this.notifications);
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
          return commands.steer(request.expectedTurnId, request.text);
        },
      };
    },
  });
  return { manager, pool, client };
}

const IDS = [
  "S00",
  "S01",
  "S02",
  "S03",
  "S04",
  "S05",
  "S06",
  "S07",
  "S08",
  "S09",
  "S10",
  "S11",
  "peer-0",
  "peer-1",
  "peer-2",
] as const;
const TURNS = ["t1", "t2", "t3"] as const;

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

async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function startsFor(client: PooledClient, sessionId: string) {
  return client.starts
    .filter((params) => params.session_id === sessionId)
    .map((params) => params.turn_id);
}

/** Complete ONE turn of a record, then wait for its next FIFO turn to start. */
async function complete(
  client: PooledClient,
  sessionId: string,
  turnId: string,
  seq: number,
  next: string | null,
) {
  const entered = next
    ? new Promise<void>((resolve) => {
        // Observer registered BEFORE the terminal that advances the queue.
        client.startEntered.push(() => resolve());
      })
    : null;
  client.emit(
    envelope(sessionId, turnId, seq + 1, "turn_terminal", {
      outcome: "completed",
    }),
  );
  // The terminal must settle exactly this turn and start its own next FIFO head.
  if (entered) await entered;
  await flush();
  if (next) expect(startsFor(client, sessionId)).toContain(next);
}

describe("SessionRecordManager capacity: 12 Sessions + 3 peers on one transport", () => {
  it("keeps 15 live records' FIFOs isolated under scripted selection and out-of-order completion", async () => {
    const h = harness();
    const records = new Map<string, SessionRecord<PooledClient>>();
    for (const id of IDS) records.set(id, await open(h, id));

    // ONE transport for all 15 records (no per-record socket).
    expect(PooledClient.constructed).toBe(1);
    expect(h.manager.records()).toHaveLength(15);

    // Each record owns its own FIFO: three turns, enqueued in order.
    for (const id of IDS)
      for (const turn of TURNS) enqueue(records.get(id)!, `${id}-${turn}`);
    await flush();
    // Exactly one active start per record, and each is that record's FIRST turn.
    expect(h.client.starts).toHaveLength(15);
    for (const id of IDS) expect(startsFor(h.client, id)).toEqual([`${id}-t1`]);

    // Scripted selection across all 15 while work is live.
    const order = [7, 0, 11, 3, 14, 5, 1, 9, 2, 12, 6, 4, 13, 8, 10];
    for (const index of order)
      h.manager.select(records.get(IDS[index]!)!.scope);
    // Selection never reset a queue nor re-dispatched a start.
    expect(h.client.starts).toHaveLength(15);
    expect(h.manager.selected()!.scope.sessionId).toBe(IDS[order.at(-1)!]);

    // Out-of-order completion: drain t1 of every record in a shuffled order,
    // then t2, then t3 — each record advances ONLY its own FIFO.
    const drains = [
      [5, 13, 1, 9, 0, 14, 3, 11, 7, 2, 12, 6, 4, 10, 8],
      [14, 2, 8, 0, 6, 12, 4, 10, 1, 7, 13, 3, 9, 5, 11],
      [9, 4, 14, 7, 1, 11, 5, 13, 0, 8, 2, 12, 6, 10, 3],
    ];
    let seq = 1;
    for (let depth = 0; depth < TURNS.length; depth += 1) {
      for (const index of drains[depth]!) {
        const id = IDS[index]!;
        const turn = TURNS[depth]!;
        const next = TURNS[depth + 1] ? `${id}-${TURNS[depth + 1]}` : null;
        await complete(h.client, id, `${id}-${turn}`, seq, next);
        seq += 2;
      }
    }
    await flush();

    // Every queue drained in its OWN order; no foreign turn ever started.
    expect(h.client.starts).toHaveLength(15 * TURNS.length);
    for (const id of IDS)
      expect(startsFor(h.client, id)).toEqual([
        `${id}-t1`,
        `${id}-t2`,
        `${id}-t3`,
      ]);
    for (const id of IDS) {
      const snapshot = records.get(id)!.controller.snapshot();
      expect(snapshot.active).toBeNull();
      expect(snapshot.pending).toEqual([]);
    }

    // Background completions marked unread WITHOUT stealing selection.
    const pinned = h.manager.selected()!.scope.sessionId;
    for (const id of IDS)
      if (id !== pinned) expect(records.get(id)!.unread).toBe(true);
    expect(records.get(pinned)!.unread).toBe(false);
    expect(h.manager.selected()!.scope.sessionId).toBe(pinned);
  });
});
