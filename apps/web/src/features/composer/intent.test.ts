import { describe, expect, it } from "vitest";
import { CORE_UI_METHODS } from "@octos-org/octoscode-client";
import { resolveComposerIntent } from "./intent.ts";

const activityCapabilities = {
  version: {
    protocol: "octos-ui/v1alpha1",
    schema_version: 1,
    jsonrpc: "2.0",
  },
  capabilities_schema_version: 2,
  supported_methods: ["task/list"],
  supported_notifications: [],
};

describe("resolveComposerIntent", () => {
  it("keeps ordinary input as a prompt", () => {
    expect(resolveComposerIntent("  explain this diff  ")).toEqual({
      kind: "prompt",
      text: "explain this diff",
    });
  });

  it("keeps absolute paths as prompts like octoscode", () => {
    expect(
      resolveComposerIntent("/Users/me/project/src/main.rs is broken"),
    ).toEqual({
      kind: "prompt",
      text: "/Users/me/project/src/main.rs is broken",
    });
  });

  it.each(["/stop", "/interrupt", "/esc"])(
    "maps %s to the same interrupt intent",
    (input) => {
      expect(
        resolveComposerIntent(input, {
          ...activityCapabilities,
          supported_methods: [CORE_UI_METHODS.TURN_INTERRUPT],
        }),
      ).toEqual({ kind: "interrupt" });
    },
  );

  it("fails closed for stop when turn/interrupt is not advertised", () => {
    expect(resolveComposerIntent("/stop", activityCapabilities)).toEqual({
      kind: "unsupported-command",
      command: "stop",
    });
  });

  it("dispatches help locally", () => {
    expect(resolveComposerIntent("/commands")).toEqual({ kind: "help" });
  });

  it("resolves the implemented local status commands", () => {
    expect(resolveComposerIntent("/tasks")).toEqual({
      kind: "process-status",
    });
    expect(resolveComposerIntent("/copy")).toEqual({ kind: "copy" });
    expect(resolveComposerIntent("/status")).toEqual({ kind: "status" });
  });

  it("fails closed for commands that this build cannot execute", () => {
    expect(resolveComposerIntent("/resume old-session")).toEqual({
      kind: "unsupported-command",
      command: "resume",
    });
    expect(resolveComposerIntent("/activity", activityCapabilities)).toEqual({
      kind: "unsupported-command",
      command: "activity",
    });
    expect(resolveComposerIntent("!git status")).toEqual({
      kind: "local-shell-unavailable",
    });
  });
});
