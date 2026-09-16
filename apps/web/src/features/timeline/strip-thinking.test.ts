import { describe, expect, it } from "vitest";
import { stripStateThinking } from "./strip-thinking.ts";
import type { TurnActivity } from "./turn-activity.ts";

const activity: TurnActivity = {
  label: "Running shell…",
  startedAtMs: 1_700_000_000_000,
  lastAtMs: 1_700_000_001_000,
};

describe("stripStateThinking", () => {
  it("replaces the state word with the live step while we are responding", () => {
    expect(stripStateThinking({ kind: "responding" }, activity)).toBe(
      "Running shell…",
    );
  });

  it("keeps the disclosure when the live turn belongs to another client", () => {
    // Whose turn it is outranks what it is doing: substituting the step word
    // here would present another client's work as this app's own response.
    // The timeline still shows every step, so no detail is lost.
    expect(stripStateThinking({ kind: "busy-elsewhere" }, activity)).toBeNull();
  });

  it("falls back to the plain state word without activity", () => {
    expect(stripStateThinking({ kind: "responding" }, null)).toBeNull();
    expect(stripStateThinking({ kind: "ready" }, activity)).toBeNull();
  });
});
