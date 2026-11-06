import { describe, expect, it } from "vitest";
import type { PeerGatherEntry } from "@octos-org/octoscode-client/peers";
import { createUiText } from "../preferences/ui-text.tsx";
import zh from "../preferences/zh.ts";
import type { PeerRosterEntry } from "../peers/peer-roster.ts";
import {
  EXPERT_TEAMS,
  composeExpertTeam,
  expertMemberState,
  expertSummaryInstruction,
  expertTeams,
  lastMemberTurn,
  memberFileChanges,
  membersToRead,
  newTeamTag,
  parseTeamBrief,
  recordedFocus,
  resultBody,
  teamCopyName,
  teamWrites,
  type MemberTurnRead,
} from "./expert-teams.ts";

const en = createUiText("en");
const zhText = createUiText("zh", zh);
const review = EXPERT_TEAMS.find((team) => team.id === "plan-review")!;
const startedAt = new Date("2026-11-04T15:32:00.000Z");
const launch = (
  t = en,
  goal = "Review docs/plan.md\n\nFocus on the rollout.",
) =>
  composeExpertTeam(t, review, {
    goal,
    workspace: "/srv/work",
    tag: "7f3a",
    startedAt,
  });

function gatherRow(
  name: string,
  slug: string,
  brief: string,
  extra: Partial<PeerGatherEntry> = {},
): PeerGatherEntry {
  return {
    slug,
    topic: `peer-${slug}`,
    name,
    brief,
    brief_truncated: false,
    result: null,
    result_truncated: false,
    result_updated_unix: null,
    has_worktree: false,
    closed: false,
    ...extra,
  };
}
function rosterEntry(
  slug: string,
  extra: Partial<PeerRosterEntry> = {},
): PeerRosterEntry {
  return {
    identity: `dev:local:tui#peer-${slug}`,
    profileId: "dev",
    topic: `peer-${slug}`,
    slug,
    cwd: "/srv/work",
    briefPath: `/peers/${slug}/brief.md`,
    origin: "prepare",
    turnId: "turn",
    status: "started",
    activity: "live",
    openedAt: 1,
    finishedAt: null,
    error: null,
    canRetry: false,
    ...extra,
  };
}
const done = (body: string, outcome = "completed") =>
  `---\nslug: x\noutcome: ${outcome}\nupdated_unix: 1\nturn: 1\n---\n\n${body}\n`;

describe("expert team templates", () => {
  it("names every member with its own ASCII handle so Core accepts the fleet", () => {
    const team = launch(zhText);
    expect(team.names).toEqual([
      "可行性评审 · 7f3a-1",
      "风险评审 · 7f3a-2",
      "用户视角评审 · 7f3a-3",
    ]);
    // Core keeps only the ASCII of a name for the handle; these must differ.
    const handles = team.names.map((name) =>
      name.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, ""),
    );
    expect(new Set(handles).size).toBe(team.names.length);
    expect(newTeamTag(() => "7F3A9C1E-0000-4000-8000-000000000000")).toBe(
      "7f3a",
    );
  });

  it("stages one brief and gives each member its own angle", () => {
    const team = launch(zhText);
    expect(team.title).toBe("方案评审团");
    expect(team.brief.split("\n")[0]).toBe(
      "Octoscode expert team: plan-review 7f3a 2026-11-04T15:32:00.000Z",
    );
    expect(team.brief).toContain("只读：不要创建、修改或删除任何文件。");
    expect(team.memberBriefs).toHaveLength(3);
    expect(team.memberBriefs[1]).toContain("你是「风险评审 · 7f3a-2」");
    expect(team.memberBriefs[1]).not.toContain("你是「可行性评审");
    for (const brief of team.memberBriefs)
      expect(brief.startsWith(team.brief)).toBe(true);
  });

  it("reads the team back from the stored brief alone, in either language", () => {
    for (const t of [en, zhText]) {
      expect(parseTeamBrief(launch(t).brief)).toEqual({
        templateId: "plan-review",
        tag: "7f3a",
        startedAt: startedAt.getTime(),
        workspace: "/srv/work",
        goal: "Review docs/plan.md\n\nFocus on the rollout.",
      });
    }
    expect(parseTeamBrief("Review this")).toBeNull();
    expect(
      parseTeamBrief("Octoscode expert team: x\nWorkspace: /a\nGoal:\ng"),
    ).toBeNull();
  });

  it("keeps a standalone --- line inside the goal", () => {
    // T-0370: the first --- ended the goal early; the delimiter is the last
    // one (the brief's own footer never has a standalone ---).
    const goal = "Part one\n\n---\n\nPart two after the rule";
    const brief = launch(en, goal).brief;
    expect(parseTeamBrief(brief)?.goal).toBe(goal);
  });

  it("strips the server's front matter from a result", () => {
    expect(resultBody(done("Problem A, see section 1."))).toBe(
      "Problem A, see section 1.",
    );
    expect(resultBody("plain answer")).toBe("plain answer");
    expect(resultBody(null)).toBeNull();
    expect(resultBody("---\nslug: x\n---\n\n")).toBeNull();
  });

  it("only parses a real front-matter block and keeps every other --- line", () => {
    // T-0370: CRLF parses; a body opening with a --- line, a block without a
    // closing marker, and later --- lines are never eaten.
    expect(
      resultBody("---\r\nslug: x\r\noutcome: completed\r\n---\r\n\r\nbody"),
    ).toBe("body");
    expect(resultBody("---\nnot front matter\n\nkept in full")).toBe(
      "---\nnot front matter\n\nkept in full",
    );
    expect(resultBody("---\nslug: x\n(no closing marker)")).toBe(
      "---\nslug: x\n(no closing marker)",
    );
    expect(resultBody(done("first\n\n---\n\nsecond"))).toBe(
      "first\n\n---\n\nsecond",
    );
  });
});

describe("expert member state", () => {
  const brief = launch().brief;
  const row = (extra: Partial<PeerGatherEntry> = {}) =>
    gatherRow("Risk reviewer · 7f3a-2", "7f3a-2", brief, extra);

  it("prefers what this tab sees live", () => {
    expect(
      expertMemberState(row(), rosterEntry("7f3a-2", { status: "opening" }))
        .state,
    ).toBe("starting");
    expect(expertMemberState(row(), rosterEntry("7f3a-2")).state).toBe(
      "working",
    );
    expect(
      expertMemberState(row(), rosterEntry("7f3a-2", { activity: "blocked" }))
        .state,
    ).toBe("waiting");
    expect(
      expertMemberState(
        row(),
        rosterEntry("7f3a-2", { activity: "done", outcome: "stopped" }),
      ).state,
    ).toBe("stopped");
    expect(
      expertMemberState(
        row(),
        rosterEntry("7f3a-2", {
          status: "failed",
          error: "Peer session could not be opened",
        }),
      ),
    ).toEqual({
      state: "not-started",
      reason: "Peer session could not be opened",
    });
  });

  it("falls back to the server's record after a refresh", () => {
    expect(expertMemberState(row(), null).state).toBe("no-result");
    expect(
      expertMemberState(
        row({ result: done("ok"), last_outcome: "completed" }),
        null,
      ).state,
    ).toBe("finished");
    expect(
      expertMemberState(
        row({
          result: done("HTTP 500 stub model is down", "errored"),
          last_outcome: "errored",
        }),
        null,
      ),
    ).toEqual({ state: "failed", reason: "HTTP 500 stub model is down" });
    expect(expertMemberState(row({ closed: true }), null).state).toBe("closed");
  });

  it("trusts only the front-matter outcome when last_outcome is missing", () => {
    // T-0370: an older Core omits last_outcome. The outcome inside the result
    // file is still the server's record; a bare body proves nothing — an
    // errored result's body is the error text, never a conclusion.
    expect(expertMemberState(row({ result: done("ok") }), null).state).toBe(
      "finished",
    );
    expect(
      expertMemberState(
        row({ result: done("HTTP 500 stub model is down", "errored") }),
        null,
      ),
    ).toEqual({ state: "failed", reason: "HTTP 500 stub model is down" });
    expect(
      expertMemberState(row({ result: done("cut off", "interrupted") }), null)
        .state,
    ).toBe("stopped");
    expect(expertMemberState(row({ result: "answer" }), null).state).toBe(
      "no-result",
    );
  });

  it("uses the server's failure text for a live failure", () => {
    expect(
      expertMemberState(
        row({
          result: done("provider down", "errored"),
          last_outcome: "errored",
        }),
        rosterEntry("7f3a-2", {
          activity: "done",
          outcome: "failed",
          error: "turn failed",
        }),
      ),
    ).toEqual({ state: "failed", reason: "provider down" });
  });
});

describe("expert teams from the blackboard", () => {
  const team = launch(zhText);
  const rows = [
    gatherRow(team.names[1]!, "7f3a-2", team.brief, {
      result: done("风险 A"),
      last_outcome: "completed",
    }),
    gatherRow(team.names[0]!, "7f3a-1", team.brief),
    gatherRow(team.names[2]!, "7f3a-3", team.brief, {
      result: done("down", "errored"),
      last_outcome: "errored",
    }),
    gatherRow("plain peer", "plain", "Review this"),
    gatherRow(
      "x · 9999-1",
      "9999-1",
      team.brief.replace("/srv/work", "/elsewhere").replace("7f3a", "9999"),
    ),
  ];

  it("groups members of this workspace by team and orders them by seat", () => {
    const [view, ...others] = expertTeams(
      rows,
      [rosterEntry("7f3a-1")],
      "/srv/work",
    );
    expect(others).toHaveLength(0);
    expect(view?.template?.id).toBe("plan-review");
    expect(view?.goal).toBe("Review docs/plan.md\n\nFocus on the rollout.");
    expect(view?.members.map((m) => [m.label, m.state, m.result])).toEqual([
      ["Feasibility reviewer", "working", null],
      ["Risk reviewer", "finished", "风险 A"],
      ["User reviewer", "failed", null],
    ]);
    expect(view?.members[2]?.reason).toBe("down");
    expect(view?.members[0]?.entry?.slug).toBe("7f3a-1");
  });

  it("asks the merge to name the experts with no result", () => {
    const [view] = expertTeams(rows, [], "/srv/work");
    const { instruction, slugs } = expertSummaryInstruction(
      zhText,
      view!,
      (state) => state,
    );
    expect(slugs).toEqual(["7f3a-2"]);
    expect(instruction).toContain("「方案评审团」");
    expect(instruction).toContain("- 7f3a-2：风险评审");
    expect(instruction).toContain("可行性评审（no-result）");
    expect(instruction).toContain("用户视角评审（failed）");
    // T-0366: the merge must cite experts by role name, not bare handles.
    expect(instruction).toContain(
      "在报告里引用专家时用他们的角色名，而不是编号。",
    );
  });
});

describe("members this tab does not hold, after a refresh", () => {
  const team = launch(en);
  const row = (extra: Partial<PeerGatherEntry> = {}) =>
    gatherRow(team.names[1]!, "7f3a-2", team.brief, extra);
  const running: MemberTurnRead = { turnId: "turn-2", state: "active" };
  const rows = [
    gatherRow(team.names[0]!, "7f3a-1", team.brief, {
      result: done("A"),
      last_outcome: "completed",
    }),
    gatherRow(team.names[1]!, "7f3a-2", team.brief),
    gatherRow(team.names[2]!, "7f3a-3", team.brief),
  ];

  it("reads the last turn from the member's own session", () => {
    expect(lastMemberTurn(null)).toBeNull();
    expect(lastMemberTurn([])).toBe("none");
    expect(
      lastMemberTurn([
        { turn_id: "t1", state: "completed" },
        { turn_id: "t2", state: "active" },
      ]),
    ).toEqual({ turnId: "t2", state: "active" });
  });

  it("places running, stopped, failed and never-started members by that turn", () => {
    const state = (turn: MemberTurnRead | null, extra = {}) =>
      expertMemberState(row(extra), null, turn).state;
    expect(state(running)).toBe("working");
    expect(state({ turnId: "t", state: "interrupting" })).toBe("working");
    // The blackboard keeps no record of a stop; the session does.
    expect(state({ turnId: "t", state: "interrupted" })).toBe("stopped");
    expect(state({ turnId: "t", state: "errored" })).toBe("failed");
    expect(state({ turnId: "t", state: "completed" })).toBe("finished");
    expect(state("none")).toBe("not-started");
    // Unread stays honest: no guess between running and stopped.
    expect(state(null)).toBe("no-result");
    // A newer turn outranks an older recorded result.
    expect(
      state(running, { result: done("A"), last_outcome: "completed" }),
    ).toBe("working");
  });

  it("offers a stop only for an active turn of a member it does not hold", () => {
    const turns = new Map<string, MemberTurnRead>([
      ["7f3a-2", running],
      ["7f3a-3", { turnId: "turn-3", state: "interrupting" }],
    ]);
    const [view] = expertTeams(rows, [], "/srv/work", turns);
    expect(
      view?.members.map((m) => [m.slug, m.state, m.runningTurn, m.topic]),
    ).toEqual([
      ["7f3a-1", "finished", null, "peer-7f3a-1"],
      ["7f3a-2", "working", "turn-2", "peer-7f3a-2"],
      ["7f3a-3", "working", null, "peer-7f3a-3"],
    ]);
    // This tab's live row wins over the session read.
    const [held] = expertTeams(
      rows,
      [rosterEntry("7f3a-2", { activity: "done", outcome: "stopped" })],
      "/srv/work",
      turns,
    );
    expect(held?.members[1]).toMatchObject({
      state: "stopped",
      runningTurn: null,
    });
  });

  it("reads only members the blackboard cannot place, and running ones again", () => {
    const slugs = (
      turns: ReadonlyMap<string, MemberTurnRead>,
      roster: PeerRosterEntry[] = [],
      force = false,
    ) =>
      membersToRead(
        expertTeams(rows, roster, "/srv/work", turns),
        turns,
        force,
      ).map((member) => member.slug);
    expect(slugs(new Map())).toEqual(["7f3a-2", "7f3a-3"]);
    const read = new Map<string, MemberTurnRead>([
      ["7f3a-2", running],
      ["7f3a-3", { turnId: "turn-3", state: "interrupted" }],
    ]);
    expect(slugs(read)).toEqual(["7f3a-2"]);
    expect(slugs(read, [rosterEntry("7f3a-2")])).toEqual([]);
    // Refresh asks every member this tab does not hold.
    expect(slugs(read, [], true)).toEqual(["7f3a-1", "7f3a-2", "7f3a-3"]);
  });

  it("merges only results that are actually there", () => {
    const turns = new Map<string, MemberTurnRead>([
      ["7f3a-2", { turnId: "turn-2", state: "completed" }],
    ]);
    const [view] = expertTeams(rows, [], "/srv/work", turns);
    expect(view?.members[1]?.state).toBe("finished");
    const { slugs, instruction } = expertSummaryInstruction(
      en,
      view!,
      (state) => state,
    );
    expect(slugs).toEqual(["7f3a-1"]);
    expect(instruction).toContain("Risk reviewer (finished)");
  });
});

describe("expert team copy", () => {
  it("translates every template string, which t() only sees as a variable", () => {
    const missing = EXPERT_TEAMS.flatMap((team) => [
      team.name,
      team.purpose,
      team.goalLabel,
      team.goalPlaceholder,
      team.summary,
      ...(team.costNote ? [team.costNote] : []),
      ...team.members.flatMap((member) => [
        member.label,
        member.focus,
        ...(member.input ? [member.input] : []),
        ...(member.output ? [member.output] : []),
      ]),
    ]).filter((source) => !Object.prototype.hasOwnProperty.call(zh, source));
    expect(missing).toEqual([]);
  });
});

describe("teams that deliver a file", () => {
  const cleanup = EXPERT_TEAMS.find((team) => team.id === "data-cleanup")!;
  const delivery = EXPERT_TEAMS.find(
    (team) => team.id === "document-delivery",
  )!;
  const start = (t = en, template = cleanup) =>
    composeExpertTeam(t, template, {
      goal: "data/orders.csv: dates as YYYY-MM-DD",
      workspace: "/srv/work",
      tag: "7f3a",
      startedAt,
    });

  it("name the copy after the original with the team's tag", () => {
    expect(teamCopyName("orders.csv", "cleaned", "7f3a")).toBe(
      "orders.cleaned-7f3a.csv",
    );
    expect(teamCopyName("docs/v1.2/proposal.md", "revised", "7f3a")).toBe(
      "docs/v1.2/proposal.revised-7f3a.md",
    );
    expect(teamCopyName("NOTES", "revised", "7f3a")).toBe("NOTES.revised-7f3a");
  });

  it("let one member write a new file and everyone else only read", () => {
    expect(teamWrites(cleanup)).toBe(true);
    expect(teamWrites(delivery)).toBe(true);
    expect(teamWrites(review)).toBe(false);
    const team = start();
    expect(team.brief).toContain(
      "Do not change, move or delete any existing file. The original stays as it is.",
    );
    expect(team.brief).toContain(
      "Only Data cleaner · 7f3a-2 creates a file, as its angle says; everyone else only reads.",
    );
    expect(team.brief).not.toContain("Read only.");
    expect(team.brief).toContain(
      "Hands back: A cleaned copy as a new file, and the rules applied with row counts.",
    );
    expect(team.memberBriefs[1]).toContain(
      "orders.csv becomes orders.cleaned-7f3a.csv",
    );
    expect(team.memberBriefs[0]).not.toContain("new file next to the original");
    expect(team.memberBriefs[2]).not.toContain("new file next to the original");
    // The review teams keep their read-only rule.
    expect(launch().brief).toContain(
      "Read only. Do not create, change or delete any files.",
    );
  });

  it("read back like any other team, in either language", () => {
    for (const t of [en, zhText]) {
      const team = start(t, delivery);
      expect(parseTeamBrief(team.brief)).toMatchObject({
        templateId: "document-delivery",
        tag: "7f3a",
        goal: "data/orders.csv: dates as YYYY-MM-DD",
      });
    }
    expect(start(zhText).memberBriefs[1]).toContain(
      "orders.csv 写成 orders.cleaned-7f3a.csv",
    );
  });

  it("tell the team's new copy from changes to other files", () => {
    const changes = memberFileChanges(
      [
        { path: "/srv/work/data/orders.cleaned-7f3a.csv", operation: "modify" },
        { path: "/srv/work/data/orders.csv", operation: "modify" },
        { path: "/srv/work/old.cleaned-0000.csv", operation: "modify" },
        { path: "/srv/work/notes.cleaned-7f3a.csv", operation: "delete" },
      ],
      cleanup,
      "7f3a",
      "/srv/work",
    );
    expect(changes).toEqual([
      { path: "notes.cleaned-7f3a.csv", teamCopy: false, deleted: true },
      { path: "old.cleaned-0000.csv", teamCopy: false, deleted: false },
      { path: "data/orders.csv", teamCopy: false, deleted: false },
      { path: "data/orders.cleaned-7f3a.csv", teamCopy: true, deleted: false },
    ]);
    // Core records every write as "modify", so a deletion always shows.
    expect(
      memberFileChanges(
        [
          { path: "/srv/work/a.csv", operation: "modify" },
          { path: "/srv/work/a.csv", operation: "delete" },
        ],
        cleanup,
        "7f3a",
        "/srv/work",
      ),
    ).toEqual([{ path: "a.csv", teamCopy: false, deleted: true }]);
  });

  it("hand the merge the files the server recorded, not the ones claimed", () => {
    const brief = start().brief;
    const rows = [
      gatherRow("Data inspector · 7f3a-1", "7f3a-1", brief, {
        result: done("problems"),
        last_outcome: "completed",
      }),
      gatherRow("Data cleaner · 7f3a-2", "7f3a-2", brief, {
        result: done("wrote orders.cleaned-7f3a.csv"),
        last_outcome: "completed",
      }),
      gatherRow("Data checker · 7f3a-3", "7f3a-3", brief, {
        result: done("model is down", "errored"),
        last_outcome: "errored",
      }),
    ];
    const files = new Map([
      [
        "7f3a-2",
        [
          {
            path: "/srv/work/data/orders.cleaned-7f3a.csv",
            operation: "modify" as const,
          },
        ],
      ],
      [
        "7f3a-3",
        [{ path: "/srv/work/data/orders.csv", operation: "modify" as const }],
      ],
      ["7f3a-1", []],
    ]);
    const [view] = expertTeams(rows, [], "/srv/work", new Map(), files);
    expect(view?.members.map((member) => member.files?.length)).toEqual([
      0, 1, 1,
    ]);
    expect(view?.members[1]?.writes).toEqual({
      suffix: "cleaned",
      example: "orders.csv",
    });
    const { slugs, instruction } = expertSummaryInstruction(
      en,
      view!,
      (state) => state,
    );
    expect(slugs).toEqual(["7f3a-1", "7f3a-2"]);
    expect(instruction).toContain(
      "New files from experts that finished, as the server recorded them:\n- Data cleaner: data/orders.cleaned-7f3a.csv",
    );
    expect(instruction).toContain(
      "- Data checker (changed a file that is not the team's new copy): data/orders.csv",
    );
    expect(instruction).toContain("- Data checker (failed)");
    // Unread files add nothing.
    const [unread] = expertTeams(rows, [], "/srv/work");
    expect(unread?.members.every((member) => member.files === null)).toBe(true);
    expect(
      expertSummaryInstruction(en, unread!, (state) => state).instruction,
    ).not.toContain("recorded");
  });
});

describe("a member's angle for one task (T-0440)", () => {
  const cleanup = EXPERT_TEAMS.find((team) => team.id === "data-cleanup")!;
  const start = (
    t: typeof en,
    template = review,
    focus?: readonly (string | undefined)[],
  ) =>
    composeExpertTeam(t, template, {
      goal: "Review docs/plan.md",
      workspace: "/srv/work",
      tag: "7f3a",
      startedAt,
      ...(focus ? { focus } : {}),
    });
  const own = "只看回滚：每一步能不能撤回，\n撤回要多久、谁来做。";

  it("changes only that member's angle; names, rules and the others' angles stay", () => {
    for (const t of [en, zhText]) {
      const plain = start(t);
      const edited = start(t, review, [undefined, own, undefined]);
      expect(edited.names).toEqual(plain.names);
      const oneLine = "只看回滚：每一步能不能撤回， 撤回要多久、谁来做。";
      // The shared brief: only member 2's roster line differs.
      const diff = (a: string, b: string) =>
        a.split("\n").filter((line, index) => line !== b.split("\n")[index]);
      expect(diff(edited.brief, plain.brief)).toEqual([
        t("- {name}: {focus}", { name: plain.names[1]!, focus: oneLine }),
      ]);
      // Each member's own instruction: 1 and 3 keep the template's angle.
      for (const index of [0, 2])
        expect(edited.memberBriefs[index]!.split("\n").at(-1)).toBe(
          plain.memberBriefs[index]!.split("\n").at(-1),
        );
      expect(edited.memberBriefs[1]!.split("\n").at(-1)).toBe(
        t("You are “{name}”. Your angle: {focus}", {
          name: plain.names[1]!,
          focus: oneLine,
        }),
      );
      // The built-in team itself is untouched.
      expect(start(t).brief).toBe(plain.brief);
    }
  });

  it("treats a blank override as the default", () => {
    expect(start(en, review, [" \n ", undefined, ""]).brief).toBe(
      start(en).brief,
    );
  });

  it("keeps the writer's file rules and hand-off when its angle changes", () => {
    const writer = cleanup.members.findIndex((member) => member.writes);
    const focus = cleanup.members.map((_, index) =>
      index === writer ? "Only fix the date column." : undefined,
    );
    const plain = start(zhText, cleanup);
    const edited = start(zhText, cleanup, focus);
    expect(edited.memberBriefs[writer]).toContain("Only fix the date column.");
    expect(edited.memberBriefs[writer]).toContain("orders.cleaned-7f3a.csv");
    expect(edited.brief).toContain(
      zhText(
        "Only {name} creates a file, as its angle says; everyone else only reads.",
        {
          name: plain.names[writer]!,
        },
      ),
    );
  });

  it("reads each member's angle back from the server's brief, marking only the changed one", () => {
    for (const t of [en, zhText]) {
      for (const template of [review, cleanup]) {
        const focus = template.members.map((_, index) =>
          index === 1 ? own : undefined,
        );
        const team = start(t, template, focus);
        team.names.forEach((name, index) => {
          const member = template.members[index]!;
          expect(recordedFocus(t, team.brief, name, member)).toEqual(
            index === 1
              ? {
                  text: "只看回滚：每一步能不能撤回， 撤回要多久、谁来做。",
                  adjusted: true,
                }
              : { text: t(member.focus), adjusted: false },
          );
        });
      }
    }
  });

  it("shows another language's line as the server has it, and nothing it lacks", () => {
    const team = start(zhText, review, [undefined, own, undefined]);
    // Read in English: the zh line cannot be split by the English wording.
    const read = recordedFocus(
      en,
      team.brief,
      team.names[1]!,
      review.members[1]!,
    );
    expect(read).toEqual({
      text: "只看回滚：每一步能不能撤回， 撤回要多久、谁来做。",
      adjusted: false,
    });
    expect(recordedFocus(en, team.brief, "Nobody · 7f3a-9", null)).toBeNull();
  });

  it("does not put the template's angle where a cut brief lost the member's line", () => {
    const team = start(en, review, [undefined, own, undefined]);
    const cut = team.brief.slice(0, team.brief.indexOf("Members:"));
    const rows = team.names.map((name, index) =>
      gatherRow(name, `slug-${index}`, cut, { brief_truncated: true }),
    );
    const [view] = expertTeams(rows, [], "/srv/work", new Map(), new Map(), en);
    expect(
      view!.members.map((member) => [member.recordedFocus, member.focusUnread]),
    ).toEqual([
      [null, true],
      [null, true],
      [null, true],
    ]);
    const whole = team.names.map((name, index) =>
      gatherRow(name, `slug-${index}`, team.brief),
    );
    const [full] = expertTeams(
      whole,
      [],
      "/srv/work",
      new Map(),
      new Map(),
      en,
    );
    expect(full!.members[1]!.recordedFocus).toEqual({
      text: "只看回滚：每一步能不能撤回， 撤回要多久、谁来做。",
      adjusted: true,
    });
    expect(full!.members[0]!.recordedFocus?.adjusted).toBe(false);
  });
});
