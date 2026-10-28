import type { TimelineEntry } from "./entry-model.ts";
import { toolTarget } from "./folds.ts";

export interface TurnSummaryData {
  seconds?: number | undefined;
  changedFiles: string[];
  outputFiles: string[];
  failedSteps: number;
  usage?: { input: number; output: number } | undefined;
}

export function summarizeTurn(
  entries: readonly TimelineEntry[],
  turnId: string,
): TurnSummaryData {
  const turn = entries.filter((entry) => entry.turnId === turnId);
  const terminal = turn.find((entry) => entry.id === `terminal:${turnId}`);
  const changed = new Set<string>();
  const output = new Set<string>();
  let failedSteps = 0;
  for (const entry of turn) {
    for (const path of entry.media ?? []) output.add(path);
    if (entry.kind !== "tool") continue;
    if (entry.status === "error") failedSteps += 1;
    const name = entry.title.toLowerCase();
    const target = toolTarget(entry.toolArguments ?? entry.body);
    if (
      entry.status === "complete" &&
      (name === "write_file" || name === "edit_file" || name === "apply_patch")
    ) {
      if (target) changed.add(target);
    }
    if (
      entry.status === "complete" &&
      (name === "write_file" || name === "send_file")
    ) {
      if (target) output.add(target);
    }
  }
  const starts = turn.flatMap((entry) =>
    entry.startedAtMs === undefined ? [] : [entry.startedAtMs],
  );
  const ends = turn.flatMap((entry) =>
    entry.endedAtMs === undefined ? [] : [entry.endedAtMs],
  );
  const start =
    terminal?.startedAtMs ?? (starts.length ? Math.min(...starts) : undefined);
  const end =
    terminal?.endedAtMs ?? (ends.length ? Math.max(...ends) : undefined);
  return {
    seconds:
      start === undefined || end === undefined
        ? undefined
        : Math.max(0, Math.round((end - start) / 1000)),
    changedFiles: [...changed],
    outputFiles: [...output],
    failedSteps,
    usage: terminal?.turnUsage ?? legacyUsage(terminal?.body),
  };
}

function legacyUsage(body: string | undefined) {
  const match = body?.match(/^(\d+) in · (\d+) out$/);
  return match
    ? { input: Number(match[1]), output: Number(match[2]) }
    : undefined;
}
