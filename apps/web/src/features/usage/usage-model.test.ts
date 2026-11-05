import { describe, expect, it } from "vitest";
import type { UsageTotals } from "@octos-org/octoscode-client/usage";
import {
  SESSIONS_PER_PAGE,
  daysNewestFirst,
  modelsByUse,
  promptTokens,
  rangeStart,
  recordedCost,
  sessionPage,
  usageQueryKey,
} from "./usage-model.ts";

const totals = (patch: Partial<UsageTotals> = {}): UsageTotals => ({
  runCount: 1,
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: 0,
  ...patch,
});

describe("usage ledger page model", () => {
  it("starts presets at local midnight and leaves the end open", () => {
    const now = new Date(2026, 10, 5, 1, 30);
    expect(rangeStart("all", now)).toBeUndefined();
    expect(rangeStart("today", now)).toEqual(new Date(2026, 10, 5));
    expect(rangeStart("7d", now)).toEqual(new Date(2026, 9, 30));
    expect(rangeStart("30d", now)).toEqual(new Date(2026, 9, 7));
  });

  it("counts cache reads and writes as input, as the composer chip does", () => {
    expect(
      promptTokens(
        totals({ inputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 60 }),
      ),
    ).toBe(1000);
  });

  it("shows money only when the server recorded some", () => {
    expect(recordedCost(totals())).toBeNull();
    expect(recordedCost(totals({ estimatedCostUsd: 0.0042 }))).toBe(0.0042);
  });

  it("orders models by tokens and days newest first", () => {
    expect(
      modelsByUse([
        { key: "small", totals: totals({ inputTokens: 10 }) },
        {
          key: "big",
          totals: totals({ inputTokens: 5, cacheReadTokens: 900 }),
        },
        { key: "mid", totals: totals({ inputTokens: 300 }) },
      ]).map((row) => row.key),
    ).toEqual(["big", "mid", "small"]);
    expect(
      daysNewestFirst([
        { key: "2026-11-03", totals: totals() },
        { key: "2026-11-05", totals: totals() },
        { key: "2026-10-30", totals: totals() },
      ]).map((row) => row.key),
    ).toEqual(["2026-11-05", "2026-11-03", "2026-10-30"]);
  });

  it("pages Sessions and keeps the page inside the list as it shrinks", () => {
    const rows = Array.from({ length: SESSIONS_PER_PAGE * 2 + 1 }, (_, i) => i);
    expect(sessionPage(rows, 0)).toMatchObject({ page: 0, pages: 3 });
    expect(sessionPage(rows, 2).rows).toEqual([SESSIONS_PER_PAGE * 2]);
    expect(sessionPage(rows.slice(0, 3), 2)).toEqual({
      rows: [0, 1, 2],
      page: 0,
      pages: 1,
    });
    expect(sessionPage([], 0)).toEqual({ rows: [], page: 0, pages: 1 });
  });

  it("keys a result to everything it answers", () => {
    const base = usageQueryKey('{"kind":"mine"}', "7d", null);
    expect(usageQueryKey('{"kind":"mine"}', "30d", null)).not.toBe(base);
    expect(usageQueryKey('{"kind":"mine"}', "7d", "s1")).not.toBe(base);
    expect(
      usageQueryKey('{"kind":"profile","profileId":"p"}', "7d", null),
    ).not.toBe(base);
  });
});
