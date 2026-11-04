import type { TimelineEntry } from "./entry-model.ts";
import { toolTargetFull } from "./folds.ts";

export interface TurnSummaryData {
  seconds?: number | undefined;
  changedFiles: string[];
  /** Files Core counted as changed by a command without naming them. */
  unlistedChanges: number;
  /** A tool that can change files ran, so the count is only a floor. */
  changesUnknown: boolean;
  outputFiles: string[];
  /** Failed steps the turn never recovered from. */
  failedSteps: number;
  /** Failed steps a later call of the same tool in the turn succeeded at. */
  retriedSteps: number;
  usage?: { input: number; output: number } | undefined;
}

const COMMAND_TOOLS = new Set(["exec_command", "write_stdin", "shell", "bash"]);
const FILE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "diff_edit",
  "apply_patch",
]);
/** Tools that cannot change the workspace; any other tool might have. */
const READ_ONLY_TOOLS = new Set([
  "ask_user_question",
  "check_background_tasks",
  "check_workspace_contract",
  "code_structure",
  "discover_tools",
  "glob",
  "grep",
  "list_dir",
  "memory_load",
  "memory_search",
  "message",
  "monitor_list",
  "peer_list",
  "read_file",
  "read_task_output",
  "recall",
  "recall_memory",
  "search",
  "send_app_card",
  "send_file",
  "tool_search",
  "tool_suggest",
  "view_image",
  "view_video",
  "wait_agent",
  "web_fetch",
  "web_search",
  "workspace_diff",
  "workspace_log",
  "workspace_show",
]);

/**
 * Core appends what a command changed to its output: `files_changed: 1`, then
 * the paths, indented. It compares `git status` lines before and after, so it
 * misses a file that was already dirty and any file that became clean or was
 * deleted while untracked. The count is a floor, and its zero proves nothing.
 * Outside a git project, or past a long output's cut, there is no receipt.
 */
export function commandReceipt(
  output: string,
): { count: number; paths: string[] } | null {
  const last = [
    ...output.matchAll(/^files_changed: (\d+)((?:\n {2}.*)*)/gm),
  ].at(-1);
  if (!last) return null;
  const paths = last[2]!
    .split("\n")
    .map((line) => line.trim())
    // A path cut off by the preview names nothing; it stays in the count.
    .filter((line) => line && !/^\(\+\d+ more|(\.\.\.|…)$/.test(line));
  return { count: Number(last[1]), paths };
}

export function summarizeTurn(
  entries: readonly TimelineEntry[],
  turnId: string,
): TurnSummaryData {
  const turn = entries.filter((entry) => entry.turnId === turnId);
  const terminal = turn.find((entry) => entry.id === `terminal:${turnId}`);
  const changed = new Set<string>();
  const output = new Set<string>();
  const recovered = recoveredFailures(turn);
  let failedSteps = 0;
  let retriedSteps = 0;
  let unlistedChanges = 0;
  let changesUnknown = false;
  for (const entry of turn) {
    // What the user attached is an input, however the turn used it.
    if (entry.kind !== "user")
      for (const path of entry.media ?? []) output.add(path);
    if (entry.kind !== "tool") continue;
    if (entry.status === "error") {
      if (recovered.has(entry.id)) retriedSteps += 1;
      else failedSteps += 1;
    }
    const name = entry.title.toLowerCase();
    const target = toolTargetFull(entry.toolArguments ?? entry.body);
    if (FILE_TOOLS.has(name)) {
      if (entry.status === "complete") {
        if (target) changed.add(target);
        else changesUnknown = true;
      }
    } else if (
      !READ_ONLY_TOOLS.has(name) &&
      entry.status !== "info" &&
      // Refused before it ran, so it changed nothing.
      !entry.body.startsWith("Command denied by ")
    ) {
      changesUnknown = true;
      const receipt = COMMAND_TOOLS.has(name)
        ? commandReceipt(entry.body)
        : null;
      if (receipt) {
        for (const path of receipt.paths) changed.add(path);
        unlistedChanges += Math.max(0, receipt.count - receipt.paths.length);
      }
    }
    if (
      entry.status === "complete" &&
      (name === "write_file" || name === "send_file")
    ) {
      if (target) output.add(target);
    }
  }
  const starts = turn.flatMap((entry) =>
    [entry.turnStartedAtMs, entry.startedAtMs].filter(
      (value): value is number => value !== undefined,
    ),
  );
  const ends = turn.flatMap((entry) =>
    [entry.turnEndedAtMs, entry.endedAtMs].filter(
      (value): value is number => value !== undefined,
    ),
  );
  const hydratedTerminal =
    terminal &&
    (terminal.turnStartedAtMs !== undefined ||
      terminal.turnEndedAtMs !== undefined);
  const start = hydratedTerminal
    ? terminal.turnStartedAtMs
    : (terminal?.startedAtMs ??
      (starts.length ? Math.min(...starts) : undefined));
  const end = hydratedTerminal
    ? terminal.turnEndedAtMs
    : (terminal?.endedAtMs ?? (ends.length ? Math.max(...ends) : undefined));
  return {
    seconds:
      start === undefined || end === undefined
        ? undefined
        : Math.max(0, Math.round((end - start) / 1000)),
    changedFiles: [...changed],
    unlistedChanges,
    changesUnknown,
    outputFiles: [...output],
    failedSteps,
    retriedSteps,
    usage: terminal?.turnUsage ?? legacyUsage(terminal?.body),
  };
}

function legacyUsage(body: string | undefined) {
  const match = body?.match(/^(\d+) in · (\d+) out$/);
  return match
    ? { input: Number(match[1]), output: Number(match[2]) }
    : undefined;
}

/**
 * Failed tool calls that a later call of the same tool in the same turn
 * completed: the model retried or worked around them, so they read as
 * "retried", not as failures of the turn.
 */
export function recoveredFailures(turn: readonly TimelineEntry[]): Set<string> {
  const recovered = new Set<string>();
  turn.forEach((entry, index) => {
    if (entry.kind !== "tool" || entry.status !== "error") return;
    const name = entry.title.toLowerCase();
    if (
      turn
        .slice(index + 1)
        .some(
          (later) =>
            later.kind === "tool" &&
            later.status === "complete" &&
            later.title.toLowerCase() === name,
        )
    )
      recovered.add(entry.id);
  });
  return recovered;
}

/** `recoveredFailures` for every turn in the transcript. */
export function recoveredFailuresByTurn(
  entries: readonly TimelineEntry[],
): Set<string> {
  const turns = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    if (entry.turnId === undefined) continue;
    const turn = turns.get(entry.turnId);
    if (turn) turn.push(entry);
    else turns.set(entry.turnId, [entry]);
  }
  const recovered = new Set<string>();
  for (const turn of turns.values())
    for (const id of recoveredFailures(turn)) recovered.add(id);
  return recovered;
}
