import { describe, expect, it } from "vitest";
import {
  CORE_UI_METHODS,
  CORE_UI_FEATURES,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  commandAvailability,
  commandSuggestions,
  findCommand,
  KEYBOARD_PARITY_SHORTCUTS,
  looksLikeSlashCommand,
  matchKeyboardParityShortcut,
  parseCommandInvocation,
  WEB_COMMANDS,
} from "./registry.ts";

const capabilities = (
  methods: string[],
  features: string[] = [],
): UiProtocolCapabilities => ({
  version: {
    protocol: "octos-ui/v1alpha1",
    schema_version: 1,
    jsonrpc: "2.0",
  },
  capabilities_schema_version: 2,
  supported_methods: methods,
  supported_notifications: [],
  supported_features: features,
});

describe("octoscode command registry slice", () => {
  const autonomy = [
    {
      name: "agents",
      method: CORE_UI_METHODS.AGENT_LIST,
      feature: CORE_UI_FEATURES.CODING_AGENT_CONTROL_V1,
    },
    {
      name: "goal",
      method: CORE_UI_METHODS.SESSION_GOAL_GET,
      feature: CORE_UI_FEATURES.CODING_GOAL_RUNTIME_V1,
    },
    {
      name: "loop",
      method: CORE_UI_METHODS.LOOP_LIST,
      feature: CORE_UI_FEATURES.CODING_LOOP_RUNTIME_V1,
    },
    {
      name: "monitor",
      method: CORE_UI_METHODS.MONITOR_LIST,
      feature: CORE_UI_FEATURES.CODING_MONITOR_RUNTIME_V1,
    },
  ];
  it.each(autonomy)(
    "gates /$name on its method, family feature, and autonomy negotiation",
    ({ name, method, feature }) => {
      const command = findCommand(name)!;
      const features = [CORE_UI_FEATURES.CODING_AUTONOMY_V1, feature];
      expect(commandAvailability(command).available).toBe(false);
      expect(
        commandAvailability(command, capabilities([], features)).available,
      ).toBe(false);
      expect(
        commandAvailability(command, capabilities([method], [feature]))
          .available,
      ).toBe(false);
      expect(
        commandAvailability(
          command,
          capabilities([method], [CORE_UI_FEATURES.CODING_AUTONOMY_V1]),
        ).available,
      ).toBe(false);
      expect(
        commandAvailability(command, capabilities([method], features))
          .available,
      ).toBe(true);
      expect(
        commandSuggestions(`/${name}`, capabilities([method], features)).map(
          (spec) => spec.name,
        ),
      ).toContain(name);
      expect(
        commandSuggestions(`/${name}`, capabilities([method], [])).map(
          (spec) => spec.name,
        ),
      ).not.toContain(name);
      expect(
        commandAvailability(command, {
          ...capabilities([method], features),
          unsupported: [{ method, reason: "withdrawn" }],
        }).available,
      ).toBe(false);
    },
  );
  it("preserves only the verified native agent alias", () => {
    expect(findCommand("agent")?.name).toBe("agents");
    expect(findCommand("goal")?.aliases).toEqual([]);
    expect(findCommand("loop")?.aliases).toEqual([]);
    expect(findCommand("monitor")?.aliases).toEqual([]);
    expect(findCommand("monitors")).toBeUndefined();
  });
  it("allows advertised create forms and hides commands with no usable panel section", () => {
    expect(
      commandAvailability(
        findCommand("loop")!,
        capabilities(
          [CORE_UI_METHODS.LOOP_CREATE],
          [
            CORE_UI_FEATURES.CODING_AUTONOMY_V1,
            CORE_UI_FEATURES.CODING_LOOP_RUNTIME_V1,
          ],
        ),
      ).available,
    ).toBe(true);
    expect(
      commandAvailability(
        findCommand("monitor")!,
        capabilities(
          [CORE_UI_METHODS.MONITOR_CREATE],
          [
            CORE_UI_FEATURES.CODING_AUTONOMY_V1,
            CORE_UI_FEATURES.CODING_MONITOR_RUNTIME_V1,
          ],
        ),
      ).available,
    ).toBe(true);
    expect(
      commandAvailability(
        findCommand("agents")!,
        capabilities(
          [CORE_UI_METHODS.AGENT_OUTPUT_READ],
          [
            CORE_UI_FEATURES.CODING_AUTONOMY_V1,
            CORE_UI_FEATURES.CODING_AGENT_CONTROL_V1,
          ],
        ),
      ).available,
    ).toBe(false);
  });
  it("preserves path-leading prompts instead of dropping them as commands", () => {
    expect(looksLikeSlashCommand("/Users/me/file.rs is broken")).toBe(false);
    expect(looksLikeSlashCommand("/src\\main.rs is broken")).toBe(false);
    expect(parseCommandInvocation("/Users/me/file.rs is broken")).toBeNull();
  });

  it("resolves canonical names and aliases", () => {
    expect(findCommand("/tasks")?.name).toBe("ps");
    expect(findCommand("esc")?.name).toBe("stop");
    expect(parseCommandInvocation("  /help theme")).toEqual({
      name: "help",
      args: "theme",
    });
  });

  it("only suggests implemented commands", () => {
    expect(
      commandSuggestions("/", capabilities([])).map(({ name }) => name),
    ).toEqual([
      "theme",
      "lang",
      "vimmode",
      "saveconfig",
      "steer",
      "ps",
      "help",
      "activity",
      "copy",
      "status",
      "cost",
      "sessions",
    ]);
    expect(
      commandSuggestions("/st", capabilities([])).map(({ name }) => name),
    ).toEqual(["steer", "status"]);
    expect(
      commandSuggestions(
        "/st",
        capabilities([CORE_UI_METHODS.TURN_INTERRUPT]),
      ).map(({ name }) => name),
    ).toEqual(["steer", "stop", "status"]);
  });

  it("does not advertise stop without the server interrupt method", () => {
    const stop = findCommand("stop");
    expect(stop).toBeDefined();
    expect(commandAvailability(stop!, capabilities([]))).toMatchObject({
      available: false,
      reason: `Server lacks ${CORE_UI_METHODS.TURN_INTERRUPT}`,
    });
    expect(
      commandAvailability(stop!, capabilities([CORE_UI_METHODS.TURN_INTERRUPT]))
        .available,
    ).toBe(true);
  });

  it("requires all resume methods and workspace capability before browsing candidates", () => {
    const resume = WEB_COMMANDS.find(({ name }) => name === "resume");
    expect(resume).toBeDefined();
    const implementedResume = { ...resume!, implemented: true };

    expect(
      commandAvailability(implementedResume, capabilities(["session/list"]))
        .available,
    ).toBe(false);
    expect(
      commandAvailability(
        implementedResume,
        capabilities(["session/list", "session/hydrate"]),
      ).available,
    ).toBe(false);
    expect(
      commandAvailability(
        implementedResume,
        capabilities(
          ["session/list", "session/open", "session/hydrate"],
          [CORE_UI_FEATURES.SESSION_WORKSPACE_CWD_V1],
        ),
      ).available,
    ).toBe(true);
  });
});

// TUI-only canonical names: the browser cannot run them, so each must be an
// explicit fail-closed entry rather than an unknown, while genuine unknowns and
// the server-negotiated Web-only names keep their existing behavior.
const TUI_ONLY_COMMANDS: Array<[string, string[]]> = [
  ["exit", ["quit"]],
  ["onboard", ["setup", "wizard"]],
  ["login", ["auth"]],
  ["add-model", ["provider", "providers", "add_model"]],
  ["profiles", ["profile"]],
  ["dock", ["ag"]],
  ["scrollmode", ["scroll-mode"]],
  ["statusline", ["status-line"]],
  ["title", []],
  ["keymap", ["keys"]],
  ["task", []],
];

describe("TUI-only commands fail closed in the browser", () => {
  it.each(TUI_ONLY_COMMANDS)(
    "resolves /%s and its aliases to an explicit browser-unavailable entry",
    (name, aliases) => {
      const command = findCommand(name);
      expect(command).toBeDefined();
      expect(command!.name).toBe(name);
      expect(command!.implemented).toBe(false);
      const availability = commandAvailability(command!);
      expect(availability.available).toBe(false);
      expect(availability.reason).toMatch(/native Octoscode TUI/);
      for (const alias of aliases) {
        const viaAlias = findCommand(alias);
        expect(viaAlias?.name).toBe(name);
        expect(commandAvailability(viaAlias!).available).toBe(false);
      }
    },
  );

  it("never suggests TUI-only names and leaves unknown names unknown", () => {
    const suggested = commandSuggestions("/", capabilities([])).map(
      ({ name }) => name,
    );
    for (const [name] of TUI_ONLY_COMMANDS) {
      expect(suggested).not.toContain(name);
    }
    expect(findCommand("frobnicate")).toBeUndefined();
    expect(findCommand("monitors")).toBeUndefined();
  });

  it("keeps Web-only names gated by server capability, not TUI-only marking", () => {
    expect(commandAvailability(findCommand("monitor")!).available).toBe(false);
    expect(commandAvailability(findCommand("fork")!).available).toBe(false);
    expect(commandAvailability(findCommand("images")!).available).toBe(false);
    expect(
      commandAvailability(
        findCommand("monitor")!,
        capabilities(
          [CORE_UI_METHODS.MONITOR_LIST],
          [
            CORE_UI_FEATURES.CODING_AUTONOMY_V1,
            CORE_UI_FEATURES.CODING_MONITOR_RUNTIME_V1,
          ],
        ),
      ).available,
    ).toBe(true);
    expect(
      commandAvailability(
        findCommand("fork")!,
        capabilities([
          CORE_UI_METHODS.SESSION_FORK,
          CORE_UI_METHODS.SESSION_OPEN,
          CORE_UI_METHODS.SESSION_HYDRATE,
        ]),
      ).available,
    ).toBe(true);
    expect(
      commandAvailability(
        findCommand("images")!,
        capabilities([CORE_UI_METHODS.TURN_START]),
      ).available,
    ).toBe(true);
  });
});

// Reference-TUI parity (keymap.rs:1 "Ctrl+R/Alt+A show approval"). The browser
// carries Alt+A only: Ctrl+R is the browser reload. The binding is registry DATA
// so e2e/keyboard-parity.spec can assert it later without re-deriving the key.
describe("keyboard-parity shortcut registry", () => {
  const press = (
    overrides: Partial<{
      code: string;
      key: string;
      altKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
    }> = {},
  ) => ({
    code: "KeyA",
    key: "a",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  });

  it("registers show-approval as Alt+A", () => {
    const shortcut = KEYBOARD_PARITY_SHORTCUTS.find(
      ({ id }) => id === "show-approval",
    );
    expect(shortcut).toBeDefined();
    expect(shortcut!.alt).toBe(true);
    expect(shortcut!.code).toBe("KeyA");
    expect(matchKeyboardParityShortcut(press({ altKey: true }))?.id).toBe(
      "show-approval",
    );
  });

  it("matches the physical key code so macOS Option+A (a dead key) still binds", () => {
    expect(
      matchKeyboardParityShortcut(press({ altKey: true, key: "å" }))?.id,
    ).toBe("show-approval");
  });

  it("never carries the TUI Ctrl+R alias: the browser owns reload", () => {
    // No registered shortcut is Ctrl-based, and the matcher rejects Ctrl.
    expect(KEYBOARD_PARITY_SHORTCUTS.every(({ alt }) => alt)).toBe(true);
    expect(KEYBOARD_PARITY_SHORTCUTS.some((entry) => "ctrl" in entry)).toBe(
      false,
    );
    expect(matchKeyboardParityShortcut(press({ ctrlKey: true }))).toBeNull();
  });

  it("ignores bare A, Cmd+Alt+A, and AltGr (Ctrl+Alt+A)", () => {
    expect(matchKeyboardParityShortcut(press())).toBeNull();
    expect(
      matchKeyboardParityShortcut(press({ altKey: true, metaKey: true })),
    ).toBeNull();
    expect(
      matchKeyboardParityShortcut(press({ altKey: true, ctrlKey: true })),
    ).toBeNull();
  });

  it("registers the peer-dock fold as Alt+P, dropping the TUI Ctrl+L alias", () => {
    // Reference TUI event_loop.rs:1544-1551 binds Alt+P / Ctrl+L. The web keeps
    // ONLY Alt+P: Ctrl+L is the browser's own location-bar focus, so the alias
    // would be UA-swallowed.
    const shortcut = KEYBOARD_PARITY_SHORTCUTS.find(
      ({ id }) => id === "toggle-peer-dock",
    );
    expect(shortcut).toBeDefined();
    expect(shortcut!.code).toBe("KeyP");
    expect(shortcut!.alt).toBe(true);
    expect(
      matchKeyboardParityShortcut(
        press({ altKey: true, code: "KeyP", key: "p" }),
      )?.id,
    ).toBe("toggle-peer-dock");
    // Ctrl+L resolves to nothing: no Ctrl binding exists at all.
    expect(
      matchKeyboardParityShortcut(
        press({ ctrlKey: true, code: "KeyL", key: "l" }),
      ),
    ).toBeNull();
  });

  it("registers the controller Dispatch focus as Alt+D", () => {
    // Grant 2840: the peer CONTROLLER console is keyboard reachable end-to-end,
    // so Alt+D focuses its Dispatch button through the same registry matcher.
    const shortcut = KEYBOARD_PARITY_SHORTCUTS.find(
      ({ id }) => id === "focus-dispatch",
    );
    expect(shortcut).toBeDefined();
    expect(shortcut!.code).toBe("KeyD");
    expect(shortcut!.alt).toBe(true);
    expect(
      matchKeyboardParityShortcut(
        press({ altKey: true, code: "KeyD", key: "d" }),
      )?.id,
    ).toBe("focus-dispatch");
  });
});
