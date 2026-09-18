export type ComposerIntent =
  | { kind: "prompt"; text: string }
  | { kind: "interrupt" }
  | { kind: "help" }
  | { kind: "process-status" }
  | { kind: "copy" }
  | { kind: "status" }
  | { kind: "cost" }
  | { kind: "activity" }
  | { kind: "models" }
  | { kind: "sessions" }
  | { kind: "resume"; query: string }
  | { kind: "context" }
  | { kind: "tools" }
  | { kind: "mcp" }
  | { kind: "skills" }
  | { kind: "research" }
  | { kind: "autonomy" }
  | { kind: "thinking" }
  | { kind: "set-thinking"; value: ReasoningEffort | undefined }
  | { kind: "images" }
  | { kind: "peers"; clear?: boolean }
  | { kind: "gather"; slugs?: string[] }
  | { kind: "btw"; question: string }
  | { kind: "threads" }
  | { kind: "turn"; turnId: string }
  | { kind: "set-steer"; value: boolean | "toggle" }
  | { kind: "theme" }
  | { kind: "language" }
  | { kind: "set-language"; value: "en" | "zh" }
  | { kind: "vim-mode" }
  | { kind: "save-config" }
  | { kind: "approval-scopes" }
  | { kind: "undo" }
  | { kind: "rewind" }
  | { kind: "fork" }
  | { kind: "native-review"; prompt: string }
  | { kind: "empty-command" }
  | { kind: "unsupported-command"; command: string; reason?: string }
  | { kind: "local-shell-unavailable" };

import {
  commandAvailability,
  findCommand,
  parseCommandInvocation,
} from "../commands/registry.ts";
import type { CommandIntent } from "../commands/registry.ts";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client/protocol";
import { reasoningEffort, type ReasoningEffort } from "../reasoning/model.ts";
import { parseInspectionIntent } from "../inspection/intent.ts";

/** Commands are resolved before queueing so command text never reaches a model. */
export function resolveComposerIntent(
  input: string,
  capabilities?: UiProtocolCapabilities,
  activeTurnId: string | null = null,
): ComposerIntent {
  const text = input.trim();
  if (isLocalShellBang(text)) return { kind: "local-shell-unavailable" };
  const invocation = parseCommandInvocation(text);
  if (!invocation) return { kind: "prompt", text };
  if (!invocation.name) return { kind: "empty-command" };

  // TUI parity 2500 §2: `/peer clear` is a purely client-side dock tidy (prune
  // FINISHED peers). The reference TUI resolves the command, then routes this
  // ONE verb BEFORE the peer/prepare capability gate (store.rs:853-865 -> 1041)
  // because orphan peers from an earlier connection are exactly when the gate is
  // lost. Mirror that: require the registered `/peer` command, but bypass its
  // availability gate. Every other `/peer …` verb still gates below.
  if (
    invocation.name.toLowerCase() === "peer" &&
    invocation.args.trim().toLowerCase() === "clear" &&
    findCommand("peer")?.intent === "peers"
  )
    return { kind: "peers", clear: true };

  const command = findCommand(invocation.name.toLowerCase());
  if (!command || !commandAvailability(command, capabilities).available) {
    return { kind: "unsupported-command", command: invocation.name };
  }
  if (command.intent === "threads" || command.intent === "turn") {
    const result = parseInspectionIntent(
      command.intent,
      invocation.args,
      activeTurnId,
    );
    return result.ok
      ? result.request
      : {
          kind: "unsupported-command",
          command: invocation.name,
          reason: result.reason,
        };
  }
  if (command.intent === "btw") {
    const question = invocation.args.trim();
    return question
      ? { kind: "btw", question }
      : {
          kind: "unsupported-command",
          command: invocation.name,
          reason:
            "Use /btw <question> for a temporary side answer. Nothing was sent to the model.",
        };
  }
  if (command.intent === "resume")
    return { kind: "resume", query: invocation.args.trim() };
  if (command.intent === "language") {
    const choice = invocation.args.trim().toLowerCase();
    if (!choice) return { kind: "language" };
    if (choice.startsWith("en")) return { kind: "set-language", value: "en" };
    if (choice.startsWith("zh")) return { kind: "set-language", value: "zh" };
    return {
      kind: "unsupported-command",
      command: invocation.name,
      reason: "Use /lang [en | zh]. Nothing was sent to the model.",
    };
  }
  if (command.intent === "steer") {
    const choice = invocation.args.trim().toLowerCase();
    if (!choice) return { kind: "set-steer", value: "toggle" };
    if (["on", "true", "enable", "enabled"].includes(choice))
      return { kind: "set-steer", value: true };
    if (["off", "false", "disable", "disabled"].includes(choice))
      return { kind: "set-steer", value: false };
    return {
      kind: "unsupported-command",
      command: invocation.name,
      reason: "Use /steer [on | off]. Nothing was sent to the model.",
    };
  }
  if (command.intent === "gather") {
    const args = invocation.args.trim();
    if (!args || args.toLowerCase() === "all") return { kind: "gather" };
    const slugs = args.split(/\s+/u);
    if (slugs.every((slug) => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(slug)))
      return { kind: "gather", slugs };
    return {
      kind: "unsupported-command",
      command: invocation.name,
      reason: "Use /gather [all | peer-slug …]. Nothing was sent to the model.",
    };
  }
  if (invocation.args.trim()) {
    if (command.intent === "native-review")
      return { kind: "native-review", prompt: invocation.args.trim() };
    if (command.intent === "thinking") {
      const choice = invocation.args.trim().toLowerCase();
      const effort = reasoningEffort(choice);
      if (effort || choice === "default" || choice === "reset")
        return { kind: "set-thinking", value: effort };
    }
    return {
      kind: "unsupported-command",
      command: invocation.name,
      reason: `Arguments for /${command.name} are not supported in this Web build. Open the command without arguments to use its controls. Nothing was sent to the model.`,
    };
  }
  return (
    implementedIntent(command.intent) ?? {
      kind: "unsupported-command",
      command: invocation.name,
    }
  );
}

/**
 * A leading `!` is the native local-shell escape, which a browser cannot run.
 * Recognize CJK-width and compatibility bangs (NFKC maps U+FF01/U+FE15/U+FE57
 * to `!`) and ignore any zero-width/whitespace prefix, so a disguised bang
 * still fails closed instead of reaching the model as ordinary text. Only the
 * boolean is derived here; the caller's text is never normalized and the
 * receipt carries no command echo.
 */
function isLocalShellBang(text: string): boolean {
  return text
    .normalize("NFKC")
    .replace(/^[\p{Cf}\s]+/u, "")
    .startsWith("!");
}

function implementedIntent(intent: CommandIntent): ComposerIntent | null {
  switch (intent) {
    case "gather":
      return { kind: "gather" };
    case "native-review":
      return { kind: "native-review", prompt: "" };
    case "theme":
    case "language":
    case "vim-mode":
    case "save-config":
      return { kind: intent };
    case "process-status":
    case "interrupt":
    case "help":
    case "copy":
    case "status":
    case "cost":
    case "activity":
    case "models":
    case "sessions":
    case "context":
    case "tools":
    case "mcp":
    case "skills":
    case "research":
    case "autonomy":
    case "thinking":
    case "approval-scopes":
    case "images":
    case "peers":
    case "undo":
    case "rewind":
    case "fork":
      return { kind: intent };
    case "resume":
    case "btw":
    case "threads":
    case "turn":
    case "steer":
      return null;
    default:
      return assertNever(intent);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled composer intent ${String(value)}`);
}
