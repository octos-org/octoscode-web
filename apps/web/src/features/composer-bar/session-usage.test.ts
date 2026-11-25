import type {
  SessionStatusReadResult,
  TokenCostUpdate,
} from "@octos-org/octoscode-client/protocol";
import { describe, expect, it } from "vitest";
import { sessionUsage } from "./session-usage.ts";

const status = (provider: string) =>
  ({
    session_id: "s",
    model: { model: "m", provider },
    usage: {
      input_tokens: 10,
      output_tokens: 2,
      estimated_cost_micros_usd: 20000,
    },
  }) as SessionStatusReadResult;
const live = {
  sessionId: "s",
  inputTokens: 10,
  outputTokens: 2,
  sessionCost: 0.5,
} as TokenCostUpdate;

describe("sessionUsage", () => {
  // T-0676: a coding plan is a subscription, so a per-token estimate would read as a charge.
  it("shows no dollars for a coding plan and keeps the server's estimate for metered providers", () => {
    for (const provider of ["zai-coding", "moonshot-coding", "kimi-coding"]) {
      expect(sessionUsage("s", status(provider), null)).toEqual({
        inputTokens: 10,
        outputTokens: 2,
        cachedTokens: 0,
        plan: true,
      });
      expect(
        sessionUsage("s", status(provider), live)?.costUsd,
      ).toBeUndefined();
    }
    expect(sessionUsage("s", status("moonshot"), null)?.costUsd).toBe(0.02);
    expect(sessionUsage("s", status("moonshot"), live)?.costUsd).toBe(0.5);
  });
});
