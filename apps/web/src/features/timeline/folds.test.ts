import { describe, expect, it } from "vitest";
import {
  collapseAll,
  expandAll,
  initialFoldState,
  isFoldExpanded,
  pruneFolds,
  thinkingSummary,
  thinkingSummaryParts,
  toggleFold,
  toolHeaderLine,
  toolStatusGlyph,
  toolTarget,
} from "./folds.ts";

describe("transcript fold model", () => {
  it("starts with every foldable block folded", () => {
    const folds = initialFoldState();
    expect(isFoldExpanded(folds, "reasoning:turn-1")).toBe(false);
    expect(isFoldExpanded(folds, "tool:call-1")).toBe(false);
  });

  it("toggles one block and remembers it while the session stays open", () => {
    let folds = initialFoldState();
    folds = toggleFold(folds, "tool:call-1");
    expect(isFoldExpanded(folds, "tool:call-1")).toBe(true);
    folds = toggleFold(folds, "tool:call-1");
    expect(isFoldExpanded(folds, "tool:call-1")).toBe(false);
    // Other blocks stay folded.
    expect(isFoldExpanded(folds, "tool:call-2")).toBe(false);
  });

  it("expandAll expands exactly the live foldable ids", () => {
    let folds = initialFoldState();
    folds = toggleFold(folds, "reasoning:turn-1");
    const next = expandAll(folds, [
      "reasoning:turn-1",
      "tool:call-1",
      "tool:call-2",
    ]);
    expect(isFoldExpanded(next, "reasoning:turn-1")).toBe(true);
    expect(isFoldExpanded(next, "tool:call-1")).toBe(true);
    expect(isFoldExpanded(next, "tool:call-2")).toBe(true);
    expect(isFoldExpanded(next, "tool:gone")).toBe(false);
  });

  it("collapseAll returns to the all-folded default and forgets memory", () => {
    let folds = expandAll(initialFoldState(), ["tool:call-1", "tool:call-2"]);
    folds = collapseAll(folds);
    expect(isFoldExpanded(folds, "tool:call-1")).toBe(false);
    expect(isFoldExpanded(folds, "tool:call-2")).toBe(false);
    expect(folds).toEqual({});
  });

  it("pruneFolds drops memory for blocks no longer in the transcript", () => {
    let folds = expandAll(initialFoldState(), ["tool:a", "tool:b"]);
    folds = pruneFolds(folds, ["tool:b", "tool:c"]);
    expect(isFoldExpanded(folds, "tool:a")).toBe(false);
    expect(isFoldExpanded(folds, "tool:b")).toBe(true);
    expect(isFoldExpanded(folds, "tool:c")).toBe(false);
  });
});

describe("thinking one-line summary", () => {
  const words = Array.from({ length: 340 }, () => "word").join(" ");

  it("summarizes a settled thinking block with duration and word count", () => {
    expect(
      thinkingSummary({
        body: words,
        startedAtMs: 0,
        endedAtMs: 12_400,
      }),
    ).toBe("Thinking · 12 s · 340 words");
  });

  it("uses the latest delta time while the block is still streaming", () => {
    expect(
      thinkingSummary({
        body: words,
        startedAtMs: 1_000,
        updatedAtMs: 5_600,
      }),
    ).toBe("Thinking · 5 s · 340 words");
  });

  it("omits the duration when timing was never captured", () => {
    expect(thinkingSummary({ body: "one two three" })).toBe(
      "Thinking · 3 words",
    );
  });

  it("exposes parts so localized copy can interpolate them", () => {
    expect(
      thinkingSummaryParts({
        body: words,
        startedAtMs: 0,
        endedAtMs: 12_400,
      }),
    ).toEqual({ seconds: 12, words: 340 });
  });
});

describe("tool call header line", () => {
  it("joins name, target, status icon and duration in order", () => {
    expect(
      toolHeaderLine({
        title: "shell",
        body: '{"cmd": "cargo test", "cwd": "/repo"}',
        status: "complete",
        startedAtMs: 0,
        endedAtMs: 3_400,
      }),
    ).toBe("shell · cargo test · ✓ · 3 s");
  });

  it("keeps errors visible in the header line", () => {
    const line = toolHeaderLine({
      title: "shell",
      body: '{"cmd": "rm -rf /"}',
      status: "error",
      startedAtMs: 0,
      endedAtMs: 2_200,
    });
    expect(line).toContain("✗");
    expect(line).toContain("shell · rm -rf /");
  });

  it("maps every status to a stable single glyph", () => {
    expect(toolStatusGlyph("running")).toBe("◐");
    expect(toolStatusGlyph("complete")).toBe("✓");
    expect(toolStatusGlyph("error")).toBe("✗");
    expect(toolStatusGlyph("info")).toBe("·");
  });

  it("extracts the most useful argument as the target", () => {
    expect(toolTarget('{"path": "/src/main.rs", "q": 1}')).toBe("/src/main.rs");
    expect(toolTarget('{"file_path": "/a/b.rs"}')).toBe("/a/b.rs");
    expect(toolTarget('{"query": "spinner"}')).toBe("spinner");
    expect(toolTarget("not json")).toBe("");
  });

  it("truncates very long targets", () => {
    const long = `/${"a".repeat(80)}`;
    const truncated = toolTarget(JSON.stringify({ path: long }));
    expect(truncated).toHaveLength(25); // 24 chars + ellipsis
    expect(truncated.endsWith("…")).toBe(true);
  });
});
