import { describe, expect, it, vi } from "vitest";
import {
  OctosUiRequestTimeoutError,
  type OctosUiClient,
  type TurnStateGetResult,
} from "@octos-org/octoscode-client";
import type { TimelineEntry } from "../timeline/model.ts";
import {
  createQueueBackedTurnController,
  type TurnDispatchStateEvent,
  type QueueBackedTurnController,
  type TurnControllerDependencies,
} from "./use-turn-controller.ts";
import { PromptTurnQueue } from "./turn-queue.ts";
import { deferred } from "../session/session-record-test-fixture.ts";

// The REAL queue-backed controller over a recording client: what is sent, in
// what order, and who owns the live turn. Each case is a race that shipped or
// a protocol boundary (docs/protocol.md "Turn ownership during Session
// navigation", ADR 0019, runtime review 2026-09-15 P1): one turn/start per
// prompt, FIFO never crossing a turn Core may still be running, a lost or
// late answer read as unknown rather than rejected, ownership never carried
// to a replacement transport. Before changing the controller, expect these to
// fail if a prompt could be sent twice, skipped, or sent over another turn.
describe("queue-backed turn controller async authority", () => {
  it("treats a start timeout as an unknown outcome instead of a rejection", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("slow server");
    const turnId = harness.activeTurnId();
    start.reject(new OctosUiRequestTimeoutError("turn/start"));

    await vi.waitFor(() => {
      expect(
        harness.timeline.some(
          (entry) =>
            entry.kind === "system" && entry.title === "Turn start timed out",
        ),
      ).toBe(true);
    });
    // The queue must not advance into a turn that may still be running.
    expect(harness.controller.snapshot().active?.turnId).toBe(turnId);
    expect(harness.dispatchEvents.map((event) => event.state)).toEqual([
      "dispatching",
    ]);

    // Server-side activity proves acceptance and promotes the dispatch.
    expect(harness.controller.confirmTurnAccepted(turnId)).toBe(true);
    expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    expect(harness.dispatchEvents.map((event) => event.state)).toEqual([
      "dispatching",
      "accepted",
    ]);

    // The terminal event then settles the queue as usual.
    harness.controller.settleTurn(turnId, "completed");
    expect(harness.controller.snapshot().active).toBeNull();
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

  it("restores an interrupted prompt on its OWN session's terminal, never another session's", async () => {
    let session = "session-a";
    const restored: string[] = [];
    const client = fakeClient();
    const harness = renderController(client, {
      sessionId: () => session,
      onInterruptPromptRestore: (prompt) => restored.push(prompt),
    });
    harness.controller.enqueuePrompt("  draft a  ");
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    const turnA = harness.activeTurnId();
    await harness.controller.interrupt();

    // The user switched to session B before A's terminal round-tripped.
    session = "session-b";
    harness.controller.settleTurn("turn-b");
    expect(restored).toEqual([]);

    // A's own terminal still finds its stashed prompt (nothing was lost).
    session = "session-a";
    harness.controller.settleTurn(turnA);
    expect(restored).toEqual(["draft a"]);
  });
});

/**
 * One `octos serve` can be shared by the octoscode terminal client and this
 * browser client on the SAME session. The server keeps ONE turn slot per
 * session, so whoever is second is refused. These cover the two ways this app
 * learns that another client owns the session: the live `turn/started` it
 * receives through the server's per-session fan-out, and the refusal of its
 * own `turn/start`.
 */
describe("another attached client owns the session's turn", () => {
  const OTHER_TURN = "3f1a9c52-4d1b-4c2e-8f6a-0b7d21e9c4aa";

  function turnStarted(turnId: string, sessionId = "session-a") {
    return {
      jsonrpc: "2.0" as const,
      method: "turn/started",
      params: { session_id: sessionId, turn_id: turnId },
    };
  }

  it("adopts a live turn this app holds nothing for, as another client's only when this tab's receipts say so", () => {
    // Adoption is display only: it never dispatches, never crosses sessions,
    // and never stomps a turn this app may still own. Only one turn can be
    // active server-side, so a foreign start over ours means our view is
    // stale; hydrate reconciles that with the full ownership rules.
    for (const [sentHere, origin] of [
      [false, "adopted"],
      [true, "local"],
      [null, "unknown"],
    ] as const) {
      const idle = renderController(fakeClient(), {
        wasTurnSentHere: () => sentHere,
      });
      idle.controller.observeSteerDropped(turnStarted(OTHER_TURN, "session-b"));
      expect(idle.controller.snapshot().active).toBeNull();
      idle.controller.observeSteerDropped(turnStarted(OTHER_TURN));
      expect(idle.controller.snapshot().active).toMatchObject({
        turnId: OTHER_TURN,
        origin,
      });
      expect(idle.controller.snapshot().pending).toHaveLength(0);
    }

    const busy = renderController(fakeClient());
    busy.controller.enqueuePrompt("mine");
    const mine = busy.activeTurnId();
    busy.controller.observeSteerDropped(turnStarted(mine));
    expect(busy.controller.snapshot().active?.origin).toBeUndefined();
    busy.controller.observeSteerDropped(turnStarted(OTHER_TURN));
    expect(busy.controller.snapshot().active?.turnId).toBe(mine);
  });
});

function renderController(
  initialClient: FakeTurnClient,
  overrides: Partial<TurnControllerDependencies> = {},
): {
  controller: QueueBackedTurnController;
  timeline: TimelineEntry[];
  connectionErrors: string[];
  dispatchEvents: TurnDispatchStateEvent[];
  recoveredTerminals: string[];
  setCanGetTurnState(value: boolean): void;
  setSessionId(value: string): void;
  setClient(client: FakeTurnClient): void;
  setCanStart(value: boolean): void;
  activeTurnId(): string;
} {
  let client: FakeTurnClient = initialClient;
  let canStart = true;
  let canGetTurnState = true;
  let sessionId = "session-a";
  const recoveredTerminals: string[] = [];
  const timeline: TimelineEntry[] = [];
  const connectionErrors: string[] = [];
  const dispatchEvents: TurnDispatchStateEvent[] = [];
  const setTimeline: TurnControllerDependencies["setTimeline"] = (action) => {
    const next = typeof action === "function" ? action([...timeline]) : action;
    timeline.splice(0, timeline.length, ...next);
  };

  const controller = createQueueBackedTurnController({
    queueRef: { current: new PromptTurnQueue() },
    dependenciesRef: {
      current: {
        client: () => client as unknown as OctosUiClient,
        sessionId: () => sessionId,
        canEnqueue: () => true,
        canStart: () => canStart,
        canInterrupt: () => true,
        canGetTurnState: () => canGetTurnState,
        onRecoveredTerminal: (turnId) => recoveredTerminals.push(turnId),
        setTimeline,
        setConnectionError: (message) => connectionErrors.push(message),
        onDispatchState: (event) => dispatchEvents.push(event),
        ...overrides,
      },
    },
  });
  const renderedController = controller;
  return {
    controller: renderedController,
    timeline,
    connectionErrors,
    dispatchEvents,
    recoveredTerminals,
    setSessionId(value) {
      sessionId = value;
    },
    setCanGetTurnState(value) {
      canGetTurnState = value;
    },
    setClient(next) {
      client = next;
    },
    setCanStart(value) {
      canStart = value;
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
  getTurnState: ReturnType<typeof vi.fn>;
}

function fakeClient(options?: {
  start?: () => Promise<void>;
  interrupt?: () => Promise<void>;
  state?: (params: {
    session_id: string;
    turn_id: string;
  }) => Promise<TurnStateGetResult>;
}): FakeTurnClient {
  return {
    startTurn: vi.fn(options?.start ?? (async () => undefined)),
    interruptTurn: vi.fn(options?.interrupt ?? (async () => undefined)),
    getTurnState: vi.fn(
      options?.state ??
        (async (params) => ({
          ...params,
          state: "unknown",
          committed_seqs: [],
        })),
    ),
  };
}
