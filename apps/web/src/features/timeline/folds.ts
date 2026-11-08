/** Per-block expanded memory. Absent = folded (the default for both kinds). */
export type FoldState = Readonly<{ [id: string]: boolean }>;

export const COLLAPSED_ALL = "__collapsed_all__";

export function initialFoldState(): FoldState {
  return {};
}

export function toggleFold(folds: FoldState, id: string): FoldState {
  return { ...folds, [id]: !folds[id] };
}

/** Records an explicit open/closed choice for one block. */
export function setFold(
  folds: FoldState,
  id: string,
  open: boolean,
): FoldState {
  return { ...folds, [id]: open };
}

/** Expands exactly the given live ids; ids not listed fold back. */
export function expandAll(
  _folds: FoldState,
  ids: readonly string[],
): FoldState {
  return Object.fromEntries(ids.map((id) => [id, true] as const)) as FoldState;
}

/** Explicit all-folded state, distinct from the unset error-auto-open default. */
export function collapseAll(_folds: FoldState): FoldState {
  return { [COLLAPSED_ALL]: false };
}

const TRUNCATED_TARGET_LENGTH = 24;

// Chinese, Japanese and Korean write without spaces between words: each of
// their characters counts as one, the way a CJK reader counts length.
const CJK_SINGLE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function countWords(body: string): number {
  const trimmed = body.trim();
  if (!trimmed) return 0;
  if (CJK_SINGLE.test(trimmed)) {
    return Array.from(trimmed.replace(/\s/g, "")).filter((character) =>
      /[\p{L}\p{N}]/u.test(character),
    ).length;
  }
  return trimmed.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word))
    .length;
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

export function thinkingSummaryParts(input: ThinkingSummaryInput): {
  seconds: number | undefined;
  words: number;
  unit: "words" | "characters";
} {
  const cjk = CJK_SINGLE.test(input.body);
  return {
    seconds: durationSeconds(
      input.startedAtMs,
      input.endedAtMs ?? input.updatedAtMs,
    ),
    words: countWords(input.body),
    unit: cjk ? "characters" : "words",
  };
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

/** Best-effort untruncated single-line target for identity and aggregation. */
export function toolTargetFull(argumentsJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    for (const key of TARGET_KEYS) {
      const match = argumentsJson.match(
        new RegExp(`(?:^|[,\\s])${key}\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`),
      );
      if (!match) continue;
      try {
        const value = JSON.parse(`"${match[1]}"`) as unknown;
        if (typeof value === "string" && value.trim()) {
          const first = value.trim().split("\n")[0] ?? "";
          return first;
        }
      } catch {
        return "";
      }
    }
    return "";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const row = parsed as Record<string, unknown>;
  for (const key of TARGET_KEYS) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      const first = value.trim().split("\n")[0] ?? "";
      return first;
    }
  }
  return "";
}

export function toolTarget(argumentsJson: string): string {
  const first = toolTargetFull(argumentsJson);
  return first.length > TRUNCATED_TARGET_LENGTH
    ? `${first.slice(0, TRUNCATED_TARGET_LENGTH)}…`
    : first;
}
