import { expect } from "vitest";
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

/** Shared REAL manager/runtime harness; only the transport is a double. */
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

export function hydrate(
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

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export class PooledClient {
  /** Proves records share ONE transport, never per-record sockets. */
  static constructed = 0;
  status: ConnectionStatus = "connected";
  readonly starts: TurnStartParams[] = [];
  readonly opens: SessionOpenParams[] = [];
  readonly hydrates: SessionHydrateParams[] = [];
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

  constructor() {
    PooledClient.constructed += 1;
  }

  async connect() {
    this.setStatus("connected");
  }

  disconnect() {
    this.setStatus("disconnected");
  }

  setStatus(status: ConnectionStatus) {
    this.status = status;
    // A listener may subscribe or unsubscribe while another listener runs.
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
    for (const entered of this.startEntered.splice(0)) entered(params);
    return this.startGate ? this.startGate(params) : {};
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

  emit(notification: RpcNotification) {
    for (const listener of Array.from(this.notifications))
      listener(notification);
  }
}

export function config(sessionId: string): SessionConnectionInput {
  return {
    endpoint: "ws://server.test/ui",
    token: "",
    sessionId,
    profileId: "coding",
    cwd: "/srv/project",
  };
}

export function harness(
  options: { presentation?: boolean } = {},
  client = new PooledClient(),
) {
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
      if (!options.presentation) return;
      view.events.push(event.type);
      mirror();
      if (event.type === "session-hydrate") {
        expect(manager.selected()?.runtime.getSnapshot().phase).toBe(
          "recovering",
        );
      }
    },
    onSelectedSnapshot: () => {
      if (options.presentation) mirror();
    },
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
        setConnectionError: (error) => {
          if (options.presentation) view.errors.push(error);
        },
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
  if (options.presentation) {
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
  }
  return { manager, pool, view, client };
}

export type Harness = ReturnType<typeof harness>;

export async function open(h: Harness, sessionId: string) {
  return h.manager.openOnRecord(
    config(sessionId),
    h.pool.client,
    new AbortController().signal,
  );
}

export function enqueue(record: SessionRecord<PooledClient>, turnId: string) {
  expect(record.controller.enqueueTurn({ turnId, text: turnId })).toBe(true);
}

export function envelope(
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

export function terminal(sessionId: string, turnId: string, seq = 1) {
  return envelope(sessionId, turnId, seq, "turn_terminal", {
    outcome: "completed",
  });
}

export function approvalRequested(
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

export async function boundedWait(label: string, wait: Promise<unknown>) {
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

export async function flush(rounds = 20) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function starts(client: PooledClient) {
  return client.starts.map(({ session_id, turn_id }) => [session_id, turn_id]);
}

export function startsFor(client: PooledClient, sessionId: string) {
  return client.starts
    .filter((params) => params.session_id === sessionId)
    .map((params) => params.turn_id);
}

export function rows(record: SessionRecord<PooledClient>) {
  return record.timeline.map(({ id, body }) => [id, body]);
}
