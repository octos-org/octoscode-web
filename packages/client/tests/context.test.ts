import { describe, expect, it, vi } from "vitest";
import {
  APPUI_CONTEXT_METHODS,
  applyContextNotification,
  createContextCommands,
  parseCompactResult,
  parseContextSnapshot,
  parseContextState,
  parseSessionStatusReadResult,
  type UiProtocolCapabilities,
} from "../src/index.ts";

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
const capabilities = (methods: string[]): UiProtocolCapabilities => ({
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: methods,
  supported_notifications: [],
});

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
  it("accepts old servers without inventing lifecycle state", () => {
    expect(
      parseContextSnapshot({ usage: { input_tokens: 10000 } }, "s1"),
    ).toBeNull();
    expect(parseSessionStatusReadResult({ session_id: "s1" })).toEqual({
      session_id: "s1",
      mcp_servers: [],
    });
    expect(
      parseSessionStatusReadResult({ session_id: "s1", context_state: state }),
    ).toMatchObject({ contextSnapshot: { state } });
    expect(
      parseSessionStatusReadResult({ session_id: "s2", context_state: state }),
    ).not.toHaveProperty("contextSnapshot");
    expect(parseContextSnapshot({ context: { state } }, "s1")).toEqual({
      state,
    });
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
  it("never carries another session generation or diagnostics into an update", () => {
    for (const generation of [1, 100]) {
      const prior = {
        state: { ...state, session_id: "other", generation },
        lastCompaction: {
          status: "other-private-state",
          input_generation: 1,
          token_estimate_before: 1,
        },
      };
      const next = applyContextNotification(
        prior,
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
      );
      expect(next?.state).toEqual(state);
      expect(next?.lastCompaction).toBeUndefined();
    }
  });
  it("settles lifecycle even when the provider error is very long", () => {
    const next = applyContextNotification(
      {
        state,
        compacting: { generation: 3, thresholdTokens: 100, trigger: "manual" },
      },
      {
        jsonrpc: "2.0",
        method: "context/compaction_completed",
        params: {
          session_id: "s1",
          context_state: state,
          compaction: { ...result, status: "failed", error: "x".repeat(2048) },
        },
      },
      "s1",
    );
    expect(next?.compacting).toBeUndefined();
    expect(next?.lastCompaction?.error).toHaveLength(512);
  });
  it("gates requests and rejects cross-session results", async () => {
    const request = vi.fn().mockResolvedValue(result);
    await expect(
      createContextCommands({ request }, "s1", capabilities([])).compact(),
    ).rejects.toThrow("not advertised");
    expect(request).not.toHaveBeenCalled();
    const commands = createContextCommands(
      { request },
      "s1",
      capabilities(Object.values(APPUI_CONTEXT_METHODS)),
    );
    await expect(commands.compact()).resolves.toMatchObject({
      compacted: true,
      session_id: "s1",
    });
    expect(request).toHaveBeenCalledWith("session/compact", {
      session_id: "s1",
    });
    request.mockResolvedValue({ ...result, session_id: "s2" });
    await expect(commands.compact()).rejects.toThrow("wrong-session");
    request.mockResolvedValue({ session_id: "s1", mode: "llm" });
    await expect(commands.setMode("llm")).resolves.toBe("llm");
    request.mockResolvedValue({ session_id: "s2", mode: "llm" });
    await expect(commands.setMode("llm")).rejects.toThrow("wrong-session");
    expect(
      parseCompactResult(
        {
          ...result,
          compacted: false,
          status: "failed",
          reason: "rejected_over_budget",
        },
        "s1",
      ),
    ).toMatchObject({ compacted: false, reason: "rejected_over_budget" });
  });
});
