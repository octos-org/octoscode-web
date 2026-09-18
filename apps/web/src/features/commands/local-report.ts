import type { UiText } from "../preferences/ui-text.tsx";

/** Cold presentation for local diagnostic commands; no transport or task owner. */
export type LocalReport =
  | {
      kind: "help";
      commands: readonly { name: string; aliases: readonly string[] }[];
    }
  | { kind: "copy"; outcome: "empty" | "copied" | "failed"; reason?: string }
  | { kind: "save-config"; saved: boolean }
  | { kind: "process-status"; turn: string | null; pending: number }
  | {
      kind: "status";
      workspace: string | undefined;
      runtimeModel: string | undefined;
      profileDefault: string | undefined;
      permission: { mode: string; network: string } | null;
      working: boolean;
    }
  | { kind: "local-shell-unavailable" }
  | { kind: "unsupported-command"; command: string; reason?: string };

export function localCommandReport(
  report: LocalReport,
  t: UiText,
): {
  title: string;
  body: string;
  error: boolean;
} {
  switch (report.kind) {
    case "copy":
      return {
        title: t(
          report.outcome === "empty"
            ? "Nothing to copy"
            : report.outcome === "copied"
              ? "Copied"
              : "Copy failed",
        ),
        body:
          report.outcome === "failed"
            ? (report.reason ?? t("Copy failed"))
            : t(
                report.outcome === "empty"
                  ? "There is no assistant reply in this session yet."
                  : "The last assistant reply is on the clipboard.",
              ),
        error: report.outcome === "failed",
      };
    case "save-config":
      return {
        title: t(
          report.saved
            ? "Browser preferences saved."
            : "Browser preferences could not be saved.",
        ),
        body: t(
          "Save remembers display preferences only in this browser, not server configuration.",
        ),
        error: !report.saved,
      };
    case "help":
      return {
        title: t("Commands"),
        body: `${report.commands.map((command) => `/${command.name}${command.aliases.length ? ` (${command.aliases.map((alias) => `/${alias}`).join(", ")})` : ""}`).join(" · ")}. ${t("Unsupported slash commands are never sent to the model.")}`,
        error: false,
      };
    case "process-status":
      return {
        title: t("Process status"),
        body: report.turn
          ? t("Foreground turn {turn} is active. {count} prompt(s) queued.", {
              turn: report.turn.slice(0, 8),
              count: report.pending,
            })
          : report.pending > 0
            ? t(
                "No foreground turn is active. {count} prompt(s) remain queued.",
                { count: report.pending },
              )
            : t("No foreground turn is active and the prompt queue is empty."),
        error: false,
      };
    case "status":
      return {
        title: t("Session status"),
        body: [
          `${t("Workspace")}: ${report.workspace ?? t("server default")}`,
          `${t("Runtime model")}: ${report.runtimeModel ?? t("not reported")}`,
          `${t("Profile default")}: ${report.profileDefault ?? t("not reported")}`,
          `${t("Access")}: ${report.permission ? `${report.permission.mode} · network ${report.permission.network}` : t("server default")}`,
          `${t("Queue")}: ${t(report.working ? "working" : "idle")}`,
        ].join("\n"),
        error: false,
      };
    case "local-shell-unavailable":
      return {
        title: t("Local shell unavailable"),
        body: t(
          "Octoscode's ! command runs on the TUI host. A browser cannot execute a local process, so nothing was sent.",
        ),
        error: true,
      };
    case "unsupported-command":
      return {
        title: t("/{command} is unavailable", { command: report.command }),
        body: t(
          report.reason ??
            "This Web build cannot execute that Octoscode command. Nothing was sent to the model.",
        ),
        error: true,
      };
  }
}
