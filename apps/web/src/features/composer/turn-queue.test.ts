import { describe, expect, it } from "vitest";
import { PromptTurnQueue, type PromptTurn } from "./turn-queue.ts";

const turn = (turnId: string): PromptTurn => ({ turnId, text: turnId });

describe("PromptTurnQueue", () => {
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

  it("restores a server-active turn without starting a second one", () => {
    const queue = new PromptTurnQueue();

    expect(queue.restoreActive(turn("server-turn"))).toBe(true);
    expect(queue.restoreActive(turn("other-turn"))).toBe(false);
    expect(queue.snapshot().active).toEqual(turn("server-turn"));
  });

  it("clears browser-local queue state when the session disconnects", () => {
    const queue = new PromptTurnQueue();
    queue.enqueue(turn("one"));
    queue.enqueue(turn("two"));

    queue.clear();

    expect(queue.snapshot()).toEqual({ active: null, pending: [] });
  });
});
