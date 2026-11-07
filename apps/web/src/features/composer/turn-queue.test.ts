import { describe, expect, it } from "vitest";
import { PromptTurnQueue } from "./turn-queue.ts";

// The queue's FIFO, single active turn, stale terminals, cancel and the
// turn-keyed interrupt restore all run through the real queue inside the
// controller suite (use-turn-controller.test.ts). What stays here is the
// stash a stopped prompt waits in, which that suite reaches only for one
// Session: one entry per Session, replaced by a re-stop, never touching
// another Session's, and attachments kept even when the prompt has no text.
// Losing either would drop or misplace a user's draft.
describe("PromptTurnQueue interrupt restores", () => {
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

  it("keeps a stopped turn's attachments even with no text, and nothing for an empty prompt", () => {
    const queue = new PromptTurnQueue();
    const media = [{ path: "up/x/a.csv", mime: "text/csv", size_bytes: 3 }];
    queue.stashInterruptPrompt("session-a", "turn-a", "", media);
    expect(queue.takeInterruptPrompt("turn-a")).toMatchObject({ media });

    queue.stashInterruptPrompt("session-a", "turn-b", "   ");
    expect(queue.takeInterruptPrompt("turn-b")).toBeNull();

    queue.stashInterruptPrompt("session-a", "turn-c", "draft");
    queue.clear();
    expect(queue.takeInterruptPrompt("turn-c")).toBeNull();
  });
});
