/**
 * What an expert team cost, from the server's own records only.
 *
 * A member's figure is its session's part of the #1376 usage ledger: the
 * member's session holds the member's runs and nothing else (Core 6fc12da3
 * keeps the merge and its own synthesis turn in the starting conversation).
 * A merge is one turn of the starting conversation, read from that
 * conversation's replayed `turn_terminal`, which carries the turn's own usage
 * in the ledger's terms. The starting conversation's ledger total is never
 * used: it holds every turn there, so adding it would count merges twice and
 * take in turns that belong to no team.
 *
 * Prompt tokens are counted the way the usage page counts them: input plus
 * cache reads and writes. A run the server recorded without any token figure
 * is unknown, never 0.
 */
import type { ProjectionEnvelopeV2 } from "@octos-org/octoscode-client/protocol";
import type { UsageAnalytics } from "@octos-org/octoscode-client/usage";
import { promptTokens, recordedCost } from "../usage/usage-model.ts";
import type { ExpertTeamView } from "./expert-teams.ts";

export interface TokenCount {
  /** Input plus cache reads and writes. */
  readonly prompt: number;
  readonly output: number;
}

export type MemberUsage =
  | {
      readonly kind: "recorded";
      readonly runs: number;
      readonly tokens: TokenCount;
      readonly cacheRead: number;
      /** The server's estimate; null when it priced none of these runs. */
      readonly costUsd: number | null;
    }
  /** Runs recorded, but the provider reported no tokens for any of them. */
  | { readonly kind: "unreported"; readonly runs: number }
  /** No run recorded yet: still working, or it never ran. */
  | { readonly kind: "none" }
  | { readonly kind: "unreadable" };

export function memberUsage(analytics: UsageAnalytics): MemberUsage {
  const totals = analytics.totals;
  if (totals.runCount === 0) return { kind: "none" };
  const prompt = promptTokens(totals);
  if (prompt === 0 && totals.outputTokens === 0)
    return { kind: "unreported", runs: totals.runCount };
  return {
    kind: "recorded",
    runs: totals.runCount,
    tokens: { prompt, output: totals.outputTokens },
    cacheRead: totals.cacheReadTokens,
    costUsd: recordedCost(totals),
  };
}

export interface ParentTurn {
  readonly turnId: string;
  /** What the turn was started with; null when the replay holds no user message for it. */
  readonly userText: string | null;
  /** null while the turn has no terminal; "unreported" when its terminal carried no usage. */
  readonly usage: TokenCount | "unreported" | null;
}

/** The starting conversation's turns, in replay order, from its replayed envelopes. */
export function parentTurns(
  envelopes: readonly ProjectionEnvelopeV2[],
): ParentTurn[] {
  const turns = new Map<
    string,
    { userText: string | null; usage: ParentTurn["usage"] }
  >();
  for (const envelope of envelopes) {
    const turnId = envelope.turn_id;
    if (!turnId) continue;
    const turn = turns.get(turnId) ?? { userText: null, usage: null };
    const data = envelope.payload?.data;
    const row =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    if (
      envelope.payload?.type === "user_message" &&
      turn.userText === null &&
      typeof row.text === "string"
    )
      turn.userText = row.text;
    if (envelope.payload?.type === "turn_terminal")
      turn.usage = terminalUsage(row.token_usage);
    turns.set(turnId, turn);
  }
  return [...turns].map(([turnId, turn]) => ({ turnId, ...turn }));
}

function terminalUsage(value: unknown): TokenCount | "unreported" {
  if (!value || typeof value !== "object") return "unreported";
  const row = value as Record<string, unknown>;
  const count = (field: unknown) =>
    typeof field === "number" && Number.isSafeInteger(field) && field > 0
      ? field
      : 0;
  // Core leaves zero fields out, so `{}` is a turn with no usage reported.
  const prompt =
    count(row.input_tokens) +
    count(row.cache_read_tokens) +
    count(row.cache_write_tokens);
  const output = count(row.output_tokens);
  return prompt === 0 && output === 0 ? "unreported" : { prompt, output };
}

/**
 * The merges of one team: turns started with this team's gathered results,
 * which carry each member's brief and so the team's own header line.
 */
export function teamMerges(
  turns: readonly ParentTurn[],
  team: Pick<ExpertTeamView, "key">,
): ParentTurn[] {
  const [templateId, tag] = team.key.split("/");
  const header = `Octoscode expert team: ${templateId} ${tag} `;
  return turns.filter((turn) => turn.userText?.includes(header));
}

/** Turns with a terminal but no user message: the server started them itself. */
export function serverTurns(turns: readonly ParentTurn[]): ParentTurn[] {
  return turns.filter((turn) => turn.userText === null && turn.usage !== null);
}

export interface UsagePart {
  /** Parts with a figure, added up. */
  readonly known: TokenCount;
  readonly knownCount: number;
  /** Parts the server recorded without a figure, or that could not be read. */
  readonly unknownCount: number;
  /** Parts with nothing recorded yet: still working, or not started. */
  readonly pendingCount: number;
}

export interface TeamUsage {
  readonly members: UsagePart;
  readonly merges: UsagePart;
  /** Members plus merges; nothing else is in it. */
  readonly total: TokenCount;
}

const ZERO: TokenCount = { prompt: 0, output: 0 };
const add = (a: TokenCount, b: TokenCount): TokenCount => ({
  prompt: a.prompt + b.prompt,
  output: a.output + b.output,
});

export function teamUsage(
  team: ExpertTeamView,
  usage: ReadonlyMap<string, MemberUsage>,
  merges: readonly ParentTurn[],
): TeamUsage {
  let members: UsagePart = {
    known: ZERO,
    knownCount: 0,
    unknownCount: 0,
    pendingCount: 0,
  };
  for (const member of team.members) {
    const read = usage.get(member.slug);
    if (read?.kind === "recorded")
      members = {
        ...members,
        known: add(members.known, read.tokens),
        knownCount: members.knownCount + 1,
      };
    else if (read?.kind === "unreported" || read?.kind === "unreadable")
      members = { ...members, unknownCount: members.unknownCount + 1 };
    else members = { ...members, pendingCount: members.pendingCount + 1 };
  }
  let mergeParts: UsagePart = {
    known: ZERO,
    knownCount: 0,
    unknownCount: 0,
    pendingCount: 0,
  };
  for (const merge of merges) {
    if (merge.usage === null)
      mergeParts = { ...mergeParts, pendingCount: mergeParts.pendingCount + 1 };
    else if (merge.usage === "unreported")
      mergeParts = { ...mergeParts, unknownCount: mergeParts.unknownCount + 1 };
    else
      mergeParts = {
        ...mergeParts,
        known: add(mergeParts.known, merge.usage),
        knownCount: mergeParts.knownCount + 1,
      };
  }
  return {
    members,
    merges: mergeParts,
    total: add(members.known, mergeParts.known),
  };
}
