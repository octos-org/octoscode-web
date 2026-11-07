import { describe, expect, it } from "vitest";
import type { CronJob } from "@octos-org/octoscode-client/cron";
import type { HydratedTurn } from "@octos-org/octoscode-client/protocol";
import {
  LINK_WINDOW_MS,
  runOutcomes,
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
});
