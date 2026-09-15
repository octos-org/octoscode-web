import { describe, expect, it } from "vitest";

describe("peer gather command arguments", () => {
  const caps = {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: ["peer/gather"],
    supported_notifications: [],
  };
  it.each(["/gather", "/gather all", "/gather ALL"])(
    "maps %s to unfiltered synthesis",
    (text) => {
      expect(resolveComposerIntent(text, caps)).toEqual({ kind: "gather" });
    },
  );
  it("preserves named filters and rejects unsupported syntax/capability loss", () => {
    expect(resolveComposerIntent("/gather fix-nav review_2", caps)).toEqual({
      kind: "gather",
      slugs: ["fix-nav", "review_2"],
    });
    expect(resolveComposerIntent("/gather ../other", caps).kind).toBe(
      "unsupported-command",
    );
    expect(resolveComposerIntent("/gather review").kind).toBe(
      "unsupported-command",
    );
  });
});
import { CORE_UI_METHODS, CORE_UI_FEATURES } from "@octos-org/octoscode-client";
import { resolveComposerIntent } from "./intent.ts";

describe("browser-local display commands", () => {
  it.each([
    "/theme",
    "/lang",
    "/language",
    "/vimmode",
    "/vim-mode",
    "/saveconfig",
    "/save-config",
  ])("resolves %s without Core capabilities", (input) => {
    expect(resolveComposerIntent(input).kind).not.toBe("prompt");
    expect(resolveComposerIntent(input).kind).not.toBe("unsupported-command");
  });
  it.each([
    ["/lang zh_CN.UTF-8", "zh"],
    ["/LANG EN_us", "en"],
    ["/language zh", "zh"],
  ])("normalizes native language syntax %s", (input, value) => {
    expect(resolveComposerIntent(input!)).toEqual({
      kind: "set-language",
      value,
    });
  });
  it.each([
    "/lang fr",
    "/theme Claude",
    "/vimmode on",
    "/saveconfig /tmp/config",
  ])("fails closed for unsupported arguments %s", (input) => {
    expect(resolveComposerIntent(input).kind).toBe("unsupported-command");
  });
});

describe("historical candidate command admission", () => {
  const caps = {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: ["session/list", "session/open", "session/hydrate"],
    supported_notifications: [],
    supported_features: [CORE_UI_FEATURES.SESSION_WORKSPACE_CWD_V1],
  };
  it("treats arguments only as a local search filter, never an automatic open", () => {
    expect(resolveComposerIntent("/resume coding:local:old", caps)).toEqual({
      kind: "resume",
      query: "coding:local:old",
    });
    expect(resolveComposerIntent("/resume", caps)).toEqual({
      kind: "resume",
      query: "",
    });
  });
  it("fails closed if identity-aware workspace capability or open method is absent", () => {
    expect(
      resolveComposerIntent("/resume old", { ...caps, supported_features: [] })
        .kind,
    ).toBe("unsupported-command");
    expect(
      resolveComposerIntent("/resume old", {
        ...caps,
        supported_methods: ["session/list", "session/hydrate"],
      }).kind,
    ).toBe("unsupported-command");
  });
});

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

describe("native side questions, inspection, and steering", () => {
  const turnId = "9a658e7c-e0b2-4e54-a0ea-22d6d8c31b29";
  const capabilities = {
    ...activityCapabilities,
    supported_methods: [
      CORE_UI_METHODS.SESSION_BTW,
      CORE_UI_METHODS.THREAD_GRAPH_GET,
      CORE_UI_METHODS.TURN_STATE_GET,
      CORE_UI_METHODS.APPROVAL_SCOPES_LIST,
    ],
    supported_features: [
      CORE_UI_FEATURES.THREAD_GRAPH_V1,
      CORE_UI_FEATURES.TURN_STATE_GET_V1,
    ],
  };
  it("keeps side questions out of turn/start even without its capability", () => {
    expect(
      resolveComposerIntent("/aside  explain this choice  ", capabilities),
    ).toEqual({ kind: "btw", question: "explain this choice" });
    expect(resolveComposerIntent("/btw", capabilities).kind).toBe(
      "unsupported-command",
    );
    expect(resolveComposerIntent("/btw explain this choice").kind).toBe(
      "unsupported-command",
    );
  });
  it("uses exact native thread/turn grammar and a captured active UUID", () => {
    expect(resolveComposerIntent("/thread graph-get", capabilities)).toEqual({
      kind: "threads",
    });
    expect(resolveComposerIntent("/turn", capabilities, turnId)).toEqual({
      kind: "turn",
      turnId,
    });
    expect(
      resolveComposerIntent(
        `/turn state ${turnId.toUpperCase()}`,
        capabilities,
      ),
    ).toEqual({ kind: "turn", turnId });
    for (const input of [
      "/thread graph extra",
      "/turn",
      `/turn ${turnId}`,
      "/turn state wrong",
      `/turn state ${turnId} extra`,
    ])
      expect(resolveComposerIntent(input, capabilities).kind).toBe(
        "unsupported-command",
      );
    expect(
      resolveComposerIntent("/threads", {
        ...capabilities,
        supported_features: [],
      }).kind,
    ).toBe("unsupported-command");
    expect(resolveComposerIntent("/permission", capabilities)).toEqual({
      kind: "approval-scopes",
    });
    expect(resolveComposerIntent("/permissions clear", capabilities).kind).toBe(
      "unsupported-command",
    );
  });
  it("toggles the local opt-in flag without pretending server steering support", () => {
    expect(resolveComposerIntent("/steer")).toEqual({
      kind: "set-steer",
      value: "toggle",
    });
    for (const value of ["on", "true", "enable", "enabled"])
      expect(resolveComposerIntent(`/steer-mid-turn ${value}`)).toEqual({
        kind: "set-steer",
        value: true,
      });
    for (const value of ["off", "false", "disable", "disabled"])
      expect(resolveComposerIntent(`/steermode ${value}`)).toEqual({
        kind: "set-steer",
        value: false,
      });
    expect(resolveComposerIntent("/steer override everything").kind).toBe(
      "unsupported-command",
    );
    expect(resolveComposerIntent("/usage")).toEqual({ kind: "cost" });
  });
});

describe("resolveComposerIntent", () => {
  it("resolves thinking choices before dispatch and rejects unknown values", () => {
    const caps = {
      ...activityCapabilities,
      supported_methods: [CORE_UI_METHODS.TURN_START],
    };
    expect(resolveComposerIntent("/thinking", caps)).toEqual({
      kind: "thinking",
    });
    expect(resolveComposerIntent("/think HIGH", caps)).toEqual({
      kind: "set-thinking",
      value: "high",
    });
    expect(resolveComposerIntent("/thinking reset", caps)).toEqual({
      kind: "set-thinking",
      value: undefined,
    });
    expect(resolveComposerIntent("/thinking unbounded", caps).kind).toBe(
      "unsupported-command",
    );
    expect(resolveComposerIntent("/thinking max").kind).toBe(
      "unsupported-command",
    );
    expect(resolveComposerIntent("/images", caps)).toEqual({ kind: "images" });
    expect(resolveComposerIntent("/images /private/path", caps).kind).toBe(
      "unsupported-command",
    );
  });
  const autonomyCapabilities = {
    ...activityCapabilities,
    supported_methods: [
      CORE_UI_METHODS.SESSION_GOAL_GET,
      CORE_UI_METHODS.LOOP_LIST,
      CORE_UI_METHODS.MONITOR_LIST,
      CORE_UI_METHODS.AGENT_LIST,
    ],
    supported_features: [
      CORE_UI_FEATURES.CODING_AUTONOMY_V1,
      CORE_UI_FEATURES.CODING_GOAL_RUNTIME_V1,
      CORE_UI_FEATURES.CODING_LOOP_RUNTIME_V1,
      CORE_UI_FEATURES.CODING_MONITOR_RUNTIME_V1,
      CORE_UI_FEATURES.CODING_AGENT_CONTROL_V1,
    ],
  };
  it.each(["/goal", "/loop", "/monitor", "/agents", "/agent", " /GOAL \n"])(
    "opens the local autonomy dialog for bare %s",
    (input) => {
      expect(resolveComposerIntent(input, autonomyCapabilities)).toEqual({
        kind: "autonomy",
      });
    },
  );
  it.each([
    "/goal clear",
    "/goal --budget 2M",
    "/loop every 5m check build",
    "/monitor pause monitor-1",
    "/agents list",
    "/agent output peer-1",
  ])("rejects unsupported arguments before dispatch: %s", (input) => {
    const intent = resolveComposerIntent(input, autonomyCapabilities);
    expect(intent).toMatchObject({
      kind: "unsupported-command",
      reason: expect.stringContaining("Nothing was sent to the model"),
    });
    expect(resolveComposerIntent(input)).toMatchObject({
      kind: "unsupported-command",
    });
  });
  it.each(["/goal", "/loop", "/monitor", "/agents", "/agent"])(
    "fails closed for %s after method or feature withdrawal",
    (input) => {
      expect(resolveComposerIntent(input)).toMatchObject({
        kind: "unsupported-command",
      });
      expect(
        resolveComposerIntent(input, {
          ...autonomyCapabilities,
          supported_methods: [],
        }),
      ).toMatchObject({ kind: "unsupported-command" });
      expect(
        resolveComposerIntent(input, {
          ...autonomyCapabilities,
          supported_features: [],
        }),
      ).toMatchObject({ kind: "unsupported-command" });
    },
  );
  it("does not turn invented autonomy aliases or command names into prompts", () => {
    expect(
      resolveComposerIntent("/monitors", autonomyCapabilities),
    ).toMatchObject({ kind: "unsupported-command" });
    expect(
      resolveComposerIntent("/autonomy", autonomyCapabilities),
    ).toMatchObject({ kind: "unsupported-command" });
  });
  it("opens context and inventory aliases only with advertised methods", () => {
    const caps = {
      ...activityCapabilities,
      supported_methods: [
        "session/compact",
        "tool/status/list",
        "mcp/status/list",
      ],
    };
    for (const alias of ["/context", "/ctx", "/compact", "/compress"]) {
      expect(resolveComposerIntent(alias, caps)).toEqual({ kind: "context" });
    }
    expect(resolveComposerIntent("/tools", caps)).toEqual({ kind: "tools" });
    expect(resolveComposerIntent("/mcp", caps)).toEqual({ kind: "mcp" });
    expect(resolveComposerIntent("/mcp")).toEqual({
      kind: "unsupported-command",
      command: "mcp",
    });
    expect(resolveComposerIntent("/mcp disable server-a", caps)).toMatchObject({
      kind: "unsupported-command",
      command: "mcp",
    });
    expect(resolveComposerIntent("/context heuristic", caps)).toMatchObject({
      kind: "unsupported-command",
      command: "context",
    });
  });
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
    expect(resolveComposerIntent("!git status")).toEqual({
      kind: "local-shell-unavailable",
    });
  });
  it("opens real product surfaces without sending command prose", () => {
    expect(resolveComposerIntent("/act", activityCapabilities)).toEqual({
      kind: "activity",
    });
    expect(resolveComposerIntent("/ss")).toEqual({ kind: "sessions" });
    expect(
      resolveComposerIntent("/model", {
        ...activityCapabilities,
        supported_methods: ["profile/llm/list"],
      }),
    ).toEqual({ kind: "models" });
    expect(resolveComposerIntent("/activity")).toEqual({ kind: "activity" });
    expect(resolveComposerIntent("/model")).toEqual({
      kind: "unsupported-command",
      command: "model",
    });
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
    "\u3000!pwd",
    "\uFF01git status",
    "\uFE15git status",
    "\uFE57git status",
    "\u3000\uFF01pwd",
    "\u200B!git status",
    "\u200B\uFF01git status",
  ])("resolves %s to a local-shell-unavailable receipt", (input) => {
    expect(resolveComposerIntent(input)).toEqual({
      kind: "local-shell-unavailable",
    });
  });

  it("never echoes the shell command in the receipt", () => {
    const receipt = resolveComposerIntent("\uFF01rm -rf /srv/secret-token-abc");
    expect(receipt).toEqual({ kind: "local-shell-unavailable" });
    const rendered = JSON.stringify(receipt);
    expect(rendered).not.toContain("rm -rf");
    expect(rendered).not.toContain("secret-token-abc");
  });
});

describe("/peer clear composer intent (reference-TUI parity 2500 §2)", () => {
  const peerCaps = {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: ["peer/gather"],
    supported_notifications: [],
    supported_features: [],
  };
  const prepareCaps = { ...peerCaps, supported_methods: ["peer/prepare"] };
  it("maps `/peer clear` to the roster prune", () => {
    expect(resolveComposerIntent("/peer clear", peerCaps)).toEqual({
      kind: "peers",
      clear: true,
    });
    expect(resolveComposerIntent("/peer clear")).toEqual({
      kind: "peers",
      clear: true,
    });
    expect(resolveComposerIntent("/peer  clear ", peerCaps)).toEqual({
      kind: "peers",
      clear: true,
    });
  });
  it("stays reachable without the peer/prepare capability (before the gate)", () => {
    const intent = resolveComposerIntent("/peer clear", peerCaps);
    expect(intent.kind).not.toBe("unsupported-command");
    expect(intent.kind).not.toBe("prompt");
  });
  it("does not swallow other `/peer …` verbs", () => {
    expect(resolveComposerIntent("/peer clear extra", peerCaps).kind).toBe(
      "unsupported-command",
    );
    expect(resolveComposerIntent("/peer somebody", peerCaps).kind).toBe(
      "unsupported-command",
    );
  });
  it("keeps bare `/peer` opening the dialog without a clear flag", () => {
    expect(resolveComposerIntent("/peer", prepareCaps)).toEqual({
      kind: "peers",
    });
  });
});
