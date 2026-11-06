import { describe, expect, it, vi } from "vitest";
import {
  createUsageCommands,
  parseUsageAnalytics,
  usageScope,
  UsageReadError,
} from "../src/usage.ts";
import { OctosUiClient } from "../src/client.ts";
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

  it("reads ledgers written before the cache fields, and refuses malformed totals", () => {
    const legacy = structuredClone(captured.session) as {
      totals: Record<string, unknown>;
    };
    delete legacy.totals.cache_read_tokens;
    delete legacy.totals.cache_write_tokens;
    expect(parseUsageAnalytics(legacy)?.totals.cacheReadTokens).toBe(0);
    for (const broken of [
      {
        ...captured.empty,
        totals: { ...captured.empty.totals, run_count: -1 },
      },
      {
        ...captured.empty,
        totals: { ...captured.empty.totals, input_tokens: 1.5 },
      },
      {
        ...captured.empty,
        totals: { ...captured.empty.totals, estimated_cost_usd: "0.4" },
      },
      { ...captured.empty, by_model: [{ key: 1, totals: {} }] },
      { ...captured.empty, by_day: undefined },
      null,
    ])
      expect(parseUsageAnalytics(broken)).toBeNull();
  });

  it("reads an admin token's working profile, and everyone else's own ledger", () => {
    expect(usageScope({ user: { id: "admin", role: "admin" } }, "dev")).toEqual(
      { kind: "profile", profileId: "dev" },
    );
    // A tenant host already scopes /api/my to its profile.
    expect(
      usageScope(
        { user: { role: "admin" }, scoped_profile: { id: "tenant" } },
        "dev",
      ),
    ).toEqual({ kind: "mine" });
    expect(usageScope({ user: { id: "u1", role: "user" } }, "u1")).toEqual({
      kind: "mine",
    });
    expect(usageScope({ user: { role: "admin" } }, " ")).toEqual({
      kind: "mine",
    });
    expect(usageScope(null, "dev")).toEqual({ kind: "mine" });
  });

  it("sends the token only as a header, with the exact routes and RFC 3339 range", async () => {
    const fetchMock = vi.fn(async () => json(captured.session));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new OctosUiClient({ endpoint, token: " secret-usage " });
      const usage = await client.usageCommands("dev");
      const from = new Date("2026-11-04T16:00:00.000Z");
      const to = new Date("2026-11-05T16:00:00.000Z");
      await usage.read({ kind: "mine" }, {});
      await usage.read(
        { kind: "profile", profileId: "dev team" },
        { sessionId: "dev:api:web-1#a/b", from, to },
      );
      const calls = fetchMock.mock.calls as unknown as [URL, RequestInit][];
      expect(String(calls[0]![0])).toBe("https://example.invalid/api/my/usage");
      expect(String(calls[1]![0])).toBe(
        "https://example.invalid/api/admin/profiles/dev%20team/usage/sessions/dev%3Aapi%3Aweb-1%23a%2Fb?from=2026-11-04T16%3A00%3A00.000Z&to=2026-11-05T16%3A00%3A00.000Z",
      );
      for (const [url, init] of calls) {
        expect(String(url)).not.toContain("secret");
        expect(new Headers(init.headers).get("authorization")).toBe(
          "Bearer secret-usage",
        );
        expect(init).toMatchObject({
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
        });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("asks auth/me who the token is before choosing a route", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ user: { id: "admin", role: "admin" } }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            date: "Fri, 06 Nov 2026 10:00:00 GMT",
          },
        }),
    );
    const usage = createUsageCommands({
      endpoint: "http://127.0.0.1:9/",
      token: "t",
      profileId: "dev",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(usage.scope()).resolves.toEqual({
      scope: { kind: "profile", profileId: "dev" },
      // The server's own clock anchors the period windows (T-0432).
      serverNow: new Date("2026-11-06T10:00:00.000Z"),
    });
    expect(String((fetchMock.mock.calls[0] as unknown as [URL])[0])).toBe(
      "http://127.0.0.1:9/api/auth/me",
    );
  });

  it("an auth/me 404 is a probe failure, never a missing ledger", async () => {
    // T-0432: an older server without the auth route must not be reported as
    // "this server does not keep a usage ledger".
    for (const status of [404, 405, 503]) {
      const usage = createUsageCommands({
        endpoint,
        profileId: "dev",
        fetch: (async () =>
          new Response("no route", { status })) as unknown as typeof fetch,
      });
      const error = await usage.scope().catch((cause) => cause);
      expect(error).toMatchObject({ kind: "probe-failed", status });
    }
    // The ledger routes themselves still mean what they say.
    const usage = createUsageCommands({
      endpoint,
      profileId: "dev",
      fetch: (async () =>
        new Response("no route", { status: 404 })) as unknown as typeof fetch,
    });
    const error = await usage.read({ kind: "mine" }).catch((cause) => cause);
    expect(error).toMatchObject({ kind: "unsupported", status: 404 });
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

  it("lets an abort through as an abort", async () => {
    const abort = new DOMException("stop", "AbortError");
    const usage = createUsageCommands({
      endpoint,
      profileId: "dev",
      fetch: (async () => {
        throw abort;
      }) as unknown as typeof fetch,
    });
    await expect(usage.read({ kind: "mine" })).rejects.toBe(abort);
  });
});
