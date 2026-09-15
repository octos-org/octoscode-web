import { describe, expect, it } from "vitest";
import { stripStateThinking } from "../timeline/strip-thinking.ts";
import type { SessionStripState } from "./SessionStatusStrip.tsx";

describe("strip third segment shows live activity word", () => {
  it("prefers the live activity label while a turn is producing", () => {
    expect(
      stripStateThinking({ kind: "responding" } satisfies SessionStripState, {
        label: "Thinking…",
        startedAtMs: 0,
        lastAtMs: 1,
      }),
    ).toBe("Thinking…");
    expect(
      stripStateThinking({ kind: "responding" } satisfies SessionStripState, {
        label: "Running shell…",
        startedAtMs: 0,
        lastAtMs: 2,
      }),
    ).toBe("Running shell…");
  });

  it("keeps the plain word when no live activity exists", () => {
    expect(
      stripStateThinking(
        { kind: "responding" } satisfies SessionStripState,
        null,
      ),
    ).toBe(null);
    expect(
      stripStateThinking(
        { kind: "waiting-approval" } satisfies SessionStripState,
        { label: "Thinking…", startedAtMs: 0, lastAtMs: 1 },
      ),
    ).toBe(null);
  });
});
