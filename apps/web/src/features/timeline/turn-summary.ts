import type { TimelineEntry } from "./entry-model.ts";
import { toolTargetFull } from "./folds.ts";

export interface TurnSummaryData {
  seconds?: number | undefined;
  changedFiles: string[];
  outputFiles: string[];
  /** Failed steps the turn never recovered from. */
  failedSteps: number;
  /** Failed steps a later call of the same tool in the turn succeeded at. */
  retriedSteps: number;
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
  const recovered = recoveredFailures(turn);
  let failedSteps = 0;
  let retriedSteps = 0;
  for (const entry of turn) {
    for (const path of entry.media ?? []) output.add(path);
    if (entry.kind !== "tool") continue;
    if (entry.status === "error") {
      if (recovered.has(entry.id)) retriedSteps += 1;
      else failedSteps += 1;
    }
    const name = entry.title.toLowerCase();
    const target = toolTargetFull(entry.toolArguments ?? entry.body);
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
