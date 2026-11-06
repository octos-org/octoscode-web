import { describe, expect, it } from "vitest";
import {
  collapseAll,
  expandAll,
  initialFoldState,
  isFoldExpanded,
  thinkingSummary,
  thinkingSummaryParts,
  toggleFold,
  toolTarget,
} from "./folds.ts";

describe("transcript fold model", () => {
  it("starts folded, remembers each toggled block, expands exactly the live blocks, and collapses back to folded", () => {
    let folds = initialFoldState();
    expect(isFoldExpanded(folds, "reasoning:turn-1")).toBe(false);
    folds = toggleFold(folds, "tool:call-1");
    expect(isFoldExpanded(folds, "tool:call-1")).toBe(true);
    // Other blocks stay folded.
    expect(isFoldExpanded(folds, "tool:call-2")).toBe(false);
    folds = toggleFold(folds, "tool:call-1");
    expect(isFoldExpanded(folds, "tool:call-1")).toBe(false);

    const expanded = expandAll(toggleFold(folds, "reasoning:turn-1"), [
      "reasoning:turn-1",
      "tool:call-1",
      "tool:call-2",
    ]);
    for (const id of ["reasoning:turn-1", "tool:call-1", "tool:call-2"])
      expect(isFoldExpanded(expanded, id)).toBe(true);
    expect(isFoldExpanded(expanded, "tool:gone")).toBe(false);

    const collapsed = collapseAll(expanded);
    for (const id of ["reasoning:turn-1", "tool:call-1", "tool:call-2"])
      expect(isFoldExpanded(collapsed, id)).toBe(false);
  });
});

describe("thinking one-line summary", () => {
  it("shows duration and word count, timing from the latest delta while streaming, and counts Chinese by characters", () => {
    const words = Array.from({ length: 340 }, () => "word").join(" ");
    expect(
      thinkingSummary({ body: words, startedAtMs: 0, endedAtMs: 12_400 }),
    ).toBe("Thinking · 12 s · 340 words");
    expect(
      thinkingSummary({ body: words, startedAtMs: 1_000, updatedAtMs: 5_600 }),
    ).toBe("Thinking · 5 s · 340 words");
    // No timing captured: the duration is omitted, never shown as 0.
    expect(thinkingSummary({ body: "one two three" })).toBe(
      "Thinking · 3 words",
    );
    // Chinese has no spaces between words: 12 characters plus one Latin
    // word; the comma counts as neither.
    expect(
      thinkingSummaryParts({ body: "先看一下工作区，再读 sales.csv 的数据" }),
    ).toMatchObject({ words: 20, unit: "characters" });
    expect(thinkingSummaryParts({ body: "你好，世界！" })).toMatchObject({
      words: 4,
      unit: "characters",
    });
  });
});

describe("tool call target", () => {
  it("picks the most useful argument and truncates very long ones", () => {
    expect(toolTarget('{"path": "/src/main.rs", "q": 1}')).toBe("/src/main.rs");
    expect(toolTarget('{"file_path": "/a/b.rs"}')).toBe("/a/b.rs");
    expect(toolTarget('{"query": "spinner"}')).toBe("spinner");
    expect(toolTarget('path: "report.md", content: …')).toBe("report.md");
    expect(toolTarget("not json")).toBe("");
    const truncated = toolTarget(
      JSON.stringify({ path: `/${"a".repeat(80)}` }),
    );
    expect(truncated).toHaveLength(25); // 24 chars + ellipsis
    expect(truncated.endsWith("…")).toBe(true);
  });
});
