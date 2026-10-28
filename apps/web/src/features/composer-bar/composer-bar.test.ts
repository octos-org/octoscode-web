import { describe, expect, it } from "vitest";
import type { SessionStatusReadResult } from "@octos-org/octoscode-client/protocol";
import { modelStrengths } from "./model-strengths.ts";
import { formatUsd, sessionUsage } from "./session-usage.ts";

describe("model strengths", () => {
  it("tags tiers by their public naming, never fast and heavy at once", () => {
    expect(modelStrengths("deepseek-v4-pro", "deepseek")).toEqual([
      "deep",
      "zh",
    ]);
    expect(modelStrengths("deepseek-v4-flash", "deepseek")).toEqual([
      "fast",
      "zh",
    ]);
    expect(modelStrengths("gpt-5.1-codex", "openai")).toEqual(["code", "deep"]);
    expect(modelStrengths("gpt-5-mini", "openai")).toEqual(["fast"]);
    expect(modelStrengths("o4-mini", "openai")).toEqual(["fast"]);
    expect(modelStrengths("kimi-k3", "moonshot")).toEqual([
      "deep",
      "long",
      "zh",
    ]);
    expect(modelStrengths("Qwen/Qwen3-32B", "vllm")).toEqual(["local", "zh"]);
    expect(modelStrengths("some-house-model", "openai")).toEqual([]);
  });
});

describe("session usage", () => {
  const status: SessionStatusReadResult = {
    session_id: "s1",
    mcp_servers: [],
    usage: {
      input_tokens: 1200,
      output_tokens: 300,
      estimated_cost_micros_usd: 4100,
    },
  };

  it("prefers the live session totals, falls back to the status read", () => {
    expect(
      sessionUsage("s1", status, {
        sessionId: "s1",
        inputTokens: 1500,
        outputTokens: 400,
        sessionCost: 0.005,
      }),
    ).toEqual({
      inputTokens: 1500,
      outputTokens: 400,
      cachedTokens: 0,
      costUsd: 0.005,
    });
    expect(
      sessionUsage("s1", status, { sessionId: "other", inputTokens: 9 }),
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      cachedTokens: 0,
      costUsd: 0.0041,
    });
  });

  it("shows nothing it was not told, and no cost in another currency", () => {
    expect(sessionUsage("s1", null, null)).toBeNull();
    expect(sessionUsage("s2", status, null)).toBeNull();
    expect(
      sessionUsage("s1", null, {
        sessionId: "s1",
        sessionCost: 2,
        currency: "CNY",
      }),
    ).toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
  });

  it("keeps small costs readable", () => {
    expect(formatUsd(0.0041)).toBe("$0.0041");
    expect(formatUsd(1.234)).toBe("$1.23");
  });
});
