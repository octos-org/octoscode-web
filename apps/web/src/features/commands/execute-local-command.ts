import type { ComposerIntent } from "../composer/intent.ts";
import type { OctosSessionRuntime } from "../session/use-octos-session.ts";
import { addSystemMessage, type TimelineStatus } from "../timeline/model.ts";
import { commandSuggestions } from "./registry.ts";

export type LocalCommandIntent = Exclude<
  ComposerIntent,
  { kind: "prompt" | "interrupt" | "empty-command" }
>;

export interface ExecuteLocalCommandInput {
  intent: LocalCommandIntent;
  opened: NonNullable<OctosSessionRuntime["connection"]["opened"]>;
  conversation: Pick<
    OctosSessionRuntime["conversation"],
    "timeline" | "queue" | "setTimeline"
  >;
  models: {
    state: Pick<OctosSessionRuntime["models"]["state"], "models">;
  };
  safety: {
    permission: Pick<OctosSessionRuntime["safety"]["permission"], "result">;
  };
  work: {
    supervision: Pick<
      OctosSessionRuntime["work"]["supervision"],
      "runtimeStatus"
    >;
  };
  /** Retires this invocation on any Session or connection identity change. */
  isCurrent(): boolean;
}

/** Presentation-only commands: no transport or RPC methods enter this surface. */
export async function executeLocalCommand({
  intent,
  opened,
  conversation,
  models,
  safety,
  work,
  isCurrent,
}: ExecuteLocalCommandInput): Promise<void> {
  if (!isCurrent()) return;

  function append(
    key: string,
    title: string,
    body: string,
    status: TimelineStatus = "info",
  ): void {
    if (!isCurrent()) return;
    const id = `${key}:${crypto.randomUUID()}`;
    conversation.setTimeline((current) =>
      isCurrent()
        ? addSystemMessage(current, id, title, body, status)
        : current,
    );
  }

  switch (intent.kind) {
    case "help": {
      const available = commandSuggestions("/", opened.capabilities)
        .map(
          (command) =>
            `/${command.name}${command.aliases.length ? ` (${command.aliases.map((alias) => `/${alias}`).join(", ")})` : ""}`,
        )
        .join(" · ");
      append(
        "help",
        "Commands",
        `${available}. Unsupported slash commands are never sent to the model.`,
      );
      return;
    }
    case "process-status":
      append(
        "process-status",
        "Process status",
        conversation.queue.active
          ? `Foreground turn ${conversation.queue.active.turnId.slice(0, 8)} is active. ${conversation.queue.pending.length} prompt${conversation.queue.pending.length === 1 ? "" : "s"} queued.`
          : "No foreground turn is active and the prompt queue is empty.",
      );
      return;
    case "status": {
      const runtimeModel = work.supervision.runtimeStatus?.model;
      const profileDefault = models.state.models.find(
        (model) => model.selected,
      );
      const currentPermission = safety.permission.result?.current;
      append(
        "status",
        "Session status",
        [
          `Workspace: ${opened.workspace_root ?? "server default"}`,
          `Runtime model: ${runtimeModel?.title ?? runtimeModel?.model ?? "not reported"}`,
          `Profile default: ${profileDefault?.title ?? profileDefault?.model ?? "not reported"}`,
          `Access: ${currentPermission ? `${currentPermission.mode} · network ${currentPermission.network}` : "server default"}`,
          `Queue: ${conversation.queue.active ? "working" : "idle"}`,
        ].join("\n"),
      );
      return;
    }
    case "copy": {
      const lastReply = conversation.timeline.findLast(
        (entry) => entry.kind === "assistant" && entry.body,
      );
      if (!lastReply) {
        append(
          "copy-empty",
          "Nothing to copy",
          "There is no assistant reply in this session yet.",
        );
        return;
      }
      try {
        const clipboard = globalThis.navigator?.clipboard;
        if (!clipboard?.writeText) {
          throw new Error("Clipboard access is unavailable in this browser.");
        }
        await clipboard.writeText(lastReply.body);
        if (!isCurrent()) return;
        append(
          "copy-ok",
          "Copied",
          "The last assistant reply is on the clipboard.",
          "complete",
        );
      } catch (reason) {
        if (!isCurrent()) return;
        append(
          "copy-error",
          "Copy failed",
          reason instanceof Error ? reason.message : String(reason),
          "error",
        );
      }
      return;
    }
    case "local-shell-unavailable":
      append(
        "shell-unavailable",
        "Local shell unavailable",
        "Octoscode's ! command runs on the TUI host. A browser cannot execute a local process, so nothing was sent.",
        "error",
      );
      return;
    case "unsupported-command":
      append(
        "unsupported-command",
        `/${intent.command} is unavailable`,
        "This Web build cannot execute that Octoscode command. Nothing was sent to the model.",
        "error",
      );
      return;
    default:
      return assertNever(intent);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled local command ${String(value)}`);
}
