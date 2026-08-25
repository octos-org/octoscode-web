import {
  supportsMethod,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";

export const OCTOSCODE_INTERACTION_SOURCE_REVISION =
  "dab1de823cdb5db9587c09fc91c2e7e744f251c9";

export type CommandCategory = "Runtime" | "Session" | "Settings" | "Help";
export type CommandIntent =
  | "process-status"
  | "activity"
  | "interrupt"
  | "help"
  | "copy"
  | "status"
  | "resume";

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
    name: "ps",
    aliases: ["tasks"],
    description: "Show foreground and queued work",
    category: "Runtime",
    intent: "process-status",
    implemented: true,
  },
  {
    name: "activity",
    aliases: [],
    description: "Search tasks across recent sessions",
    category: "Runtime",
    intent: "activity",
    implemented: true,
    requirement: { methodsAll: ["task/list"] },
  },
  {
    name: "stop",
    aliases: ["interrupt", "esc"],
    description: "Stop the active foreground turn",
    category: "Runtime",
    intent: "interrupt",
    implemented: true,
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
    name: "resume",
    aliases: [],
    description: "Switch to a prior session and reload its transcript",
    category: "Session",
    intent: "resume",
    implemented: false,
    menuHidden: true,
    requirement: { methodsAll: ["session/list", "session/hydrate"] },
  },
] as const;

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
    return { available: false, reason: "Not implemented in this Web build" };
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
