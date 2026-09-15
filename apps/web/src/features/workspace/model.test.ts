import { describe, expect, it } from "vitest";
import { mergeTokenCost } from "./model.ts";

describe("workspace product model", () => {
  it("merges sparse live token-cost updates within one session", () => {
    expect(
      mergeTokenCost(
        { sessionId: "s1", inputTokens: 100, contextWindow: 1_000 },
        { sessionId: "s1", outputTokens: 20, sessionCost: 0.01 },
      ),
    ).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      contextWindow: 1_000,
      sessionCost: 0.01,
    });
  });
});
