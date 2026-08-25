export type ComposerIntent =
  | { kind: "prompt"; text: string }
  | { kind: "interrupt" }
  | { kind: "help" }
  | { kind: "unsupported-command"; command: string }
  | { kind: "local-shell-unavailable" };

const INTERRUPT_ALIASES = new Set(["stop", "interrupt", "esc"]);
const HELP_ALIASES = new Set(["help", "?", "commands"]);

/** Commands are resolved before queueing so command text never reaches a model. */
export function resolveComposerIntent(input: string): ComposerIntent {
  const text = input.trim();
  if (text.startsWith("!")) return { kind: "local-shell-unavailable" };
  if (!text.startsWith("/")) return { kind: "prompt", text };

  const command = text.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (INTERRUPT_ALIASES.has(command)) return { kind: "interrupt" };
  if (HELP_ALIASES.has(command)) return { kind: "help" };
  return { kind: "unsupported-command", command: command || "/" };
}
