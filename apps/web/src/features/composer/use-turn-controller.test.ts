import { createElement, type Dispatch, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OctosUiClient } from "@octos-org/octoscode-client";
import type { TimelineEntry } from "../timeline/model.ts";
import {
  useTurnController,
  type TurnDispatchStateEvent,
  type TurnController,
} from "./use-turn-controller.ts";

describe("useTurnController async authority", () => {
  it("does not expose an optimistic turn for background handoff before Core accepts it", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("ship it");
    expect(harness.controller.snapshot().active).not.toBeNull();
    expect(harness.controller.backgroundHandoffTurn()).toBeNull();
    expect(harness.controller.activeTurnOwnership()).toBe("dispatching");

    start.resolve(undefined);
    await vi.waitFor(() => {
      expect(harness.controller.backgroundHandoffTurn()?.turnId).toBe(
        harness.activeTurnId(),
      );
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
  });

  it("publishes dispatching and accepted only around the exact start ACK", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("ship it");
    expect(harness.dispatchEvents.map((event) => event.state)).toEqual([
      "dispatching",
    ]);

    start.resolve(undefined);
    await vi.waitFor(() => {
      expect(harness.dispatchEvents.map((event) => event.state)).toEqual([
        "dispatching",
        "accepted",
      ]);
    });
  });

  it("rejects or locally cancels a dispatch without publishing acceptance", async () => {
    const rejectedStart = deferred<void>();
    const rejected = renderController(
      fakeClient({ start: () => rejectedStart.promise }),
    );
    rejected.controller.enqueuePrompt("reject me");
    rejectedStart.reject(new Error("not accepted"));
    await vi.waitFor(() => {
      expect(rejected.dispatchEvents.map((event) => event.state)).toEqual([
        "dispatching",
        "rejected",
      ]);
    });

    const cancelledStart = deferred<void>();
    const cancelled = renderController(
      fakeClient({ start: () => cancelledStart.promise }),
    );
    cancelled.controller.enqueuePrompt("cancel me");
    const turnId = cancelled.activeTurnId();
    cancelled.controller.settleTurn(turnId, "failed");
    cancelledStart.resolve(undefined);
    await cancelledStart.promise;

    expect(cancelled.dispatchEvents.map((event) => event.state)).toEqual([
      "dispatching",
      "cancelled",
    ]);
  });

  it("uses recovery hydrate as the authoritative ACK without waiting forever for the RPC", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("recover this start");
    const turnId = harness.activeTurnId();
    harness.controller.reconcileFromHydrate(
      {
        session_id: "session-a",
        cursor: { stream: "session-a", seq: 3 },
        turns: [{ turn_id: turnId, state: "active" }],
      },
      true,
    );

    expect(harness.dispatchEvents.map((event) => event.state)).toEqual([
      "dispatching",
      "accepted",
    ]);
    expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    expect(harness.controller.backgroundHandoffTurn()).toEqual({
      turnId,
      state: "running",
    });

    start.resolve(undefined);
    await start.promise;
    expect(harness.dispatchEvents.map((event) => event.state)).toEqual([
      "dispatching",
      "accepted",
    ]);
  });

  it("admits and settles an in-flight start when recovery already proves it terminal", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("already finished");
    const turnId = harness.activeTurnId();
    harness.controller.reconcileFromHydrate(
      {
        session_id: "session-a",
        cursor: { stream: "session-a", seq: 4 },
        turns: [{ turn_id: turnId, state: "completed" }],
      },
      true,
    );

    expect(harness.dispatchEvents.map((event) => event.state)).toEqual([
      "dispatching",
      "accepted",
    ]);
    expect(harness.controller.snapshot().active).toBeNull();
    expect(harness.controller.backgroundHandoffTurn()).toEqual({
      turnId,
      state: "completed",
    });
    start.resolve(undefined);
    await start.promise;
  });

  it("does not send interrupt while turn/start is still dispatching", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("start slowly");
    await harness.controller.interrupt();

    expect(client.interruptTurn).not.toHaveBeenCalled();
    expect(
      harness.timeline.some(
        (entry) =>
          entry.kind === "system" && entry.title === "Turn is still starting",
      ),
    ).toBe(true);

    start.resolve(undefined);
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    await harness.controller.interrupt();
    expect(client.interruptTurn).toHaveBeenCalledTimes(1);
  });

  it("treats a hydrated active turn as observed, never as owner of this socket", () => {
    const client = fakeClient();
    const harness = renderController(client);

    harness.controller.reconcileFromHydrate({
      session_id: "session-a",
      cursor: { stream: "session-a", seq: 2 },
      turns: [{ turn_id: "server-turn", state: "active" }],
    });

    expect(harness.controller.backgroundHandoffTurn()).toBeNull();
    expect(harness.controller.activeTurnOwnership()).toBe("observed");
  });

  it("retains the local transport owner after terminal until it is handed off", async () => {
    const client = fakeClient();
    const harness = renderController(client);

    harness.controller.enqueuePrompt("ship it");
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    const turnId = harness.activeTurnId();
    harness.controller.settleTurn(turnId, "completed");

    expect(harness.controller.snapshot().active).toBeNull();
    expect(harness.controller.backgroundHandoffTurn()).toEqual({
      turnId,
      state: "completed",
    });
    expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
  });

  it("does not carry local socket ownership across reconnect hydrate", async () => {
    const client = fakeClient();
    const harness = renderController(client);

    harness.controller.enqueuePrompt("ship it");
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    const turnId = harness.activeTurnId();
    harness.controller.reconcileFromHydrate(
      {
        session_id: "session-a",
        cursor: { stream: "session-a", seq: 2 },
        turns: [{ turn_id: turnId, state: "active" }],
      },
      false,
    );

    expect(harness.controller.backgroundHandoffTurn()).toBeNull();
    expect(harness.controller.activeTurnOwnership()).toBe("observed");
  });

  it("stops treating a replacement reconnect client as the old turn owner before hydrate", async () => {
    const older = fakeClient();
    const newer = fakeClient();
    const harness = renderController(older);

    harness.controller.enqueuePrompt("ship it");
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });

    harness.setClient(newer);

    expect(harness.controller.backgroundHandoffTurn()).toBeNull();
    expect(harness.controller.activeTurnOwnership()).toBe("observed");
  });

  it("restores exact transport ownership when a parked owner is reclaimed", () => {
    const owner = fakeClient();
    const harness = renderController(owner);

    expect(
      harness.controller.restoreTransportOwnership({
        turnId: "terminal-tail",
        state: "completed",
      }),
    ).toBe(true);

    expect(harness.controller.backgroundHandoffTurn()).toEqual({
      turnId: "terminal-tail",
      state: "completed",
    });
    expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
  });

  it("replaces a reclaimed terminal lease when the same client starts another turn", async () => {
    const owner = fakeClient();
    const harness = renderController(owner);

    harness.controller.restoreTransportOwnership({
      turnId: "terminal-tail",
      state: "completed",
    });
    harness.controller.enqueuePrompt("continue on the reclaimed transport");

    await vi.waitFor(() => {
      expect(harness.controller.backgroundHandoffTurn()).toEqual({
        turnId: harness.activeTurnId(),
        state: "running",
      });
    });
    expect(harness.controller.backgroundHandoffTurn()?.turnId).not.toBe(
      "terminal-tail",
    );
    expect(owner.startTurn).toHaveBeenCalledTimes(1);
  });

  it("tracks waiting interactions on the accepted owner without reviving terminal work", async () => {
    const client = fakeClient();
    const harness = renderController(client);

    harness.controller.enqueuePrompt("ask me something");
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    const turnId = harness.activeTurnId();
    expect(
      harness.controller.setAcceptedOwnerInteraction(true, "another-turn"),
    ).toBe(false);
    expect(harness.controller.backgroundHandoffTurn()?.state).toBe("running");
    expect(harness.controller.setAcceptedOwnerInteraction(true, turnId)).toBe(
      true,
    );
    expect(harness.controller.backgroundHandoffTurn()?.state).toBe("waiting");
    expect(harness.controller.setAcceptedOwnerInteraction(false, turnId)).toBe(
      true,
    );
    expect(harness.controller.backgroundHandoffTurn()?.state).toBe("running");

    harness.controller.settleTurn(turnId, "completed");
    expect(harness.controller.setAcceptedOwnerInteraction(false)).toBe(false);
    expect(harness.controller.backgroundHandoffTurn()?.state).toBe("completed");
  });

  it("keeps a server-confirmed interrupt de-duplicated after hydrate", async () => {
    const interrupt = deferred<void>();
    const client = fakeClient({ interrupt: () => interrupt.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("ship it");
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    const first = harness.controller.interrupt();
    expect(client.interruptTurn).toHaveBeenCalledTimes(1);

    harness.controller.reconcileFromHydrate({
      session_id: "session-a",
      cursor: { stream: "session-a", seq: 2 },
      turns: [{ turn_id: harness.activeTurnId(), state: "interrupting" }],
    });
    await harness.controller.interrupt();

    expect(client.interruptTurn).toHaveBeenCalledTimes(1);
    interrupt.resolve(undefined);
    await first;
  });

  it("preserves a pending start rejection when hydrate has no turn evidence", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("ship it");
    harness.controller.reconcileFromHydrate({
      session_id: "session-a",
      cursor: { stream: "session-a", seq: 2 },
      turns: [],
    });
    start.reject(new Error("start was rejected"));

    await vi.waitFor(() => {
      expect(harness.controller.snapshot().active).toBeNull();
    });
    expect(harness.timeline.some((entry) => entry.kind === "system")).toBe(
      true,
    );
  });

  it("does not let an old interrupt failure pollute a replacement client", async () => {
    const staleInterrupt = deferred<void>();
    const older = fakeClient({ interrupt: () => staleInterrupt.promise });
    const newer = fakeClient();
    const harness = renderController(older);

    harness.controller.enqueuePrompt("ship it");
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    const pending = harness.controller.interrupt();
    harness.setClient(newer);
    staleInterrupt.reject(new Error("old socket closed"));
    await pending;

    expect(harness.connectionErrors).toEqual([]);
    await harness.controller.interrupt();
    expect(newer.interruptTurn).toHaveBeenCalledTimes(1);
  });
});

function renderController(initialClient: FakeTurnClient): {
  controller: TurnController;
  timeline: TimelineEntry[];
  connectionErrors: string[];
  dispatchEvents: TurnDispatchStateEvent[];
  setClient(client: FakeTurnClient): void;
  activeTurnId(): string;
} {
  let controller: TurnController | null = null;
  let client: FakeTurnClient = initialClient;
  const timeline: TimelineEntry[] = [];
  const connectionErrors: string[] = [];
  const dispatchEvents: TurnDispatchStateEvent[] = [];
  const setTimeline: Dispatch<SetStateAction<TimelineEntry[]>> = (action) => {
    const next = typeof action === "function" ? action([...timeline]) : action;
    timeline.splice(0, timeline.length, ...next);
  };

  function Probe() {
    controller = useTurnController({
      client: () => client as unknown as OctosUiClient,
      sessionId: () => "session-a",
      canEnqueue: () => true,
      canStart: () => true,
      canInterrupt: () => true,
      setTimeline,
      setConnectionError: (message) => connectionErrors.push(message),
      onDispatchState: (event) => dispatchEvents.push(event),
    });
    return null;
  }

  renderToStaticMarkup(createElement(Probe));
  if (!controller) throw new Error("Turn controller probe did not render");
  const renderedController: TurnController = controller;
  return {
    controller: renderedController,
    timeline,
    connectionErrors,
    dispatchEvents,
    setClient(next) {
      client = next;
    },
    activeTurnId() {
      const turnId = renderedController.snapshot().active?.turnId;
      if (!turnId) throw new Error("Expected an active turn");
      return turnId;
    },
  };
}

interface FakeTurnClient {
  startTurn: ReturnType<typeof vi.fn>;
  interruptTurn: ReturnType<typeof vi.fn>;
}

function fakeClient(options?: {
  start?: () => Promise<void>;
  interrupt?: () => Promise<void>;
}): FakeTurnClient {
  return {
    startTurn: vi.fn(options?.start ?? (async () => undefined)),
    interruptTurn: vi.fn(options?.interrupt ?? (async () => undefined)),
  };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
} {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
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
