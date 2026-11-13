import { describe, expect, it, vi } from "vitest";
import {
  CORE_UI_METHODS,
  type ConfigCapabilitiesListResult,
  type ConnectionStatus,
  type RpcNotification,
  type SessionHydrateParams,
  type SessionHydrateResult,
  type SessionOpenParams,
  type SessionOpenResult,
  type SessionOpened,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import type { CandidateSessionSnapshot } from "./candidate-session.ts";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";
import { deferred } from "./session-record-test-fixture.ts";
import { appuiCaps } from "../../test-fixtures/caps.ts";
import {
  ActiveSessionRuntime,
  type ActiveSessionRuntimeEvent,
} from "./active-session-runtime.ts";

const serverCapabilities = capabilities();
const opened: SessionOpened = {
  session_id: "session-one",
  active_profile_id: "coding",
  workspace_root: "/srv/project",
  capabilities: serverCapabilities,
};
const hydrated: SessionHydrateResult = {
  session_id: "session-one",
  cursor: { stream: "session-one", seq: 12 },
};
const connection: SessionConnectionInput = {
  endpoint: " https://octos.example.test ",
  token: " secret ",
  sessionId: " stale-session-hint ",
  profileId: " stale-profile ",
  cwd: " /stale/workspace ",
};
const sessionConfig: SessionConnectionInput = {
  ...connection,
  sessionId: "session-one",
  profileId: "coding",
  cwd: "/srv/project",
};

class FakeActiveClient {
  status: ConnectionStatus = "idle";
  disconnectCount = 0;
  readonly calls: string[] = [];
  readonly hydrateParams: SessionHydrateParams[] = [];

  openImplementation: (
    params: SessionOpenParams,
  ) => Promise<SessionOpenResult> = async () => ({ opened });
  hydrateImplementation: (
    params: SessionHydrateParams,
  ) => Promise<SessionHydrateResult> = async () => hydrated;

  readonly #statusListeners = new Set<(status: ConnectionStatus) => void>();
  readonly #notificationListeners = new Set<
    (notification: RpcNotification) => void
  >();

  async connect(): Promise<void> {
    this.calls.push("connect");
    this.setStatus("connecting");
    this.setStatus("connected");
  }

  disconnect(): void {
    this.calls.push("disconnect");
    this.disconnectCount += 1;
    this.setStatus("disconnected");
  }

  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.#statusListeners.add(listener);
    listener(this.status);
    return () => this.#statusListeners.delete(listener);
  }

  subscribeErrors(): () => void {
    return () => undefined;
  }

  subscribeNotifications(
    listener: (notification: RpcNotification) => void,
  ): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  listConfigCapabilities(): Promise<ConfigCapabilitiesListResult> {
    this.calls.push("capabilities");
    return Promise.resolve({ capabilities: serverCapabilities });
  }

  openSession(params: SessionOpenParams): Promise<SessionOpenResult> {
    this.calls.push("open");
    return this.openImplementation(params);
  }

  hydrateSession(params: SessionHydrateParams): Promise<SessionHydrateResult> {
    this.calls.push("hydrate");
    this.hydrateParams.push(params);
    return this.hydrateImplementation(params);
  }

  setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.#statusListeners) listener(status);
  }

  emit(notification: RpcNotification): void {
    for (const listener of this.#notificationListeners) listener(notification);
  }
}

describe("ActiveSessionRuntime", () => {
  it("fails closed when reconnect opens a different Session id", async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeActiveClient();
      const candidate = new FakeActiveClient();
      const reconnect = new FakeActiveClient();
      reconnect.openImplementation = async () => ({
        opened: { ...opened, session_id: "session-other" },
      });
      const clients = [server, reconnect];
      const { runtime } = testRuntime(() => {
        const client = clients.shift();
        if (!client) throw new Error("unexpected client request");
        return client;
      });
      await adoptConnected(runtime, candidate);

      candidate.setStatus("disconnected");
      await vi.advanceTimersByTimeAsync(500);

      expect(reconnect.calls).toEqual(["connect", "open", "disconnect"]);
      expect(runtime.currentAuthority()?.sessionId).toBe("session-one");
      expect(runtime.getSnapshot()).toMatchObject({
        phase: "reconnect_wait",
        authenticated: true,
        error: expect.stringContaining(
          "session/open returned session-other, expected session-one",
        ),
        session: { sessionId: "session-one" },
      });
      runtime.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rehydrates after lossy replay before delivering further notifications", async () => {
    const server = new FakeActiveClient();
    const candidate = new FakeActiveClient();
    const recoveryHydrate = deferred<SessionHydrateResult>();
    candidate.hydrateImplementation = () => recoveryHydrate.promise;
    const { runtime, events } = testRuntime(() => server);
    await adoptConnected(runtime, candidate);
    events.length = 0;

    candidate.emit({
      jsonrpc: "2.0",
      method: CORE_UI_METHODS.REPLAY_LOSSY,
      params: { session_id: "session-one", dropped_count: 2 },
    });
    candidate.emit(scopedNotification("buffered"));
    expect(events.map((event) => event.type)).toEqual([
      "raw-notification",
      "raw-notification",
    ]);
    recoveryHydrate.resolve(hydrated);
    await vi.waitFor(() => {
      expect(runtime.getSnapshot().phase).toBe("ready");
    });

    expect(events.map((event) => event.type)).toEqual([
      "raw-notification",
      "raw-notification",
      "session-hydrate",
      "notification",
      "session-ready",
    ]);
    expect(candidate.hydrateParams).toEqual([
      {
        session_id: "session-one",
        include: ["messages", "threads", "turns", "pending_approvals"],
      },
    ]);
  });

  it("fails closed on the 4097th recovery event", async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeActiveClient();
      const candidate = new FakeActiveClient();
      const recoveryHydrate = deferred<SessionHydrateResult>();
      candidate.hydrateImplementation = () => recoveryHydrate.promise;
      const { runtime, events } = testRuntime(() => server);
      await adoptConnected(runtime, candidate);
      events.length = 0;

      candidate.emit({
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.REPLAY_LOSSY,
        params: { session_id: "session-one", dropped_count: 1 },
      });
      for (let index = 0; index < 4_097; index += 1) {
        candidate.emit(scopedNotification(String(index)));
      }

      expect(candidate.disconnectCount).toBe(1);
      expect(runtime.getSnapshot()).toMatchObject({
        phase: "reconnect_wait",
        error: expect.stringContaining("4096"),
        recovery: {
          phase: "reconnecting",
          // The reconnect banner must keep the actionable overflow cause
          // instead of overwriting it with the generic retry text.
          detail: expect.stringContaining("4096"),
        },
      });
      const terminalEvents = events.length;
      recoveryHydrate.resolve(hydrated);
      await flushMicrotasks();

      expect(events).toHaveLength(terminalEvents);
      expect(runtime.getSnapshot()).toMatchObject({
        phase: "reconnect_wait",
        error: expect.stringContaining("4096"),
        recovery: { phase: "reconnecting" },
      });
      expect(events.some((event) => event.type === "session-ready")).toBe(
        false,
      );
      runtime.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});

function testRuntime(
  createClient: (config: SessionConnectionInput) => FakeActiveClient,
  prepareHydrate?: (hydrated: SessionHydrateResult) => Promise<void>,
): {
  runtime: ActiveSessionRuntime<FakeActiveClient>;
  events: ActiveSessionRuntimeEvent<FakeActiveClient>[];
} {
  const runtime = new ActiveSessionRuntime({
    createClient,
    validateServerCapabilities(value) {
      if (!value) throw new Error("missing server capabilities");
    },
    validateSessionCapabilities(value) {
      if (!value) throw new Error("missing Session capabilities");
    },
    random: () => 0.5,
    ...(prepareHydrate ? { prepareHydrate } : {}),
  });
  const events: ActiveSessionRuntimeEvent<FakeActiveClient>[] = [];
  runtime.subscribeEvents((event) => events.push(event));
  return { runtime, events };
}

/** Signs in, then adopts `candidate` as the connected session-one. */
async function adoptConnected(
  runtime: ActiveSessionRuntime<FakeActiveClient>,
  candidate: FakeActiveClient,
): Promise<void> {
  candidate.status = "connected";
  const expected = await runtime.authenticate(connection);
  if (!expected) throw new Error("missing authority");
  runtime.adoptCandidate({
    expected,
    config: sessionConfig,
    candidate: candidateSnapshot(candidate),
  });
}

function candidateSnapshot(
  client: FakeActiveClient,
  notifications: readonly RpcNotification[] = [],
): CandidateSessionSnapshot<FakeActiveClient> {
  return { client, opened, hydrated, notifications };
}

function scopedNotification(
  id: string,
  sessionId = "session-one",
): RpcNotification {
  return {
    jsonrpc: "2.0",
    method: `test/${id}`,
    params: { session_id: sessionId },
  };
}

function capabilities(): UiProtocolCapabilities {
  return appuiCaps({});
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}
