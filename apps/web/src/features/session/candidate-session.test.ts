import { describe, expect, it, vi } from "vitest";
import type {
  RpcNotification,
  SessionHydrateParams,
  SessionHydrateResult,
  SessionOpened,
  SessionOpenParams,
  SessionOpenResult,
} from "@octos-org/octoscode-client";
import {
  CandidateSessionCancelledError,
  prepareCandidateSession,
  type CandidateSessionClient,
} from "./candidate-session.ts";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";

const config: SessionConnectionInput = {
  endpoint: "https://octos.example.test",
  token: "secret",
  sessionId: "session-next",
  profileId: "coding",
  cwd: "/srv/project",
};

const opened: SessionOpened = {
  session_id: "session-next",
  active_profile_id: "coding",
  workspace_root: "/srv/project",
};

const hydrated: SessionHydrateResult = {
  session_id: "session-next",
  cursor: { stream: "session-next", seq: 12 },
};

class FakeCandidateClient implements CandidateSessionClient {
  readonly calls: string[] = [];
  readonly openParams: SessionOpenParams[] = [];
  readonly hydrateParams: SessionHydrateParams[] = [];
  disconnectCount = 0;
  private readonly listeners = new Set<
    (notification: RpcNotification) => void
  >();

  connectImplementation: () => Promise<void> = async () => undefined;
  openImplementation: (
    params: SessionOpenParams,
  ) => Promise<SessionOpenResult> = async () => ({ opened });
  hydrateImplementation: (
    params: SessionHydrateParams,
  ) => Promise<SessionHydrateResult> = async () => hydrated;

  connect(): Promise<void> {
    this.calls.push("connect");
    return this.connectImplementation();
  }

  disconnect(): void {
    this.disconnectCount += 1;
  }

  subscribeNotifications(
    listener: (notification: RpcNotification) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

  emit(notification: RpcNotification): void {
    for (const listener of this.listeners) listener(notification);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

describe("prepareCandidateSession", () => {
  it("stages open and hydrate before releasing the isolated client", async () => {
    const client = new FakeCandidateClient();
    const controller = new AbortController();
    const validateOpened = vi.fn();
    client.connectImplementation = async () => {
      client.emit(notification(1));
    };

    const prepared = await prepareCandidateSession({
      config,
      signal: controller.signal,
      createClient: (received) => {
        expect(received).toBe(config);
        return client;
      },
      validateOpened,
    });

    expect(client.calls).toEqual(["connect", "open", "hydrate"]);
    expect(client.openParams).toEqual([
      {
        session_id: "session-next",
        profile_id: "coding",
        cwd: "/srv/project",
      },
    ]);
    expect(client.hydrateParams).toEqual([
      {
        session_id: "session-next",
        include: ["messages", "threads", "turns", "pending_approvals"],
      },
    ]);
    expect(validateOpened).toHaveBeenCalledWith(opened);
    expect(client.disconnectCount).toBe(0);

    client.emit(notification(2));
    const snapshot = prepared.release();
    expect(snapshot).toMatchObject({ client, opened, hydrated });
    expect(snapshot.notifications.map((event) => event.method)).toEqual([
      "test/1",
      "test/2",
    ]);
    expect(client.listenerCount).toBe(0);

    controller.abort();
    expect(client.disconnectCount).toBe(0);
  });

  it("disconnects and rejects when opened Session validation fails", async () => {
    const client = new FakeCandidateClient();

    await expect(
      prepareCandidateSession({
        config,
        signal: new AbortController().signal,
        createClient: () => client,
        validateOpened: () => {
          throw new Error("incompatible candidate");
        },
      }),
    ).rejects.toThrow("incompatible candidate");

    expect(client.calls).toEqual(["connect", "open"]);
    expect(client.disconnectCount).toBe(1);
    expect(client.listenerCount).toBe(0);
  });

  it("fails closed when hydrate returns another Session", async () => {
    const client = new FakeCandidateClient();
    client.hydrateImplementation = async () => ({
      ...hydrated,
      session_id: "session-other",
    });

    await expect(
      prepareCandidateSession({
        config,
        signal: new AbortController().signal,
        createClient: () => client,
        validateOpened: () => undefined,
      }),
    ).rejects.toThrow("session/hydrate returned another session");

    expect(client.disconnectCount).toBe(1);
    expect(client.listenerCount).toBe(0);
  });

  it("fails closed on the 4097th notification before commit", async () => {
    const client = new FakeCandidateClient();
    client.hydrateImplementation = async () => {
      for (let index = 1; index <= 4_097; index += 1) {
        client.emit(notification(index));
      }
      return hydrated;
    };

    await expect(
      prepareCandidateSession({
        config,
        signal: new AbortController().signal,
        createClient: () => client,
        validateOpened: () => undefined,
      }),
    ).rejects.toThrow(
      "The candidate session emitted too many events while opening.",
    );

    expect(client.disconnectCount).toBe(1);
    expect(client.listenerCount).toBe(0);
  });

  it("cancels a pending stage immediately and cleans the client", async () => {
    const client = new FakeCandidateClient();
    const controller = new AbortController();
    const hydrate = deferred<SessionHydrateResult>();
    const hydrateStarted = deferred<void>();
    client.hydrateImplementation = () => {
      hydrateStarted.resolve();
      return hydrate.promise;
    };

    const pending = prepareCandidateSession({
      config,
      signal: controller.signal,
      createClient: () => client,
      validateOpened: () => undefined,
    });
    await hydrateStarted.promise;

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(
      CandidateSessionCancelledError,
    );
    expect(client.disconnectCount).toBe(1);
    expect(client.listenerCount).toBe(0);

    hydrate.resolve(hydrated);
  });

  it("keeps a newer candidate owned when an older stage settles after cancel", async () => {
    const olderClient = new FakeCandidateClient();
    const newerClient = new FakeCandidateClient();
    const olderController = new AbortController();
    const newerController = new AbortController();
    const olderHydrate = deferred<SessionHydrateResult>();
    const olderHydrateStarted = deferred<void>();
    olderClient.hydrateImplementation = () => {
      olderHydrateStarted.resolve();
      return olderHydrate.promise;
    };

    const olderStage = prepareCandidateSession({
      config,
      signal: olderController.signal,
      createClient: () => olderClient,
      validateOpened: () => undefined,
    });
    await olderHydrateStarted.promise;

    olderController.abort();
    const newerStage = await prepareCandidateSession({
      config: { ...config, sessionId: "session-newer" },
      signal: newerController.signal,
      createClient: () => newerClient,
      validateOpened: () => undefined,
    });

    await expect(olderStage).rejects.toBeInstanceOf(
      CandidateSessionCancelledError,
    );
    expect(olderClient.disconnectCount).toBe(1);
    expect(newerClient.disconnectCount).toBe(0);

    const newerSnapshot = newerStage.release();
    expect(newerSnapshot.client).toBe(newerClient);
    expect(newerClient.disconnectCount).toBe(0);

    olderHydrate.resolve(hydrated);
  });

  it("disposes a prepared candidate that is not committed", async () => {
    const client = new FakeCandidateClient();
    const prepared = await prepareCandidateSession({
      config,
      signal: new AbortController().signal,
      createClient: () => client,
      validateOpened: () => undefined,
    });

    prepared.dispose();
    prepared.dispose();

    expect(client.disconnectCount).toBe(1);
    expect(client.listenerCount).toBe(0);
    expect(() => prepared.release()).toThrow(
      "Candidate session is not prepared",
    );
  });
});

function notification(sequence: number): RpcNotification {
  return {
    jsonrpc: "2.0",
    method: `test/${sequence}`,
    params: { session_id: "session-next", sequence },
  };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve(value) {
      if (!resolve) throw new Error("Deferred promise is not initialized");
      resolve(value);
    },
  };
}
