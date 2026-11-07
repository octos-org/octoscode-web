import { CORE_UI_FEATURES, CORE_UI_METHODS } from "@octos-org/octoscode-client";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client/protocol";
import { describe, expect, it } from "vitest";
import { resolveComposerIntent } from "./intent.ts";

// `resolveComposerIntent` is the one gate between what the user typed and
// `turn/start`. By design (docs/tui-command-coverage.md, "Implemented native
// contracts and remaining syntax limits"), ordinary text reaches the model as
// typed, and an unknown, unadvertised or malformed command fails closed instead
// of becoming model input. Before widening a command, check that its row below
// still fails closed when the server does not advertise the method or feature.

function capabilities(
  methods: string[],
  features: string[] = [],
): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: methods,
    supported_notifications: [],
    supported_features: features,
  };
}

const interrupt = capabilities([CORE_UI_METHODS.TURN_INTERRUPT]);
const autonomy = capabilities(
  [
    CORE_UI_METHODS.SESSION_GOAL_GET,
    CORE_UI_METHODS.LOOP_LIST,
    CORE_UI_METHODS.MONITOR_LIST,
    CORE_UI_METHODS.AGENT_LIST,
  ],
  [
    CORE_UI_FEATURES.CODING_AUTONOMY_V1,
    CORE_UI_FEATURES.CODING_GOAL_RUNTIME_V1,
    CORE_UI_FEATURES.CODING_LOOP_RUNTIME_V1,
    CORE_UI_FEATURES.CODING_MONITOR_RUNTIME_V1,
    CORE_UI_FEATURES.CODING_AGENT_CONTROL_V1,
  ],
);
const resume = capabilities(
  ["session/list", "session/open", "session/hydrate"],
  [CORE_UI_FEATURES.SESSION_WORKSPACE_CWD_V1],
);
const inspection = capabilities(
  [CORE_UI_METHODS.SESSION_BTW, CORE_UI_METHODS.TURN_STATE_GET],
  [CORE_UI_FEATURES.TURN_STATE_GET_V1],
);
const peers = capabilities(["peer/gather"]);

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

  it.each<[string, UiProtocolCapabilities | undefined, unknown]>([
    ["/stop", interrupt, { kind: "interrupt" }],
    ["/goal", autonomy, { kind: "autonomy" }],
    // Arguments only filter the local list; they never open a Session.
    [
      "/resume coding:local:old",
      resume,
      { kind: "resume", query: "coding:local:old" },
    ],
    [
      "/aside  explain this choice  ",
      inspection,
      { kind: "btw", question: "explain this choice" },
    ],
    ["/lang zh_CN.UTF-8", undefined, { kind: "set-language", value: "zh" }],
    ["/peer clear", undefined, { kind: "peers", clear: true }],
  ])("opens %s when the server advertises it", (input, caps, intent) => {
    expect(resolveComposerIntent(input, caps)).toEqual(intent);
  });

  it.each<[string, UiProtocolCapabilities | undefined]>([
    ["/stop", capabilities(["task/list"])],
    ["/goal", { ...autonomy, supported_features: [] }],
    ["/goal clear", autonomy],
    ["/monitors", autonomy],
    ["/resume old", { ...resume, supported_features: [] }],
    [
      "/resume old",
      capabilities(
        ["session/list", "session/hydrate"],
        [CORE_UI_FEATURES.SESSION_WORKSPACE_CWD_V1],
      ),
    ],
    ["/btw explain this choice", undefined],
    ["/turn state wrong", inspection],
    ["/mcp", undefined],
    ["/mcp disable server-a", capabilities(["mcp/status/list"])],
    ["/thinking unbounded", capabilities([CORE_UI_METHODS.TURN_START])],
    ["/images /private/path", capabilities([CORE_UI_METHODS.TURN_START])],
    ["/lang fr", undefined],
    ["/steer override everything", undefined],
    ["/gather ../other", peers],
    ["/peer clear extra", peers],
  ])("fails closed for %s instead of sending it as a prompt", (input, caps) => {
    expect(resolveComposerIntent(input, caps).kind).toBe("unsupported-command");
  });
});

describe("local-shell bang fail-closed receipt", () => {
  // The native TUI runs a leading `!` on the local machine. A browser cannot,
  // so every variant must resolve to the typed receipt and never reach the
  // model as ordinary text — including CJK-width and whitespace-prefixed forms.
  it.each([
    "!git status",
    "!  ls -la",
    " \t!git status",
    "　!pwd",
    "！git status",
    "︕git status",
    "﹗git status",
    "　！pwd",
    "​!git status",
    "​！git status",
  ])("resolves %s to a local-shell-unavailable receipt", (input) => {
    expect(resolveComposerIntent(input)).toEqual({
      kind: "local-shell-unavailable",
    });
  });

  it("never echoes the shell command in the receipt", () => {
    const receipt = resolveComposerIntent("！rm -rf /srv/secret-token-abc");
    expect(receipt).toEqual({ kind: "local-shell-unavailable" });
    const rendered = JSON.stringify(receipt);
    expect(rendered).not.toContain("rm -rf");
    expect(rendered).not.toContain("secret-token-abc");
  });
});
