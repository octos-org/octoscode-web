import { describe, expect, it } from "vitest";
import { closeOpenFence } from "./streaming-fence.ts";

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
