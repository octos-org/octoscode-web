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
import {
  ActiveSessionRuntime,
  StaleSessionAuthorityError,
  prepareRetainedCandidateSession,
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
  readonly openParams: SessionOpenParams[] = [];
  readonly hydrateParams: SessionHydrateParams[] = [];
  readonly statusHistory: Array<(status: ConnectionStatus) => void> = [];

  connectImplementation: () => Promise<void> = async () => undefined;
  capabilitiesImplementation: () => Promise<ConfigCapabilitiesListResult> =
    async () => ({ capabilities: serverCapabilities });
  openImplementation: (
    params: SessionOpenParams,
  ) => Promise<SessionOpenResult> = async () => ({ opened });
  hydrateImplementation: (
    params: SessionHydrateParams,
  ) => Promise<SessionHydrateResult> = async () => hydrated;
  statusSubscribeImplementation: (() => void) | null = null;

  readonly #statusListeners = new Set<(status: ConnectionStatus) => void>();
  readonly #errorListeners = new Set<(error: Error) => void>();
  readonly #notificationListeners = new Set<
    (notification: RpcNotification) => void
  >();

  async connect(): Promise<void> {
    this.calls.push("connect");
    this.setStatus("connecting");
    await this.connectImplementation();
    this.setStatus("connected");
  }

  disconnect(): void {
    this.calls.push("disconnect");
    this.disconnectCount += 1;
    this.setStatus("disconnected");
  }

  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.#statusListeners.add(listener);
    this.statusHistory.push(listener);
    this.statusSubscribeImplementation?.();
    listener(this.status);
    return () => this.#statusListeners.delete(listener);
  }

  subscribeErrors(listener: (error: Error) => void): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  subscribeNotifications(
    listener: (notification: RpcNotification) => void,
  ): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  listConfigCapabilities(): Promise<ConfigCapabilitiesListResult> {
    this.calls.push("capabilities");
    return this.capabilitiesImplementation();
  }

  openSession(params: SessionOpenParams): Promise<SessionOpenResult> {
    this.calls.push("open");
    this.openParams.push(params);
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

  emitError(message: string): void {
    for (const listener of this.#errorListeners) listener(new Error(message));
  }
}

describe("ActiveSessionRuntime", () => {
  it("stages an already-connected retained owner without reconnecting or taking cleanup authority", async () => {
    const owner = new FakeActiveClient();
    owner.status = "connected";
    owner.hydrateImplementation = async () => {
      owner.emit(scopedNotification("buffered"));
      return hydrated;
    };
    const controller = new AbortController();

    const prepared = await prepareRetainedCandidateSession({
      client: owner,
      config: sessionConfig,
      signal: controller.signal,
      validateOpened: () => undefined,
    });
    const candidate = prepared.release();

    expect(owner.calls).toEqual(["open", "hydrate"]);
    expect(owner.disconnectCount).toBe(0);
    expect(candidate.client).toBe(owner);
    expect(candidate.notifications).toEqual([scopedNotification("buffered")]);
  });

  it("cancels retained-owner staging without disconnecting the parked authority", async () => {
    const owner = new FakeActiveClient();
    owner.status = "connected";
    const opening = deferred<SessionOpenResult>();
    owner.openImplementation = () => opening.promise;
    const controller = new AbortController();

    const preparing = prepareRetainedCandidateSession({
      client: owner,
      config: sessionConfig,
      signal: controller.signal,
      validateOpened: () => undefined,
    });
    controller.abort();

    await expect(preparing).rejects.toThrow(
      "Retained candidate opening was cancelled",
    );
    expect(owner.disconnectCount).toBe(0);
    opening.resolve({ opened });
  });

  it("authenticates a server without opening a hidden Session", async () => {
    const client = new FakeActiveClient();
    const createdWith: SessionConnectionInput[] = [];
    const { runtime, events } = testRuntime((config) => {
      createdWith.push(config);
      return client;
    });

    const authority = await runtime.authenticate(connection);

    expect(authority?.client).toBe(client);
    expect(createdWith).toEqual([
      {
        endpoint: "https://octos.example.test",
        token: " secret ",
        sessionId: "",
        profileId: "",
        cwd: "",
      },
    ]);
    expect(client.calls).toEqual(["connect", "capabilities"]);
    expect(runtime.getSnapshot()).toMatchObject({
      phase: "authenticated",
      status: "connected",
      authenticated: true,
      session: null,
    });
    expect(events.map((event) => event.type)).toEqual([
      "session-cleared",
      "authenticated",
    ]);
  });

  it("adopts a prepared candidate atomically and orders raw events before hydrate, safe events, and ready", async () => {
    const server = new FakeActiveClient();
    const candidate = new FakeActiveClient();
    candidate.status = "connected";
    const { runtime, events } = testRuntime(() => server);
    const previous = await runtime.authenticate(connection);
    if (!previous) throw new Error("missing authority");
    events.length = 0;

    const next = runtime.adoptCandidate({
      expected: previous,
      config: sessionConfig,
      candidate: candidateSnapshot(candidate, [
        scopedNotification("one"),
        scopedNotification("two"),
      ]),
    });

    expect(next.client).toBe(candidate);
    expect(server.disconnectCount).toBe(1);
    expect(candidate.disconnectCount).toBe(0);
    expect(runtime.currentAuthority()).toBe(next);
    expect(runtime.getSnapshot()).toMatchObject({
      phase: "ready",
      authenticated: true,
      session: {
        sessionId: "session-one",
        profileId: "coding",
        cwd: "/srv/project",
      },
      recovery: { phase: "healthy" },
    });
    expect(events.map((event) => event.type)).toEqual([
      "session-cleared",
      "raw-notification",
      "raw-notification",
      "session-hydrate",
      "notification",
      "notification",
      "session-ready",
    ]);
  });

  it("retires the old product binding without closing a preserved turn-owner transport", async () => {
    const server = new FakeActiveClient();
    const candidate = new FakeActiveClient();
    candidate.status = "connected";
    const { runtime } = testRuntime(() => server);
    const previous = await runtime.authenticate(connection);
    if (!previous) throw new Error("missing authority");

    const next = runtime.adoptCandidate({
      expected: previous,
      config: sessionConfig,
      candidate: candidateSnapshot(candidate),
      preservePreviousTransport: true,
    });

    expect(runtime.currentAuthority()).toBe(next);
    expect(server.disconnectCount).toBe(0);
    expect(candidate.disconnectCount).toBe(0);

    server.emit(scopedNotification("old-session-event"));
    expect(runtime.currentAuthority()).toBe(next);
    expect(runtime.getSnapshot()).toMatchObject({
      session: { sessionId: "session-one" },
      recovery: { phase: "healthy" },
    });
  });

  it("rejects a stale candidate without touching either transport", async () => {
    const first = new FakeActiveClient();
    const second = new FakeActiveClient();
    const candidate = new FakeActiveClient();
    candidate.status = "connected";
    const clients = [first, second];
    const { runtime } = testRuntime(() => {
      const client = clients.shift();
      if (!client) throw new Error("unexpected client request");
      return client;
    });
    const stale = await runtime.authenticate(connection);
    if (!stale) throw new Error("missing authority");
    const current = await runtime.authenticate(connection);
    if (!current) throw new Error("missing replacement authority");

    expect(() =>
      runtime.adoptCandidate({
        expected: stale,
        config: sessionConfig,
        candidate: candidateSnapshot(candidate),
      }),
    ).toThrow(StaleSessionAuthorityError);
    expect(runtime.currentAuthority()).toBe(current);
    expect(second.disconnectCount).toBe(0);
    expect(candidate.disconnectCount).toBe(0);
  });

  it("authorizes the launch commit before mutating transport authority", async () => {
    const server = new FakeActiveClient();
    const candidate = new FakeActiveClient();
    candidate.status = "connected";
    const { runtime } = testRuntime(() => server);
    const previous = await runtime.authenticate(connection);
    if (!previous) throw new Error("missing authority");
    const authorizeCommit = vi.fn(() => false);

    expect(() =>
      runtime.adoptCandidate({
        expected: previous,
        config: sessionConfig,
        candidate: candidateSnapshot(candidate),
        authorizeCommit,
      }),
    ).toThrow(StaleSessionAuthorityError);

    expect(authorizeCommit).toHaveBeenCalledOnce();
    expect(runtime.currentAuthority()).toBe(previous);
    expect(server.disconnectCount).toBe(0);
    expect(candidate.disconnectCount).toBe(0);
  });

  it("keeps the old authority when candidate contract validation fails", async () => {
    const server = new FakeActiveClient();
    const candidate = new FakeActiveClient();
    candidate.status = "connected";
    const runtime = new ActiveSessionRuntime({
      createClient: () => server,
      validateServerCapabilities(value) {
        if (!value) throw new Error("missing server capabilities");
      },
      validateSessionCapabilities() {
        throw new Error("incompatible candidate contract");
      },
    });
    const previous = await runtime.authenticate(connection);
    if (!previous) throw new Error("missing authority");

    expect(() =>
      runtime.adoptCandidate({
        expected: previous,
        config: sessionConfig,
        candidate: candidateSnapshot(candidate),
      }),
    ).toThrow("incompatible candidate contract");
    expect(runtime.currentAuthority()).toBe(previous);
    expect(server.disconnectCount).toBe(0);
    expect(candidate.disconnectCount).toBe(0);
  });

  it("keeps the old authority when a candidate disconnects while it is bound", async () => {
    const server = new FakeActiveClient();
    const candidate = new FakeActiveClient();
    candidate.status = "connected";
    candidate.statusSubscribeImplementation = () => {
      candidate.statusSubscribeImplementation = null;
      candidate.setStatus("disconnected");
    };
    const { runtime } = testRuntime(() => server);
    const previous = await runtime.authenticate(connection);
    if (!previous) throw new Error("missing authority");

    expect(() =>
      runtime.adoptCandidate({
        expected: previous,
        config: sessionConfig,
        candidate: candidateSnapshot(candidate),
      }),
    ).toThrow("prepared candidate transport disconnected");
    candidate.setStatus("connected");

    expect(runtime.currentAuthority()).toBe(previous);
    expect(runtime.getSnapshot()).toMatchObject({
      phase: "authenticated",
      status: "connected",
      session: null,
    });
    expect(server.disconnectCount).toBe(0);
    expect(candidate.disconnectCount).toBe(0);
  });

  it("ignores callbacks retained by a superseded transport", async () => {
    const first = new FakeActiveClient();
    const second = new FakeActiveClient();
    const clients = [first, second];
    const { runtime } = testRuntime(() => {
      const client = clients.shift();
      if (!client) throw new Error("unexpected client request");
      return client;
    });
    await runtime.authenticate(connection);
    const staleStatus = first.statusHistory[0];
    await runtime.authenticate(connection);

    staleStatus?.("error");
    first.emitError("stale failure");
    first.emit(scopedNotification("stale"));

    expect(runtime.getSnapshot()).toMatchObject({
      phase: "authenticated",
      error: null,
      status: "connected",
    });
  });

  it("reconnects a committed Session with its durable cursor", async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeActiveClient();
      const candidate = new FakeActiveClient();
      candidate.status = "connected";
      const reconnect = new FakeActiveClient();
      const clients = [server, reconnect];
      const { runtime, events } = testRuntime(() => {
        const client = clients.shift();
        if (!client) throw new Error("unexpected client request");
        return client;
      });
      const previous = await runtime.authenticate(connection);
      if (!previous) throw new Error("missing authority");
      runtime.adoptCandidate({
        expected: previous,
        config: sessionConfig,
        candidate: candidateSnapshot(candidate),
      });
      events.length = 0;

      candidate.setStatus("disconnected");
      expect(runtime.getSnapshot()).toMatchObject({
        phase: "reconnect_wait",
        authenticated: true,
        session: { sessionId: "session-one" },
        recovery: { phase: "reconnecting", reconnectAttempt: 1 },
      });
      await vi.runAllTimersAsync();

      expect(reconnect.openParams).toEqual([
        {
          session_id: "session-one",
          profile_id: "coding",
          cwd: "/srv/project",
          after: { stream: "session-one", seq: 12 },
        },
      ]);
      expect(reconnect.calls).toEqual(["connect", "open", "hydrate"]);
      expect(runtime.getSnapshot()).toMatchObject({
        phase: "ready",
        status: "connected",
        authenticated: true,
        recovery: { phase: "healthy" },
      });
      expect(events.map((event) => event.type)).toEqual([
        "session-hydrate",
        "session-ready",
      ]);
      expect(
        events.find((event) => event.type === "session-hydrate"),
      ).toMatchObject({ reason: "reconnect" });

      events.length = 0;
      reconnect.emit({
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.REPLAY_LOSSY,
        params: { session_id: "session-one", dropped_count: 1 },
      });
      await vi.waitFor(() => {
        expect(reconnect.hydrateParams).toHaveLength(2);
      });
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "session-hydrate",
            reason: "recovery",
          }),
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when reconnect opens a different Session id", async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeActiveClient();
      const candidate = new FakeActiveClient();
      candidate.status = "connected";
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
      const previous = await runtime.authenticate(connection);
      if (!previous) throw new Error("missing authority");
      runtime.adoptCandidate({
        expected: previous,
        config: sessionConfig,
        candidate: candidateSnapshot(candidate),
      });

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

  it("fails closed when reconnect crosses the committed Profile scope", async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeActiveClient();
      const candidate = new FakeActiveClient();
      candidate.status = "connected";
      const reconnect = new FakeActiveClient();
      reconnect.openImplementation = async () => ({
        opened: { ...opened, active_profile_id: "review" },
      });
      const clients = [server, reconnect];
      const { runtime } = testRuntime(() => {
        const client = clients.shift();
        if (!client) throw new Error("unexpected client request");
        return client;
      });
      const previous = await runtime.authenticate(connection);
      if (!previous) throw new Error("missing authority");
      runtime.adoptCandidate({
        expected: previous,
        config: sessionConfig,
        candidate: candidateSnapshot(candidate),
      });

      candidate.setStatus("disconnected");
      await vi.advanceTimersByTimeAsync(500);

      expect(reconnect.calls).toEqual(["connect", "open", "disconnect"]);
      expect(runtime.currentAuthority()?.profileId).toBe("coding");
      expect(runtime.getSnapshot()).toMatchObject({
        phase: "reconnect_wait",
        authenticated: true,
        error: expect.stringContaining(
          "session/open returned Profile review, expected coding",
        ),
        session: { profileId: "coding", cwd: "/srv/project" },
      });
      runtime.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnects an authenticated server without opening a Session", async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeActiveClient();
      const reconnect = new FakeActiveClient();
      const clients = [server, reconnect];
      const { runtime, events } = testRuntime(() => {
        const client = clients.shift();
        if (!client) throw new Error("unexpected client request");
        return client;
      });
      await runtime.authenticate(connection);
      events.length = 0;

      server.setStatus("disconnected");
      expect(runtime.getSnapshot()).toMatchObject({
        phase: "reconnect_wait",
        authenticated: true,
        session: null,
      });
      await vi.runAllTimersAsync();

      expect(reconnect.calls).toEqual(["connect", "capabilities"]);
      expect(reconnect.openParams).toEqual([]);
      expect(reconnect.hydrateParams).toEqual([]);
      expect(runtime.getSnapshot()).toMatchObject({
        phase: "authenticated",
        authenticated: true,
        session: null,
      });
      expect(events).toMatchObject([
        { type: "authenticated", reason: "reconnect" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rehydrates after lossy replay before delivering further notifications", async () => {
    const server = new FakeActiveClient();
    const candidate = new FakeActiveClient();
    candidate.status = "connected";
    const recoveryHydrate = deferred<SessionHydrateResult>();
    candidate.hydrateImplementation = () => recoveryHydrate.promise;
    const { runtime, events } = testRuntime(() => server);
    const previous = await runtime.authenticate(connection);
    if (!previous) throw new Error("missing authority");
    runtime.adoptCandidate({
      expected: previous,
      config: sessionConfig,
      candidate: candidateSnapshot(candidate),
    });
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

  it("fails closed instead of hydrating forever on a poison durable event", async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeActiveClient();
      const candidate = new FakeActiveClient();
      candidate.status = "connected";
      const firstHydrate = deferred<SessionHydrateResult>();
      const hydrateResults = [firstHydrate];
      candidate.hydrateImplementation = () =>
        hydrateResults.shift()?.promise ?? new Promise(() => undefined);
      const { runtime, events } = testRuntime(() => server);
      const previous = await runtime.authenticate(connection);
      if (!previous) throw new Error("missing authority");
      runtime.adoptCandidate({
        expected: previous,
        config: sessionConfig,
        candidate: candidateSnapshot(candidate),
      });
      events.length = 0;

      candidate.emit({
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.PROJECTION_ENVELOPE,
        params: {},
      });
      expect(candidate.hydrateParams).toHaveLength(1);

      firstHydrate.resolve(hydrated);
      await flushMicrotasks();

      expect(candidate.hydrateParams).toHaveLength(1);
      expect(candidate.disconnectCount).toBe(1);
      expect(runtime.getSnapshot()).toMatchObject({
        phase: "reconnect_wait",
        error: expect.stringContaining("could not reconcile"),
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

  it("moves the undrained remainder into a nested recovery buffer", async () => {
    const server = new FakeActiveClient();
    const candidate = new FakeActiveClient();
    candidate.status = "connected";
    const firstHydrate = deferred<SessionHydrateResult>();
    const secondHydrate = deferred<SessionHydrateResult>();
    const hydrateResults = [firstHydrate, secondHydrate];
    candidate.hydrateImplementation = () =>
      hydrateResults.shift()?.promise ?? new Promise(() => undefined);
    const { runtime, events } = testRuntime(() => server);
    const previous = await runtime.authenticate(connection);
    if (!previous) throw new Error("missing authority");
    runtime.adoptCandidate({
      expected: previous,
      config: sessionConfig,
      candidate: candidateSnapshot(candidate),
    });
    events.length = 0;

    candidate.emit({
      jsonrpc: "2.0",
      method: CORE_UI_METHODS.REPLAY_LOSSY,
      params: { session_id: "session-one", dropped_count: 1 },
    });
    candidate.emit(envelope(1, 13));
    candidate.emit(envelope(3, 15));
    candidate.emit(envelope(4, 16));

    firstHydrate.resolve(hydrated);
    await flushMicrotasks();
    expect(candidate.hydrateParams).toHaveLength(2);

    secondHydrate.resolve(hydrated);
    await flushMicrotasks();

    expect(runtime.getSnapshot().phase).toBe("ready");
    expect(
      events
        .filter((event) => event.type === "notification")
        .map((event) =>
          "params" in event.notification
            ? (event.notification.params as { seq?: number }).seq
            : undefined,
        ),
    ).toEqual([1, 3, 4]);
  });

  it("ignores a hydrate rejection after transport loss invalidates recovery", async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeActiveClient();
      const candidate = new FakeActiveClient();
      candidate.status = "connected";
      const recoveryHydrate = deferred<SessionHydrateResult>();
      candidate.hydrateImplementation = () => recoveryHydrate.promise;
      const { runtime, events } = testRuntime(() => server);
      const previous = await runtime.authenticate(connection);
      if (!previous) throw new Error("missing authority");
      runtime.adoptCandidate({
        expected: previous,
        config: sessionConfig,
        candidate: candidateSnapshot(candidate),
      });
      events.length = 0;

      candidate.emit({
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.REPLAY_LOSSY,
        params: { session_id: "session-one", dropped_count: 1 },
      });
      candidate.setStatus("disconnected");
      recoveryHydrate.reject(new Error("late hydrate failure"));
      await flushMicrotasks();

      expect(runtime.getSnapshot()).toMatchObject({
        phase: "reconnect_wait",
        error: null,
        recovery: { phase: "reconnecting" },
      });
      expect(events).toEqual([
        expect.objectContaining({ type: "raw-notification" }),
      ]);
      runtime.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on the 4097th recovery event", async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeActiveClient();
      const candidate = new FakeActiveClient();
      candidate.status = "connected";
      const recoveryHydrate = deferred<SessionHydrateResult>();
      candidate.hydrateImplementation = () => recoveryHydrate.promise;
      const { runtime, events } = testRuntime(() => server);
      const previous = await runtime.authenticate(connection);
      if (!previous) throw new Error("missing authority");
      runtime.adoptCandidate({
        expected: previous,
        config: sessionConfig,
        candidate: candidateSnapshot(candidate),
      });
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
        recovery: { phase: "reconnecting" },
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

  it("filters cross-session and duplicate canonical notifications", async () => {
    const server = new FakeActiveClient();
    const candidate = new FakeActiveClient();
    candidate.status = "connected";
    const { runtime, events } = testRuntime(() => server);
    const previous = await runtime.authenticate(connection);
    if (!previous) throw new Error("missing authority");
    runtime.adoptCandidate({
      expected: previous,
      config: sessionConfig,
      candidate: candidateSnapshot(candidate),
    });
    events.length = 0;

    candidate.emit(scopedNotification("wrong", "session-other"));
    candidate.emit(envelope(1, 13));
    candidate.emit(envelope(1, 13));

    expect(
      events.filter((event) => event.type === "raw-notification"),
    ).toHaveLength(3);
    expect(
      events.filter((event) => event.type === "notification"),
    ).toHaveLength(1);
  });

  it("cancels a pending retry on explicit disconnect", async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeActiveClient();
      const reconnect = new FakeActiveClient();
      const clients = [server, reconnect];
      const { runtime } = testRuntime(() => {
        const client = clients.shift();
        if (!client) throw new Error("unexpected client request");
        return client;
      });
      await runtime.authenticate(connection);
      server.setStatus("disconnected");

      runtime.disconnect();
      await vi.runAllTimersAsync();

      expect(reconnect.calls).toEqual([]);
      expect(runtime.getSnapshot()).toMatchObject({
        phase: "disconnected",
        authenticated: false,
        session: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

function testRuntime(
  createClient: (config: SessionConnectionInput) => FakeActiveClient,
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
  });
  const events: ActiveSessionRuntimeEvent<FakeActiveClient>[] = [];
  runtime.subscribeEvents((event) => events.push(event));
  return { runtime, events };
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

function envelope(seq: number, cursorSeq: number): RpcNotification {
  return {
    jsonrpc: "2.0",
    method: CORE_UI_METHODS.PROJECTION_ENVELOPE,
    params: {
      session_id: "session-one",
      thread_id: "thread-one",
      seq,
      cursor: { stream: "session-one", seq: cursorSeq },
      turn_id: "turn-one",
      payload: { type: "assistant_delta", data: { text: "hello" } },
    },
  };
}

function capabilities(): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: [],
    supported_notifications: [],
    supported_features: [],
  };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
} {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<Value>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return {
    promise,
    resolve(value) {
      if (!resolve) throw new Error("Deferred promise is not initialized");
      resolve(value);
    },
    reject(reason) {
      if (!reject) throw new Error("Deferred promise is not initialized");
      reject(reason);
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}
