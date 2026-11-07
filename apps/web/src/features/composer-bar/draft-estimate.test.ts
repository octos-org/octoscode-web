import { describe, expect, it } from "vitest";
import { estimateTextTokens } from "./draft-estimate.ts";

describe("estimateTextTokens", () => {
  // The same numbers Core's octos_llm::context::estimate_tokens gives.
  it("counts a quarter token per ASCII character and two thirds per other character", () => {
    expect(estimateTextTokens("hello world")).toBe(2);
    expect(estimateTextTokens("x".repeat(400))).toBe(100);
    expect(estimateTextTokens("你好世界")).toBe(2);
    expect(estimateTextTokens("评审一下方案的第一节")).toBe(6);
    expect(estimateTextTokens("fix 登录 bug")).toBe(2 + 1);
    // One emoji is one character, not two UTF-16 units.
    expect(estimateTextTokens("👍👍👍")).toBe(2);
    expect(estimateTextTokens("")).toBe(1);
  });
});
