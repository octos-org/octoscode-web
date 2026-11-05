import { describe, expect, it } from "vitest";
import type { CronJob } from "@octos-org/octoscode-client/cron";
import {
  displayNow,
  parseNextIn,
  serverNow,
  serverTimeRange,
} from "./server-clock.ts";

const SERVER = Date.parse("2026-11-05T01:15:25.000Z");
const job = (nextRun: number | null, nextIn: string | null): CronJob => ({
  id: "j",
  name: "j",
  enabled: true,
  schedule: {},
  message: "m",
  nextRun,
  nextIn,
});

describe("server clock from cron/list", () => {
  it("reads what next_in rounded away", () => {
    expect(parseNextIn("42s")).toEqual({ left: 42_000, rounding: 999 });
    expect(parseNextIn("5m")).toEqual({ left: 300_000, rounding: 59_999 });
    expect(parseNextIn("2h 5m")).toEqual({
      left: 7_500_000,
      rounding: 59_999,
    });
    expect(parseNextIn("overdue")).toBe("overdue");
    expect(parseNextIn("soon")).toBeNull();
    expect(parseNextIn(null)).toBeNull();
  });

  it("pins the server's now between what every job agrees on", () => {
    const range = serverTimeRange(
      [
        job(SERVER + 3_540_000 + 20_000, "59m"),
        job(SERVER + 12_400, "12s"),
        job(null, null),
      ],
      100,
    );
    expect(range).toEqual({
      earliest: SERVER - 599,
      latest: SERVER + 400,
      readAt: 100,
    });
    expect(serverNow(range, 5_100)).toEqual({
      earliest: SERVER + 4_401,
      latest: SERVER + 5_400,
    });
    // An overdue job only says the server is past its time.
    expect(serverTimeRange([job(SERVER, "overdue")], 0)).toEqual({
      earliest: SERVER,
      latest: Infinity,
      readAt: 0,
    });
    expect(serverTimeRange([], 0)).toBeNull();
  });

  it("shows times against the server's clock when the browser's is an hour off", () => {
    const range = serverTimeRange([job(SERVER + 12_400, "12s")], 0);
    expect(displayNow(range, SERVER, 0)).toBe(SERVER);
    expect(displayNow(range, SERVER + 3_600_000, 0)).toBe(SERVER + 400);
    expect(displayNow(range, SERVER - 3_600_000, 0)).toBe(SERVER - 599);
    // Without a range from both sides, no relative time at all.
    expect(displayNow(null, 7, 0)).toBeNull();
    expect(
      displayNow(serverTimeRange([job(SERVER, "overdue")], 0), SERVER, 0),
    ).toBeNull();
  });
});
