/**
 * Expert teams: built-in templates over the existing peer protocol.
 *
 * A team is one `peer/prepare` with one named member per expert. Every member
 * stages the same team brief (the durable copy on the server) and is kicked
 * off with its own angle. Members run side by side in their own sessions; the
 * conversation that started the team merges their results through the
 * existing gather-and-summarise turn.
 *
 * Nothing about a team is stored in the browser. The brief's first line
 * names the template and the team, so `peer/gather` alone is enough to show
 * the team again after a refresh; live states come from this tab's peer
 * roster while the members it opened are retained. For members this tab does
 * not hold, the member's own session says whether its last turn is still
 * running, was stopped, failed or finished: `peer/gather` keeps no record of
 * a stopped turn, and Core keeps a member working when the page goes away.
 */
import type {
  PeerGatherEntry,
  PeerTurnOutcomeRecord,
} from "@octos-org/octoscode-client/peers";
import type { HydratedTurn } from "@octos-org/octoscode-client/protocol";
import type { PeerRosterEntry } from "../peers/peer-roster.ts";
import type { UiText } from "../preferences/ui-text.tsx";

export interface ExpertMember {
  /** What the member is called in the team, e.g. "Risk reviewer". */
  readonly label: string;
  /** The member's angle, told to the member and shown to the person. */
  readonly focus: string;
}

export interface ExpertTeamTemplate {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly goalLabel: string;
  readonly goalPlaceholder: string;
  readonly members: readonly ExpertMember[];
  /** How the starting conversation should merge the results. */
  readonly summary: string;
}

export const EXPERT_TEAMS: readonly ExpertTeamTemplate[] = Object.freeze([
  {
    id: "plan-review",
    name: "Plan review",
    purpose:
      "Three reviewers read the same plan, design or decision, and each looks for problems from one angle.",
    goalLabel: "What should they review?",
    goalPlaceholder: "For example docs/plan.md, or paste the plan here",
    members: [
      {
        label: "Feasibility reviewer",
        focus:
          "Can it be built as described? Missing steps, hidden dependencies, time and cost.",
      },
      {
        label: "Risk reviewer",
        focus:
          "What could go wrong: failure cases, security and privacy, things that are hard to undo.",
      },
      {
        label: "User reviewer",
        focus:
          "Read it as the person who will use the result: is it clear, useful and worth the effort?",
      },
    ],
    summary:
      "Merge the reviews into one report: a verdict first, then the problems by priority, each noting which reviewer raised it. Remove duplicates and point out where the reviewers disagree.",
  },
  {
    id: "research",
    name: "Research group",
    purpose:
      "Three researchers look into one question from different sides, and the results are merged into one brief.",
    goalLabel: "What should they find out?",
    goalPlaceholder: "For example: which charting library fits this project",
    members: [
      {
        label: "Fact finder",
        focus:
          "Collect the facts and the current state, with a source for each.",
      },
      {
        label: "Options analyst",
        focus:
          "List the realistic options and compare them on the points that matter here.",
      },
      {
        label: "Devil's advocate",
        focus:
          "Look for counter-evidence, limits, and reasons the obvious answer may be wrong.",
      },
    ],
    summary:
      "Merge the findings into one brief: the answer first, then the evidence and the options compared, and a short section on open questions and doubts.",
  },
  {
    id: "code-check",
    name: "Code check-up",
    purpose:
      "Three engineers read the code in this workspace, and each reports problems in one area. Nobody changes files.",
    goalLabel: "Which part of the code?",
    goalPlaceholder: "For example src/payments, or the whole project",
    members: [
      {
        label: "Correctness",
        focus:
          "Bugs and wrong behaviour: edge cases, error handling, data that can be lost.",
      },
      {
        label: "Tests",
        focus:
          "What is not tested and should be, and tests that would pass even if the code were wrong.",
      },
      {
        label: "Maintainability",
        focus:
          "Code that is hard to read or change, duplication, and slow paths that matter.",
      },
    ],
    summary:
      "Merge the findings into one list ordered by severity. For each problem give the file and line, what goes wrong and a suggested fix, and note which engineer found it.",
  },
  {
    id: "writing",
    name: "Writing review",
    purpose:
      "Three editors read the same draft: one for structure, one for facts, one as the intended reader.",
    goalLabel: "Which draft, and who is it for?",
    goalPlaceholder: "For example README.md, for first-time users",
    members: [
      {
        label: "Structure editor",
        focus:
          "Order, headings, what is missing or repeated, and where readers will get lost.",
      },
      {
        label: "Fact checker",
        focus:
          "Claims, numbers, names and links that are wrong, outdated or unsupported.",
      },
      {
        label: "Target reader",
        focus:
          "Read as the intended reader: what is unclear, what you would ask, where you would stop reading.",
      },
    ],
    summary:
      "Merge the edits into one list the author can work through: the most important changes first, each with its place in the draft and a suggested rewrite where useful.",
  },
]);

export const EXPERT_GOAL_MAX_CHARS = 8000;
const HEADER = "Octoscode expert team:";
const HEADER_LINE =
  /^Octoscode expert team: ([a-z0-9-]+) ([a-z0-9]{4}) (\S+)$/u;
const GOAL_END = "---";

/** Four lowercase hex characters, the team's own part of every member name. */
export function newTeamTag(uuid: () => string): string {
  return uuid().replace(/-/gu, "").slice(0, 4).toLowerCase();
}

/**
 * Core derives a member's handle from the ASCII in its name and refuses two
 * members with the same handle, so each name carries `<tag>-<n>`.
 */
export function expertMemberName(label: string, tag: string, index: number) {
  return `${label} · ${tag}-${index + 1}`;
}

export interface ExpertTeamLaunch {
  readonly brief: string;
  readonly title: string;
  readonly names: string[];
  readonly memberBriefs: string[];
}

export function composeExpertTeam(
  t: UiText,
  template: ExpertTeamTemplate,
  input: {
    goal: string;
    workspace: string;
    tag: string;
    startedAt: Date;
  },
): ExpertTeamLaunch {
  const names = template.members.map((member, index) =>
    expertMemberName(t(member.label), input.tag, index),
  );
  const brief = [
    `${HEADER} ${template.id} ${input.tag} ${input.startedAt.toISOString()}`,
    t("Workspace: {path}", { path: input.workspace }),
    t("Goal:"),
    input.goal.trim(),
    GOAL_END,
    t(
      "This is the {team} team. {count} experts work on the same goal at the same time, each from one angle, and cannot see each other's results. The conversation that started the team merges them.",
      { team: t(template.name), count: template.members.length },
    ),
    "",
    t("Members:"),
    ...template.members.map((member, index) =>
      t("- {name}: {focus}", { name: names[index]!, focus: t(member.focus) }),
    ),
    "",
    t("Rules for every member:"),
    `- ${t("Read only. Do not create, change or delete any files.")}`,
    `- ${t("Work only from your own angle; the other experts cover theirs.")}`,
    `- ${t("Lead with your conclusion, then the reasons, in under 600 words. Give the evidence for each point: file path and line, or source.")}`,
    `- ${t("If information is missing, say what is missing instead of guessing.")}`,
  ].join("\n");
  return {
    brief,
    title: t(template.name),
    names,
    memberBriefs: template.members.map(
      (member, index) =>
        `${brief}\n\n${t("You are “{name}”. Your angle: {focus}", {
          name: names[index]!,
          focus: t(member.focus),
        })}`,
    ),
  };
}

export interface ParsedTeamBrief {
  readonly templateId: string;
  readonly tag: string;
  readonly startedAt: number | null;
  readonly workspace: string;
  readonly goal: string;
}

/** Reads back what `composeExpertTeam` wrote; any other brief is not a team. */
export function parseTeamBrief(brief: string): ParsedTeamBrief | null {
  const lines = brief.split("\n");
  const header = HEADER_LINE.exec(lines[0] ?? "");
  if (!header || lines.length < 4) return null;
  const workspace = (lines[1] ?? "").replace(/^[^:：]*[:：]\s*/u, "");
  // The goal itself may contain a standalone --- line; the delimiter is the
  // LAST one — the footer (team intro, members, rules) never has one.
  const end = lines.lastIndexOf(GOAL_END);
  const goal = lines
    .slice(3, end === -1 || end < 3 ? undefined : end)
    .join("\n")
    .trim();
  const startedAt = Date.parse(header[3]!);
  return {
    templateId: header[1]!,
    tag: header[2]!,
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    workspace,
    goal,
  };
}

/**
 * The result file starts with the server's own front matter; people read the
 * body. Only a REAL block at position 0 — `---`, one or more `key:` lines, a
 * closing `---` — parses (CRLF tolerated). A body that itself opens with a
 * `---` line, or a block missing its closing marker, is never eaten.
 */
const FRONT_MATTER =
  /^---\r?\n((?:[A-Za-z][\w-]*:[^\n]*\r?\n)+)---(?:\r?\n|$)/u;

export interface ResultParts {
  /** The outcome the server recorded in the front matter, if it wrote one. */
  readonly outcome: string | null;
  readonly body: string | null;
}

export function resultParts(result: string | null): ResultParts {
  if (result === null) return { outcome: null, body: null };
  const match = FRONT_MATTER.exec(result);
  const outcome = match
    ? (/^outcome:\s*(\S+)\s*$/mu.exec(match[1]!)?.[1] ?? null)
    : null;
  const text = (match ? result.slice(match[0].length) : result).trim();
  return { outcome, body: text || null };
}

export function resultBody(result: string | null): string | null {
  return resultParts(result).body;
}

export type ExpertMemberState =
  | "starting"
  | "not-started"
  | "working"
  | "waiting"
  | "finished"
  | "stopped"
  | "failed"
  | "rate-limited"
  | "closed"
  | "no-result";

export interface ExpertMemberView {
  readonly slug: string;
  readonly name: string;
  /** The role from the template, or the member's own name when unknown. */
  readonly label: string;
  readonly focus: string | null;
  readonly state: ExpertMemberState;
  /** The member's answer, without the server's front matter. */
  readonly result: string | null;
  /** Why it failed or did not start, in the server's or client's own words. */
  readonly reason: string | null;
  /** Present while this tab holds the member's session; needed to stop it. */
  readonly entry: PeerRosterEntry | null;
  /** The member's peer topic; its session id follows from it. */
  readonly topic: string;
  /**
   * The running turn as the member's own session reported it, when this tab
   * does not hold the member. Stopping names this turn and nothing else.
   */
  readonly runningTurn: string | null;
}

/**
 * What the member's own session (`session/hydrate`) says about its turns:
 * the last one, `none` when it has never started one, or null when unread.
 */
export type MemberTurnRead =
  { readonly turnId: string; readonly state: HydratedTurn["state"] } | "none";

export function lastMemberTurn(
  turns: readonly HydratedTurn[] | null | undefined,
): MemberTurnRead | null {
  if (!turns) return null;
  const last = turns.at(-1);
  return last ? { turnId: last.turn_id, state: last.state } : "none";
}

/** Still running by the member's own account; `interrupting` is already being stopped. */
export function memberTurnRunning(read: MemberTurnRead | null | undefined) {
  return (
    !!read &&
    read !== "none" &&
    (read.state === "active" || read.state === "interrupting")
  );
}

export interface ExpertTeamView {
  readonly key: string;
  readonly template: ExpertTeamTemplate | null;
  readonly tag: string;
  readonly startedAt: number | null;
  readonly workspace: string;
  readonly goal: string;
  readonly members: readonly ExpertMemberView[];
}

const DURABLE_STATE: Readonly<
  Record<PeerTurnOutcomeRecord, ExpertMemberState>
> = {
  completed: "finished",
  errored: "failed",
  interrupted: "stopped",
  rate_limited: "rate-limited",
};

export function expertMemberState(
  row: PeerGatherEntry | null,
  entry: PeerRosterEntry | null,
  turn: MemberTurnRead | null = null,
): { state: ExpertMemberState; reason: string | null } {
  const parts = resultParts(row?.result ?? null);
  const body = parts.body;
  if (row?.closed || entry?.status === "closed")
    return { state: "closed", reason: null };
  if (entry && entry.status !== "unknown") {
    if (entry.status === "opening") return { state: "starting", reason: null };
    if (entry.status === "failed")
      return { state: "not-started", reason: entry.error };
    if (entry.activity === "blocked") return { state: "waiting", reason: null };
    if (entry.activity === "live") return { state: "working", reason: null };
    if (entry.activity === "done") {
      if (entry.outcome === "stopped")
        return { state: "stopped", reason: null };
      if (entry.outcome === "failed")
        return {
          state: "failed",
          reason: row?.last_outcome === "errored" ? body : entry.error,
        };
      return { state: "finished", reason: null };
    }
    // Opened and kicked off, but the first turn has not reported yet.
    if (!row?.last_outcome) return { state: "starting", reason: null };
  }
  // The member's own session is newer than the blackboard: a later turn, or
  // a stop, which the blackboard never records.
  if (turn === "none" && !row?.last_outcome && !body)
    return { state: "not-started", reason: null };
  if (turn && turn !== "none") {
    if (memberTurnRunning(turn)) return { state: "working", reason: null };
    if (turn.state === "interrupted") return { state: "stopped", reason: null };
    if (turn.state === "errored")
      return {
        state: "failed",
        reason:
          (row?.last_outcome ?? parts.outcome) === "errored" ? body : null,
      };
    if (turn.state === "completed") return { state: "finished", reason: null };
  }
  if (row?.last_outcome) {
    const state = DURABLE_STATE[row.last_outcome];
    return {
      state,
      reason: state === "failed" || state === "rate-limited" ? body : null,
    };
  }
  // T-0370: no last_outcome field — the ONLY remaining server fact is the
  // outcome it wrote into the result file's front matter. A bare body never
  // proves completion (an errored result's body is the error text), so
  // without either record the member stays unknown and out of the merge.
  // When the outcome field arrives later, this same recomputation adopts it.
  if (parts.outcome && parts.outcome in DURABLE_STATE) {
    const state = DURABLE_STATE[parts.outcome as PeerTurnOutcomeRecord];
    return {
      state,
      reason: state === "failed" || state === "rate-limited" ? body : null,
    };
  }
  return { state: "no-result", reason: null };
}

/**
 * Teams in this workspace, newest first. Rows come from `peer/gather`; the
 * roster only adds what this tab knows live about members it opened.
 */
export function expertTeams(
  rows: readonly PeerGatherEntry[],
  roster: readonly PeerRosterEntry[],
  workspace: string,
  turns: ReadonlyMap<string, MemberTurnRead> = new Map(),
): ExpertTeamView[] {
  const teams = new Map<
    string,
    { brief: ParsedTeamBrief; rows: PeerGatherEntry[] }
  >();
  for (const row of rows) {
    const brief = parseTeamBrief(row.brief);
    if (!brief || brief.workspace !== workspace) continue;
    const key = `${brief.templateId}/${brief.tag}`;
    const team = teams.get(key) ?? { brief, rows: [] };
    team.rows.push(row);
    teams.set(key, team);
  }
  const bySlug = new Map(roster.map((entry) => [entry.slug, entry]));
  return [...teams.entries()]
    .map(([key, { brief, rows: members }]) => {
      const template =
        EXPERT_TEAMS.find((candidate) => candidate.id === brief.templateId) ??
        null;
      const number = (name: string) =>
        Number(/-(\d+)$/u.exec(name)?.[1] ?? Number.NaN);
      return {
        key,
        template,
        tag: brief.tag,
        startedAt: brief.startedAt,
        workspace: brief.workspace,
        goal: brief.goal,
        members: members
          .map((row) => {
            const name = row.name ?? row.slug;
            const member = template?.members[number(name) - 1] ?? null;
            const entry = bySlug.get(row.slug) ?? null;
            // This tab's live row wins; the member's session fills in otherwise.
            const held = !!entry && entry.status !== "unknown";
            const turn = held ? null : (turns.get(row.slug) ?? null);
            const { state, reason } = expertMemberState(row, entry, turn);
            return {
              slug: row.slug,
              name,
              label: member?.label ?? name,
              focus: member?.focus ?? null,
              state,
              result: state === "finished" ? resultBody(row.result) : null,
              reason,
              entry,
              topic: row.topic,
              runningTurn:
                turn && turn !== "none" && turn.state === "active"
                  ? turn.turnId
                  : null,
            } satisfies ExpertMemberView;
          })
          .sort((a, b) => number(a.name) - number(b.name)),
      } satisfies ExpertTeamView;
    })
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

export const ACTIVE_MEMBER_STATES: ReadonlySet<ExpertMemberState> = new Set([
  "starting",
  "working",
  "waiting",
]);

/**
 * Members whose own session should be read: ones this tab does not hold and
 * the blackboard cannot place (no durable outcome), and ones last seen
 * running. `force` (the Refresh button) reads every member not held here.
 */
export function membersToRead(
  teams: readonly ExpertTeamView[],
  turns: ReadonlyMap<string, MemberTurnRead>,
  force = false,
): ExpertMemberView[] {
  return teams
    .flatMap((team) => team.members)
    .filter((member) => {
      if (member.state === "closed") return false;
      if (member.entry && member.entry.status !== "unknown") return false;
      if (force) return true;
      const read = turns.get(member.slug);
      return read === undefined
        ? member.state === "no-result"
        : memberTurnRunning(read);
    });
}

/**
 * What the starting conversation is asked to do with the results. Only
 * finished members are gathered; the rest are named so the merge says what
 * is missing instead of passing an error off as a finding.
 */
export function expertSummaryInstruction(
  t: UiText,
  team: ExpertTeamView,
  stateWord: (state: ExpertMemberState) => string,
): { instruction: string; slugs: string[] } {
  // Only results that are actually there: a member whose session finished but
  // whose answer is not on the blackboard yet counts as missing.
  const usable = (member: ExpertMemberView) =>
    member.state === "finished" && member.result !== null;
  const finished = team.members.filter(usable);
  const missing = team.members.filter((member) => !usable(member));
  const name = team.template ? t(team.template.name) : t("Expert team");
  const lines = [
    t("These are the results of the {team} team for this goal:", {
      team: name,
    }),
    team.goal,
    "",
    team.template
      ? t(team.template.summary)
      : t("Merge the results into one report, conclusion first."),
    "",
    t("Results below are listed by handle:"),
    ...finished.map((member) =>
      t("- {handle}: {label}", { handle: member.slug, label: t(member.label) }),
    ),
    t(
      "In the report, refer to each expert by their role name, not the handle.",
    ),
  ];
  if (missing.length)
    lines.push(
      "",
      t("These experts have no result; say that their part is missing:"),
      ...missing.map((member) =>
        t("- {label} ({state})", {
          label: t(member.label),
          state: stateWord(member.state),
        }),
      ),
    );
  return {
    instruction: lines.join("\n"),
    slugs: finished.map((member) => member.slug),
  };
}
