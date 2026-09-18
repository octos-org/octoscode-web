/**
 * WEB-UX-DESIGN-4000 §5.2/§6 composer-handover RED (brief 4010 clauses a+b).
 *
 * Design cases pinned here (acceptance 4/8/16/20b/20c):
 *  - THIS tab holds the seat and the user sends: release `next:"internal"`
 *    FIRST, wait for its result, THEN send the turn exactly once (§5.2 case 2).
 *  - Release failure: draft kept, nothing sent, "Retry" (§6 row 8).
 *  - Foreign holder on send: "Another app is using this session" + Resume chat
 *    affordance = acquire (CAS observed revision) -> release(next:"internal")
 *    -> confirm -> send once (§5.2 case 3).
 *  - Lost release reply: reconcile via driver/get — internal => send once, no
 *    second release; still ours => Retry one release then send (20b/20c).
 *  - Lost acquire reply: NO further frames with the unproven binding; wait for
 *    the disclosed lease expiry before any fresh acquire (20).
 *
 * Same discipline as the sibling seat suites: apps/web has no jsdom, so pure
 * decisions are asserted directly and the hook wiring is pinned by source text.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DriverAcquireView } from "@octos-org/octoscode-client/external-driver";
import type { OctosUiClient } from "@octos-org/octoscode-client";
import type { TimelineEntry } from "../timeline/model.ts";
import { createQueueBackedTurnController } from "./use-turn-controller.ts";
import { PromptTurnQueue, type PromptTurn } from "./turn-queue.ts";
import {
  FOREIGN_SEAT_HOLDER_MESSAGE,
  RESUME_CHAT_LABEL,
  HANDING_BACK_CONTROL_STATUS,
  RELEASE_FAILED_MESSAGE,
  boundedTurnAdmissionError,
  isExternalMasterHeldRefusal,
  planComposerSeatHandover,
} from "./composer-seat-handover.ts";
import { peerControlRefusalLabel } from "../control/peer-control-commands.ts";
import { peerDispatchRefusalLabel } from "../control/peer-dispatch-commands.ts";

const SOURCE = readFileSync(
  new URL("./use-turn-controller.ts", import.meta.url),
  "utf8",
);
const SESSION_SOURCE = readFileSync(
  new URL("../session/use-octos-session.ts", import.meta.url),
  "utf8",
);
const ZH_SOURCE = readFileSync(
  new URL("../preferences/zh.ts", import.meta.url),
  "utf8",
);

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

describe("§6 copy: bounded admission refusals", () => {
  it("maps an ExternalMasterHeld send refusal to the human message", () => {
    expect(
      isExternalMasterHeldRefusal(
        "turn admission refused for this session: ExternalMasterHeld",
      ),
    ).toBe(true);
    expect(
      boundedTurnAdmissionError(
        "turn admission refused for this session: ExternalMasterHeld",
      ),
    ).toBe(FOREIGN_SEAT_HOLDER_MESSAGE);
  });

  it("passes non-seat failures through verbatim and degrades empties", () => {
    expect(boundedTurnAdmissionError("some other failure")).toBe(
      "some other failure",
    );
    expect(boundedTurnAdmissionError("")).toBe("");
  });

  it("labels the affordances exactly as §5.2/§6 word them", () => {
    expect(RESUME_CHAT_LABEL).toBe("Resume chat");
    expect(HANDING_BACK_CONTROL_STATUS).toBe("Handing back control…");
    expect(RELEASE_FAILED_MESSAGE).toBe(
      "Couldn't hand back control — your message wasn't sent",
    );
    expect(FOREIGN_SEAT_HOLDER_MESSAGE).toBe(
      "Another app is using this session",
    );
  });
});

describe("§5.2: plan the seat handover before one send", () => {
  it("this-tab seat + send: release(next:internal) first, then send once", () => {
    const plan = planComposerSeatHandover({
      seatHeld: true,
      thisTabHoldsSeat: true,
      acquireView: acquireView(),
    });
    expect(plan).toEqual({
      kind: "release-then-send",
      releaseParams: {
        driverId: "web:11111111-1111-4111-8111-111111111111",
        epoch: 3,
        controlToken: "tok-1",
        expectedRevision: 12,
        next: "internal",
      },
    });
  });

  it("foreign holder + send: resume-chat three-step, never a silent send", () => {
    const plan = planComposerSeatHandover({
      seatHeld: false,
      thisTabHoldsSeat: false,
      acquireView: null,
      observedForeignLeaseExpiresAtMs: null,
      observedRevision: "12",
    });
    expect(plan).toEqual({
      kind: "resume-chat",
      acquireDriverId: expect.any(String),
      expectedRevision: 12,
    });
  });

  it("no seat, nobody holds: plain send, no frame", () => {
    const plan = planComposerSeatHandover({
      seatHeld: false,
      thisTabHoldsSeat: false,
      acquireView: null,
    });
    expect(plan.kind).toBe("send");
  });

  it("a LIVE OUR-ID lease with NO proof waits for expiry (lost acquire reply)", () => {
    const plan = planComposerSeatHandover({
      seatHeld: false,
      thisTabHoldsSeat: false,
      acquireView: null,
      observedOwnLeaseExpiresAtMs: 1_700_000_120_000,
    });
    expect(plan.kind).toBe("wait-for-expiry");
    expect(plan).not.toHaveProperty("releaseParams");
    expect(plan).not.toHaveProperty("acquireDriverId");
  });

  it("a live FOREIGN lease still plans resume-chat with the busy annotation", () => {
    const plan = planComposerSeatHandover({
      seatHeld: false,
      thisTabHoldsSeat: false,
      acquireView: null,
      observedRevision: "9",
      observedForeignLeaseExpiresAtMs: 1_700_000_120_000,
    });
    // Acceptance 4: the affordance stays; the acquire inside Resume chat is
    // what refuses busy with the disclosed expiry.
    expect(plan.kind).toBe("resume-chat");
    expect(plan).toMatchObject({
      foreignLeaseExpiresAtMs: 1_700_000_120_000,
    });
  });
});

describe("§5.2 wiring pins (source text)", () => {
  it("the turn controller gates the send on the handover and bounds refusals", () => {
    expect(SOURCE).toContain("releaseSeatBeforeTurn");
    expect(SOURCE).toContain("boundedTurnAdmissionError");
  });

  it("the session seam plans the handover and exposes the release", () => {
    expect(SESSION_SOURCE).toContain("planComposerSeatHandover");
    expect(SESSION_SOURCE).toContain("releaseControlSeatForUserTurn");
  });

  it("the session seam exposes Resume chat to the strip (App mounts it)", () => {
    expect(SESSION_SOURCE).toContain("seatHandover");
    expect(SESSION_SOURCE).toContain("resumeChatSend");
  });

  it("the zh catalog carries every new operator string", () => {
    for (const source of [
      "Another app is using this session",
      "Resume chat",
      "Handing back control…",
      "Couldn't hand back control — your message wasn't sent",
      "Resuming chat…",
      "Turn not sent",
    ])
      expect(ZH_SOURCE).toContain(`"${source}"`);
  });
});

describe("§6 copy: refusal label maps are protocol-free", () => {
  it("maps every typed refusal kind to its §6 recovery message", () => {
    expect(peerControlRefusalLabel("driver_fence_stale")).toBe(
      "Your control of this session expired",
    );
    expect(peerControlRefusalLabel("driver_busy_handover")).toBe(
      "This session is changing hands right now",
    );
    expect(peerControlRefusalLabel("driver_revision_conflict")).toBe(
      "This session changed hands; refresh and try again",
    );
    expect(peerControlRefusalLabel("driver_model_unavailable")).toBe(
      "That model is not configured on this server",
    );
    expect(peerControlRefusalLabel("driver_operation_conflict")).toBe(
      "A different request already used this id — nothing was sent",
    );
    expect(peerControlRefusalLabel("driver_scope_mismatch")).toBe(
      "This session can't be controlled from here",
    );
    expect(peerControlRefusalLabel("interaction_recovery_required")).toBe(
      "This session needs recovery on the server",
    );
  });

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

  it("carries the new refusal copy in the zh catalog", () => {
    for (const source of [
      "Your control of this session expired",
      "This session is changing hands right now",
      "This session changed hands; refresh and try again",
      "That model is not configured on this server",
      "A different request already used this id — nothing was sent",
      "This session can't be controlled from here",
      "This session needs recovery on the server",
      "That action was refused.",
      "Couldn't start that peer.",
    ])
      expect(ZH_SOURCE).toContain(`"${source}"`);
  });
});

describe("§5.2 behavioral: the send gate (turn controller)", () => {
  const wire: string[] = [];
  const client = {
    startTurn: async () => {
      wire.push("turn/start");
    },
  } as unknown as OctosUiClient;

  const harness = (
    seatGate: NonNullable<
      Parameters<
        typeof createQueueBackedTurnController
      >[0]["dependenciesRef"]["current"]["releaseSeatBeforeTurn"]
    >,
  ) => {
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
    return { controller, timeline, restores };
  };

  it("releases the seat BEFORE turn/start, and only once per send", async () => {
    wire.length = 0;
    const calls: string[] = [];
    const { controller } = harness(async () => {
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
    wire.length = 0;
    const { controller, timeline, restores } = harness(async () => ({
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
    wire.length = 0;
    let release!: (value: { sent: true }) => void;
    const gate = new Promise<{ sent: true }>((resolve) => {
      release = resolve;
    });
    const { controller } = harness(() => gate);
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
