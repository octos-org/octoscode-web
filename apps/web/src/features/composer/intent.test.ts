import { describe, expect, it } from "vitest";
import { resolveComposerIntent } from "./intent.ts";

describe("resolveComposerIntent", () => {
  it("keeps ordinary input as a prompt", () => {
    expect(resolveComposerIntent("  explain this diff  ")).toEqual({
      kind: "prompt",
      text: "explain this diff",
    });
  });

  it.each(["/stop", "/interrupt", "/esc"])(
    "maps %s to the same interrupt intent",
    (input) => {
      expect(resolveComposerIntent(input)).toEqual({ kind: "interrupt" });
    },
  );

  it("dispatches help locally", () => {
    expect(resolveComposerIntent("/commands")).toEqual({ kind: "help" });
  });

  it("fails closed for commands that this build cannot execute", () => {
    expect(resolveComposerIntent("/resume old-session")).toEqual({
      kind: "unsupported-command",
      command: "resume",
    });
    expect(resolveComposerIntent("!git status")).toEqual({
      kind: "local-shell-unavailable",
    });
  });
});
