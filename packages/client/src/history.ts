import {
  CORE_UI_METHODS,
  CORE_UI_FEATURES,
} from "./generated/core-contract.ts";
import { isRecord } from "./rpc.ts";
import { supportsFeature, supportsMethod } from "./interaction.ts";
import { parseSessionHydrateResult } from "./hydrate.ts";
import { isProtocolUuid } from "./supervision.ts";
import type { SessionHydrateResult, UiProtocolCapabilities } from "./types.ts";

// AppUI-only extensions audited against rc11 ui_protocol_transport.rs.
export const APPUI_SNAPSHOT_METHODS = {
  LIST: "snapshot/list",
  RESTORE: "snapshot/restore",
} as const;
export interface WorkspaceSnapshot {
  id: string;
  label: string;
  timestamp_unix: number;
}
export interface SnapshotList {
  session_id: string;
  enabled: boolean;
  available: boolean;
  snapshots: WorkspaceSnapshot[];
}
export interface SnapshotRestore {
  session_id: string;
  restored: string;
  snapshots: WorkspaceSnapshot[];
}
export interface RollbackResult {
  dropped_turns: number;
  thread: SessionHydrateResult;
}
export interface ForkResult {
  new_session_id: string;
  parent_session_id: string;
  copied_messages: number;
}
export interface ReviewStartResult {
  accepted: boolean;
  session_id: string;
  turn_id: string;
  workflow: "code_review";
  backend: "native";
  agent_count: number;
}

const uint = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const u32 = (value: unknown): value is number =>
  uint(value) && value <= 0xffff_ffff;
export function validForkChatId(value: string): boolean {
  return (
    value.length > 0 &&
    new TextEncoder().encode(value).length <= 50 &&
    !/[#:/\p{Cc}]/u.test(value) &&
    value.toLowerCase() !== "default"
  );
}
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 2048;
function snapshotRows(value: unknown): WorkspaceSnapshot[] | null {
  if (!Array.isArray(value) || value.length > 10000) return null;
  const ids = new Set<string>();
  const rows: WorkspaceSnapshot[] = [];
  for (const row of value) {
    if (
      !isRecord(row) ||
      !text(row.id) ||
      typeof row.label !== "string" ||
      !uint(row.timestamp_unix) ||
      ids.has(row.id)
    )
      return null;
    ids.add(row.id);
    rows.push({
      id: row.id,
      label: row.label.slice(0, 512),
      timestamp_unix: row.timestamp_unix,
    });
  }
  return rows;
}
export function parseSnapshotList(
  value: unknown,
  sessionId: string,
): SnapshotList | null {
  if (
    !isRecord(value) ||
    value.session_id !== sessionId ||
    typeof value.enabled !== "boolean" ||
    typeof value.available !== "boolean"
  )
    return null;
  const snapshots = snapshotRows(value.snapshots);
  return snapshots
    ? {
        session_id: sessionId,
        enabled: value.enabled,
        available: value.available,
        snapshots,
      }
    : null;
}
export function parseSnapshotRestore(
  value: unknown,
  sessionId: string,
  snapshotId: string,
): SnapshotRestore | null {
  if (
    !isRecord(value) ||
    value.session_id !== sessionId ||
    value.restored !== snapshotId
  )
    return null;
  const snapshots = snapshotRows(value.snapshots);
  return snapshots
    ? { session_id: sessionId, restored: snapshotId, snapshots }
    : null;
}
export function parseRollbackResult(
  value: unknown,
  sessionId: string,
): RollbackResult | null {
  if (!isRecord(value) || !uint(value.dropped_turns)) return null;
  const thread = parseSessionHydrateResult(value.thread);
  return thread?.session_id === sessionId
    ? { dropped_turns: value.dropped_turns, thread }
    : null;
}
export function parseForkResult(
  value: unknown,
  sessionId: string,
): ForkResult | null {
  if (
    !isRecord(value) ||
    value.parent_session_id !== sessionId ||
    !text(value.new_session_id) ||
    value.new_session_id === sessionId ||
    !uint(value.copied_messages)
  )
    return null;
  return {
    parent_session_id: sessionId,
    new_session_id: value.new_session_id,
    copied_messages: value.copied_messages,
  };
}
export function parseReviewStartResult(
  value: unknown,
  sessionId: string,
  turnId: string,
): ReviewStartResult | null {
  if (
    !isRecord(value) ||
    value.session_id !== sessionId ||
    value.turn_id !== turnId ||
    typeof value.accepted !== "boolean" ||
    value.workflow !== "code_review" ||
    value.backend !== "native" ||
    !uint(value.agent_count)
  )
    return null;
  return {
    session_id: sessionId,
    turn_id: turnId,
    accepted: value.accepted,
    workflow: "code_review",
    backend: "native",
    agent_count: value.agent_count,
  };
}

export function createHistoryCommands(
  client: { request(method: string, params: unknown): Promise<unknown> },
  sessionId: string,
  capabilities: UiProtocolCapabilities,
) {
  const available = (method: string) => {
    if (!supportsMethod(capabilities, method))
      throw new Error(`${method} is not advertised by this server`);
  };
  const validate = <T>(result: T | null): T => {
    if (result === null)
      throw new Error("Invalid or wrong-session history result");
    return result;
  };
  return {
    async listSnapshots() {
      available(APPUI_SNAPSHOT_METHODS.LIST);
      return validate(
        parseSnapshotList(
          await client.request(APPUI_SNAPSHOT_METHODS.LIST, {
            session_id: sessionId,
          }),
          sessionId,
        ),
      );
    },
    async restoreSnapshot(snapshotId: string) {
      available(APPUI_SNAPSHOT_METHODS.RESTORE);
      if (!text(snapshotId)) throw new Error("A snapshot is required");
      return validate(
        parseSnapshotRestore(
          await client.request(APPUI_SNAPSHOT_METHODS.RESTORE, {
            session_id: sessionId,
            snapshot_id: snapshotId,
          }),
          sessionId,
          snapshotId,
        ),
      );
    },
    async rewind(numTurns: number) {
      available(CORE_UI_METHODS.SESSION_ROLLBACK);
      if (!u32(numTurns) || numTurns === 0)
        throw new Error("Rewind requires a positive turn count");
      return validate(
        parseRollbackResult(
          await client.request(CORE_UI_METHODS.SESSION_ROLLBACK, {
            session_id: sessionId,
            num_turns: numTurns,
          }),
          sessionId,
        ),
      );
    },
    async fork(newChatId: string, copyMessages?: number) {
      available(CORE_UI_METHODS.SESSION_FORK);
      if (
        !validForkChatId(newChatId) ||
        (copyMessages !== undefined && !u32(copyMessages))
      )
        throw new Error("Invalid conversation branch request");
      return validate(
        parseForkResult(
          await client.request(CORE_UI_METHODS.SESSION_FORK, {
            session_id: sessionId,
            new_chat_id: newChatId,
            ...(copyMessages === undefined
              ? {}
              : { copy_messages: copyMessages }),
          }),
          sessionId,
        ),
      );
    },
    async startReview(turnId: string, prompt?: string) {
      available(CORE_UI_METHODS.REVIEW_START);
      if (!supportsFeature(capabilities, CORE_UI_FEATURES.REVIEW_START_V1))
        throw new Error("Native review is not advertised by this server");
      if (!isProtocolUuid(turnId))
        throw new Error("Review requires a protocol turn UUID");
      return validate(
        parseReviewStartResult(
          await client.request(CORE_UI_METHODS.REVIEW_START, {
            session_id: sessionId,
            turn_id: turnId,
            delivery: "inline",
            ...(prompt === undefined ? {} : { prompt }),
          }),
          sessionId,
          turnId,
        ),
      );
    },
  };
}
