import { describe, expect, it } from "vitest";
import type {
  ContextSnapshot,
  TokenCostUpdate,
} from "@octos-org/octoscode-client/protocol";
import { draftEstimate, estimateTextTokens } from "./draft-estimate.ts";

const snapshot = (sessionId: string, tokens: number) =>
  ({
    state: {
      session_id: sessionId,
      token_estimate: tokens,
      item_count: 3,
      generation: 1,
      recovery_state: "clean",
    },
  }) as unknown as ContextSnapshot;
const usage = (sessionId: string, contextWindow?: number): TokenCostUpdate => ({
  sessionId,
  ...(contextWindow === undefined ? {} : { contextWindow }),
});

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

describe("draftEstimate", () => {
  const base = {
    sessionId: "s1",
    text: "x".repeat(400),
    snapshot: snapshot("s1", 8_000),
    usage: usage("s1", 64_000),
    attachments: 0,
  };

  it("shows nothing for an empty draft or without a session", () => {
    expect(draftEstimate({ ...base, text: "" })).toBeNull();
    expect(draftEstimate({ ...base, text: "  \n " })).toBeNull();
    expect(draftEstimate({ ...base, sessionId: null })).toBeNull();
  });

  it("adds Core's per-message overhead and the server's context to a share of the window", () => {
    expect(draftEstimate(base)).toEqual({
      draftTokens: 104,
      contextTokens: 8_000,
      contextSource: "transcript",
      threshold: null,
      reachesThreshold: false,
      window: 64_000,
      afterPercent: 13,
      attachments: 0,
    });
  });

  it("uses the server's live prompt estimate and its own compaction threshold", () => {
    const live = (tokens: number) => ({
      ...snapshot("s1", tokens),
      reported: { thresholdTokens: 44_800 },
    });
    expect(draftEstimate({ ...base, snapshot: live(9_000) })).toMatchObject({
      contextSource: "prompt",
      threshold: 44_800,
      reachesThreshold: false,
    });
    expect(
      draftEstimate({ ...base, snapshot: live(44_700) })?.reachesThreshold,
    ).toBe(true);
    // Without a report there is no threshold to warn against: no guessed ratio.
    expect(
      draftEstimate({ ...base, snapshot: snapshot("s1", 63_000) }),
    ).toMatchObject({
      threshold: null,
      reachesThreshold: false,
      afterPercent: 99,
    });
  });

  it("never borrows another session's context or window", () => {
    expect(
      draftEstimate({
        ...base,
        snapshot: snapshot("s2", 8_000),
        usage: usage("s2", 64_000),
      }),
    ).toMatchObject({
      contextTokens: null,
      contextSource: null,
      window: null,
      afterPercent: null,
    });
  });

  it("says what it does not know instead of guessing", () => {
    expect(
      draftEstimate({ ...base, snapshot: null, usage: usage("s1") }),
    ).toMatchObject({
      draftTokens: 104,
      contextTokens: null,
      window: null,
      afterPercent: null,
    });
    expect(draftEstimate({ ...base, attachments: 2 })?.attachments).toBe(2);
  });

  it("caps the share at the whole window", () => {
    expect(
      draftEstimate({ ...base, snapshot: snapshot("s1", 70_000) })
        ?.afterPercent,
    ).toBe(100);
  });
});
