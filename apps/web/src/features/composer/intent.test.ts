import { describe, expect, it } from "vitest";
import { resolveComposerIntent } from "./intent.ts";

describe("composer text to model input or a local surface", () => {
  it("sends ordinary text and a path-leading line to the model as typed", () => {
    expect(resolveComposerIntent("  explain this diff  ")).toEqual({
      kind: "prompt",
      text: "explain this diff",
    });
    expect(
      resolveComposerIntent("/Users/me/project/src/main.rs is broken"),
    ).toEqual({
      kind: "prompt",
      text: "/Users/me/project/src/main.rs is broken",
    });
  });
});
