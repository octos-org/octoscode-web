import { describe, expect, it } from "vitest";
import { applyContextNotification, parseContextState } from "../src/index.ts";
const state = {
  session_id: "s1",
  generation: 3,
  token_estimate: 120,
  item_count: 8,
  recovery_state: "exact",
};
const result = {
  session_id: "s1",
  compacted: true,
  status: "installed",
  input_generation: 3,
  output_generation: 4,
  token_estimate_before: 120,
  token_estimate_after: 50,
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
  it("rejects wrong-session and stale lifecycle notifications", () => {
    const previous = { state };
    const event = {
      jsonrpc: "2.0" as const,
      method: "context/compaction_started",
      params: {
        session_id: "s1",
        context_state: state,
        threshold_tokens: 100,
        trigger: "automatic",
      },
    };
    const active = applyContextNotification(previous, event, "s1");
    expect(active?.compacting).toEqual({
      generation: 3,
      thresholdTokens: 100,
      trigger: "automatic",
    });
    expect(applyContextNotification(previous, event, "s2")).toBeNull();
    expect(
      applyContextNotification(
        previous,
        {
          ...event,
          params: {
            ...event.params,
            context_state: { ...state, generation: 2 },
          },
        },
        "s1",
      ),
    ).toBe(previous);
    const completed = applyContextNotification(
      active,
      {
        ...event,
        method: "context/compaction_completed",
        params: {
          session_id: "s1",
          context_state: { ...state, generation: 4, token_estimate: 50 },
          compaction: result,
        },
      },
      "s1",
    );
    expect(completed?.compacting).toBeUndefined();
    expect(completed?.state.token_estimate).toBe(50);
    expect(applyContextNotification(completed, event, "s1")).toBe(completed);
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
