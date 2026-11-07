/**
 * WEB-UX-DESIGN-4000 §5.2/§6 composer handover (brief 4010 clauses a+b).
 *
 * When a control seat holds the session, a user's send must first hand the
 * seat back, and only then send, once. The planner decides which frames may
 * go out; the turn controller's send gate enforces the order. Before changing
 * either, keep these lock rules:
 *  - THIS tab holds the seat: release `next:"internal"` with the held fence and
 *    the observed revision FIRST, then send exactly once (§5.2 case 2).
 *  - Release refused: nothing is sent and the whole draft is kept (§6 row 8).
 *  - Another holder: Resume chat = acquire (CAS on the observed revision) ->
 *    release -> send once; never a silent send (§5.2 case 3).
 *  - Lost acquire reply (a live lease under OUR id, no proof): no frame with the
 *    unproven binding; wait for the disclosed lease expiry (acceptance 20).
 *  - A transport change during hand-back holds the unsent prompt until resume.
 * Resume chat and the owned-seat release also run in e2e/chat-handover.spec.ts.
 */
import { describe, expect, it } from "vitest";
import type { DriverAcquireView } from "@octos-org/octoscode-client/external-driver";
import type { OctosUiClient } from "@octos-org/octoscode-client";
import type { TimelineEntry } from "../timeline/model.ts";
import { createQueueBackedTurnController } from "./use-turn-controller.ts";
import { PromptTurnQueue, type PromptTurn } from "./turn-queue.ts";
import { planComposerSeatHandover } from "./composer-seat-handover.ts";
import { peerControlRefusalLabel } from "../control/peer-control-commands.ts";
import { peerDispatchRefusalLabel } from "../control/peer-dispatch-commands.ts";

const acquireView = (): DriverAcquireView =>
  ({
    capability: {
      driverId: "web:11111111-1111-4111-8111-111111111111",
      epoch: 3,
      reveal: () => "tok-1",
    },
    binding: {
      driverId: "web:11111111-1111-4111-8111-111111111111",
      epoch: 3,
      revision: 12,
      leaseExpiresAtMs: 1_700_000_120_000,
    },
    pendingWork: null,
  }) as unknown as DriverAcquireView;

describe("§5.2: plan the seat handover before one send", () => {
  it.each([
    [
      "this tab holds the seat: release(next:internal) first, then send once",
      { seatHeld: true, thisTabHoldsSeat: true, acquireView: acquireView() },
      {
        kind: "release-then-send",
        releaseParams: {
          driverId: "web:11111111-1111-4111-8111-111111111111",
          epoch: 3,
          controlToken: "tok-1",
          expectedRevision: 12,
          next: "internal",
        },
      },
      true,
    ],
    [
      "another holder: the Resume chat three-step, never a silent send",
      {
        seatHeld: false,
        thisTabHoldsSeat: false,
        acquireView: null,
        observedForeignLeaseExpiresAtMs: null,
        observedRevision: "12",
      },
      {
        kind: "resume-chat",
        acquireDriverId: expect.any(String),
        expectedRevision: 12,
      },
      true,
    ],
    [
      "a live foreign lease: Resume chat stays, annotated busy",
      {
        seatHeld: false,
        thisTabHoldsSeat: false,
        acquireView: null,
        observedRevision: "9",
        observedForeignLeaseExpiresAtMs: 1_700_000_120_000,
      },
      { kind: "resume-chat", foreignLeaseExpiresAtMs: 1_700_000_120_000 },
      false,
    ],
    [
      "nobody holds a seat: a plain send, no frame",
      { seatHeld: false, thisTabHoldsSeat: false, acquireView: null },
      { kind: "send" },
      false,
    ],
    [
      "a live lease under our id with no proof (lost acquire reply): wait for expiry",
      {
        seatHeld: false,
        thisTabHoldsSeat: false,
        acquireView: null,
        observedOwnLeaseExpiresAtMs: 1_700_000_120_000,
      },
      { kind: "wait-for-expiry" },
      false,
    ],
  ] as const)("%s", (_name, input, plan, exact) => {
    const planned = planComposerSeatHandover(input);
    // A plan that sends frames is pinned whole: no extra field rides along.
    if (exact) expect(planned).toEqual(plan);
    else expect(planned).toMatchObject(plan);
    if (plan.kind === "wait-for-expiry" || plan.kind === "send") {
      expect(planned).not.toHaveProperty("releaseParams");
      expect(planned).not.toHaveProperty("acquireDriverId");
    }
  });
});

describe("§6 copy: refusal labels stay protocol-free", () => {
  it("degrades unknown kinds to bounded copy without protocol words", () => {
    expect(peerControlRefusalLabel("driver_operations_cursor_reset")).toBe(
      "That action was refused.",
    );
    expect(peerDispatchRefusalLabel("driver_operations_cursor_reset")).toBe(
      "Couldn't start that peer.",
    );
    expect(peerDispatchRefusalLabel("driver_fence_stale")).toBe(
      "Your control of this session expired",
    );
  });
});

describe("§5.2 behavioral: the send gate (turn controller)", () => {
  const harness = (
    seatGate: NonNullable<
      Parameters<
        typeof createQueueBackedTurnController
      >[0]["dependenciesRef"]["current"]["releaseSeatBeforeTurn"]
    >,
  ) => {
    const wire: string[] = [];
    const client = {
      startTurn: async () => {
        wire.push("turn/start");
      },
    } as unknown as OctosUiClient;
    const timeline: TimelineEntry[] = [];
    const restores: Array<[PromptTurn, string]> = [];
    const controller = createQueueBackedTurnController({
      queueRef: { current: new PromptTurnQueue() },
      dependenciesRef: {
        current: {
          client: () => client,
          sessionId: () => "session-a",
          canEnqueue: () => true,
          canStart: () => true,
          canInterrupt: () => true,
          setTimeline: (action) => {
            const next =
              typeof action === "function" ? action([...timeline]) : action;
            timeline.splice(0, timeline.length, ...next);
          },
          setConnectionError: () => undefined,
          releaseSeatBeforeTurn: seatGate,
          onTurnNotSentRestore: (prompt, sessionId) => {
            restores.push([prompt, sessionId]);
          },
        },
      },
    });
    return { controller, timeline, restores, wire };
  };

  it("releases the seat BEFORE turn/start, and only once per send", async () => {
    const calls: string[] = [];
    const { controller, wire } = harness(async () => {
      calls.push("release");
      return { sent: true };
    });
    controller.enqueuePrompt("hello");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["release"]);
    expect(wire).toEqual(["turn/start"]);
  });

  it("a refused release sends NO turn/start and parks the draft", async () => {
    const { controller, timeline, restores, wire } = harness(async () => ({
      sent: false as const,
      message: "turn admission refused for this session: ExternalMasterHeld",
    }));
    const turn = {
      turnId: "refused-turn",
      text: "keep me",
      reasoningEffort: "high",
      media: [{ path: "uploaded/image", mime: "image/png", size_bytes: 4 }],
    };
    controller.enqueueTurn(turn);
    await Promise.resolve();
    await Promise.resolve();
    expect(wire).toEqual([]);
    expect(restores).toEqual([[turn, "session-a"]]);
    expect(
      timeline.some((entry) =>
        JSON.stringify(entry).includes("Another app is using this session"),
      ),
    ).toBe(true);
  });

  it("holds an unsent prompt when transport changes during handback", async () => {
    let release!: (value: { sent: true }) => void;
    const gate = new Promise<{ sent: true }>((resolve) => {
      release = resolve;
    });
    const { controller, wire } = harness(() => gate);
    controller.enqueuePrompt("send after recovery");
    controller.suspendTransport();
    release({ sent: true });
    await Promise.resolve();
    expect(wire).toEqual([]);
    expect(controller.snapshot().active?.text).toBe("send after recovery");

    controller.resumePendingTurn();
    await Promise.resolve();
    expect(wire).toEqual(["turn/start"]);
  });
});
