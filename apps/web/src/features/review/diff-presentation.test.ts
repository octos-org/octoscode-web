import { describe, expect, it, vi } from "vitest";
import type { DiffPreviewLine } from "@octos-org/octoscode-client";
import { highlightToTokens } from "../markdown/highlight.ts";
import { canDecorateDiff, decorateDiffHunk } from "./diff-presentation.ts";

const line = (kind: string, content: string): DiffPreviewLine => ({
  kind,
  content,
});

describe("diff presentation", () => {
  it("does not pair unequal blocks or cross context boundaries", () => {
    for (const lines of [
      [
        line("removed", "return oldName;"),
        line("added", "return newName;"),
        line("added", "return extra;"),
      ],
      [
        line("removed", "return oldName;"),
        line("context", "// break"),
        line("added", "return newName;"),
      ],
      [
        line("removed", "old unrelated text"),
        line("added", "another replacement"),
      ],
    ]) {
      expect(
        decorateDiffHunk(lines, undefined)
          .flat()
          .every((token) => !token.changed),
      ).toBe(true);
    }
  });

  it("bounds both total preview work and quadratic word comparison", () => {
    const files = (lines: DiffPreviewLine[]) => [
      {
        path: "large.ts",
        status: "modified",
        hunks: [{ header: "@@", lines }],
      },
    ];
    expect(
      canDecorateDiff(
        files(Array.from({ length: 400 }, () => line("added", "a"))),
      ),
    ).toBe(true);
    expect(
      canDecorateDiff(
        files(Array.from({ length: 401 }, () => line("added", "a"))),
      ),
    ).toBe(false);
    expect(canDecorateDiff(files([line("added", "a".repeat(2_001))]))).toBe(
      false,
    );
    expect(
      canDecorateDiff(
        files(
          Array.from({ length: 40 }, () => line("added", "a".repeat(1_001))),
        ),
      ),
    ).toBe(false);
    const lines = [
      line("removed", `${"a + ".repeat(100)}before`),
      line("added", `${"a + ".repeat(100)}after`),
    ];
    expect(
      decorateDiffHunk(lines, undefined)
        .flat()
        .every((token) => !token.changed),
    ).toBe(true);
  });

  it("uses the existing lazy grammar and preserves multiline context on each side", async () => {
    await vi.waitFor(() =>
      expect(highlightToTokens("const ready = true;", "ts")).toBeDefined(),
    );
    const lines = [
      line("context", "/* starts here"),
      line("removed", "old comment"),
      line("added", "new comment"),
      line("context", "ends here */"),
      line("added", "const ready = true;"),
    ];
    const decorated = decorateDiffHunk(lines, "ts");
    expect(
      decorated[1]!.every((token) =>
        token.className.includes("shiki-color-comment"),
      ),
    ).toBe(true);
    expect(
      decorated[2]!.every((token) =>
        token.className.includes("shiki-color-comment"),
      ),
    ).toBe(true);
    expect(
      decorated[4]!.some((token) =>
        token.className.includes("shiki-color-keyword"),
      ),
    ).toBe(true);
  });

  it("never interprets source as markup or drops embedded line endings", async () => {
    await vi.waitFor(() =>
      expect(highlightToTokens("const ready = true;", "ts")).toBeDefined(),
    );
    const contents = [
      'const html = "<img src=x onerror=alert(1)>";',
      "a\r\nb",
      "\t",
      "",
      "e\u0301😀\u2028end",
      "a\rb",
    ];
    const lines = contents.map((content) => line("added", content));
    const tokens = decorateDiffHunk(lines, "ts");
    expect(
      tokens.map((row) => row.map((token) => token.content).join("")),
    ).toEqual(contents);
    expect(
      tokens
        .flat()
        .every((token) =>
          /^$|^shiki-[a-z-]+(?: shiki-[a-z-]+)*$/.test(token.className),
        ),
    ).toBe(true);
    expect(
      highlightToTokens("<script>alert(1)</script>", "unknown"),
    ).toBeUndefined();
  });
});
