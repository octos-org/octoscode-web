import { describe, expect, it } from "vitest";
import type { BackgroundTurnSnapshot } from "../session/background-turn-manager.ts";
import { AttentionTracker, foregroundAttentionTurns } from "./model.ts";
import type { TimelineEntry } from "../timeline/model.ts";

const first: BackgroundTurnSnapshot = {
  workspaceRoot: "/workspace/one",
  profileId: "coding",
  sessionId: "session-1",
  turnId: "turn-1",
  state: "running",
};
const second = { ...first, sessionId: "session-2" };

describe("attention transitions", () => {
  it("seeds hydrated terminal and waiting states without replaying notifications", () => {
    const tracker = new AttentionTracker();
    const identity = {};
    const hydrated = [
      { ...first, state: "completed" as const },
      { ...second, state: "waiting" as const },
    ];
    expect(tracker.observe(identity, hydrated, null, false)).toEqual([]);
    expect(tracker.observe(identity, hydrated, null, false)).toEqual([]);
    expect(tracker.count).toBe(0);
  });

  it.each(["completed", "failed", "waiting"] as const)(
    "signals observed %s once and acknowledges after reopening a reclaimed owner",
    (state) => {
      const tracker = new AttentionTracker();
      const identity = {};
      tracker.observe(identity, [first], second, true);
      const next = { ...first, state };
      expect(tracker.observe(identity, [next], second, true)).toEqual([next]);
      expect(tracker.observe(identity, [next], second, true)).toEqual([]);
      expect(tracker.count).toBe(1);
      tracker.observe(identity, [], first, true);
      expect(tracker.count).toBe(0);
      expect(tracker.observe(identity, [next], second, true)).toEqual([]);
    },
  );

  it("keeps waiting then completed as one unread turn but two distinct signals", () => {
    const tracker = new AttentionTracker();
    const identity = {};
    tracker.observe(identity, [first], second, true);
    tracker.observe(identity, [{ ...first, state: "waiting" }], second, true);
    expect(
      tracker.observe(
        identity,
        [{ ...first, state: "completed" }],
        second,
        true,
      ),
    ).toHaveLength(1);
    expect(tracker.count).toBe(1);
    // Terminal-to-terminal contradictions aren't new lifecycle evidence.
    expect(
      tracker.observe(identity, [{ ...first, state: "failed" }], second, true),
    ).toEqual([]);
  });

  it("separates identical turn and session IDs by workspace and profile", () => {
    const tracker = new AttentionTracker();
    const identity = {};
    const rows = [
      first,
      { ...first, workspaceRoot: "/workspace/two" },
      { ...first, profileId: "other" },
    ];
    tracker.observe(identity, rows, null, true);
    expect(
      tracker.observe(
        identity,
        rows.map((row) => ({ ...row, state: "failed" })),
        null,
        true,
      ),
    ).toHaveLength(3);
    expect(tracker.count).toBe(3);
  });

  it("resets unread and baselines when identity changes or disconnects", () => {
    const tracker = new AttentionTracker();
    const identity = {};
    tracker.observe(identity, [first], null, true);
    tracker.observe(identity, [{ ...first, state: "failed" }], null, true);
    expect(tracker.count).toBe(1);
    expect(
      tracker.observe({}, [{ ...first, state: "failed" }], null, true),
    ).toEqual([]);
    expect(tracker.count).toBe(0);
    expect(tracker.observe(null, [first], null, true)).toEqual([]);
    expect(
      tracker.observe(null, [{ ...first, state: "completed" }], null, true),
    ).toEqual([]);
    expect(tracker.count).toBe(0);
  });

  it("retains evidence when queue removal and a terminal arrive in separate renders", () => {
    const tracker = new AttentionTracker();
    const identity = {};
    tracker.observe(identity, [first], first, true);
    expect(tracker.observe(identity, [], first, false)).toEqual([]);
    expect(tracker.count).toBe(0);
    expect(
      tracker.observe(
        identity,
        [{ ...first, state: "completed" }],
        first,
        false,
      ),
    ).toHaveLength(1);
  });

  it("deduplicates overlapping owner and foreground snapshots without replaying terminals", () => {
    const tracker = new AttentionTracker();
    const identity = {};
    tracker.observe(identity, [first], null, false);
    expect(
      tracker.observe(
        identity,
        [first, { ...first, state: "completed" }],
        null,
        false,
      ),
    ).toHaveLength(1);
    expect(tracker.observe(identity, [first], null, false)).toEqual([]);
    expect(
      tracker.observe(
        identity,
        [{ ...first, state: "completed" }],
        null,
        false,
      ),
    ).toEqual([]);
    expect(tracker.count).toBe(1);
  });

  it("bounds observation and unread history during a long-lived tab", () => {
    const tracker = new AttentionTracker();
    const identity = {};
    tracker.observe(identity, [], null, false);
    for (let index = 0; index < 200; index++) {
      const row = { ...first, turnId: `turn-${index}` };
      tracker.observe(identity, [row], null, false);
      tracker.observe(identity, [{ ...row, state: "failed" }], null, false);
    }
    expect(tracker.count).toBe(128);
  });
});

describe("foreground attention evidence", () => {
  const terminal: TimelineEntry = {
    id: "terminal:turn-1",
    kind: "system",
    title: "Turn complete",
    body: "",
    status: "complete",
    turnId: "turn-1",
  };

  it("ignores assistant completion, anonymous terminals, interruption and a vanished active queue", () => {
    expect(
      foregroundAttentionTurns(first, null, null, [
        { ...terminal, id: "assistant:turn-1", kind: "assistant" },
        { ...terminal, id: "terminal:turn-2" },
        { ...terminal, status: "info" },
      ]),
    ).toEqual([]);
    expect(foregroundAttentionTurns(first, null, null, [])).toEqual([]);
    expect(
      foregroundAttentionTurns(null, "turn-1", "turn-1", [terminal]),
    ).toEqual([]);
  });
  it("associates waiting with the exact active turn and handles terminal plus next running turn", () => {
    expect(
      foregroundAttentionTurns(first, "turn-1", "turn-other", []),
    ).toMatchObject([{ state: "running" }]);
    expect(
      foregroundAttentionTurns(first, "turn-1", "turn-1", []),
    ).toMatchObject([{ state: "waiting" }]);
    expect(
      foregroundAttentionTurns(first, "turn-2", null, [
        { ...terminal, status: "error" },
      ]),
    ).toMatchObject([
      { state: "running", turnId: "turn-2" },
      { state: "failed", turnId: "turn-1" },
    ]);
  });
});
