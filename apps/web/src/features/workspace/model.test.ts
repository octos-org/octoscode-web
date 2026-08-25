import { describe, expect, it } from "vitest";
import {
  formatFileSize,
  includeActiveSession,
  mergeTokenCost,
  sessionLabel,
  sortSessions,
} from "./model.ts";

describe("workspace product model", () => {
  it("sorts sessions by authoritative recency", () => {
    const sessions = sortSessions([
      { id: "old", message_count: 1, updated_at: "2026-08-20T00:00:00Z" },
      { id: "new", message_count: 2, updated_at: "2026-08-26T00:00:00Z" },
    ]);
    expect(sessions.map((session) => session.id)).toEqual(["new", "old"]);
  });

  it("prefers title, then prompt, then id", () => {
    expect(sessionLabel({ id: "s1", message_count: 1, title: "Named" })).toBe(
      "Named",
    );
    expect(
      sessionLabel({ id: "s1", message_count: 1, last_prompt: "Prompt" }),
    ).toBe("Prompt");
    expect(sessionLabel({ id: "s1", message_count: 1 })).toBe("s1");
    expect(formatFileSize(12_400)).toBe("12.4 KB");
  });

  it("keeps a newly opened empty session visible before its first prompt", () => {
    expect(
      includeActiveSession(
        [{ id: "coding:local:main", message_count: 2 }],
        "coding:local:new",
      ),
    ).toEqual([
      { id: "coding:local:new", message_count: 0 },
      { id: "coding:local:main", message_count: 2 },
    ]);
  });

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
