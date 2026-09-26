/**
 * Transcript entry shape and the few reducers the app shell needs before any
 * transcript rendering exists.
 *
 * `model.ts` owns the full notification fold (hydrate, projection envelopes,
 * tool coalescing). That machinery is only reachable once a Session is open,
 * so it must not ride in the entry chunk. The shell itself only ever needs the
 * entry type, the system-notice writer and the activity label, and those live
 * here as a leaf module with no transcript dependencies.
 */
import {
  CORE_UI_METHODS,
  isRecord,
  parseProjectionEnvelope,
  type RpcNotification,
} from "@octos-org/octoscode-client/protocol";

export type TimelineKind =
  "user" | "assistant" | "reasoning" | "tool" | "system";
export type TimelineStatus = "running" | "complete" | "error" | "info";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  title: string;
  body: string;
  status: TimelineStatus;
  statusLabel?: string;
  turnId?: string;
  messageId?: string;
  streamId?: string;
  turnSettled?: true;
  toolSettled?: true;
  latestTurnOutcome?: string;
  /** Explicit terminal state from this owner's hydrate/live lifecycle. */
  textTerminal?: "completed" | "errored" | "interrupted";
  omittedCount?: number;
  /**
   * Files delivered with a user or assistant message (server paths or upload
   * handles). Rendered as attachments, never as part of `body`.
   */
  media?: readonly string[];
  /** First-seen wall-clock for a streamed block (duration in fold headers). */
  startedAtMs?: number;
  /** Latest stream time while running; final time once settled. */
  endedAtMs?: number;
}

export function timelineActivity(
  entries: readonly TimelineEntry[],
  activeTurnId: string | null,
): string | null {
  if (!activeTurnId || hasTerminal(entries, activeTurnId)) return null;
  const turn = entries.filter((entry) => entry.turnId === activeTurnId);
  const tool = turn.findLast(
    (entry) => entry.kind === "tool" && entry.status === "running",
  );
  if (tool) return `Running ${tool.title}…`;
  const current = turn.findLast(
    (entry) => entry.kind === "assistant" || entry.kind === "reasoning",
  );
  if (current?.status === "running") {
    return current.kind === "reasoning" ? "Thinking…" : "Writing response…";
  }
  return turn.some((entry) => entry.kind === "tool")
    ? "Preparing next step…"
    : "Working…";
}

export function addSystemMessage(
  entries: readonly TimelineEntry[],
  id: string,
  title: string,
  body: string,
  status: TimelineStatus = "info",
): TimelineEntry[] {
  return upsert(entries, { id, kind: "system", title, body, status });
}

export function terminalTurnId(notification: RpcNotification): string | null {
  if (
    notification.method === CORE_UI_METHODS.TURN_COMPLETED ||
    notification.method === CORE_UI_METHODS.TURN_ERROR
  ) {
    return isRecord(notification.params) &&
      typeof notification.params.turn_id === "string"
      ? notification.params.turn_id
      : null;
  }
  if (notification.method !== CORE_UI_METHODS.PROJECTION_ENVELOPE) return null;
  const envelope = parseProjectionEnvelope(notification.params);
  return envelope?.payload.type === "turn_terminal" ? envelope.turn_id : null;
}

export function hasTerminal(
  entries: readonly TimelineEntry[],
  turnId: string,
): boolean {
  return entries.some(
    (entry) =>
      entry.id === `terminal:${turnId}` ||
      (entry.turnId === turnId &&
        (entry.turnSettled || entry.textTerminal !== undefined)),
  );
}

export function nextNoticeId(
  entries: readonly TimelineEntry[],
  prefix: string,
): string {
  let ordinal = entries.length;
  while (entries.some((entry) => entry.id === `${prefix}:${ordinal}`)) {
    ordinal += 1;
  }
  return `${prefix}:${ordinal}`;
}

export function upsert(
  entries: readonly TimelineEntry[],
  next: TimelineEntry,
): TimelineEntry[] {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index < 0) return [...entries, next];
  const previous = entries[index];
  // A hydrated terminal fence survives later canonical refinement of the row.
  if (
    previous?.textTerminal &&
    previous.turnId === next.turnId &&
    next.textTerminal === undefined
  )
    next = { ...next, textTerminal: previous.textTerminal };
  return entries.map((entry, current) => (current === index ? next : entry));
}
