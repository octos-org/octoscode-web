import { describe, expect, it } from "vitest";
import { PromptTurnQueue, type PromptTurn } from "./turn-queue.ts";

const turn = (turnId: string): PromptTurn => ({ turnId, text: turnId });

describe("PromptTurnQueue", () => {
  it("preserves review dispatch kind across owned queue snapshots", () => {
    const queue = new PromptTurnQueue();
    const review: PromptTurn = { turnId: "review", text: "", kind: "review" };
    queue.enqueue(review);
    delete review.kind;
    const snapshot = queue.snapshot();
    delete snapshot.active!.kind;
    expect(queue.snapshot().active).toEqual({
      turnId: "review",
      text: "",
      kind: "review",
    });
  });
  it("owns media at admission and returns independent snapshot and transition copies", () => {
    const queue = new PromptTurnQueue();
    const input: PromptTurn = {
      turnId: "one",
      text: "one",
      reasoningEffort: "high",
      media: [{ path: "uploaded/original", mime: "image/png", size_bytes: 5 }],
    };
    queue.enqueue(input);
    input.media![0]!.path = "caller-mutated";
    input.media!.push({ path: "extra", mime: "image/png", size_bytes: 1 });
    queue.enqueue({
      ...input,
      turnId: "two",
      media: [{ path: "second", mime: "image/png", size_bytes: 2 }],
    });
    const snapshot = queue.snapshot();
    snapshot.active!.media![0]!.path = "snapshot-mutated";
    snapshot.pending[0]!.media![0]!.path = "pending-mutated";
    expect(queue.snapshot().active?.media).toEqual([
      { path: "uploaded/original", mime: "image/png", size_bytes: 5 },
    ]);
    const next = queue.settle("one").next!;
    next.media![0]!.path = "transition-mutated";
    expect(queue.snapshot().active?.media?.[0]?.path).toBe("second");
  });

  it("starts the first prompt and queues later prompts FIFO", () => {
    const queue = new PromptTurnQueue();

    expect(queue.enqueue(turn("one"))).toEqual({ startNow: true });
    expect(queue.enqueue(turn("two"))).toEqual({ startNow: false });
    expect(queue.enqueue(turn("three"))).toEqual({ startNow: false });

    expect(queue.snapshot()).toEqual({
      active: turn("one"),
      pending: [turn("two"), turn("three")],
    });
    expect(queue.settle("one")).toEqual({
      settled: true,
      next: turn("two"),
    });
    expect(queue.settle("two")).toEqual({
      settled: true,
      next: turn("three"),
    });
  });

  it("ignores duplicate or stale terminal events", () => {
    const queue = new PromptTurnQueue();
    queue.enqueue(turn("one"));
    queue.enqueue(turn("two"));

    expect(queue.settle("stale")).toEqual({ settled: false, next: null });
    expect(queue.snapshot().active).toEqual(turn("one"));

    queue.settle("one");
    expect(queue.settle("one")).toEqual({ settled: false, next: null });
    expect(queue.snapshot().active).toEqual(turn("two"));
  });

  it("removes only pending prompts and preserves the remaining FIFO", () => {
    const queue = new PromptTurnQueue();
    queue.enqueue(turn("one"));
    queue.enqueue(turn("two"));
    queue.enqueue(turn("three"));

    expect(queue.removePending("one")).toBe(false);
    expect(queue.removePending("missing")).toBe(false);
    expect(queue.removePending("two")).toBe(true);
    expect(queue.removePending("two")).toBe(false);
    expect(queue.snapshot()).toEqual({
      active: turn("one"),
      pending: [turn("three")],
    });
    expect(queue.settle("one").next).toEqual(turn("three"));
  });

  it("restores a server-active turn without starting a second one", () => {
    const queue = new PromptTurnQueue();

    expect(queue.restoreActive(turn("server-turn"))).toBe(true);
    expect(queue.restoreActive(turn("other-turn"))).toBe(false);
    expect(queue.snapshot().active).toEqual(turn("server-turn"));
  });

  it("keys interrupt prompt restores by turn so another session's terminal cannot consume them", () => {
    const queue = new PromptTurnQueue();
    queue.stashInterruptPrompt("session-a", "turn-a", "draft a");

    // Session B's terminal (a different turn) consumes nothing.
    expect(queue.takeInterruptPrompt("turn-b")).toBeNull();
    // A's own terminal gets the prompt, carrying its owning session.
    expect(queue.takeInterruptPrompt("turn-a")).toEqual({
      sessionId: "session-a",
      turnId: "turn-a",
      prompt: "draft a",
    });
    expect(queue.takeInterruptPrompt("turn-a")).toBeNull();
  });

  it("keeps one re-armable entry per session without disturbing other sessions", () => {
    const queue = new PromptTurnQueue();
    queue.stashInterruptPrompt("session-a", "turn-a1", "first");
    queue.stashInterruptPrompt("session-b", "turn-b", "keep b");
    queue.stashInterruptPrompt("session-a", "turn-a2", "second");

    // The re-Esc on A replaced A's own entry; B's is untouched.
    expect(queue.takeInterruptPrompt("turn-a1")).toBeNull();
    expect(queue.takeInterruptPrompt("turn-a2")?.prompt).toBe("second");
    expect(queue.takeInterruptPrompt("turn-b")?.prompt).toBe("keep b");
    expect(queue.takeInterruptPrompt("turn-a2")).toBeNull();
  });

  it("ignores empty prompts and clears restores with the queue", () => {
    const queue = new PromptTurnQueue();
    queue.stashInterruptPrompt("session-a", "turn-a", "   ");
    expect(queue.takeInterruptPrompt("turn-a")).toBeNull();

    queue.stashInterruptPrompt("session-a", "turn-a", "draft");
    queue.clear();
    expect(queue.takeInterruptPrompt("turn-a")).toBeNull();
  });
});
