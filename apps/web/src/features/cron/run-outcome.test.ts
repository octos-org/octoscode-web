import { describe, expect, it } from "vitest";
import type { CronJob } from "@octos-org/octoscode-client/cron";
import type {
  HydratedMessage,
  HydratedTurn,
  ProjectionEnvelopeV2,
} from "@octos-org/octoscode-client/protocol";
import {
  LINK_WINDOW_MS,
  failureReason,
  linksOf,
  needsTurnsRead,
  runOutcomes,
  turnStarters,
  type LinkedOutcome,
  type TurnStarter,
} from "./run-outcome.ts";

const SESSION = "coding:api:one";
const T0 = Date.parse("2026-11-04T00:53:13.890Z");
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
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
interface T {
  id: string;
  state: string;
  at: number;
  by?: TurnStarter;
}
const turn = (id: string, state: string, at: number, by?: TurnStarter): T => ({
  id,
  state,
  at,
  ...(by ? { by } : {}),
});
/** Timing without any wall clock: what the server list proved, and how long this page knew. */
const timing = (serverEarliest: number | null = null, knownFor = 0) => ({
  serverEarliest,
  knownFor: () => knownFor,
});
const outcomes = (
  jobs: CronJob[],
  turns: T[] | undefined,
  clock = timing(),
  confirmed: ReadonlyMap<string, LinkedOutcome> = new Map(),
) =>
  runOutcomes(
    jobs,
    new Map(
      turns
        ? [
            [
              SESSION,
              {
                turns: turns.map((each): HydratedTurn => ({
                  turn_id: each.id,
                  state: each.state,
                  started_at: iso(each.at),
                })),
                starters: new Map(
                  turns.flatMap((each) =>
                    each.by ? [[each.id, each.by] as const] : [],
                  ),
                ),
              },
            ],
          ]
        : [],
    ),
    clock,
    confirmed,
  );
const closed = timing(T0 + LINK_WINDOW_MS + 60_000);

describe("runOutcomes", () => {
  it("reports a turn the server started that failed, even though the job says ok", () => {
    const result = outcomes(
      [job("a", iso(0))],
      [turn("t1", "errored", 1_938, "system")],
    );
    expect(result.get("a")).toEqual({ kind: "failed", at: T0, turnId: "t1" });
  });

  it("never takes a person's turn, even one right after a run that started none", () => {
    // A notify job delivers its text and starts no turn; the person writes
    // 0.6 s later. Their turn is theirs.
    const jobs = [job("notify", iso(0))];
    const turns = [turn("mine", "errored", 600, "person")];
    expect(outcomes(jobs, turns).get("notify")).toEqual({
      kind: "pending",
      at: T0,
    });
    expect(outcomes(jobs, turns, closed).get("notify")).toEqual({
      kind: "unlinked",
      at: T0,
      why: "no-turn",
    });
  });

  it("does not chain: a run with no turn leaves the next run's turn alone", () => {
    const result = outcomes(
      [job("notify", iso(0)), job("report", iso(60_000))],
      [
        turn("mine", "completed", 600, "person"),
        turn("report-turn", "completed", 61_000, "system"),
      ],
      closed,
    );
    expect(result.get("notify")).toEqual({
      kind: "unlinked",
      at: T0,
      why: "no-turn",
    });
    expect(result.get("report")).toEqual({
      kind: "succeeded",
      at: T0 + 60_000,
      turnId: "report-turn",
    });
  });

  it("says it cannot tell when two runs fire together", () => {
    const result = outcomes(
      [job("late", iso(32)), job("early", iso(0))],
      [
        turn("t1", "completed", 1_938, "system"),
        turn("t2", "errored", 3_938, "system"),
      ],
    );
    expect(result.get("early")).toEqual({
      kind: "unlinked",
      at: T0,
      why: "ambiguous",
    });
    expect(result.get("late")).toMatchObject({
      kind: "unlinked",
      why: "ambiguous",
    });
  });

  it("keeps two jobs a minute apart on one Session to their own turns", () => {
    const result = outcomes(
      [job("b", iso(60_000)), job("a", iso(0))],
      [
        turn("ta", "completed", 900, "system"),
        turn("tb", "errored", 61_100, "system"),
      ],
    );
    expect(result.get("a")).toMatchObject({ kind: "succeeded", turnId: "ta" });
    expect(result.get("b")).toMatchObject({ kind: "failed", turnId: "tb" });
  });

  it("calls a turn too long after the run late, not this run's", () => {
    const result = outcomes(
      [job("a", iso(0))],
      [turn("t1", "completed", 45_000, "system")],
    );
    expect(result.get("a")).toEqual({ kind: "unlinked", at: T0, why: "late" });
  });

  it("does not call a turn after the next run, or much later, this run's", () => {
    const result = outcomes(
      [job("notify", iso(0)), job("next", iso(20 * 60_000))],
      [
        turn("next-turn", "completed", 20 * 60_000 + 900, "system"),
        turn("stray", "completed", 25 * 60_000, "system"),
      ],
      timing(T0 + 40 * 60_000),
    );
    expect(result.get("notify")).toEqual({
      kind: "unlinked",
      at: T0,
      why: "no-turn",
    });
    expect(result.get("next")).toMatchObject({
      kind: "succeeded",
      turnId: "next-turn",
    });
  });

  it("does not link a turn whose opener cannot be read", () => {
    expect(
      outcomes([job("a", iso(0))], [turn("t1", "completed", 900)]).get("a"),
    ).toEqual({ kind: "unlinked", at: T0, why: "ambiguous" });
  });

  it("ignores turns from before the run", () => {
    expect(
      outcomes(
        [job("a", iso(0))],
        [turn("old", "errored", -200_000, "system")],
      ).get("a"),
    ).toEqual({ kind: "pending", at: T0 });
  });

  it("closes the window by the server's clock or this page's, never the browser's", () => {
    const jobs = [job("a", iso(0))];
    expect(outcomes(jobs, [], timing(null, 0)).get("a")?.kind).toBe("pending");
    // The list proves the server is past the window.
    expect(
      outcomes(jobs, [], timing(T0 + LINK_WINDOW_MS + 1_001)).get("a")?.kind,
    ).toBe("unlinked");
    // Or this page has known the run longer than the window.
    expect(
      outcomes(jobs, [], timing(null, LINK_WINDOW_MS + 1_001)).get("a")?.kind,
    ).toBe("unlinked");
  });

  it("keeps a confirmed link when a later read lacks what made it", () => {
    const jobs = [job("a", iso(0)), job("b", iso(10))];
    const first = outcomes(jobs, [turn("t1", "completed", 900, "system")]);
    expect(first.get("a")).toMatchObject({ kind: "unlinked" });
    const once = outcomes([jobs[0]!], [turn("t1", "completed", 900, "system")]);
    const links = linksOf([jobs[0]!], once);
    expect(links.size).toBe(1);
    // The turn list is now empty (or its starters unread): the link stands,
    // and its turn is not offered to the other run.
    expect(outcomes(jobs, [], timing(), links).get("a")).toEqual({
      kind: "succeeded",
      at: T0,
      turnId: "t1",
    });
    expect(
      outcomes(jobs, [turn("t1", "completed", 900)], timing(), links).get("b"),
    ).toEqual({ kind: "pending", at: T0 + 10 });
  });

  it("claims nothing until the Session's turns are known", () => {
    expect(outcomes([job("a", iso(0))], undefined).get("a")).toEqual({
      kind: "unconfirmed",
      at: T0,
    });
  });

  it("keeps a run going as running, and a stopped one as stopped", () => {
    expect(
      outcomes([job("a", iso(0))], [turn("t1", "active", 1_110, "system")]).get(
        "a",
      )?.kind,
    ).toBe("running");
    expect(
      outcomes(
        [job("a", iso(0))],
        [turn("t1", "interrupted", 1_110, "system")],
      ).get("a")?.kind,
    ).toBe("interrupted");
  });

  it("reports a delivery failure from the job, with its reason", () => {
    const result = outcomes(
      [
        job("a", null, { lastStatus: "error", lastError: "queue full" }),
        job("b", iso(0), {
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

const msg = (
  seq: number,
  role: string,
  extra: Partial<HydratedMessage> = {},
): HydratedMessage => ({
  seq,
  role,
  content: role,
  persisted_at: iso(seq),
  media: [],
  ...extra,
});

describe("turnStarters", () => {
  it("reads who opened each turn from its thread's first message", () => {
    // The shape Core b95e756f returned in the T-0369 probe.
    const starters = turnStarters({
      turns: [
        { turn_id: "u1", state: "completed", thread_id: "u1" },
        { turn_id: "c1", state: "completed", thread_id: "c1" },
        { turn_id: "x", state: "completed", thread_id: "x" },
      ],
      threads: [
        { thread_id: "u1", root_seq: 0, message_seqs: [0, 1] },
        { thread_id: "c1", root_seq: 2, message_seqs: [2] },
        { thread_id: "x", root_seq: 9 },
        "junk",
      ],
      messages: [msg(0, "user"), msg(1, "assistant"), msg(2, "assistant")],
    });
    expect([...starters]).toEqual([
      ["u1", "person"],
      ["c1", "system"],
    ]);
  });

  it("also knows a person's turn from a message that names it", () => {
    expect(
      turnStarters({
        turns: [{ turn_id: "u1", state: "completed" }],
        messages: [msg(4, "user", { turn_id: "u1" })],
      }).get("u1"),
    ).toBe("person");
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
