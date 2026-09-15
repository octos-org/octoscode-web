import {
  CORE_UI_METHODS,
  CORE_UI_FEATURES,
  APPUI_ONBOARDING_METHODS,
  APPUI_CONTEXT_METHODS,
  APPUI_INVENTORY_METHODS,
  APPUI_SKILL_METHODS,
  APPUI_RESEARCH_METHODS,
  supportsMethod,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";

export const OCTOSCODE_INTERACTION_SOURCE_REVISION =
  "0a174d95ddec2b123adb3498432e29eb13affb81";

export type CommandCategory = "Runtime" | "Session" | "Settings" | "Help";
export type CommandIntent =
  | "process-status"
  | "interrupt"
  | "help"
  | "copy"
  | "status"
  | "cost"
  | "resume"
  | "activity"
  | "models"
  | "sessions"
  | "context"
  | "tools"
  | "mcp"
  | "skills"
  | "research"
  | "autonomy"
  | "thinking"
  | "images"
  | "peers"
  | "gather"
  | "btw"
  | "threads"
  | "turn"
  | "steer"
  | "theme"
  | "language"
  | "vim-mode"
  | "save-config"
  | "approval-scopes"
  | "undo"
  | "rewind"
  | "fork"
  | "native-review";

export interface CommandRequirement {
  methodsAll?: readonly string[];
  methodsAny?: readonly string[];
  featuresAll?: readonly string[];
}

export interface WebCommandSpec {
  name: string;
  aliases: readonly string[];
  description: string;
  category: CommandCategory;
  intent: CommandIntent;
  implemented: boolean;
  /**
   * Explicit fail-closed explanation for an `implemented: false` entry.
   * TUI-only commands set this so the browser reports WHY a known canonical
   * name is unavailable instead of treating it as an unknown command.
   */
  disabledReason?: string;
  menuHidden?: boolean;
  requirement?: CommandRequirement;
}

export interface CommandAvailability {
  available: boolean;
  reason?: string;
}

export interface CommandInvocation {
  name: string;
  args: string;
}

// This is deliberately the implemented Web slice, in octoscode registry order.
// It must not become a handwritten copy of the complete Rust registry.
export const WEB_COMMANDS: readonly WebCommandSpec[] = [
  {
    name: "theme",
    aliases: [],
    description: "Choose a browser display theme",
    category: "Settings",
    intent: "theme",
    implemented: true,
  },
  {
    name: "lang",
    aliases: ["language"],
    description: "Choose English or Chinese interface text",
    category: "Settings",
    intent: "language",
    implemented: true,
  },
  {
    name: "vimmode",
    aliases: ["vim-mode"],
    description: "Toggle the native Vim composer editing subset",
    category: "Settings",
    intent: "vim-mode",
    implemented: true,
  },
  {
    name: "saveconfig",
    aliases: ["save-config"],
    description: "Save display preferences in this browser only",
    category: "Settings",
    intent: "save-config",
    implemented: true,
  },
  {
    name: "review",
    aliases: ["code-review"],
    description: "Run the server’s native code-review workflow",
    category: "Session",
    intent: "native-review",
    implemented: true,
    requirement: {
      methodsAll: [CORE_UI_METHODS.REVIEW_START],
      featuresAll: [CORE_UI_FEATURES.REVIEW_START_V1],
    },
  },
  {
    name: "undo",
    aliases: ["snapshots"],
    description: "Restore workspace files from a server snapshot",
    category: "Session",
    intent: "undo",
    implemented: true,
    requirement: {
      methodsAll: [
        "snapshot/list",
        "snapshot/restore",
        CORE_UI_METHODS.SESSION_HYDRATE,
      ],
    },
  },
  {
    name: "rewind",
    aliases: ["backtrack"],
    description: "Rewind this conversation to an earlier user turn",
    category: "Session",
    intent: "rewind",
    implemented: true,
    requirement: {
      methodsAll: [
        CORE_UI_METHODS.SESSION_ROLLBACK,
        CORE_UI_METHODS.SESSION_HYDRATE,
      ],
    },
  },
  {
    name: "fork",
    aliases: [],
    description: "Copy this conversation to a separate Session",
    category: "Session",
    intent: "fork",
    implemented: true,
    requirement: {
      methodsAll: [
        CORE_UI_METHODS.SESSION_FORK,
        CORE_UI_METHODS.SESSION_OPEN,
        CORE_UI_METHODS.SESSION_HYDRATE,
      ],
    },
  },
  {
    name: "peer",
    aliases: [],
    description: "Prepare native peers and inspect their Sessions",
    category: "Session",
    intent: "peers",
    implemented: true,
    requirement: { methodsAll: ["peer/prepare"] },
  },
  {
    name: "btw",
    aliases: ["aside"],
    description: "Ask a temporary side question without changing the main turn",
    category: "Session",
    intent: "btw",
    implemented: true,
    requirement: { methodsAll: [CORE_UI_METHODS.SESSION_BTW] },
  },
  {
    name: "threads",
    aliases: ["thread"],
    description: "Inspect the server’s native thread graph",
    category: "Session",
    intent: "threads",
    implemented: true,
    requirement: {
      methodsAll: [CORE_UI_METHODS.THREAD_GRAPH_GET],
      featuresAll: [CORE_UI_FEATURES.THREAD_GRAPH_V1],
    },
  },
  {
    name: "turn",
    aliases: [],
    description: "Inspect native state for the active or specified turn",
    category: "Session",
    intent: "turn",
    implemented: true,
    requirement: {
      methodsAll: [CORE_UI_METHODS.TURN_STATE_GET],
      featuresAll: [CORE_UI_FEATURES.TURN_STATE_GET_V1],
    },
  },
  {
    name: "steer",
    aliases: ["steer-mid-turn", "steermode"],
    description: "Toggle mid-turn steering; FIFO queueing remains the default",
    category: "Session",
    intent: "steer",
    implemented: true,
  },
  {
    name: "permissions",
    aliases: ["permission"],
    description:
      "Inspect remembered decisions; Session controls set approval mode",
    category: "Settings",
    intent: "approval-scopes",
    implemented: true,
    requirement: { methodsAll: [CORE_UI_METHODS.APPROVAL_SCOPES_LIST] },
  },
  {
    name: "gather",
    aliases: [],
    description: "Gather peer results into this Session’s prompt queue",
    category: "Session",
    intent: "gather",
    implemented: true,
    requirement: { methodsAll: ["peer/gather"] },
  },
  {
    name: "thinking",
    aliases: ["think"],
    description: "Set thinking effort for this Session’s new prompts",
    category: "Session",
    intent: "thinking",
    implemented: true,
    requirement: { methodsAll: [CORE_UI_METHODS.TURN_START] },
  },
  {
    name: "images",
    aliases: [],
    description: "Attach images to this Session’s next prompt",
    category: "Session",
    intent: "images",
    implemented: true,
    requirement: { methodsAll: [CORE_UI_METHODS.TURN_START] },
  },
  {
    name: "ps",
    aliases: ["tasks"],
    description: "Show foreground and queued work",
    category: "Runtime",
    intent: "process-status",
    implemented: true,
  },
  {
    name: "stop",
    aliases: ["interrupt", "esc"],
    description: "Stop the active foreground turn",
    category: "Runtime",
    intent: "interrupt",
    implemented: true,
    requirement: { methodsAll: [CORE_UI_METHODS.TURN_INTERRUPT] },
  },
  {
    name: "help",
    aliases: ["?", "commands"],
    description: "Show available commands",
    category: "Help",
    intent: "help",
    implemented: true,
  },
  {
    name: "activity",
    aliases: ["act"],
    description: "Search activity across confirmed sessions",
    category: "Runtime",
    intent: "activity",
    implemented: true,
  },
  {
    name: "copy",
    aliases: ["yank"],
    description: "Copy the last assistant reply",
    category: "Runtime",
    intent: "copy",
    implemented: true,
  },
  {
    name: "status",
    aliases: [],
    description: "Show session and capability status",
    category: "Runtime",
    intent: "status",
    implemented: true,
  },
  {
    name: "cost",
    aliases: ["usage"],
    description: "Inspect reported Session token usage and estimated cost",
    category: "Runtime",
    intent: "cost",
    implemented: true,
  },
  {
    name: "model",
    aliases: [],
    description: "Show runtime model and Profile model settings",
    category: "Session",
    intent: "models",
    implemented: true,
    requirement: { methodsAll: [APPUI_ONBOARDING_METHODS.PROFILE_LLM_LIST] },
  },
  {
    name: "context",
    aliases: ["ctx", "compact", "compress"],
    description: "Inspect context, cache, and compaction controls",
    category: "Session",
    intent: "context",
    implemented: true,
    requirement: { methodsAll: [APPUI_CONTEXT_METHODS.COMPACT] },
  },
  {
    name: "sessions",
    aliases: ["ss"],
    description: "Browse confirmed sessions in this browser tab",
    category: "Session",
    intent: "sessions",
    implemented: true,
  },
  {
    name: "tools",
    aliases: ["tool-settings"],
    description: "Inspect server-owned tool availability and policy",
    category: "Settings",
    intent: "tools",
    implemented: true,
    requirement: { methodsAll: [APPUI_INVENTORY_METHODS.TOOLS] },
  },
  {
    name: "mcp",
    aliases: [],
    description: "Inspect server-reported MCP connections",
    category: "Settings",
    intent: "mcp",
    implemented: true,
    requirement: { methodsAll: [APPUI_INVENTORY_METHODS.MCP] },
  },
  {
    name: "skills",
    aliases: ["skill"],
    description:
      "Manage installed skills and registry packages in this Profile",
    category: "Settings",
    intent: "skills",
    implemented: true,
    requirement: { methodsAll: [APPUI_SKILL_METHODS.LIST] },
  },
  {
    name: "research",
    aliases: ["lanes"],
    description: "Manage server research provider lanes",
    category: "Settings",
    intent: "research",
    implemented: true,
    requirement: { methodsAll: [APPUI_RESEARCH_METHODS.LIST] },
  },
  {
    name: "agents",
    aliases: ["agent"],
    description: "Inspect session agents and their output",
    category: "Runtime",
    intent: "autonomy",
    implemented: true,
    requirement: {
      methodsAll: [CORE_UI_METHODS.AGENT_LIST],
      featuresAll: [
        CORE_UI_FEATURES.CODING_AUTONOMY_V1,
        CORE_UI_FEATURES.CODING_AGENT_CONTROL_V1,
      ],
    },
  },
  {
    name: "goal",
    aliases: [],
    description: "Inspect and manage the session goal",
    category: "Runtime",
    intent: "autonomy",
    implemented: true,
    requirement: {
      methodsAny: [
        CORE_UI_METHODS.SESSION_GOAL_GET,
        CORE_UI_METHODS.SESSION_GOAL_SET,
        CORE_UI_METHODS.SESSION_GOAL_CLEAR,
      ],
      featuresAll: [
        CORE_UI_FEATURES.CODING_AUTONOMY_V1,
        CORE_UI_FEATURES.CODING_GOAL_RUNTIME_V1,
      ],
    },
  },
  {
    name: "loop",
    aliases: [],
    description: "Inspect and manage scheduled loops",
    category: "Runtime",
    intent: "autonomy",
    implemented: true,
    requirement: {
      methodsAny: [CORE_UI_METHODS.LOOP_CREATE, CORE_UI_METHODS.LOOP_LIST],
      featuresAll: [
        CORE_UI_FEATURES.CODING_AUTONOMY_V1,
        CORE_UI_FEATURES.CODING_LOOP_RUNTIME_V1,
      ],
    },
  },
  {
    name: "monitor",
    aliases: [],
    description: "Inspect and manage session monitors",
    category: "Runtime",
    intent: "autonomy",
    implemented: true,
    requirement: {
      methodsAny: [
        CORE_UI_METHODS.MONITOR_CREATE,
        CORE_UI_METHODS.MONITOR_LIST,
      ],
      featuresAll: [
        CORE_UI_FEATURES.CODING_AUTONOMY_V1,
        CORE_UI_FEATURES.CODING_MONITOR_RUNTIME_V1,
      ],
    },
  },
  {
    name: "resume",
    aliases: [],
    description:
      "Browse unverified historical candidates and confirm a Session",
    category: "Session",
    intent: "resume",
    implemented: true,
    requirement: {
      methodsAll: [
        CORE_UI_METHODS.SESSION_LIST,
        CORE_UI_METHODS.SESSION_OPEN,
        CORE_UI_METHODS.SESSION_HYDRATE,
      ],
      featuresAll: [CORE_UI_FEATURES.SESSION_WORKSPACE_CWD_V1],
    },
  },
  // Canonical names that exist only in the native Octoscode TUI. The browser
  // has no local shell, terminal, dock, or display host, so each is an EXPLICIT
  // fail-closed entry (implemented:false + disabledReason) rather than an
  // unknown. `intent` is inert here: commandAvailability short-circuits on
  // implemented:false, so these never reach implementedIntent or the model.
  {
    name: "exit",
    aliases: ["quit"],
    description: "Close",
    category: "Runtime",
    intent: "help",
    implemented: false,
    disabledReason:
      "This command runs in the native Octoscode TUI; the browser cannot close a process it does not own. Nothing was sent to the model.",
  },
  {
    name: "onboard",
    aliases: ["setup", "wizard"],
    description: "Octoscode setup",
    category: "Settings",
    intent: "help",
    implemented: false,
    disabledReason:
      "This command runs in the native Octoscode TUI; the browser onboards through its own connection controls. Nothing was sent to the model.",
  },
  {
    name: "login",
    aliases: ["auth"],
    description: "Auth token",
    category: "Session",
    intent: "help",
    implemented: false,
    disabledReason:
      "This command runs in the native Octoscode TUI; the browser authenticates through its connection controls. Nothing was sent to the model.",
  },
  {
    name: "add-model",
    aliases: ["provider", "providers", "add_model"],
    description: "Add model provider",
    category: "Settings",
    intent: "help",
    implemented: false,
    disabledReason:
      "This command runs in the native Octoscode TUI; the browser manages providers in Profile settings. Nothing was sent to the model.",
  },
  {
    name: "profiles",
    aliases: ["profile"],
    description: "Profile",
    category: "Session",
    intent: "help",
    implemented: false,
    disabledReason:
      "This command runs in the native Octoscode TUI; the browser switches Profiles through its own Session controls. Nothing was sent to the model.",
  },
  {
    name: "dock",
    aliases: ["ag"],
    description: "Agent roster",
    category: "Session",
    intent: "help",
    implemented: false,
    disabledReason:
      "This command runs in the native Octoscode TUI; the browser shows agents in its Session panels. Nothing was sent to the model.",
  },
  {
    name: "scrollmode",
    aliases: ["scroll-mode"],
    description: "Mode",
    category: "Settings",
    intent: "help",
    implemented: false,
    disabledReason:
      "This command runs in the native Octoscode TUI; the browser scrolls with its own viewport. Nothing was sent to the model.",
  },
  {
    name: "statusline",
    aliases: ["status-line"],
    description: "Status",
    category: "Settings",
    intent: "help",
    implemented: false,
    disabledReason:
      "This command runs in the native Octoscode TUI; the browser renders its own status surface. Nothing was sent to the model.",
  },
  {
    name: "title",
    aliases: [],
    description: "Name",
    category: "Settings",
    intent: "help",
    implemented: false,
    disabledReason:
      "This command runs in the native Octoscode TUI; the browser keeps server-owned Session titles. Nothing was sent to the model.",
  },
  {
    name: "keymap",
    aliases: ["keys"],
    description: "Vim editing",
    category: "Settings",
    intent: "help",
    implemented: false,
    disabledReason:
      "This command runs in the native Octoscode TUI; the browser exposes only its own Vim editing subset. Nothing was sent to the model.",
  },
  {
    name: "task",
    aliases: [],
    description: "Task output",
    category: "Runtime",
    intent: "help",
    implemented: false,
    disabledReason:
      "This command runs in the native Octoscode TUI; the browser shows task output in its own panels. Nothing was sent to the model.",
  },
] as const;

/**
 * Reference-TUI keyboard parity, expressed as registry DATA so
 * `e2e/keyboard-parity.spec.ts` can assert a binding without re-deriving the
 * key. Native source: `keymap.rs:1` — a HELP legend, not a handler body:
 * "Ctrl+R/Alt+A show approval".
 *
 * The browser carries **Alt+A only**. `Ctrl+R` is deliberately dropped: it is
 * the browser's own reload on every Chromium/Firefox/Safari build, so binding it
 * would either be swallowed by the UA or reload the tab mid-approval. Alt+A is
 * collision-free (no UA chord, no in-app Alt+A handler). Matching is physical
 * (`code`), because on macOS Option+A is a dead key that reports `key: "å"` —
 * the same defect class hardened in PeerDock's `rowDecision`.
 */
export interface KeyboardParityShortcut {
  /** Stable id the handler dispatches on; also the e2e assertion hook. */
  readonly id: "show-approval" | "toggle-peer-dock" | "focus-dispatch";
  /** Physical key, layout- and modifier-stable. */
  readonly code: string;
  /** Alt is REQUIRED; the binding is inert without it. */
  readonly alt: true;
}

export type KeyboardParityKey = Pick<
  KeyboardEvent,
  "code" | "key" | "altKey" | "ctrlKey" | "metaKey"
>;

export const KEYBOARD_PARITY_SHORTCUTS: readonly KeyboardParityShortcut[] = [
  { id: "show-approval", code: "KeyA", alt: true },
  // Reference TUI event_loop.rs:1544-1551 binds Alt+P / Ctrl+L to toggle
  // `peer_dock_collapsed`. The web keeps ONLY Alt+P: Ctrl+L focuses the
  // browser's own location bar on Chromium/Firefox/Safari, so the alias would
  // be UA-swallowed (the same reason Ctrl+R was dropped for show-approval).
  { id: "toggle-peer-dock", code: "KeyP", alt: true },
  // Grant 2840 (program WEB-PEER-CONTROLLER-2800 §3): the peer controller
  // console is keyboard reachable END-TO-END, so Alt+D focuses its Dispatch
  // button. Same collision discipline as Alt+A/Alt+P: no UA chord, matched on
  // the physical `code` (macOS Option+D is a dead key reporting `key: "∂"`).
  { id: "focus-dispatch", code: "KeyD", alt: true },
] as const;

/**
 * Resolve a keydown to its registered parity shortcut, or null. Alt is
 * REQUIRED; Ctrl and Meta are rejected, so Cmd+Alt+A and AltGr (which reports
 * Ctrl+Alt on Windows) stay inert rather than shadowing a text-input chord.
 */
export function matchKeyboardParityShortcut(
  event: KeyboardParityKey,
): KeyboardParityShortcut | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  const byCode = KEYBOARD_PARITY_SHORTCUTS.find(
    (shortcut) => shortcut.code === event.code,
  );
  if (byCode) return byCode;
  // Fallback for synthetic events that carry no `code` (tests, older WebViews).
  const letter = event.key.toLowerCase();
  return (
    KEYBOARD_PARITY_SHORTCUTS.find(
      (shortcut) => shortcut.code === `Key${letter.toUpperCase()}`,
    ) ?? null
  );
}

export function looksLikeSlashCommand(input: string): boolean {
  const rest = input.trimStart().startsWith("/")
    ? input.trimStart().slice(1)
    : null;
  if (rest === null) return false;

  const name = rest.split(/\s+/, 1)[0] ?? "";
  if (!name) return true;
  return !name.includes("/") && !name.includes("\\");
}

export function parseCommandInvocation(
  input: string,
): CommandInvocation | null {
  if (!looksLikeSlashCommand(input)) return null;
  const command = input.trimStart().slice(1);
  const splitAt = command.search(/\s/);
  if (splitAt === -1) return { name: command, args: "" };
  return {
    name: command.slice(0, splitAt),
    args: command.slice(splitAt).trimStart(),
  };
}

export function findCommand(name: string): WebCommandSpec | undefined {
  const candidate = name.startsWith("/") ? name.slice(1) : name;
  return WEB_COMMANDS.find(
    (command) =>
      command.name === candidate || command.aliases.includes(candidate),
  );
}

export function commandAvailability(
  command: WebCommandSpec,
  capabilities?: UiProtocolCapabilities,
): CommandAvailability {
  if (!command.implemented) {
    return {
      available: false,
      reason: command.disabledReason ?? "Not implemented in this Web build",
    };
  }

  const requirement = command.requirement;
  if (!requirement) return { available: true };
  if (!capabilities) {
    return { available: false, reason: "Server capabilities unavailable" };
  }

  const features = new Set(capabilities.supported_features ?? []);
  const missingAll = requirement.methodsAll?.find(
    (method) => !supportsMethod(capabilities, method),
  );
  if (missingAll) {
    return { available: false, reason: `Server lacks ${missingAll}` };
  }
  if (
    requirement.methodsAny?.length &&
    !requirement.methodsAny.some((method) =>
      supportsMethod(capabilities, method),
    )
  ) {
    return {
      available: false,
      reason: `Server lacks one of ${requirement.methodsAny.join(", ")}`,
    };
  }
  const missingFeature = requirement.featuresAll?.find(
    (feature) => !features.has(feature),
  );
  if (missingFeature) {
    return { available: false, reason: `Server lacks ${missingFeature}` };
  }
  return { available: true };
}

export function commandSuggestions(
  draft: string,
  capabilities?: UiProtocolCapabilities,
): readonly WebCommandSpec[] {
  const invocation = parseCommandInvocation(draft);
  if (!invocation || invocation.args || !draft.trimStart().startsWith("/")) {
    return [];
  }
  const query = invocation.name.toLowerCase();
  return WEB_COMMANDS.filter((command) => {
    if (
      command.menuHidden ||
      !commandAvailability(command, capabilities).available
    )
      return false;
    return (
      !query ||
      command.name.startsWith(query) ||
      command.aliases.some((alias) => alias.startsWith(query))
    );
  });
}
