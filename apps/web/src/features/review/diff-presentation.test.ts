import { describe, expect, it, vi } from "vitest";
import type { DiffPreviewLine } from "@octos-org/octoscode-client";
import { highlightToTokens } from "../markdown/highlight.ts";
import {
  canDecorateDiff,
  decorateDiffHunk,
  diffKind,
  diffLanguage,
} from "./diff-presentation.ts";

const line = (kind: string, content: string): DiffPreviewLine => ({
  kind,
  content,
});
const changed = (tokens: ReturnType<typeof decorateDiffHunk>[number]) =>
  tokens
    .filter((token) => token.changed)
    .map((token) => token.content)
    .join("");

describe("diff presentation", () => {
  it("isolates multiple changed words and preserves exact Unicode and whitespace", () => {
    const lines = [
      line("removed", '\tconst 名称 = "旧值😀"; return false;  '),
      line("added", '\tconst 名称 = "新值🌏"; return true;  '),
    ];
    const decorated = decorateDiffHunk(lines, undefined);
    expect(changed(decorated[0]!)).toBe("旧值😀false");
    expect(changed(decorated[1]!)).toBe("新值🌏true");
    expect(
      decorated.map((tokens) => tokens.map((token) => token.content).join("")),
    ).toEqual(lines.map((entry) => entry.content));
  });

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

  it("keeps insert/delete aliases and unknown kinds consistent", () => {
    expect(diffKind("inserted")).toBe("added");
    expect(diffKind("delete")).toBe("removed");
    expect(diffKind("future-kind")).toBe("context");
    const result = decorateDiffHunk(
      [
        line("deleted", "const ready = false;"),
        line("insert", "const ready = true;"),
      ],
      undefined,
    );
    expect(changed(result[0]!)).toBe("false");
    expect(changed(result[1]!)).toBe("true");
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

  it("infers only the filename suffix and treats unknown languages as plain text", () => {
    expect(diffLanguage("src/APP.TSX")).toBe("tsx");
    expect(diffLanguage("C:\\repo\\code.py")).toBe("py");
    expect(diffLanguage(".bashrc")).toBe("sh");
    expect(diffLanguage("README")).toBeUndefined();
    expect(diffLanguage("parent.ts/README")).toBeUndefined();
  });
});
