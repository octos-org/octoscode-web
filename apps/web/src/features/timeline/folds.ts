import type { TimelineEntry, TimelineStatus } from "./model.ts";

/** Per-block expanded memory. Absent = folded (the default for both kinds). */
export type FoldState = Readonly<{ [id: string]: true }>;

export function initialFoldState(): FoldState {
  return {};
}

export function isFoldExpanded(folds: FoldState, id: string): boolean {
  return folds[id] === true;
}

export function toggleFold(folds: FoldState, id: string): FoldState {
  const next = { ...folds };
  if (next[id]) delete next[id];
  else next[id] = true;
  return next;
}

/** Expands exactly the given live ids; ids not listed fold back. */
export function expandAll(
  _folds: FoldState,
  ids: readonly string[],
): FoldState {
  return Object.fromEntries(ids.map((id) => [id, true] as const)) as FoldState;
}

/** Back to the all-folded default; per-block memory is discarded. */
export function collapseAll(_folds: FoldState): FoldState {
  return {};
}

/** Drops memory for blocks that left the bounded transcript window. */
export function pruneFolds(
  folds: FoldState,
  liveIds: readonly string[],
): FoldState {
  const live = new Set(liveIds);
  return Object.fromEntries(
    Object.entries(folds).filter(([id]) => live.has(id)),
  );
}

const TRUNCATED_TARGET_LENGTH = 24;

function countWords(body: string): number {
  const trimmed = body.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function durationSeconds(
  startedAtMs: number | undefined,
  endOrUpdatedAtMs: number | undefined,
): number | undefined {
  if (startedAtMs === undefined || endOrUpdatedAtMs === undefined)
    return undefined;
  return Math.max(0, Math.round((endOrUpdatedAtMs - startedAtMs) / 1000));
}

export interface ThinkingSummaryInput {
  body: string;
  startedAtMs?: number | undefined;
  endedAtMs?: number | undefined;
  /** Latest streamed delta time when the block is still running. */
  updatedAtMs?: number;
}

export function thinkingSummaryParts(
  input: ThinkingSummaryInput,
): { seconds: number | undefined; words: number } {
  return {
    seconds: durationSeconds(
      input.startedAtMs,
      input.endedAtMs ?? input.updatedAtMs,
    ),
    words: countWords(input.body),
  };
}

/** "Thinking · 12 s · 340 words" — one line, English source; zh via copy table. */
export function thinkingSummary(input: ThinkingSummaryInput): string {
  const { seconds, words } = thinkingSummaryParts(input);
  return [
    "Thinking",
    seconds === undefined ? undefined : `${seconds} s`,
    `${words} words`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

export function toolStatusGlyph(status: TimelineStatus): string {
  switch (status) {
    case "running":
      return "◐";
    case "complete":
      return "✓";
    case "error":
      return "✗";
    case "info":
      return "·";
  }
}

const TARGET_KEYS = [
  "cmd",
  "command",
  "path",
  "file_path",
  "filepath",
  "file",
  "url",
  "query",
  "pattern",
  "name",
] as const;

/** Best-effort single-line target from a tool call's arguments JSON. */
export function toolTarget(argumentsJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return "";
  const row = parsed as Record<string, unknown>;
  for (const key of TARGET_KEYS) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      const first = value.trim().split("\n")[0] ?? "";
      return first.length > TRUNCATED_TARGET_LENGTH
        ? `${first.slice(0, TRUNCATED_TARGET_LENGTH)}…`
        : first;
    }
  }
  return "";
}

export function toolHeaderLine(entry: {
  title: string;
  body: string;
  status: TimelineStatus;
  startedAtMs?: number | undefined;
  endedAtMs?: number | undefined;
}): string {
  const seconds = durationSeconds(entry.startedAtMs, entry.endedAtMs);
  return [
    entry.title,
    toolTarget(entry.body) || undefined,
    toolStatusGlyph(entry.status),
    seconds === undefined ? undefined : `${seconds} s`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

/** The one-line header summary for a thinking block fold. */
export function entryHeaderSummary(
  entry: Pick<
    TimelineEntry,
    "id" | "kind" | "body" | "startedAtMs" | "endedAtMs"
  >,
): string {
  return entry.kind === "reasoning"
    ? thinkingSummary({
        body: entry.body,
        startedAtMs: entry.startedAtMs,
        endedAtMs: entry.endedAtMs,
      })
    : toolHeaderLine({
        title: entry.id,
        body: entry.body,
        status: "info",
        startedAtMs: entry.startedAtMs,
        endedAtMs: entry.endedAtMs,
      });
}