import type {
  SessionStatusReadResult,
  TokenCostUpdate,
} from "@octos-org/octoscode-client/protocol";

/** Session totals as reported by the server; nothing here is estimated locally. */
export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** The server's estimate in USD; absent when it reported none. */
  costUsd?: number;
}

/**
 * Prefer the live `token_cost_update` for this Session (session-cumulative
 * tokens and cost), else the last `session/status/read` usage. Null when the
 * server has reported neither, so the composer shows nothing rather than zero.
 */
export function sessionUsage(
  sessionId: string | null | undefined,
  status: SessionStatusReadResult | null | undefined,
  live: TokenCostUpdate | null | undefined,
): SessionUsage | null {
  if (!sessionId) return null;
  if (live && live.sessionId === sessionId) {
    const usd = !live.currency || live.currency.toUpperCase() === "USD";
    return {
      inputTokens: live.inputTokens ?? 0,
      outputTokens: live.outputTokens ?? 0,
      cachedTokens: live.cacheReadTokens ?? 0,
      ...(usd && live.sessionCost !== undefined
        ? { costUsd: live.sessionCost }
        : {}),
    };
  }
  if (!status || status.session_id !== sessionId) return null;
  const usage = status.usage ?? {};
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cachedTokens: usage.cached_input_tokens ?? 0,
    ...(usage.estimated_cost_micros_usd !== undefined
      ? { costUsd: usage.estimated_cost_micros_usd / 1_000_000 }
      : {}),
  };
}

export function formatTokenCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    ...(value > 0 && value < 0.01
      ? { maximumSignificantDigits: 2 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  }).format(value);
}
