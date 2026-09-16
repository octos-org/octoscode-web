import { isRecord } from "./rpc.ts";
import { isProtocolUuid } from "./protocol-id.ts";
import type {
  OutputCursor,
  TaskArtifactListResult,
  TaskArtifactReadResult,
  TaskArtifactRecord,
  TaskCancelResult,
  TaskListEntry,
  TaskListResult,
  TaskOutputReadLimitation,
  TaskOutputReadResult,
} from "./types.ts";

// Cold task inspection RPC decoders; streaming notifications stay in supervision.ts.
export function parseTaskListResult(value: unknown): TaskListResult | null {
  if (!isRecord(value) || typeof value.session_id !== "string") return null;
  if (!Array.isArray(value.tasks)) return null;
  const tasks = value.tasks.map(parseTaskListEntry);
  if (tasks.some((task) => task === null)) return null;
  if (value.topic !== undefined && typeof value.topic !== "string") return null;
  return {
    session_id: value.session_id,
    ...(typeof value.topic === "string" ? { topic: value.topic } : {}),
    tasks: tasks as TaskListEntry[],
  };
}

export function parseTaskCancelResult(value: unknown): TaskCancelResult | null {
  return isRecord(value) &&
    isProtocolUuid(value.task_id) &&
    isNonEmptyString(value.status)
    ? { task_id: value.task_id, status: value.status }
    : null;
}

export function parseTaskOutputReadResult(
  value: unknown,
): TaskOutputReadResult | null {
  if (
    !isRecord(value) ||
    typeof value.session_id !== "string" ||
    !isProtocolUuid(value.task_id) ||
    !isNonEmptyString(value.source) ||
    typeof value.text !== "string" ||
    !isU64(value.bytes_read) ||
    !isU64(value.total_bytes) ||
    typeof value.truncated !== "boolean" ||
    typeof value.complete !== "boolean" ||
    typeof value.live_tail_supported !== "boolean" ||
    typeof value.is_snapshot_projection !== "boolean" ||
    !isNonEmptyString(value.task_status) ||
    !isNonEmptyString(value.runtime_state) ||
    !isNonEmptyString(value.lifecycle_state) ||
    !Array.isArray(value.output_files) ||
    !value.output_files.every(isString) ||
    !Array.isArray(value.limitations)
  ) {
    return null;
  }
  const cursor = parseCursor(value.cursor);
  const nextCursor = parseCursor(value.next_cursor);
  const limitations = value.limitations.map(parseLimitation);
  if (!cursor || !nextCursor || limitations.some((item) => item === null)) {
    return null;
  }
  return {
    session_id: value.session_id,
    task_id: value.task_id,
    source: value.source,
    cursor,
    next_cursor: nextCursor,
    text: value.text,
    bytes_read: value.bytes_read,
    total_bytes: value.total_bytes,
    truncated: value.truncated,
    complete: value.complete,
    live_tail_supported: value.live_tail_supported,
    is_snapshot_projection: value.is_snapshot_projection,
    task_status: value.task_status,
    runtime_state: value.runtime_state,
    lifecycle_state: value.lifecycle_state,
    ...(value.runtime_detail === undefined
      ? {}
      : { runtime_detail: value.runtime_detail }),
    output_files: value.output_files,
    limitations: limitations as TaskOutputReadLimitation[],
  };
}

export function parseTaskArtifactListResult(
  value: unknown,
): TaskArtifactListResult | null {
  if (
    !isRecord(value) ||
    typeof value.session_id !== "string" ||
    !isProtocolUuid(value.task_id) ||
    !Array.isArray(value.artifacts) ||
    (value.agent_id !== undefined && typeof value.agent_id !== "string")
  ) {
    return null;
  }
  const artifacts = value.artifacts.map(parseArtifact);
  if (artifacts.some((artifact) => artifact === null)) return null;
  return {
    session_id: value.session_id,
    task_id: value.task_id,
    ...(typeof value.agent_id === "string" ? { agent_id: value.agent_id } : {}),
    artifacts: artifacts as TaskArtifactRecord[],
  };
}

export function parseTaskArtifactReadResult(
  value: unknown,
): TaskArtifactReadResult | null {
  if (
    !isRecord(value) ||
    typeof value.session_id !== "string" ||
    !isProtocolUuid(value.task_id) ||
    typeof value.has_more !== "boolean" ||
    (value.agent_id !== undefined && typeof value.agent_id !== "string") ||
    (value.content !== undefined && typeof value.content !== "string")
  ) {
    return null;
  }
  const artifact = parseArtifact(value.artifact);
  const cursor =
    value.cursor === undefined ? undefined : parseCursor(value.cursor);
  const nextCursor =
    value.next_cursor === undefined
      ? undefined
      : parseCursor(value.next_cursor);
  if (!artifact || cursor === null || nextCursor === null) return null;
  return {
    session_id: value.session_id,
    task_id: value.task_id,
    ...(typeof value.agent_id === "string" ? { agent_id: value.agent_id } : {}),
    artifact,
    ...(typeof value.content === "string" ? { content: value.content } : {}),
    ...(cursor ? { cursor } : {}),
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
    has_more: value.has_more,
  };
}

function parseTaskListEntry(value: unknown): TaskListEntry | null {
  if (
    !isRecord(value) ||
    !isProtocolUuid(value.id) ||
    !isNonEmptyString(value.tool_name) ||
    typeof value.tool_call_id !== "string" ||
    !isNonEmptyString(value.state) ||
    typeof value.status !== "string" ||
    typeof value.lifecycle_state !== "string" ||
    typeof value.runtime_state !== "string" ||
    typeof value.started_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }
  const outputFiles = value.output_files ?? [];
  if (!Array.isArray(outputFiles) || !outputFiles.every(isString)) return null;
  const entry: TaskListEntry = {
    id: value.id,
    tool_name: value.tool_name,
    tool_call_id: value.tool_call_id,
    state: value.state,
    status: value.status,
    lifecycle_state: value.lifecycle_state,
    runtime_state: value.runtime_state,
    started_at: value.started_at,
    updated_at: value.updated_at,
    output_files: outputFiles,
  };
  const optionalStrings = [
    "source",
    "role",
    "summary",
    "parent_session_key",
    "child_session_key",
    "child_terminal_state",
    "child_join_state",
    "child_joined_at",
    "child_failure_action",
    "workflow_kind",
    "current_phase",
    "completed_at",
    "error",
    "session_key",
  ] as const;
  Object.assign(entry, copyOptionalStrings(value, optionalStrings));
  if (isU32(value.artifact_count)) entry.artifact_count = value.artifact_count;
  if (value.runtime_policy_stamp !== undefined) {
    entry.runtime_policy_stamp = value.runtime_policy_stamp;
  }
  if (value.runtime_detail !== undefined)
    entry.runtime_detail = value.runtime_detail;
  return entry;
}

function parseArtifact(value: unknown): TaskArtifactRecord | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.status !== "string" ||
    (value.path !== undefined && typeof value.path !== "string") ||
    (value.content !== undefined && typeof value.content !== "string")
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    kind: value.kind,
    status: value.status,
    ...(typeof value.path === "string" ? { path: value.path } : {}),
    ...(typeof value.content === "string" ? { content: value.content } : {}),
  };
}

function parseLimitation(value: unknown): TaskOutputReadLimitation | null {
  return isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
    ? { code: value.code, message: value.message }
    : null;
}

// Keep these small decoder primitives local to the cold boundary. Sharing a
// two-consumer helper with the hot notification module co-chunks this entire
// RPC decoder module back into the startup preload graph in Rolldown.
function parseCursor(value: unknown): OutputCursor | null {
  return isRecord(value) && isU64(value.offset)
    ? { offset: value.offset }
    : null;
}

function copyOptionalStrings<const Keys extends readonly string[]>(
  value: Record<string, unknown>,
  keys: Keys,
): Partial<Record<Keys[number], string>> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      typeof value[key] === "string" ? [[key, value[key]]] : [],
    ),
  ) as Partial<Record<Keys[number], string>>;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isU32(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= 4_294_967_295
  );
}

function isU64(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
