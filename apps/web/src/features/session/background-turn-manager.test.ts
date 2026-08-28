import { describe, expect, it, vi } from "vitest";
import {
  CORE_UI_METHODS,
  type ConnectionStatus,
  type RpcNotification,
} from "@octos-org/octoscode-client";
import {
  BackgroundTurnLimitError,
  BackgroundTurnManager,
  MAX_BACKGROUND_TURN_TRANSPORTS,
  type BackgroundTurnIdentity,
  type BackgroundTurnSnapshot,
} from "./background-turn-manager.ts";

const DEFAULT_WORKSPACE = "/srv/work/project";
const DEFAULT_PROFILE = "coding";

class FakeBackgroundClient {
  status: ConnectionStatus = "connected";
  disconnectCount = 0;

  readonly #statusListeners = new Set<(status: ConnectionStatus) => void>();
  readonly #notificationListeners = new Set<
    (notification: RpcNotification) => void
  >();

  disconnect(): void {
    this.disconnectCount += 1;
    this.setStatus("disconnected");
  }

  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.#statusListeners.add(listener);
    listener(this.status);
    return () => this.#statusListeners.delete(listener);
  }

  subscribeNotifications(
    listener: (notification: RpcNotification) => void,
  ): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  emit(notification: RpcNotification): void {
    for (const listener of this.#notificationListeners) listener(notification);
  }

  setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.#statusListeners) listener(status);
  }

  get listenerCount(): number {
    return this.#statusListeners.size + this.#notificationListeners.size;
  }
}

describe("BackgroundTurnManager", () => {
  it("rolls back a candidate failure without touching the foreground client", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const client = new FakeBackgroundClient();
    const handoff = manager.prepare({
      client,
      ...identity("session-a", "turn-a"),
    });

    client.emit(completed("session-a", "turn-a"));
    handoff.rollback();

    expect(client.disconnectCount).toBe(0);
    expect(client.listenerCount).toBe(0);
    expect(manager.getSnapshot()).toEqual([]);
  });

  it("buffers a terminal notification through prepare and commits its owner socket", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const client = new FakeBackgroundClient();
    const handoff = manager.prepare({
      client,
      ...identity("session-a", "turn-a"),
    });

    client.emit(completed("session-a", "turn-a"));
    expect(client.disconnectCount).toBe(0);
    expect(manager.getSnapshot()).toEqual([]);

    expect(handoff.commit()).toBe("parked");
    expect(manager.getSnapshot()).toEqual([
      snapshot("session-a", "turn-a", "completed"),
    ]);
    expect(client.disconnectCount).toBe(0);
    expect(client.listenerCount).toBe(2);
  });

  it("parks a locally completed owner before any later notification", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const client = new FakeBackgroundClient();
    const handoff = manager.prepare({
      client,
      ...identity("session-a", "turn-a"),
      initialState: "completed",
    });

    expect(handoff.commit()).toBe("parked");
    expect(manager.getSnapshot()).toEqual([
      snapshot("session-a", "turn-a", "completed"),
    ]);
    expect(client.disconnectCount).toBe(0);
  });

  it("retains completed and failed sockets until explicit cleanup", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const completedClient = park(manager, "session-a", "turn-a");
    const failedClient = park(manager, "session-b", "turn-b");

    completedClient.emit(completed("session-a", "turn-a"));
    failedClient.emit(failed("session-b", "turn-b"));

    expect(manager.getSnapshot()).toEqual([
      snapshot("session-a", "turn-a", "completed"),
      snapshot("session-b", "turn-b", "failed"),
    ]);
    expect(completedClient.disconnectCount).toBe(0);
    expect(failedClient.disconnectCount).toBe(0);

    manager.dispose();
    expect(completedClient.disconnectCount).toBe(1);
    expect(failedClient.disconnectCount).toBe(1);
    expect(manager.getSnapshot()).toEqual([]);
  });

  it("requires both the exact Session scope and exact turn terminal", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const client = park(manager, "session-a", "turn-a");

    client.emit(completed("session-b", "turn-a"));
    client.emit(completed("session-a", "turn-b"));
    expect(manager.getSnapshot()[0]?.state).toBe("running");

    client.emit(projectionTerminal("session-a", "turn-a", "cancelled"));
    expect(manager.getSnapshot()[0]?.state).toBe("failed");
    expect(client.disconnectCount).toBe(0);
  });

  it("marks exact approval and question waits without regressing a terminal turn", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const client = park(manager, "session-a", "turn-a");

    client.emit(
      waiting(CORE_UI_METHODS.APPROVAL_REQUESTED, "session-b", "turn-a"),
    );
    client.emit(
      waiting(CORE_UI_METHODS.USER_QUESTION_REQUESTED, "session-a", "turn-b"),
    );
    expect(manager.getSnapshot()[0]?.state).toBe("running");

    client.emit(
      waiting(CORE_UI_METHODS.APPROVAL_REQUESTED, "session-a", "turn-a"),
    );
    expect(manager.getSnapshot()[0]?.state).toBe("waiting");
    expect(manager.setState(identity("session-a", "turn-a"), "running")).toBe(
      true,
    );
    expect(manager.getSnapshot()[0]?.state).toBe("running");

    client.emit(completed("session-a", "turn-a"));
    expect(manager.setState(identity("session-a", "turn-a"), "running")).toBe(
      false,
    );
    client.emit(
      waiting(CORE_UI_METHODS.USER_QUESTION_REQUESTED, "session-a", "turn-a"),
    );
    expect(manager.getSnapshot()[0]?.state).toBe("completed");
  });

  it("isolates multiple Sessions when one transport ends", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const first = park(manager, "session-a", "turn-a");
    const second = park(manager, "session-b", "turn-b");

    first.emit(completed("session-a", "turn-a"));
    expect(manager.getSnapshot()).toHaveLength(2);
    first.setStatus("disconnected");

    expect(manager.getSnapshot()).toEqual([
      snapshot("session-b", "turn-b", "running"),
    ]);
    expect(second.disconnectCount).toBe(0);

    second.setStatus("error");
    expect(manager.getSnapshot()).toEqual([]);
    expect(second.listenerCount).toBe(0);
    expect(second.disconnectCount).toBe(1);
  });

  it("does not duplicate an already parked exact Session and turn", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const owner = park(manager, "session-a", "turn-a");
    const duplicate = new FakeBackgroundClient();

    const handoff = manager.prepare({
      client: duplicate,
      ...identity("session-a", "turn-a"),
    });

    expect(handoff.shouldPreserveTransport).toBe(false);
    expect(handoff.commit()).toBe("already-owned");
    expect(duplicate.listenerCount).toBe(0);
    expect(duplicate.disconnectCount).toBe(0);
    expect(owner.disconnectCount).toBe(0);
    expect(manager.getSnapshot()).toEqual([
      snapshot("session-a", "turn-a", "running"),
    ]);
  });

  it("retains terminal-tail and newer owners for two turns in the same Session", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const older = park(manager, "session-a", "turn-a");
    older.emit(completed("session-a", "turn-a"));
    const newer = new FakeBackgroundClient();

    const handoff = manager.prepare({
      client: newer,
      ...identity("session-a", "turn-b"),
    });

    expect(older.disconnectCount).toBe(0);
    expect(older.listenerCount).toBe(2);
    expect(handoff.shouldPreserveTransport).toBe(true);
    expect(handoff.commit()).toBe("parked");
    expect(manager.getSnapshot()).toEqual([
      snapshot("session-a", "turn-a", "completed"),
      snapshot("session-a", "turn-b", "running"),
    ]);
    expect(newer.disconnectCount).toBe(0);
  });

  it("does not let an old terminal mutate a newer same-Session turn", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const older = park(manager, "session-a", "turn-a");
    const newer = new FakeBackgroundClient();
    manager
      .prepare({
        client: newer,
        ...identity("session-a", "turn-b"),
      })
      .commit();

    older.emit(failed("session-a", "turn-a"));
    newer.emit(failed("session-a", "turn-a"));

    expect(manager.getSnapshot()).toEqual([
      snapshot("session-a", "turn-a", "failed"),
      snapshot("session-a", "turn-b", "running"),
    ]);
    newer.emit(completed("session-a", "turn-b"));
    expect(manager.getSnapshot()).toEqual([
      snapshot("session-a", "turn-a", "failed"),
      snapshot("session-a", "turn-b", "completed"),
    ]);
  });

  it("isolates the same wire ids across workspace and profile scopes", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const first = park(manager, "shared-session", "shared-turn");
    const otherWorkspace = park(manager, "shared-session", "shared-turn", {
      workspaceRoot: "/srv/work/other",
    });
    const otherProfile = park(manager, "shared-session", "shared-turn", {
      profileId: "review",
    });

    first.emit(completed("shared-session", "shared-turn"));
    expect(
      manager.setState(
        identity("shared-session", "shared-turn", {
          workspaceRoot: "/srv/work/other",
        }),
        "waiting",
      ),
    ).toBe(true);
    expect(
      manager.setState(
        identity("shared-session", "shared-turn", {
          workspaceRoot: "/srv/work/missing",
        }),
        "waiting",
      ),
    ).toBe(false);
    expect(
      manager.setState(
        identity("shared-session", "shared-turn", { profileId: "review" }),
        "waiting",
      ),
    ).toBe(true);

    expect(manager.getSnapshot()).toEqual([
      snapshot("shared-session", "shared-turn", "completed"),
      snapshot("shared-session", "shared-turn", "waiting", {
        workspaceRoot: "/srv/work/other",
      }),
      snapshot("shared-session", "shared-turn", "waiting", {
        profileId: "review",
      }),
    ]);
    expect(otherWorkspace.disconnectCount).toBe(0);
    expect(otherProfile.disconnectCount).toBe(0);
  });

  it("reclaims a retained owner without closing it and preserves prepare-window terminal state", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const owner = park(manager, "session-a", "turn-a");
    const reclaim = manager.prepareReclaim(identity("session-a", "ignored"));
    if (!reclaim) throw new Error("Expected a reclaimable owner");

    owner.emit(completed("session-a", "turn-a"));

    expect(reclaim.client).toBe(owner);
    expect(reclaim.snapshot()).toEqual(
      snapshot("session-a", "turn-a", "completed"),
    );
    expect(reclaim.commit()).toBe("reclaimed");
    expect(manager.getSnapshot()).toEqual([]);
    expect(owner.disconnectCount).toBe(0);
    expect(owner.listenerCount).toBe(0);
  });

  it("rolls a reclaim back without closing the owner", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const owner = park(manager, "session-a", "turn-a");
    const reclaim = manager.prepareReclaim(identity("session-a", "ignored"));
    if (!reclaim) throw new Error("Expected a reclaimable owner");

    reclaim.rollback();

    expect(manager.getSnapshot()).toEqual([
      snapshot("session-a", "turn-a", "running"),
    ]);
    expect(owner.disconnectCount).toBe(0);
    expect(owner.listenerCount).toBe(2);
    expect(
      manager.prepareReclaim(identity("session-a", "ignored"))?.client,
    ).toBe(owner);
  });

  it("reclaims the newest owner when legacy same-Session sockets coexist", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const older = park(manager, "session-a", "turn-a");
    const newer = park(manager, "session-a", "turn-b");

    const reclaim = manager.prepareReclaim(identity("session-a", "ignored"));
    if (!reclaim) throw new Error("Expected a reclaimable owner");

    expect(reclaim.client).toBe(newer);
    expect(reclaim.turnId).toBe("turn-b");
    expect(reclaim.commit()).toBe("reclaimed");
    expect(manager.getSnapshot()).toEqual([
      snapshot("session-a", "turn-a", "running"),
    ]);
    expect(older.disconnectCount).toBe(0);
    expect(newer.disconnectCount).toBe(0);
  });

  it("uses a reclaim reservation to exchange foreground owners at the capacity limit", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const owners = Array.from(
      { length: MAX_BACKGROUND_TURN_TRANSPORTS },
      (_, index) => park(manager, `session-${index}`, `turn-${index}`),
    );
    const reclaim = manager.prepareReclaim(identity("session-0", "ignored"));
    if (!reclaim) throw new Error("Expected a reclaimable owner");
    const foreground = new FakeBackgroundClient();

    const handoff = manager.prepare({
      client: foreground,
      ...identity("session-foreground", "turn-foreground"),
    });
    expect(handoff.commit()).toBe("parked");
    expect(reclaim.commit()).toBe("reclaimed");

    expect(manager.getSnapshot()).toHaveLength(MAX_BACKGROUND_TURN_TRANSPORTS);
    expect(owners[0]?.disconnectCount).toBe(0);
    expect(foreground.disconnectCount).toBe(0);
  });

  it("cannot commit MAX + 1 when a capacity exchange changes target scope", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    Array.from({ length: MAX_BACKGROUND_TURN_TRANSPORTS }, (_, index) =>
      park(manager, `session-${index}`, `turn-${index}`),
    );
    const oldTarget = manager.prepareReclaim(identity("session-0", "ignored"));
    if (!oldTarget) throw new Error("Expected a reclaimable owner");
    const sourceClient = new FakeBackgroundClient();
    const source = manager.prepare({
      client: sourceClient,
      ...identity("source-session", "source-turn"),
    });

    // This is the transaction order used by the hook when launch/profile
    // resolution changes the target scope.
    source.rollback();
    oldTarget.rollback();

    expect(() =>
      manager.prepare({
        client: sourceClient,
        ...identity("source-session", "source-turn"),
      }),
    ).toThrow(BackgroundTurnLimitError);
    expect(manager.getSnapshot()).toHaveLength(MAX_BACKGROUND_TURN_TRANSPORTS);
  });

  it("bounds retained owner transports and disconnects every one on clear", () => {
    expect(MAX_BACKGROUND_TURN_TRANSPORTS).toBe(8);
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const owners = Array.from(
      { length: MAX_BACKGROUND_TURN_TRANSPORTS },
      (_, index) => park(manager, `session-${index}`, `turn-${index}`),
    );
    const overflow = new FakeBackgroundClient();

    expect(() =>
      manager.prepare({
        client: overflow,
        ...identity("session-overflow", "turn-overflow"),
      }),
    ).toThrow(BackgroundTurnLimitError);
    expect(() =>
      manager.prepare({
        client: overflow,
        ...identity("session-overflow", "turn-overflow"),
      }),
    ).toThrow(
      "Reopen an existing Session, or explicitly Disconnect and reconnect",
    );
    expect(overflow.disconnectCount).toBe(0);

    manager.clear();
    expect(manager.getSnapshot()).toEqual([]);
    expect(owners.every((owner) => owner.disconnectCount === 1)).toBe(true);
  });

  it("clear rolls back prepared listeners and remains reusable after reconnect", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const subscriber = vi.fn();
    manager.subscribe(subscriber);
    const foreground = new FakeBackgroundClient();
    const prepared = manager.prepare({
      client: foreground,
      ...identity("session-a", "turn-a"),
    });

    manager.clear();
    expect(foreground.disconnectCount).toBe(0);
    expect(foreground.listenerCount).toBe(0);
    expect(prepared.commit()).toBe("transport-ended");

    const reconnected = park(manager, "session-b", "turn-b");
    expect(manager.getSnapshot()).toEqual([
      snapshot("session-b", "turn-b", "running"),
    ]);
    expect(subscriber).toHaveBeenCalled();
    expect(reconnected.disconnectCount).toBe(0);
  });

  it("dispose detaches a prepared authority without disconnecting it and is final", () => {
    const manager = new BackgroundTurnManager<FakeBackgroundClient>();
    const foreground = new FakeBackgroundClient();
    const prepared = manager.prepare({
      client: foreground,
      ...identity("session-a", "turn-a"),
    });

    manager.dispose();

    expect(foreground.listenerCount).toBe(0);
    expect(foreground.disconnectCount).toBe(0);
    expect(prepared.commit()).toBe("transport-ended");
    expect(() =>
      manager.prepare({
        client: new FakeBackgroundClient(),
        ...identity("session-b", "turn-b"),
      }),
    ).toThrow("The background turn manager has been disposed");
  });
});

function park(
  manager: BackgroundTurnManager<FakeBackgroundClient>,
  sessionId: string,
  turnId: string,
  overrides: Partial<
    Pick<BackgroundTurnIdentity, "workspaceRoot" | "profileId">
  > = {},
): FakeBackgroundClient {
  const client = new FakeBackgroundClient();
  const handoff = manager.prepare({
    client,
    ...identity(sessionId, turnId, overrides),
  });
  expect(handoff.shouldPreserveTransport).toBe(true);
  expect(handoff.commit()).toBe("parked");
  return client;
}

function identity(
  sessionId: string,
  turnId: string,
  overrides: Partial<
    Pick<BackgroundTurnIdentity, "workspaceRoot" | "profileId">
  > = {},
): BackgroundTurnIdentity {
  return {
    workspaceRoot: overrides.workspaceRoot ?? DEFAULT_WORKSPACE,
    profileId: overrides.profileId ?? DEFAULT_PROFILE,
    sessionId,
    turnId,
  };
}

function snapshot(
  sessionId: string,
  turnId: string,
  state: BackgroundTurnSnapshot["state"],
  overrides: Partial<
    Pick<BackgroundTurnIdentity, "workspaceRoot" | "profileId">
  > = {},
): BackgroundTurnSnapshot {
  return { ...identity(sessionId, turnId, overrides), state };
}

function completed(sessionId: string, turnId: string): RpcNotification {
  return {
    jsonrpc: "2.0",
    method: CORE_UI_METHODS.TURN_COMPLETED,
    params: { session_id: sessionId, turn_id: turnId },
  };
}

function failed(sessionId: string, turnId: string): RpcNotification {
  return {
    jsonrpc: "2.0",
    method: CORE_UI_METHODS.TURN_ERROR,
    params: { session_id: sessionId, turn_id: turnId },
  };
}

function projectionTerminal(
  sessionId: string,
  turnId: string,
  outcome: string,
): RpcNotification {
  return {
    jsonrpc: "2.0",
    method: CORE_UI_METHODS.PROJECTION_ENVELOPE,
    params: {
      session_id: sessionId,
      thread_id: "thread-1",
      seq: 1,
      turn_id: turnId,
      payload: { type: "turn_terminal", data: { outcome } },
    },
  };
}

function waiting(
  method:
    | typeof CORE_UI_METHODS.APPROVAL_REQUESTED
    | typeof CORE_UI_METHODS.USER_QUESTION_REQUESTED,
  sessionId: string,
  turnId: string,
): RpcNotification {
  return {
    jsonrpc: "2.0",
    method,
    params: { session_id: sessionId, turn_id: turnId },
  };
}
