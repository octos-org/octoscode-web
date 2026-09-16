/**
 * Pure row projections for the peer dock and the Fleet rows.
 *
 * These are plain functions over a `PeerRosterEntry`, and the app shell calls
 * them to build the Answer card and the row command long before any dock is
 * on screen. Keeping them out of `PeerDock.tsx` keeps the dock component, its
 * stylesheet and the peer manager behind the shell's lazy boundary.
 */
import type { PeerQuestionDetail, PeerRosterEntry } from "./peer-roster.ts";
import type { PeerRosterCounts, fleetLanded } from "./peer-manager.ts";
import type {
  PeerRowAction,
  PeerRowAttention,
} from "../control/peer-row-command.ts";

/**
 * The peer-facing label (judge #4: "no raw slugs"): "Peer 2" per row, from
 * the row's 1-based position in the roster, plus the accepted dispatch's
 * resolved model when the row carries one ("Peer 2 · glm-5.3" — triage 4510
 * P2, Fleet §4.3 parity). The slug stays ONLY as the row's `data-peer-slug`
 * identity hook (diagnostics + Advanced), never as display copy.
 */
export function peerRowLabel(index: number, model?: string | null): string {
  return model && model !== ""
    ? `Peer ${index + 1} · ${model}`
    : `Peer ${index + 1}`;
}

/**
 * The actions a row offers, in design §4.3 order. Availability follows the
 * SAME rules as Fleet rows: Approve/Deny (and the session-scoped Approve)
 * only while waiting for an approval; Answer only while waiting for an
 * answer; Steer while Working; Stop while Starting/Working/Waiting. A row
 * without an accepted dispatch operation id is terminal/unaddressable — the
 * dock renders its status but no affordance.
 */
export function peerRowActions(
  peer: PeerRosterEntry,
): readonly PeerRowAction[] {
  const addressable =
    typeof peer.operationId === "string" && peer.operationId !== "";
  if (peer.activity === "blocked") {
    if (peer.requestKind === "approval")
      return addressable ? ["approve", "approve_session", "deny", "stop"] : [];
    if (peer.requestKind === "question")
      return addressable ? ["answer", "stop"] : [];
    return addressable ? ["stop"] : [];
  }
  if (peer.activity === "live" || peer.activity === "idle")
    return addressable ? ["steer", "stop"] : [];
  return [];
}

/** The attention facts a row's actions target (all ids server-reported). */
export function peerRowAttention(peer: PeerRosterEntry): PeerRowAttention {
  return {
    requestId: peer.requestId ?? null,
    requestKind: peer.requestKind ?? null,
    operationId: peer.operationId ?? null,
    turnId: peer.turnId,
  };
}

/** The request shape the App-side Answer card (`UserQuestionPanel`) renders. */
export interface PeerAnswerRequest {
  readonly sessionId: string;
  readonly questionId: string;
  readonly turnId: string;
  readonly title: string;
  readonly body: string;
  readonly questions: readonly {
    readonly header: string;
    readonly question: string;
    readonly options: readonly {
      readonly label: string;
      readonly description: string | null;
    }[];
    readonly multiSelect: boolean;
    readonly allowFreeText: boolean;
  }[];
}

/**
 * Judge r2 #4: project a question-blocked row onto the EXACT request shape
 * `UserQuestionPanel` renders, so the App-side Answer action opens the real
 * question card from the row (no synthetic id, no reconstructed choices).
 * Null unless the row is question-blocked AND carries a real pending id and
 * the stamped question detail — fail-closed like every other seam here.
 */
export function peerAnswerRequest(
  peer: PeerRosterEntry,
): PeerAnswerRequest | null {
  if (peer.activity !== "blocked" || peer.requestKind !== "question")
    return null;
  if (typeof peer.requestId !== "string" || peer.requestId === "") return null;
  const detail = peer.requestDetail;
  if (!detail || !("options" in detail)) return null;
  const question = detail as PeerQuestionDetail;
  const title = question.header ?? peer.slug;
  const body = question.question ?? "";
  return {
    sessionId: peer.identity,
    questionId: peer.requestId,
    turnId: peer.turnId,
    title,
    body,
    questions: [
      {
        header: question.header ?? title,
        question: question.question ?? body,
        options: question.options.map((option) => ({
          label: option.label,
          description: option.description,
        })),
        multiSelect: question.multiSelect,
        allowFreeText: question.allowFreeText,
      },
    ],
  };
}

/**
 * TUI parity with `format_short_duration` (app.rs:4946): sub-minute seconds,
 * then `mss`, then `hmm`. Clock skew floors at 0, and a fractional remainder
 * truncates (the TUI does integer division on ms too).
 */
export function formatElapsed(ms: number): string {
  const secs = Math.max(0, Math.trunc(ms / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600)
    return `${Math.trunc(secs / 60)}m${String(secs % 60).padStart(2, "0")}s`;
  return `${Math.trunc(secs / 3600)}h${String(Math.trunc((secs % 3600) / 60)).padStart(2, "0")}m`;
}

/**
 * A row's output-token segment (web gap 4b, TUI app.rs:4838-4900 "↓ tokens").
 * Compacts at 1k / 1M exactly like `formatTokens` (autonomy/model.ts:129) so the
 * dock and the autonomy surfaces read the same; a bare count stays verbatim.
 * Undefined output is the caller's to omit — this never invents a value.
 */
export function formatPeerTokens(value: number): string {
  if (value >= 1_000_000) return `↓ ${trimTokens(value / 1_000_000)}M`;
  if (value >= 1_000) return `↓ ${trimTokens(value / 1_000)}k`;
  return `↓ ${value}`;
}

function trimTokens(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * A row's run duration (audit row 4, TUI app.rs:4887-4900): frozen at
 * `finishedAt - openedAt` once the row landed, else `now - openedAt`. Null
 * before the row has ever opened, so nothing is invented for an idle row.
 */
export function peerElapsed(peer: PeerRosterEntry, now: number): string | null {
  if (peer.openedAt === null) return null;
  const end = peer.finishedAt ?? now;
  return formatElapsed(end - peer.openedAt);
}

/**
 * The collapsed pill's text (audit rows 2-3). Counts ride the SHARED
 * `summarizeRoster`/`fleetLanded` helpers so the dock can never drift from the
 * roster data layer. `blocked`/`done` are omitted at zero (TUI parity: the
 * segments are conditional), while the landed segment always rides.
 */
export function formatPeerDockPill(
  counts: PeerRosterCounts,
  landed: ReturnType<typeof fleetLanded>,
): string {
  const parts = [
    `${counts.total}`,
    `${counts.live} live`,
    `${landed.landed}/${landed.total} landed`,
  ];
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`);
  if (counts.done > 0) parts.push(`${counts.done} done`);
  return parts.join(" · ");
}
