import { describe, expect, it } from "vitest";
import type { ProjectionEnvelopeV2 } from "@octos-org/octoscode-client/protocol";
import type { UsageAnalytics } from "@octos-org/octoscode-client/usage";
import type { ExpertMemberView, ExpertTeamView } from "./expert-teams.ts";
import {
  memberUsage,
  parentTurns,
  serverTurns,
  teamMerges,
  teamUsage,
  type MemberUsage,
} from "./expert-usage.ts";

const ledger = (
  totals: Partial<UsageAnalytics["totals"]> = {},
): UsageAnalytics => ({
  totals: {
    runCount: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0,
    ...totals,
  },
  byDay: [],
  byModel: [],
});

let seq = 0;
const envelope = (
  turnId: string,
  type: string,
  data: Record<string, unknown>,
): ProjectionEnvelopeV2 => ({
  session_id: "dev:api:web-1",
  thread_id: turnId,
  seq: (seq += 1),
  turn_id: turnId,
  payload: { type, data },
});
const header = "Octoscode expert team: data-cleanup 7f3a 2026-11-05T23:00:00Z";

describe("a member's usage", () => {
  it("is its session's ledger figure, prompt counted with cache as the usage page does", () => {
    expect(
      memberUsage(
        ledger({
          runCount: 1,
          inputTokens: 3250,
          cacheReadTokens: 800,
          outputTokens: 407,
        }),
      ),
    ).toEqual({
      kind: "recorded",
      runs: 1,
      tokens: { prompt: 4050, output: 407 },
      cacheRead: 800,
      costUsd: null,
    });
    expect(
      memberUsage(
        ledger({ inputTokens: 10, outputTokens: 1, estimatedCostUsd: 0.02 }),
      ),
    ).toMatchObject({ costUsd: 0.02 });
  });

  it("is unknown, not 0, when runs were recorded without any tokens", () => {
    expect(memberUsage(ledger({ runCount: 1 }))).toEqual({
      kind: "unreported",
      runs: 1,
    });
    expect(memberUsage(ledger({ runCount: 0 }))).toEqual({ kind: "none" });
  });
});

describe("the starting conversation's turns", () => {
  const replay = [
    // Core's own synthesis turn: no user message.
    envelope("synth", "assistant_persisted", { text: "ok" }),
    envelope("synth", "turn_terminal", {
      outcome: "completed",
      token_usage: { input_tokens: 7000, output_tokens: 70 },
    }),
    envelope("merge-1", "user_message", {
      text: `These are the results…\n## peer A (done)\nBrief: ${header}\n`,
    }),
    envelope("merge-1", "turn_terminal", {
      outcome: "completed",
      token_usage: {
        input_tokens: 5000,
        cache_read_tokens: 100,
        output_tokens: 500,
      },
    }),
    envelope("other", "user_message", { text: "hello" }),
    envelope("other", "turn_terminal", {
      outcome: "completed",
      token_usage: { input_tokens: 9, output_tokens: 9 },
    }),
    envelope("merge-2", "user_message", { text: `Brief: ${header}` }),
    envelope("merge-2", "turn_terminal", {
      outcome: "errored",
      token_usage: {},
    }),
    envelope("merge-3", "user_message", { text: `Brief: ${header}` }),
    envelope("elsewhere", "user_message", {
      text: "Brief: Octoscode expert team: data-cleanup 7f3b 2026-11-05T23:00:00Z",
    }),
  ];
  const turns = parentTurns(replay);

  it("are read turn by turn, each with its own terminal's usage", () => {
    expect(turns.map((turn) => [turn.turnId, turn.usage])).toEqual([
      ["synth", { prompt: 7000, output: 70 }],
      ["merge-1", { prompt: 5100, output: 500 }],
      ["other", { prompt: 9, output: 9 }],
      ["merge-2", "unreported"],
      ["merge-3", null],
      ["elsewhere", null],
    ]);
  });

  it("give a team only the merges started with its own results", () => {
    expect(
      teamMerges(turns, { key: "data-cleanup/7f3a" }).map(
        (turn) => turn.turnId,
      ),
    ).toEqual(["merge-1", "merge-2", "merge-3"]);
    expect(teamMerges(turns, { key: "research/7f3a" })).toEqual([]);
  });

  it("set apart the turns the server started itself", () => {
    expect(serverTurns(turns).map((turn) => turn.turnId)).toEqual(["synth"]);
  });
});

describe("a team's usage", () => {
  const member = (slug: string): ExpertMemberView =>
    ({ slug }) as ExpertMemberView;
  const team = {
    key: "data-cleanup/7f3a",
    members: ["7f3a-1", "7f3a-2", "7f3a-3", "7f3a-4"].map(member),
  } as unknown as ExpertTeamView;
  const usage = new Map<string, MemberUsage>([
    [
      "7f3a-1",
      {
        kind: "recorded",
        runs: 1,
        tokens: { prompt: 1000, output: 100 },
        cacheRead: 0,
        costUsd: null,
      },
    ],
    [
      "7f3a-2",
      {
        kind: "recorded",
        runs: 2,
        tokens: { prompt: 4050, output: 407 },
        cacheRead: 800,
        costUsd: null,
      },
    ],
    ["7f3a-3", { kind: "unreported", runs: 1 }],
  ]);

  it("adds members and merges, and only those, keeping unknown parts out", () => {
    const figures = teamUsage(team, usage, [
      { turnId: "m1", userText: "x", usage: { prompt: 5000, output: 500 } },
      { turnId: "m2", userText: "x", usage: "unreported" },
      { turnId: "m3", userText: "x", usage: null },
    ]);
    expect(figures.members).toEqual({
      known: { prompt: 5050, output: 507 },
      knownCount: 2,
      unknownCount: 1,
      pendingCount: 1,
    });
    expect(figures.merges).toEqual({
      known: { prompt: 5000, output: 500 },
      knownCount: 1,
      unknownCount: 1,
      pendingCount: 1,
    });
    expect(figures.total).toEqual({ prompt: 10050, output: 1007 });
  });

  it("is the members alone before any merge", () => {
    expect(teamUsage(team, usage, []).total).toEqual({
      prompt: 5050,
      output: 507,
    });
  });
});
