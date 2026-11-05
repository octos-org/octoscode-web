import type {
  UsageRollup,
  UsageScope,
  UsageTotals,
} from "@octos-org/octoscode-client/usage";

export type UsageRange = "today" | "7d" | "30d" | "all";

export const USAGE_RANGES: readonly {
  value: UsageRange;
  label: string;
}[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

export const SESSIONS_PER_PAGE = 8;

/**
 * Local calendar days, open-ended so a refresh picks up runs finished since.
 * The server compares `from` inclusively against each run's timestamp.
 */
export function rangeStart(range: UsageRange, now: Date): Date | undefined {
  if (range === "all") return undefined;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);
  return start;
}

/**
 * The full prompt. The ledger keeps cache reads and writes out of
 * `input_tokens`; the composer's usage chip counts them as input, so this page
 * does too.
 */
export function promptTokens(totals: UsageTotals): number {
  return totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
}

/** The server's figure, or null: 0 also means no run had a price. */
export function recordedCost(totals: UsageTotals): number | null {
  return totals.estimatedCostUsd > 0 ? totals.estimatedCostUsd : null;
}

/** Busiest model first; the server sends them by name. */
export function modelsByUse(rollups: readonly UsageRollup[]): UsageRollup[] {
  return [...rollups].sort(
    (a, b) =>
      promptTokens(b.totals) +
        b.totals.outputTokens -
        (promptTokens(a.totals) + a.totals.outputTokens) ||
      b.totals.runCount - a.totals.runCount ||
      a.key.localeCompare(b.key),
  );
}

/** Newest day first. */
export function daysNewestFirst(
  rollups: readonly UsageRollup[],
): UsageRollup[] {
  return [...rollups].sort((a, b) => b.key.localeCompare(a.key));
}

export interface UsageSessionRow {
  readonly sessionId: string;
  readonly title: string | null;
  readonly updatedAt: number | null;
}

export function sessionPage<T>(
  rows: readonly T[],
  page: number,
): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / SESSIONS_PER_PAGE));
  const current = Math.min(Math.max(0, page), pages - 1);
  return {
    rows: rows.slice(
      current * SESSIONS_PER_PAGE,
      (current + 1) * SESSIONS_PER_PAGE,
    ),
    page: current,
    pages,
  };
}

/** What a result answers; a result for another key is never shown. */
export function usageQueryKey(
  scopeKey: string,
  range: UsageRange,
  ...rest: readonly (string | null)[]
): string {
  return JSON.stringify([scopeKey, range, ...rest]);
}

export function scopeKeyOf(scope: UsageScope): string {
  return JSON.stringify(scope);
}
