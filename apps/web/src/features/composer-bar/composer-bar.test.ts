import { describe, expect, it } from "vitest";
import type { SessionStatusReadResult } from "@octos-org/octoscode-client/protocol";
import { formatUsd, sessionUsage } from "./session-usage.ts";

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
        inputTokens: 12,
        sessionCost: 2,
        currency: "CNY",
      }),
    ).toEqual({ inputTokens: 12, outputTokens: 0, cachedTokens: 0 });
  });

  it("shows nothing until the session has used something", () => {
    expect(
      sessionUsage(
        "s1",
        { session_id: "s1", mcp_servers: [], usage: {} },
        null,
      ),
    ).toBeNull();
    expect(
      sessionUsage("s1", null, {
        sessionId: "s1",
        inputTokens: 0,
        outputTokens: 0,
        sessionCost: 0,
      }),
    ).toBeNull();
    expect(
      sessionUsage("s1", null, { sessionId: "s1", outputTokens: 1 }),
    ).toEqual({ inputTokens: 0, outputTokens: 1, cachedTokens: 0 });
  });

  it("keeps small costs readable", () => {
    expect(formatUsd(0.0041)).toBe("$0.0041");
    expect(formatUsd(1.234)).toBe("$1.23");
  });
});
