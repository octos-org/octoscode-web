import { describe, expect, it } from "vitest";
import {
  createUsageCommands,
  parseUsageAnalytics,
  UsageReadError,
} from "../src/usage.ts";

import captured from "./fixtures/usage-core-6fc12da3.json" with { type: "json" };

const endpoint = "wss://example.invalid/api/ui-protocol/ws?token=must-not-keep";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("Core #1376 usage ledger", () => {
  it("parses what a real Core returns, keeping the server's own groupings", () => {
    const profile = parseUsageAnalytics(captured.profile);
    expect(profile?.totals).toEqual({
      runCount: 3,
      inputTokens: 60,
      outputTokens: 60,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
    });
    expect(profile?.byDay.map((day) => day.key)).toEqual(["2026-11-05"]);
    expect(profile?.byModel).toEqual([
      {
        key: "t0392-probe-stub",
        totals: expect.objectContaining({ runCount: 3 }),
      },
    ]);
    expect(parseUsageAnalytics(captured.session)?.totals.runCount).toBe(2);
    expect(parseUsageAnalytics(captured.empty)).toEqual({
      totals: expect.objectContaining({ runCount: 0, estimatedCostUsd: 0 }),
      byDay: [],
      byModel: [],
    });
  });

  it("classifies failures without projecting response bodies", async () => {
    const cases: [Response | Error, string, number | null][] = [
      [new Response("no route", { status: 404 }), "unsupported", 404],
      [new Response("", { status: 405 }), "unsupported", 405],
      [new Response("", { status: 503 }), "unsupported", 503],
      [new Response("", { status: 401 }), "signed-out", 401],
      [new Response("", { status: 403 }), "forbidden", 403],
      [
        new Response("/home/someone/.octos/usage.redb", { status: 500 }),
        "failed",
        500,
      ],
      [new Response("not json"), "invalid", 200],
      [json({ totals: {} }), "invalid", null],
      [new TypeError("Failed to fetch"), "failed", null],
    ];
    for (const [outcome, kind, status] of cases) {
      const usage = createUsageCommands({
        endpoint,
        profileId: "dev",
        fetch: (async () => {
          if (outcome instanceof Error) throw outcome;
          return outcome;
        }) as unknown as typeof fetch,
      });
      const error = await usage.read({ kind: "mine" }).catch((cause) => cause);
      expect(error).toBeInstanceOf(UsageReadError);
      expect(error).toMatchObject({ kind, status });
      expect(String(error.message)).not.toContain("/home/");
    }
  });
});
