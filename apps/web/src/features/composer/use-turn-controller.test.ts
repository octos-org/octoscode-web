import { describe, expect, it, vi } from "vitest";
import {
  OctosUiProtocolError,
  OctosUiRequestTimeoutError,
  type OctosUiClient,
  type TurnStateGetResult,
} from "@octos-org/octoscode-client";
import type { ReviewStartResult } from "@octos-org/octoscode-client/history";
import type { TimelineEntry } from "../timeline/model.ts";
import {
  createQueueBackedTurnController,
  type TurnDispatchStateEvent,
  type QueueBackedTurnController,
  type TurnControllerDependencies,
  type NativeReviewStartRequest,
} from "./use-turn-controller.ts";
import { PromptTurnQueue } from "./turn-queue.ts";

describe("queue-backed turn controller async authority", () => {
  it("returns local admission before consuming caller input and rejects repeated native UUIDs", () => {
    let allowed = false;
    const client = fakeClient();
    const harness = renderController(client, { canEnqueue: () => allowed });
    const turn = { turnId: "native-uuid", text: "  review this  " };
    expect(harness.controller.enqueueTurn(turn)).toBe(false);
    expect(harness.controller.enqueuePrompt("draft")).toBe(false);
    expect(client.startTurn).not.toHaveBeenCalled();
    allowed = true;
    expect(harness.controller.enqueueTurn(turn)).toBe(true);
    expect(harness.controller.enqueueTurn(turn)).toBe(false);
    expect(client.startTurn).toHaveBeenCalledWith({
      session_id: "session-a",
      turn_id: "native-uuid",
      input: [{ kind: "text", text: "review this" }],
    });
  });

  it("sends each queued turn's captured text, reasoning and media after later drafts change", async () => {
    let reasoning = "high";
    const client = fakeClient();
    const harness = renderController(client, {
      reasoningEffort: () => reasoning,
    });
    harness.controller.enqueuePrompt("first");
    const first = harness.activeTurnId();
    const media = [
      { path: "uploaded/second", mime: "image/png", size_bytes: 4 },
    ];
    harness.controller.enqueueTurn({
      turnId: "second",
      text: "second",
      reasoningEffort: "low",
      media,
    });
    reasoning = "medium";
    media[0]!.path = "wrong-draft";
    harness.controller.snapshot().pending[0]!.media![0]!.path =
      "mutated-snapshot";
    harness.controller.enqueuePrompt("third");
    harness.controller.settleTurn(first);
    await Promise.resolve();
    expect(client.startTurn.mock.calls[0]?.[0]).toMatchObject({
      reasoning_effort: "high",
    });
    expect(client.startTurn.mock.calls[1]?.[0]).toEqual({
      session_id: "session-a",
      turn_id: "second",
      input: [{ kind: "text", text: "second" }],
      reasoning_effort: "low",
      media: [{ path: "uploaded/second", mime: "image/png", size_bytes: 4 }],
    });
    harness.controller.settleTurn("second");
    expect(client.startTurn.mock.calls[2]?.[0]).toMatchObject({
      reasoning_effort: "medium",
    });
  });

  it("does not start supplied work that has not been admitted to its queue", async () => {
    const client = fakeClient();
    const harness = renderController(client);
    await harness.controller.startTurn({
      turnId: "not-enqueued",
      text: "not-enqueued",
    });
    expect(client.startTurn).not.toHaveBeenCalled();
  });

  it("cancels a queued prompt without interrupting or dispatching server work", async () => {
    const client = fakeClient();
    const harness = renderController(client);
    harness.controller.enqueuePrompt("active prompt");
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    harness.controller.enqueuePrompt("remove this prompt");
    const activeTurnId = harness.activeTurnId();
    const pending = harness.controller.snapshot().pending[0];
    if (!pending) throw new Error("Expected a queued prompt");

    expect(harness.controller.cancelQueuedPrompt(activeTurnId)).toBe(false);
    expect(harness.controller.cancelQueuedPrompt(pending.turnId)).toBe(true);
    expect(harness.controller.snapshot().pending).toEqual([]);
    expect(harness.activeTurnId()).toBe(activeTurnId);
    harness.controller.settleTurn(activeTurnId);
    expect(client.startTurn).toHaveBeenCalledTimes(1);
    expect(client.interruptTurn).not.toHaveBeenCalled();
  });

  it("resumes a promoted queued prompt after recovery blocked its dispatch", async () => {
    const client = fakeClient();
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first prompt");
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    const firstTurnId = harness.activeTurnId();
    harness.controller.enqueuePrompt("queued prompt");
    harness.setCanStart(false);
    harness.controller.settleTurn(firstTurnId);
    const queuedTurnId = harness.activeTurnId();
    expect(client.startTurn).toHaveBeenCalledTimes(1);

    const next = harness.controller.reconcileFromHydrate({
      session_id: "session-a",
      cursor: { stream: "session-a", seq: 4 },
      turns: [{ turn_id: firstTurnId, state: "completed" }],
    });

    expect(next).toEqual({ turnId: queuedTurnId, text: "queued prompt" });
    harness.setCanStart(true);
    if (!next) throw new Error("Expected the undispatched queued prompt");
    await harness.controller.startTurn(next);
    expect(client.startTurn).toHaveBeenCalledTimes(2);
    expect(client.startTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({ turn_id: queuedTurnId }),
    );
  });

  it("keeps an undispatched prompt behind a server turn recovered after losing its ACK", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first prompt");
    const firstTurnId = harness.activeTurnId();
    harness.controller.enqueuePrompt("queued prompt");
    harness.controller.enqueuePrompt("last prompt");
    const pending = harness.controller.snapshot().pending;
    harness.setCanStart(false);
    start.reject(new OctosUiProtocolError(-32000, "turn rejected"));
    await vi.waitFor(() => {
      expect(harness.activeTurnId()).toBe(pending[0]?.turnId);
    });

    const next = harness.controller.reconcileFromHydrate({
      session_id: "session-a",
      cursor: { stream: "session-a", seq: 2 },
      turns: [{ turn_id: firstTurnId, state: "active" }],
    });

    expect(next).toBeNull();
    expect(harness.activeTurnId()).toBe(firstTurnId);
    expect(harness.controller.snapshot().pending).toEqual(pending);
    expect(client.startTurn).toHaveBeenCalledTimes(1);
    harness.setCanStart(true);
    harness.controller.settleTurn(firstTurnId);
    expect(client.startTurn).toHaveBeenCalledTimes(2);
    expect(harness.activeTurnId()).toBe(pending[0]?.turnId);
  });

  it("does not expose an optimistic turn for background handoff before Core accepts it", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("ship it");
    expect(harness.controller.snapshot().active).not.toBeNull();
    expect(harness.controller.backgroundHandoffTurn()).toBeNull();
    expect(harness.controller.activeTurnOwnership()).toBe("dispatching");
    expect(harness.dispatchEvents.map((event) => event.state)).toEqual([
      "dispatching",
    ]);

    start.resolve(undefined);
    await vi.waitFor(() => {
      expect(harness.controller.backgroundHandoffTurn()?.turnId).toBe(
        harness.activeTurnId(),
      );
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    expect(harness.dispatchEvents.map((event) => event.state)).toEqual([
      "dispatching",
      "accepted",
    ]);
  });

  it("rejects or locally cancels a dispatch without publishing acceptance", async () => {
    const rejectedStart = deferred<void>();
    const rejected = renderController(
      fakeClient({ start: () => rejectedStart.promise }),
    );
    rejected.controller.enqueuePrompt("reject me");
    rejectedStart.reject(new OctosUiProtocolError(-32000, "not accepted"));
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

  it("ignores a start timeout once server activity already accepted the turn", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("racy server");
    const turnId = harness.activeTurnId();
    expect(harness.controller.confirmTurnAccepted(turnId)).toBe(true);
    start.reject(new OctosUiRequestTimeoutError("turn/start"));
    // Give the rejected promise's handlers a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(
      harness.timeline.some(
        (entry) =>
          entry.kind === "system" && entry.title === "Turn start timed out",
      ),
    ).toBe(false);
    expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
  });

  it("keeps a timed-out start when hydrate and targeted lookup cannot find it", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);
    harness.controller.enqueuePrompt("lost acknowledgement");
    const turnId = harness.activeTurnId();
    start.reject(new OctosUiRequestTimeoutError("turn/start"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.controller.reconcileFromHydrate(emptyHydrate());
    await vi.waitFor(() =>
      expect(harness.controller.turnRecovery?.phase).toBe("unknown"),
    );
    expect(harness.activeTurnId()).toBe(turnId);
    expect(client.getTurnState).toHaveBeenCalledWith({
      session_id: "session-a",
      turn_id: turnId,
    });
    expect(client.startTurn).toHaveBeenCalledTimes(1);
    expect(
      harness.timeline.some((entry) => entry.body.includes("never accepted")),
    ).toBe(false);
  });

  it("does not treat a transport failure as a rejected start or advance the FIFO", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first");
    const turnId = harness.activeTurnId();
    harness.controller.enqueuePrompt("second");
    start.reject(new Error("Octos UI Protocol connection closed"));
    await vi.waitFor(() =>
      expect(
        harness.timeline.some(
          (entry) => entry.title === "Turn start unconfirmed",
        ),
      ).toBe(true),
    );
    expect(harness.activeTurnId()).toBe(turnId);
    expect(client.startTurn).toHaveBeenCalledTimes(1);
    expect(harness.controller.snapshot().pending).toHaveLength(1);
  });

  it.each(["completed", "errored", "interrupted"] as const)(
    "settles missing accepted turn from explicit %s lookup and resumes FIFO once",
    async (state) => {
      const client = fakeClient({
        state: async (params) => ({ ...params, state, committed_seqs: [] }),
      });
      const harness = renderController(client);
      harness.controller.enqueuePrompt("first");
      const turnId = harness.activeTurnId();
      await vi.waitFor(() =>
        expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
      );
      harness.controller.enqueuePrompt("second");
      harness.controller.enqueuePrompt("third");
      const pending = harness.controller.snapshot().pending;
      harness.timeline.push({
        id: "assistant-tail",
        kind: "assistant",
        title: "Octos",
        body: "partial",
        status: "running",
        turnId,
      });
      harness.controller.reconcileFromHydrate(emptyHydrate());
      await vi.waitFor(() => expect(client.startTurn).toHaveBeenCalledTimes(2));
      expect(harness.activeTurnId()).toBe(pending[0]?.turnId);
      expect(harness.controller.snapshot().pending).toEqual(pending.slice(1));
      expect(harness.controller.turnRecovery).toBeNull();
      expect(
        harness.timeline.find((entry) => entry.id === "assistant-tail")?.status,
      ).not.toBe("running");
      expect(
        harness.timeline.find((entry) => entry.id === `terminal:${turnId}`)
          ?.title,
      ).toBe(
        state === "completed"
          ? "Turn complete"
          : state === "interrupted"
            ? "Turn stopped"
            : "Turn failed",
      );
      expect(harness.recoveredTerminals).toEqual([turnId]);
    },
  );

  it.each(["active", "interrupting"] as const)(
    "observes targeted %s state on a replacement transport without claiming ownership",
    async (state) => {
      const original = fakeClient();
      const newer = fakeClient({
        state: async (params) => ({ ...params, state, committed_seqs: [] }),
      });
      const harness = renderController(original);
      harness.controller.enqueuePrompt("first");
      const turnId = harness.activeTurnId();
      await vi.waitFor(() =>
        expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
      );
      harness.setClient(newer);
      harness.controller.reconcileFromHydrate(emptyHydrate());
      await vi.waitFor(() =>
        expect(harness.controller.turnRecovery).toBeNull(),
      );
      expect(harness.activeTurnId()).toBe(turnId);
      expect(harness.controller.activeTurnOwnership()).toBe("observed");
      expect(harness.controller.backgroundHandoffTurn()).toBeNull();
      await harness.controller.interrupt();
      expect(newer.interruptTurn).toHaveBeenCalledTimes(
        state === "interrupting" ? 0 : 1,
      );
    },
  );

  it("holds unknown turns, blocks new admission, and lets an explicit status retry recover", async () => {
    const client = fakeClient();
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first");
    const turnId = harness.activeTurnId();
    await vi.waitFor(() =>
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
    );
    harness.controller.enqueuePrompt("pending");
    harness.controller.reconcileFromHydrate(emptyHydrate());
    await vi.waitFor(() =>
      expect(harness.controller.turnRecovery?.phase).toBe("unknown"),
    );
    harness.controller.enqueuePrompt("must remain in draft");
    await harness.controller.interrupt();
    expect(harness.controller.snapshot().pending).toHaveLength(1);
    expect(client.interruptTurn).not.toHaveBeenCalled();
    client.getTurnState.mockImplementation(async (params) => ({
      ...params,
      state: "completed",
      committed_seqs: [],
    }));
    await harness.controller.retryTurnRecovery();
    expect(harness.activeTurnId()).not.toBe(turnId);
    expect(client.startTurn).toHaveBeenCalledTimes(2);
  });

  it("holds a missing turn when the server does not advertise lifecycle lookup", async () => {
    const client = fakeClient();
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first");
    await vi.waitFor(() =>
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
    );
    harness.setCanGetTurnState(false);
    harness.controller.reconcileFromHydrate(emptyHydrate());
    expect(harness.controller.turnRecovery?.phase).toBe("unavailable");
    expect(client.getTurnState).not.toHaveBeenCalled();
    expect(harness.controller.snapshot().active).not.toBeNull();
  });

  it("reports lookup errors without settling and accepts a later retry", async () => {
    const client = fakeClient({
      state: async () => {
        throw new Error("read failed");
      },
    });
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first");
    await vi.waitFor(() =>
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
    );
    harness.controller.reconcileFromHydrate(emptyHydrate());
    await vi.waitFor(() =>
      expect(harness.controller.turnRecovery).toMatchObject({
        phase: "error",
        message: "read failed",
      }),
    );
    expect(harness.controller.snapshot().active).not.toBeNull();
    client.getTurnState.mockImplementation(async (params) => ({
      ...params,
      state: "active",
      committed_seqs: [],
    }));
    await harness.controller.retryTurnRecovery();
    expect(harness.controller.turnRecovery).toBeNull();
  });

  it.each(["client", "session", "turn", "notification"] as const)(
    "ignores stale lookup completion after %s changes",
    async (change) => {
      const state = deferred<TurnStateGetResult>();
      const start = deferred<void>();
      const client = fakeClient({
        state: () => state.promise,
        ...(change === "notification" ? { start: () => start.promise } : {}),
      });
      const harness = renderController(client);
      harness.controller.enqueuePrompt("first");
      const turnId = harness.activeTurnId();
      if (change !== "notification") {
        await vi.waitFor(() =>
          expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
        );
      }
      harness.controller.reconcileFromHydrate(
        emptyHydrate(),
        change === "notification",
      );
      expect(harness.controller.turnRecovery?.phase).toBe("checking");
      await harness.controller.retryTurnRecovery();
      expect(client.getTurnState).toHaveBeenCalledTimes(1);
      if (change === "client") harness.setClient(fakeClient());
      if (change === "session") harness.setSessionId("session-b");
      if (change === "turn") {
        harness.controller.settleTurn(turnId);
        harness.controller.enqueuePrompt("new turn");
      }
      if (change === "notification")
        expect(harness.controller.confirmTurnAccepted(turnId)).toBe(true);
      const activeBefore = harness.activeTurnId();
      state.resolve({
        session_id: "session-a",
        turn_id: turnId,
        state: "completed",
        committed_seqs: [],
      });
      await state.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(harness.activeTurnId()).toBe(activeBefore);
      expect(harness.recoveredTerminals).toEqual([]);
      start.resolve(undefined);
    },
  );

  it("does not dispatch queued work over a different hydrated foreground turn", async () => {
    const client = fakeClient({
      state: async (params) => ({
        ...params,
        state: "completed",
        committed_seqs: [],
      }),
    });
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first");
    await vi.waitFor(() =>
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
    );
    harness.controller.enqueuePrompt("pending");
    const pending = harness.controller.snapshot().pending;
    harness.controller.reconcileFromHydrate({
      ...emptyHydrate(),
      turns: [{ turn_id: "other-active", state: "active" }],
    });
    await vi.waitFor(() => expect(harness.activeTurnId()).toBe("other-active"));
    expect(client.startTurn).toHaveBeenCalledTimes(1);
    expect(harness.controller.snapshot().pending).toEqual(pending);
    harness.controller.settleTurn("other-active");
    expect(client.startTurn).toHaveBeenCalledTimes(2);
  });

  it("keeps a lifecycle lookup authoritative when observed background activity has no local dispatch lease", async () => {
    const state = deferred<TurnStateGetResult>();
    const client = fakeClient({ state: () => state.promise });
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first");
    const turnId = harness.activeTurnId();
    await vi.waitFor(() =>
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
    );
    harness.controller.enqueuePrompt("next");
    harness.controller.reconcileFromHydrate(emptyHydrate());
    expect(harness.controller.confirmTurnAccepted(turnId)).toBe(false);
    expect(harness.controller.turnRecovery?.phase).toBe("checking");

    state.resolve({
      session_id: "session-a",
      turn_id: turnId,
      state: "completed",
      committed_seqs: [],
    });
    await state.promise;
    await vi.waitFor(() => expect(client.startTurn).toHaveBeenCalledTimes(2));
    expect(harness.controller.turnRecovery).toBeNull();
    expect(harness.recoveredTerminals).toEqual([turnId]);
  });

  it("keeps FIFO behind a different hydrated turn when the old terminal notification beats its lookup", async () => {
    const response = deferred<TurnStateGetResult>();
    const client = fakeClient({ state: () => response.promise });
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first");
    const turnId = harness.activeTurnId();
    await vi.waitFor(() =>
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
    );
    harness.controller.enqueuePrompt("pending");
    const pending = harness.controller.snapshot().pending;
    harness.controller.reconcileFromHydrate({
      ...emptyHydrate(),
      turns: [{ turn_id: "other-active", state: "active" }],
    });

    harness.controller.confirmTurnAccepted(turnId);
    harness.controller.settleTurn(turnId);

    expect(harness.activeTurnId()).toBe("other-active");
    expect(harness.controller.snapshot().pending).toEqual(pending);
    expect(client.startTurn).toHaveBeenCalledTimes(1);
    response.resolve({
      session_id: "session-a",
      turn_id: turnId,
      state: "completed",
      committed_seqs: [],
    });
    await response.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.activeTurnId()).toBe("other-active");
    harness.controller.settleTurn("other-active");
    expect(client.startTurn).toHaveBeenCalledTimes(2);
    expect(harness.activeTurnId()).toBe(pending[0]?.turnId);
  });

  it("does not treat a future unrecognized hydrate state as terminal", async () => {
    const client = fakeClient();
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first");
    const turnId = harness.activeTurnId();
    await vi.waitFor(() =>
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
    );
    harness.controller.reconcileFromHydrate({
      ...emptyHydrate(),
      turns: [{ turn_id: turnId, state: "future_state" }],
    });
    await vi.waitFor(() =>
      expect(harness.controller.turnRecovery?.phase).toBe("unknown"),
    );
    expect(harness.activeTurnId()).toBe(turnId);
  });

  it("preserves the accepted owner through a same-transport lookup and its terminal tail", async () => {
    const client = fakeClient({
      state: async (params) => ({
        ...params,
        state: "active",
        committed_seqs: [],
      }),
    });
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first");
    const turnId = harness.activeTurnId();
    await vi.waitFor(() =>
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
    );
    harness.controller.reconcileFromHydrate(emptyHydrate(), true);
    await vi.waitFor(() => expect(harness.controller.turnRecovery).toBeNull());
    expect(harness.controller.backgroundHandoffTurn()).toEqual({
      turnId,
      state: "running",
    });
    client.getTurnState.mockImplementation(async (params) => ({
      ...params,
      state: "completed",
      committed_seqs: [],
    }));
    harness.controller.reconcileFromHydrate(emptyHydrate(), true);
    await vi.waitFor(() =>
      expect(harness.controller.snapshot().active).toBeNull(),
    );
    expect(harness.controller.backgroundHandoffTurn()).toEqual({
      turnId,
      state: "completed",
    });
  });

  it("keeps pending prompts behind another server turn when hydrate also contains the old terminal", async () => {
    const client = fakeClient();
    const harness = renderController(client);
    harness.controller.enqueuePrompt("first");
    const turnId = harness.activeTurnId();
    await vi.waitFor(() =>
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner"),
    );
    harness.controller.enqueuePrompt("pending");
    const next = harness.controller.reconcileFromHydrate({
      ...emptyHydrate(),
      turns: [
        { turn_id: turnId, state: "completed" },
        { turn_id: "other-active", state: "active" },
      ],
    });
    expect(next).toBeNull();
    expect(harness.activeTurnId()).toBe("other-active");
    expect(harness.controller.snapshot().pending).toHaveLength(1);
    expect(client.startTurn).toHaveBeenCalledTimes(1);
    expect(client.getTurnState).not.toHaveBeenCalled();
  });

  it("keeps a timed-out start when hydrate still lists the turn", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("slow but alive");
    const turnId = harness.activeTurnId();
    start.reject(new OctosUiRequestTimeoutError("turn/start"));
    await vi.waitFor(() => {
      expect(harness.controller.snapshot().active?.turnId).toBe(turnId);
    });

    harness.controller.reconcileFromHydrate(
      {
        session_id: "session-a",
        cursor: { stream: "session-a", seq: 2 },
        turns: [{ turn_id: turnId, state: "active" }],
      },
      true,
    );

    expect(harness.controller.snapshot().active?.turnId).toBe(turnId);
    expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
  });

  it("ignores acceptance evidence for a turn it never dispatched", () => {
    const harness = renderController(fakeClient());

    expect(harness.controller.confirmTurnAccepted("turn-elsewhere")).toBe(
      false,
    );
    expect(harness.dispatchEvents).toEqual([]);
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

  it("re-arms one pending restore per session and drops it on reset", async () => {
    const restored: string[] = [];
    const client = fakeClient();
    const harness = renderController(client, {
      onInterruptPromptRestore: (prompt) => restored.push(prompt),
    });
    harness.controller.enqueuePrompt("first draft");
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    await harness.controller.interrupt();
    harness.controller.settleTurn(harness.activeTurnId());
    expect(restored).toEqual(["first draft"]);

    harness.controller.enqueuePrompt("second draft");
    await vi.waitFor(() => {
      expect(harness.controller.activeTurnOwnership()).toBe("local-owner");
    });
    const second = harness.activeTurnId();
    await harness.controller.interrupt();
    harness.controller.reset();
    harness.controller.settleTurn(second);
    expect(restored).toEqual(["first draft"]);
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

  it("replaces a reclaimed terminal lease when the same client starts another turn", async () => {
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
    start.reject(new OctosUiProtocolError(-32000, "start was rejected"));

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

const reviewId = "00000000-0000-4000-8000-000000000042";
function reviewAck(
  request: Pick<NativeReviewStartRequest, "sessionId" | "turnId">,
): ReviewStartResult {
  return {
    accepted: true,
    session_id: request.sessionId,
    turn_id: request.turnId,
    workflow: "code_review",
    backend: "native",
    agent_count: 3,
  };
}

describe("native review on the existing turn controller", () => {
  it("dispatches an optional review prompt and exact UUID without an ordinary user turn", async () => {
    const client = fakeClient();
    const startReview = vi.fn(async (request: NativeReviewStartRequest) => {
      request.markSent();
      return reviewAck(request);
    });
    const h = renderController(client, { startReview });
    expect(
      h.controller.enqueueTurn({
        kind: "review",
        turnId: reviewId,
        text: "  check races  ",
      }),
    ).toBe(true);
    await Promise.resolve();
    expect(startReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        client,
        sessionId: "session-a",
        turnId: reviewId,
        prompt: "check races",
      }),
    );
    expect(client.startTurn).not.toHaveBeenCalled();
    expect(h.timeline.some((entry) => entry.kind === "user")).toBe(false);
    expect(
      h.timeline.some((entry) => entry.title === "Native code review"),
    ).toBe(true);
    expect(h.controller.backgroundHandoffTurn()).toMatchObject({
      turnId: reviewId,
      state: "running",
    });
    expect(h.dispatchEvents.map((event) => event.state)).toEqual([
      "dispatching",
      "accepted",
    ]);
  });

  it("omits the default review prompt instead of manufacturing model input", async () => {
    const startReview = vi.fn(async (request: NativeReviewStartRequest) => {
      request.markSent();
      return reviewAck(request);
    });
    const h = renderController(fakeClient(), { startReview });
    expect(
      h.controller.enqueueTurn({
        kind: "review",
        turnId: reviewId,
        text: "  ",
      }),
    ).toBe(true);
    await Promise.resolve();
    expect(startReview.mock.calls[0]![0]).not.toHaveProperty("prompt");
    expect(h.controller.snapshot().active).toMatchObject({
      kind: "review",
      text: "",
    });
  });

  it("fails closed without a starter, with active work, or with unsupported review arguments", () => {
    const h = renderController(fakeClient());
    expect(
      h.controller.enqueueTurn({ kind: "review", turnId: reviewId, text: "" }),
    ).toBe(false);
    const startReview = vi.fn(async (request: NativeReviewStartRequest) =>
      reviewAck(request),
    );
    const idle = renderController(fakeClient(), { startReview });
    expect(
      idle.controller.enqueueTurn({
        kind: "review",
        turnId: "not-a-uuid",
        text: "",
      }),
    ).toBe(false);
    expect(
      idle.controller.enqueueTurn({
        kind: "review",
        turnId: reviewId,
        text: "",
        reasoningEffort: "high",
      }),
    ).toBe(false);
    expect(
      idle.controller.enqueueTurn({
        kind: "review",
        turnId: reviewId,
        text: "",
        media: [{ path: "attachment", mime: "image/png", size_bytes: 1 }],
      }),
    ).toBe(false);
    idle.controller.enqueuePrompt("ordinary active turn");
    expect(
      idle.controller.enqueueTurn({
        kind: "review",
        turnId: reviewId,
        text: "",
      }),
    ).toBe(false);
    expect(startReview).not.toHaveBeenCalled();
  });

  it("allows ordinary prompts behind review but starts them only on the exact review terminal", async () => {
    const client = fakeClient();
    const startReview = vi.fn(async (request: NativeReviewStartRequest) => {
      request.markSent();
      return reviewAck(request);
    });
    const h = renderController(client, { startReview });
    h.controller.enqueueTurn({ kind: "review", turnId: reviewId, text: "" });
    h.controller.enqueuePrompt("follow up");
    await Promise.resolve();
    expect(client.startTurn).not.toHaveBeenCalled();
    expect(h.controller.snapshot().pending).toHaveLength(1);
    h.controller.settleTurn("foreign-terminal");
    expect(client.startTurn).not.toHaveBeenCalled();
    h.controller.settleTurn(reviewId);
    expect(client.startTurn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ input: [{ kind: "text", text: "follow up" }] }),
    );
    h.controller.settleTurn(reviewId);
    expect(client.startTurn).toHaveBeenCalledOnce();
  });

  it.each(["not sent", "protocol rejection", "negative ACK"] as const)(
    "settles a definite %s without treating it as an ambiguous start",
    async (failure) => {
      const gate = deferred<ReviewStartResult>();
      const startReview = vi.fn((request: NativeReviewStartRequest) => {
        if (failure !== "not sent") request.markSent();
        return gate.promise;
      });
      const client = fakeClient();
      const h = renderController(client, { startReview });
      h.controller.enqueueTurn({ kind: "review", turnId: reviewId, text: "" });
      h.controller.enqueuePrompt("following");
      if (failure === "not sent") gate.reject(new Error("factory unavailable"));
      else if (failure === "protocol rejection")
        gate.reject(new OctosUiProtocolError(-32600, "already running"));
      else
        gate.resolve({
          ...reviewAck({ sessionId: "session-a", turnId: reviewId }),
          accepted: false,
        });
      await Promise.resolve();
      expect(h.controller.snapshot().active?.kind).not.toBe("review");
      expect(
        h.timeline.some((entry) => entry.title === "Native review rejected"),
      ).toBe(true);
      expect(client.startTurn).toHaveBeenCalledOnce();
      expect(
        h.dispatchEvents.some(
          (event) => event.turnId === reviewId && event.state === "accepted",
        ),
      ).toBe(false);
    },
  );

  it("holds an ambiguous review and queued work without replay until hydrate or terminal provides evidence", async () => {
    const client = fakeClient();
    const startReview = vi.fn(async (request: NativeReviewStartRequest) => {
      request.markSent();
      throw new Error("response timed out");
    });
    const h = renderController(client, { startReview });
    h.controller.enqueueTurn({ kind: "review", turnId: reviewId, text: "" });
    h.controller.enqueuePrompt("following");
    await Promise.resolve();
    expect(h.controller.snapshot().active?.turnId).toBe(reviewId);
    expect(h.controller.backgroundHandoffTurn()).toBeNull();
    expect(
      h.timeline.some(
        (entry) => entry.title === "Native review outcome unknown",
      ),
    ).toBe(true);
    h.controller.resumePendingTurn();
    h.controller.reconcileFromHydrate(
      { session_id: "session-a", cursor: { stream: "s", seq: 1 }, turns: [] },
      true,
    );
    h.controller.resumePendingTurn();
    expect(startReview).toHaveBeenCalledOnce();
    expect(client.startTurn).not.toHaveBeenCalled();
    h.controller.reconcileFromHydrate(
      {
        session_id: "session-a",
        cursor: { stream: "s", seq: 2 },
        turns: [{ turn_id: reviewId, state: "active" }],
      },
      true,
    );
    expect(h.controller.backgroundHandoffTurn()).toMatchObject({
      turnId: reviewId,
      state: "running",
    });
    h.controller.settleTurn(reviewId);
    expect(client.startTurn).toHaveBeenCalledOnce();
  });

  it("treats an acknowledged foreign turn as uncertain and never advances the queue", async () => {
    const client = fakeClient();
    const h = renderController(client, {
      startReview: async (request) => {
        request.markSent();
        return reviewAck({ ...request, sessionId: "foreign" });
      },
    });
    h.controller.enqueueTurn({ kind: "review", turnId: reviewId, text: "" });
    h.controller.enqueuePrompt("following");
    await Promise.resolve();
    expect(h.controller.snapshot().active?.turnId).toBe(reviewId);
    expect(client.startTurn).not.toHaveBeenCalled();
    expect(h.controller.backgroundHandoffTurn()).toBeNull();
  });

  it("uses the normal accepted-turn interrupt path for review", async () => {
    const client = fakeClient();
    const h = renderController(client, {
      startReview: async (request) => {
        request.markSent();
        return reviewAck(request);
      },
    });
    h.controller.enqueueTurn({ kind: "review", turnId: reviewId, text: "" });
    await Promise.resolve();
    await h.controller.interrupt();
    await h.controller.interrupt();
    expect(client.interruptTurn).toHaveBeenCalledExactlyOnceWith(
      "session-a",
      reviewId,
    );
  });

  it("does not send after its controller authority is suspended during lazy command resolution", async () => {
    const gate = deferred<void>();
    const sent = vi.fn();
    const h = renderController(fakeClient(), {
      startReview: async (request) => {
        await gate.promise;
        request.markSent();
        sent();
        return reviewAck(request);
      },
    });
    h.controller.enqueueTurn({ kind: "review", turnId: reviewId, text: "" });
    h.controller.suspendTransport();
    gate.resolve(undefined);
    await gate.promise;
    await Promise.resolve();
    expect(sent).not.toHaveBeenCalled();
    expect(h.controller.snapshot().active?.turnId).toBe(reviewId);
    expect(h.dispatchEvents.some((event) => event.state === "accepted")).toBe(
      false,
    );
  });

  it("resumes only the never-sent review UUID after suspension and fences the older factory", async () => {
    const oldFactory = deferred<void>();
    const wire = vi.fn();
    let calls = 0;
    const h = renderController(fakeClient(), {
      startReview: async (request) => {
        calls += 1;
        if (calls === 1) await oldFactory.promise;
        request.markSent();
        wire(request.turnId);
        return reviewAck(request);
      },
    });
    h.controller.enqueueTurn({ kind: "review", turnId: reviewId, text: "" });
    h.controller.suspendTransport();
    h.controller.reconcileFromHydrate({
      session_id: "session-a",
      cursor: { stream: "s", seq: 1 },
      turns: [],
    });
    h.controller.resumePendingTurn();
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(wire).toHaveBeenCalledExactlyOnceWith(reviewId);
    oldFactory.resolve(undefined);
    await oldFactory.promise;
    await Promise.resolve();
    expect(wire).toHaveBeenCalledOnce();
    expect(h.controller.backgroundHandoffTurn()).toMatchObject({
      turnId: reviewId,
      state: "running",
    });
  });

  it("never resumes a review whose wire boundary was crossed before suspension", async () => {
    const reply = deferred<ReviewStartResult>();
    const startReview = vi.fn((request: NativeReviewStartRequest) => {
      request.markSent();
      return reply.promise;
    });
    const h = renderController(fakeClient(), { startReview });
    h.controller.enqueueTurn({ kind: "review", turnId: reviewId, text: "" });
    h.controller.suspendTransport();
    h.controller.reconcileFromHydrate({
      session_id: "session-a",
      cursor: { stream: "s", seq: 1 },
      turns: [],
    });
    h.controller.resumePendingTurn();
    reply.resolve(reviewAck({ sessionId: "session-a", turnId: reviewId }));
    await reply.promise;
    h.controller.resumePendingTurn();
    expect(startReview).toHaveBeenCalledOnce();
    expect(h.controller.snapshot().active?.turnId).toBe(reviewId);
    expect(h.controller.backgroundHandoffTurn()).toBeNull();
  });

  it("ignores a late review ACK after terminal has started the next ordinary prompt", async () => {
    const gate = deferred<ReviewStartResult>();
    const client = fakeClient();
    const h = renderController(client, {
      startReview: (request) => {
        request.markSent();
        return gate.promise;
      },
    });
    h.controller.enqueueTurn({ kind: "review", turnId: reviewId, text: "" });
    h.controller.enqueuePrompt("following");
    h.controller.settleTurn(reviewId);
    const nextId = h.activeTurnId();
    gate.resolve(reviewAck({ sessionId: "session-a", turnId: reviewId }));
    await gate.promise;
    await Promise.resolve();
    expect(h.activeTurnId()).toBe(nextId);
    expect(h.controller.backgroundHandoffTurn()?.turnId).toBe(nextId);
    expect(client.startTurn).toHaveBeenCalledOnce();
    expect(
      h.dispatchEvents
        .filter((event) => event.turnId === reviewId)
        .map((event) => event.state),
    ).toEqual(["dispatching", "cancelled"]);
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

function emptyHydrate() {
  return {
    session_id: "session-a",
    cursor: { stream: "session-a", seq: 2 },
    turns: [],
  };
}
