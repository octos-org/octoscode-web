import { describe, expect, it } from "vitest";
import type { ContextSnapshot } from "@octos-org/octoscode-client/protocol";
import { pickContext } from "./live-context.ts";

const at = (sessionId: string, generation: number, tokens: number) =>
  ({
    state: {
      session_id: sessionId,
      generation,
      token_estimate: tokens,
      item_count: 1,
      recovery_state: "exact",
    },
  }) as ContextSnapshot;

describe("pickContext", () => {
  it("prefers what the server said last for this session", () => {
    const opened = at("s1", 3, 1_000);
    const reported = {
      ...at("s1", 3, 9_400),
      reported: { thresholdTokens: 140_000 },
    };
    expect(pickContext(opened, null, "s1")).toBe(opened);
    expect(pickContext(opened, reported, "s1")).toBe(reported);
    expect(pickContext(null, reported, "s1")).toBe(reported);
    // A newer read after a compaction outranks an older report.
    const compactedRead = at("s1", 4, 400);
    expect(pickContext(compactedRead, reported, "s1")).toBe(compactedRead);
  });

  it("never shows another session's context", () => {
    expect(pickContext(at("s2", 9, 5), at("s2", 9, 5), "s1")).toBeNull();
    expect(pickContext(at("s1", 1, 5), null, null)).toBeNull();
    expect(
      pickContext(at("s1", 1, 5), at("s2", 9, 7), "s1")?.state.token_estimate,
    ).toBe(5);
  });
});
