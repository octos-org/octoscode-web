import { isRecord } from "./rpc.ts";
import { isProtocolUuid } from "./protocol-id.ts";
import {
  parseContextSnapshot,
  parseContextState,
  type ContextSnapshot,
  type ContextState,
} from "./context-state.ts";
import type { UiCursor } from "./types.ts";

// Core ui_protocol.rs: UPCR-2026-010/011; these are native read results,
// never instructions to change a browser queue or its durable projection.
export interface InspectionThread {
  thread_id: string;
  root_seq: number;
  root_client_message_id?: string;
  turn_id?: string;
  message_seqs: number[];
  status: string;
}
export interface InspectionThreadGraph {
  session_id: string;
  cursor: UiCursor;
  threads: InspectionThread[];
  orphans: number[];
}
export interface InspectionTurnState {
  session_id: string;
  turn_id: string;
  state:
    | "active"
    | "interrupting"
    | "completed"
    | "errored"
    | "interrupted"
    | "unknown";
  thread_id?: string;
  started_at?: string;
  completed_at?: string;
  committed_seqs: number[];
  context_state?: ContextState;
  /** Only audited lifecycle fields, never an arbitrary result/credential bag. */
  context?: ContextSnapshot;
}

export interface InspectionApprovalScope {
  session_id: string;
  scope: string;
  scope_match: string;
  decision: string;
  turn_id?: string;
}
export interface InspectionApprovalScopes {
  scopes: InspectionApprovalScope[];
}

const uint = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 4096;
function sequences(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > 100_000 || !value.every(uint))
    return null;
  return new Set(value).size === value.length ? [...value] : null;
}
function optionalText(value: unknown): boolean {
  return value == null || text(value);
}
/** Core returns no outer owner envelope: exact ownership is required on EVERY row. */
export function parseInspectionApprovalScopes(
  value: unknown,
  sessionId: string,
): InspectionApprovalScopes | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.scopes) ||
    value.scopes.length > 100_000
  )
    return null;
  const scopes: InspectionApprovalScope[] = [];
  for (const row of value.scopes) {
    if (
      !isRecord(row) ||
      row.session_id !== sessionId ||
      !text(row.scope) ||
      typeof row.scope_match !== "string" ||
      row.scope_match.length > 4096 ||
      !text(row.decision) ||
      (row.turn_id != null && !isProtocolUuid(row.turn_id))
    )
      return null;
    scopes.push({
      session_id: sessionId,
      scope: row.scope,
      scope_match: row.scope_match,
      decision: row.decision,
      ...(typeof row.turn_id === "string" ? { turn_id: row.turn_id } : {}),
    });
  }
  return { scopes };
}
function timestamp(value: unknown): boolean {
  return value == null || (text(value) && Number.isFinite(Date.parse(value)));
}
function thread(value: unknown): InspectionThread | null {
  if (
    !isRecord(value) ||
    !text(value.thread_id) ||
    !uint(value.root_seq) ||
    !text(value.status) ||
    !optionalText(value.root_client_message_id) ||
    (value.turn_id != null && !isProtocolUuid(value.turn_id))
  )
    return null;
  const seqs = sequences(value.message_seqs);
  if (!seqs) return null;
  return {
    thread_id: value.thread_id,
    root_seq: value.root_seq,
    status: value.status,
    message_seqs: seqs,
    ...(typeof value.root_client_message_id === "string"
      ? { root_client_message_id: value.root_client_message_id }
      : {}),
    ...(typeof value.turn_id === "string" ? { turn_id: value.turn_id } : {}),
  };
}
export function parseInspectionThreadGraph(
  value: unknown,
  sessionId: string,
): InspectionThreadGraph | null {
  if (
    !isRecord(value) ||
    value.session_id !== sessionId ||
    !isRecord(value.cursor) ||
    !text(value.cursor.stream) ||
    !uint(value.cursor.seq) ||
    !Array.isArray(value.threads) ||
    value.threads.length > 100_000
  )
    return null;
  const threads: InspectionThread[] = [];
  const ids = new Set<string>();
  for (const entry of value.threads) {
    const parsed = thread(entry);
    if (!parsed || ids.has(parsed.thread_id)) return null;
    ids.add(parsed.thread_id);
    threads.push(parsed);
  }
  const orphans = sequences(value.orphans);
  if (!orphans) return null;
  return {
    session_id: sessionId,
    cursor: { stream: value.cursor.stream, seq: value.cursor.seq },
    threads,
    orphans,
  };
}
export function parseInspectionTurnState(
  value: unknown,
  sessionId: string,
  turnId: string,
): InspectionTurnState | null {
  if (
    !isRecord(value) ||
    value.session_id !== sessionId ||
    value.turn_id !== turnId ||
    !isProtocolUuid(turnId) ||
    !optionalText(value.thread_id) ||
    !timestamp(value.started_at) ||
    !timestamp(value.completed_at)
  )
    return null;
  const state = value.state;
  if (
    state !== "active" &&
    state !== "interrupting" &&
    state !== "completed" &&
    state !== "errored" &&
    state !== "interrupted" &&
    state !== "unknown"
  )
    return null;
  // Core omits this serde-default field when no rows have committed.
  const committed = sequences(
    value.committed_seqs === undefined ? [] : value.committed_seqs,
  );
  if (!committed) return null;
  const contextState =
    value.context_state == null
      ? null
      : parseContextState(value.context_state, sessionId);
  if (value.context_state != null && !contextState) return null;
  let context: ContextSnapshot | null = null;
  if (value.context != null) {
    // Validate the nested owner independently of the outer context_state.
    if (
      !isRecord(value.context) ||
      value.context.schema !== "octos.context.lifecycle.v1" ||
      !parseContextState(value.context.state, sessionId)
    )
      return null;
    context = parseContextSnapshot({ context: value.context }, sessionId);
    if (!context) return null;
  }
  return {
    session_id: sessionId,
    turn_id: turnId,
    state,
    committed_seqs: committed,
    ...(typeof value.thread_id === "string"
      ? { thread_id: value.thread_id }
      : {}),
    ...(typeof value.started_at === "string"
      ? { started_at: value.started_at }
      : {}),
    ...(typeof value.completed_at === "string"
      ? { completed_at: value.completed_at }
      : {}),
    ...(contextState ? { context_state: contextState } : {}),
    ...(context ? { context } : {}),
  };
}
