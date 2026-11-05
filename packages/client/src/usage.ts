import { serverApiUrl } from "./media.ts";
import { isRecord } from "./rpc.ts";

/**
 * Core #1376 persistent usage ledger, read over its authenticated REST routes
 * (`/api/my/usage`, `/api/admin/profiles/{id}/usage`, each with a
 * `/sessions/{id}` form). The ledger has no WebSocket method; these are the
 * routes Core's own typed client reads.
 *
 * Ledger `input_tokens` exclude cache reads and writes: the full prompt is
 * `input + cache_read + cache_write`. `estimated_cost_usd` sums only the runs
 * the server priced, so 0 also means "no run had a price".
 */
export interface UsageTotals {
  readonly runCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly estimatedCostUsd: number;
}

export interface UsageRollup {
  readonly key: string;
  readonly totals: UsageTotals;
}

/** Only the server's own groupings; nothing here is summed in the browser. */
export interface UsageAnalytics {
  readonly totals: UsageTotals;
  /** Keyed by UTC calendar day, `YYYY-MM-DD`. */
  readonly byDay: readonly UsageRollup[];
  readonly byModel: readonly UsageRollup[];
}

/**
 * Whose ledger to read. An admin token's `/api/my/usage` is the `admin`
 * profile's ledger, not the profile its Sessions run under, so an admin reads
 * that profile through the admin route instead; everyone else reads their own.
 */
export type UsageScope =
  | { readonly kind: "mine" }
  | { readonly kind: "profile"; readonly profileId: string };

export interface UsageQuery {
  readonly sessionId?: string;
  readonly from?: Date;
  readonly to?: Date;
}

export type UsageFailure =
  "unsupported" | "signed-out" | "forbidden" | "invalid" | "failed";

export class UsageReadError extends Error {
  readonly kind: UsageFailure;
  readonly status: number | null;

  constructor(kind: UsageFailure, status: number | null) {
    super(
      status === null
        ? `Usage request failed (${kind})`
        : `Usage request failed with HTTP ${status}`,
    );
    this.name = "UsageReadError";
    this.kind = kind;
    this.status = status;
  }
}

export function createUsageCommands(options: {
  endpoint: string;
  token?: string;
  /** The profile this connection's Sessions run under. */
  profileId: string;
  fetch?: typeof fetch;
}) {
  const send = options.fetch ?? globalThis.fetch;
  async function get(url: URL, signal?: AbortSignal): Promise<unknown> {
    const headers = new Headers({ Accept: "application/json" });
    if (options.token?.trim())
      headers.set("Authorization", "Bearer " + options.token.trim());
    let response: Response;
    try {
      response = await send(url, {
        method: "GET",
        headers,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        ...(signal ? { signal } : {}),
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") throw cause;
      throw new UsageReadError("failed", null);
    }
    // Bodies are never projected: they may echo private paths.
    if (!response.ok)
      throw new UsageReadError(failureFor(response.status), response.status);
    try {
      return await response.json();
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") throw cause;
      throw new UsageReadError("invalid", response.status);
    }
  }
  return {
    async scope(signal?: AbortSignal): Promise<UsageScope> {
      const me = await get(serverApiUrl(options.endpoint, "auth/me"), signal);
      return usageScope(me, options.profileId);
    },
    async read(
      scope: UsageScope,
      query: UsageQuery = {},
      signal?: AbortSignal,
    ): Promise<UsageAnalytics> {
      const url = serverApiUrl(options.endpoint, usageRoute(scope, query));
      if (query.from) url.searchParams.set("from", query.from.toISOString());
      if (query.to) url.searchParams.set("to", query.to.toISOString());
      const value = await get(url, signal);
      const analytics = parseUsageAnalytics(value);
      if (!analytics) throw new UsageReadError("invalid", null);
      return analytics;
    },
  };
}

export type UsageCommands = ReturnType<typeof createUsageCommands>;

/** `auth/me` says who the token is; a tenant host already scopes `/api/my`. */
export function usageScope(me: unknown, profileId: string): UsageScope {
  const user = isRecord(me) && isRecord(me.user) ? me.user : null;
  if (
    user?.role === "admin" &&
    !(isRecord(me) && me.scoped_profile) &&
    profileId.trim()
  )
    return { kind: "profile", profileId: profileId.trim() };
  return { kind: "mine" };
}

function usageRoute(scope: UsageScope, query: UsageQuery): string {
  const base =
    scope.kind === "profile"
      ? `admin/profiles/${encodeURIComponent(scope.profileId)}/usage`
      : "my/usage";
  return query.sessionId
    ? `${base}/sessions/${encodeURIComponent(query.sessionId)}`
    : base;
}

function failureFor(status: number): UsageFailure {
  // 503: the server keeps no profile store, so no ledger either.
  if (status === 404 || status === 405 || status === 503) return "unsupported";
  if (status === 401) return "signed-out";
  if (status === 403) return "forbidden";
  return "failed";
}

export function parseUsageAnalytics(value: unknown): UsageAnalytics | null {
  if (!isRecord(value)) return null;
  const totals = parseTotals(value.totals);
  const byDay = parseRollups(value.by_day);
  const byModel = parseRollups(value.by_model);
  if (!totals || !byDay || !byModel) return null;
  return { totals, byDay, byModel };
}

function parseRollups(value: unknown): UsageRollup[] | null {
  if (!Array.isArray(value) || value.length > 10_000) return null;
  const rollups: UsageRollup[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== "string") return null;
    const totals = parseTotals(entry.totals);
    if (!totals) return null;
    rollups.push({ key: entry.key, totals });
  }
  return rollups;
}

function parseTotals(value: unknown): UsageTotals | null {
  if (!isRecord(value)) return null;
  const count = (field: unknown, optional = false) =>
    field === undefined && optional
      ? 0
      : typeof field === "number" && Number.isSafeInteger(field) && field >= 0
        ? field
        : null;
  const runCount = count(value.run_count);
  const inputTokens = count(value.input_tokens);
  const outputTokens = count(value.output_tokens);
  // Ledgers older than the cache fields omit them; Core reads those as 0.
  const cacheReadTokens = count(value.cache_read_tokens, true);
  const cacheWriteTokens = count(value.cache_write_tokens, true);
  const cost = value.estimated_cost_usd;
  if (
    runCount === null ||
    inputTokens === null ||
    outputTokens === null ||
    cacheReadTokens === null ||
    cacheWriteTokens === null ||
    typeof cost !== "number" ||
    !Number.isFinite(cost) ||
    cost < 0
  )
    return null;
  return {
    runCount,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    estimatedCostUsd: cost,
  };
}
