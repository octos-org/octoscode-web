import { describe, expect, it } from "vitest";
import type { CronJob } from "@octos-org/octoscode-client/cron";
import type {
  HydratedTurn,
  ProjectionEnvelopeV2,
} from "@octos-org/octoscode-client/protocol";
import { failureReason, needsTurnsRead, runOutcomes } from "./run-outcome.ts";

const SESSION = "coding:api:one";
const T0 = Date.parse("2026-11-04T00:53:13.890Z");
const job = (id: string, lastRun: string | null, patch = {}): CronJob => ({
  id,
  name: id,
  enabled: true,
  schedule: {},
  message: id,
  lastRun,
  lastStatus: lastRun ? "ok" : null,
  originSessionId: SESSION,
  ...patch,
});
const turn = (
  turn_id: string,
  state: string,
  started_at: string,
): HydratedTurn => ({ turn_id, state, started_at });
const outcomes = (
  jobs: CronJob[],
  turns: HydratedTurn[] | undefined,
  now = T0 + 5_000,
) => runOutcomes(jobs, new Map(turns ? [[SESSION, turns]] : []), now);

describe("runOutcomes", () => {
  it("reports a turn that failed even though the job says ok", () => {
    const result = outcomes(
      [job("a", "2026-11-04T00:53:13.890Z")],
      [turn("t1", "errored", "2026-11-04T00:53:15.828Z")],
    );
    expect(result.get("a")).toEqual({ kind: "failed", at: T0, turnId: "t1" });
  });

  it("gives two jobs that fired together on one Session their own turns", () => {
    const result = outcomes(
      [
        job("late", "2026-11-04T00:53:13.922Z"),
        job("early", "2026-11-04T00:53:13.890Z"),
      ],
      [
        turn("t1", "completed", "2026-11-04T00:53:15.828Z"),
        turn("t2", "errored", "2026-11-04T00:53:17.828Z"),
      ],
    );
    expect(result.get("early")?.kind).toBe("succeeded");
    expect(result.get("late")?.kind).toBe("failed");
  });

  it("ignores turns from before the run", () => {
    const result = outcomes(
      [job("a", "2026-11-04T00:53:13.890Z")],
      [turn("old", "errored", "2026-11-04T00:50:00.000Z")],
    );
    expect(result.get("a")).toEqual({ kind: "pending", at: T0 });
  });

  it("stops waiting for a turn that never appeared", () => {
    const result = outcomes(
      [job("a", "2026-11-04T00:53:13.890Z")],
      [],
      T0 + 180_000,
    );
    expect(result.get("a")).toEqual({ kind: "unconfirmed", at: T0 });
  });

  it("claims nothing until the Session's turns are known", () => {
    expect(
      outcomes([job("a", "2026-11-04T00:53:13.890Z")], undefined).get("a"),
    ).toEqual({ kind: "unconfirmed", at: T0 });
  });

  it("keeps a run going as running, and a stopped one as stopped", () => {
    const running = outcomes(
      [job("a", "2026-11-04T00:53:13.890Z")],
      [turn("t1", "active", "2026-11-04T00:53:15.000Z")],
    );
    expect(running.get("a")?.kind).toBe("running");
    const stopped = outcomes(
      [job("a", "2026-11-04T00:53:13.890Z")],
      [turn("t1", "interrupted", "2026-11-04T00:53:15.000Z")],
    );
    expect(stopped.get("a")?.kind).toBe("interrupted");
  });

  it("reports a delivery failure from the job, with its reason", () => {
    const result = outcomes(
      [
        job("a", null, { lastStatus: "error", lastError: "queue full" }),
        job("b", "2026-11-04T00:53:13.890Z", {
          lastStatus: "disabled",
          lastError: "session gone",
        }),
      ],
      [],
    );
    expect(result.get("a")).toEqual({
      kind: "undelivered",
      at: null,
      reason: "queue full",
      stopped: false,
    });
    expect(result.get("b")).toEqual({
      kind: "undelivered",
      at: T0,
      reason: "session gone",
      stopped: true,
    });
  });

  it("says a job that never ran has not run", () => {
    expect(outcomes([job("a", null)], []).get("a")).toEqual({ kind: "never" });
  });
});

describe("needsTurnsRead", () => {
  const LOCAL = 1_000_000;
  const settled = { kind: "succeeded", at: T0, turnId: "t1" } as const;
  const going = { kind: "running", at: T0, turnId: "t1" } as const;

  it("reads a run it has not read for, and leaves a settled one alone", () => {
    expect(needsTurnsRead(settled, undefined, LOCAL)).toBe(true);
    expect(
      needsTurnsRead(settled, { readAt: LOCAL, forRun: T0 - 1 }, LOCAL),
    ).toBe(true);
    expect(
      needsTurnsRead(settled, { readAt: LOCAL, forRun: T0 }, LOCAL + 60_000),
    ).toBe(false);
    expect(needsTurnsRead({ kind: "never" }, undefined, LOCAL)).toBe(false);
  });

  it("does not read in a loop when this browser's clock is behind the server's", () => {
    // LOCAL is far behind T0, so comparing the read time to the run would
    // call every read stale.
    expect(needsTurnsRead(settled, { readAt: LOCAL, forRun: T0 }, LOCAL)).toBe(
      false,
    );
  });

  it("reads a run still going no more than every few seconds", () => {
    expect(needsTurnsRead(going, { readAt: LOCAL, forRun: T0 }, LOCAL)).toBe(
      false,
    );
    expect(
      needsTurnsRead(going, { readAt: LOCAL, forRun: T0 }, LOCAL + 5_000),
    ).toBe(true);
  });
});

describe("failureReason", () => {
  const terminal = (turnId: string, data: unknown) =>
    ({
      session_id: SESSION,
      thread_id: turnId,
      seq: 1,
      turn_id: turnId,
      payload: { type: "turn_terminal", data },
    }) as unknown as ProjectionEnvelopeV2;

  it("drops the provider-routing trace from the error", () => {
    expect(
      failureReason(
        [
          terminal("t1", {
            outcome: "errored",
            error: {
              code: "turn_failed",
              message:
                "custom/stub temporarily unavailable (HTTP 500) [lanes: API error (custom/stub): provider server error]",
            },
          }),
        ],
        "t1",
      ),
    ).toBe("custom/stub temporarily unavailable (HTTP 500)");
  });

  it("has no reason when the turn's record is gone or says nothing", () => {
    expect(failureReason(undefined, "t1")).toBeNull();
    expect(failureReason([terminal("t2", {})], "t1")).toBeNull();
    expect(
      failureReason([terminal("t1", { outcome: "errored" })], "t1"),
    ).toBeNull();
  });
});
