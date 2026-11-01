import type { TimelineEntry } from "./entry-model.ts";

/**
 * Once a turn has ended, its consecutive thinking and tool blocks read as one
 * "ran N steps" disclosure instead of a wall of cards. A live turn keeps every
 * block on its own so progress stays visible while it happens.
 */
export type TimelineRenderItem =
  | { type: "entry"; entry: TimelineEntry }
  | { type: "summary"; entry: TimelineEntry; turnId: string }
  | { type: "steps"; id: string; turnId: string; entries: TimelineEntry[] };

const isStep = (entry: TimelineEntry) =>
  entry.kind === "reasoning" || entry.kind === "tool";

export function endedTurnIds(entries: readonly TimelineEntry[]): Set<string> {
  const ended = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "system" && entry.id.startsWith("terminal:"))
      ended.add(entry.id.slice("terminal:".length));
  }
  return ended;
}

export function stepGroupId(first: TimelineEntry): string {
  return `steps:${first.id}`;
}

export function timelineRenderItems(
  entries: readonly TimelineEntry[],
  ended: ReadonlySet<string>,
): TimelineRenderItem[] {
  const items: TimelineRenderItem[] = [];
  let run: TimelineEntry[] = [];
  const flush = () => {
    if (!run.length) return;
    const turnId = run[0]!.turnId;
    const groupable =
      run.length >= 2 &&
      turnId !== undefined &&
      ended.has(turnId) &&
      run.some((entry) => entry.kind === "tool");
    if (groupable) {
      items.push({
        type: "steps",
        id: stepGroupId(run[0]!),
        turnId,
        entries: run,
      });
    } else {
      for (const entry of run) items.push({ type: "entry", entry });
    }
    run = [];
  };
  for (const entry of entries) {
    if (isStep(entry) && (!run.length || run[0]!.turnId === entry.turnId)) {
      run.push(entry);
      continue;
    }
    flush();
    if (isStep(entry)) {
      run.push(entry);
    } else if (entry.kind === "system" && entry.id.startsWith("terminal:")) {
      items.push({
        type: "summary",
        entry,
        turnId: entry.id.slice("terminal:".length),
      });
    } else {
      items.push({ type: "entry", entry });
    }
  }
  flush();
  return items;
}

/** Every step-group id in the transcript, for "Expand all". */
export function stepGroupIds(entries: readonly TimelineEntry[]): string[] {
  return timelineRenderItems(entries, endedTurnIds(entries)).flatMap((item) =>
    item.type === "steps" ? [item.id] : [],
  );
}

export interface StepGroupSummary {
  steps: number;
  /** Failed steps the turn never recovered from. */
  failed: number;
  /** Failed steps a later call of the same tool succeeded at. */
  retried: number;
  seconds?: number | undefined;
}

export function summarizeSteps(
  entries: readonly TimelineEntry[],
  recovered: ReadonlySet<string> = new Set(),
): StepGroupSummary {
  const tools = entries.filter((entry) => entry.kind === "tool");
  const starts = entries.flatMap((entry) =>
    entry.startedAtMs === undefined ? [] : [entry.startedAtMs],
  );
  const ends = entries.flatMap((entry) =>
    entry.endedAtMs === undefined ? [] : [entry.endedAtMs],
  );
  const seconds =
    starts.length && ends.length
      ? Math.max(
          0,
          Math.round((Math.max(...ends) - Math.min(...starts)) / 1000),
        )
      : undefined;
  return {
    steps: tools.length,
    failed: tools.filter(
      (entry) => entry.status === "error" && !recovered.has(entry.id),
    ).length,
    retried: tools.filter(
      (entry) => entry.status === "error" && recovered.has(entry.id),
    ).length,
    seconds: seconds ? seconds : undefined,
  };
}
