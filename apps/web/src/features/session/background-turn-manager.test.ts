import { describe, expect, it } from "vitest";
import {
  CORE_UI_METHODS,
  type ConnectionStatus,
  type RpcNotification,
} from "@octos-org/octoscode-client";
import {
  BackgroundTurnManager,
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
