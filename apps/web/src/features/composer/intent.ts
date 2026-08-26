export type ComposerIntent =
  | { kind: "prompt"; text: string }
  | { kind: "interrupt" }
  | { kind: "help" }
  | { kind: "process-status" }
  | { kind: "activity" }
  | { kind: "copy" }
  | { kind: "status" }
  | { kind: "empty-command" }
  | { kind: "unsupported-command"; command: string }
  | { kind: "local-shell-unavailable" };

import {
  commandAvailability,
  findCommand,
  parseCommandInvocation,
} from "../commands/registry.ts";
import type { CommandIntent } from "../commands/registry.ts";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";

/** Commands are resolved before queueing so command text never reaches a model. */
export function resolveComposerIntent(
  input: string,
  capabilities?: UiProtocolCapabilities,
): ComposerIntent {
  const text = input.trim();
  if (text.startsWith("!")) return { kind: "local-shell-unavailable" };
  const invocation = parseCommandInvocation(text);
  if (!invocation) return { kind: "prompt", text };
  if (!invocation.name) return { kind: "empty-command" };

  const command = findCommand(invocation.name.toLowerCase());
  if (!command || !commandAvailability(command, capabilities).available) {
    return { kind: "unsupported-command", command: invocation.name };
  }
  return (
    implementedIntent(command.intent) ?? {
      kind: "unsupported-command",
      command: invocation.name,
    }
  );
}

function implementedIntent(intent: CommandIntent): ComposerIntent | null {
  switch (intent) {
    case "process-status":
    case "activity":
    case "interrupt":
    case "help":
    case "copy":
    case "status":
      return { kind: intent };
    case "resume":
      return null;
    default:
      return assertNever(intent);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled composer intent ${String(value)}`);
}
