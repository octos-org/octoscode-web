import { describe, expect, it } from "vitest";
import { closeOpenFence, prepareStreamingMarkdown } from "./streaming-fence.ts";

describe("closeOpenFence", () => {
  it("closes a fence the model has not closed yet", () => {
    expect(closeOpenFence("Here:\n\n```ts\nconst x = 1;")).toBe(
      "Here:\n\n```ts\nconst x = 1;\n```",
    );
  });

  it("leaves balanced fences alone", () => {
    const text = "```\na\n```\n\nafter";
    expect(closeOpenFence(text)).toBe(text);
  });

  it("leaves text with no fences alone", () => {
    expect(closeOpenFence("just prose")).toBe("just prose");
  });

  it("closes with the character and length the block opened with", () => {
    expect(closeOpenFence("~~~~\ncode")).toBe("~~~~\ncode\n~~~~");
  });

  it("does not treat a different fence character as the closer", () => {
    // Inside a ``` block, a ~~~ line is content, so the block is still open.
    expect(closeOpenFence("```\na\n~~~\nb")).toBe("```\na\n~~~\nb\n```");
  });

  it("recognises a fence indented by up to three spaces", () => {
    expect(closeOpenFence("   ```\nx")).toBe("   ```\nx\n```");
  });

  it("does not add a blank line when the text already ends in a newline", () => {
    expect(closeOpenFence("```\nx\n")).toBe("```\nx\n```");
  });
});

describe("prepareStreamingMarkdown", () => {
  it("hides an unmatched inline marker while preserving completed markers", () => {
    expect(prepareStreamingMarkdown("Working on **Markdown")).toBe(
      "Working on Markdown",
    );
    expect(prepareStreamingMarkdown("Working on **Markdown**")).toBe(
      "Working on **Markdown**",
    );
  });

  it("preserves escaped emphasis instead of rewriting the source", () => {
    expect(prepareStreamingMarkdown("Working on \\*\\*Markdown\\*\\*…")).toBe(
      "Working on \\*\\*Markdown\\*\\*…",
    );
  });

  it("preserves multiline inline code", () => {
    const text = "Code: `first\n2 ** 3`";
    expect(prepareStreamingMarkdown(text)).toBe(text);
  });

  it("preserves indented code while hiding unmatched prose markers", () => {
    expect(
      prepareStreamingMarkdown("Before **draft\n\n    print(2 ** 3)\n"),
    ).toBe("Before draft\n\n    print(2 ** 3)\n");
  });

  it("preserves exponent operators around template strings in indented code", () => {
    expect(
      prepareStreamingMarkdown("    const s = `hello`; let n = 2 ** 3;\n"),
    ).toBe("    const s = `hello`; let n = 2 ** 3;\n");
    expect(
      prepareStreamingMarkdown("    const a = `x`;\n    print(2 ** 3)\n"),
    ).toBe("    const a = `x`;\n    print(2 ** 3)\n");
  });

  it("preserves fenced and inline code while hiding unmatched prose markers", () => {
    expect(
      prepareStreamingMarkdown(
        "Before **draft\n```ts\nprint(2 ** 3)\nconst s = '**not emphasis**';\n```\n`2 ** 3` and **open",
      ),
    ).toBe(
      "Before draft\n```ts\nprint(2 ** 3)\nconst s = '**not emphasis**';\n```\n`2 ** 3` and open",
    );
  });
});
