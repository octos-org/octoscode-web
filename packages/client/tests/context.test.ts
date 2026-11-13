import { describe, expect, it } from "vitest";
import { applyContextNotification, parseContextState } from "../src/index.ts";
const state = {
  session_id: "s1",
  generation: 3,
  token_estimate: 120,
  item_count: 8,
  recovery_state: "exact",
};

describe("context lifecycle", () => {
  it("projects only bounded diagnostic labels and authoritative counts", () => {
    expect(
      parseContextState(
        {
          ...state,
          cache_epoch_id: "epoch-1",
          raw_prompt: "never project this",
        },
        "s1",
      ),
    ).toEqual({ ...state, cache_epoch_id: "epoch-1" });
    expect(parseContextState(state, "s2")).toBeNull();
    for (const token_estimate of [
      -1,
      NaN,
      Infinity,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(parseContextState({ ...state, token_estimate }, "s1")).toBeNull();
    }
    expect(
      parseContextState({ ...state, cache_epoch_id: "x".repeat(513) }, "s1"),
    ).toBeNull();
  });
  it("permits a failed compaction to retry at the same generation", () => {
    const completed = {
      state,
      lastCompaction: {
        status: "failed",
        input_generation: 3,
        token_estimate_before: 120,
      },
    };
    expect(
      applyContextNotification(
        completed,
        {
          jsonrpc: "2.0",
          method: "context/compaction_started",
          params: {
            session_id: "s1",
            context_state: state,
            threshold_tokens: 100,
            trigger: "manual",
          },
        },
        "s1",
      ),
    ).toMatchObject({ compacting: { generation: 3, trigger: "manual" } });
  });
});
