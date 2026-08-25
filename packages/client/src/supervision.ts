import { isRecord, type RpcNotification } from "./rpc.ts";
import type {
  OutputCursor,
  PlanItem,
  PlanUpdated,
  SessionStatusReadResult,
  SessionUsageStatus,
  TaskArtifactListResult,
  TaskArtifactReadResult,
  TaskArtifactRecord,
  TaskCancelResult,
  TaskListEntry,
  TaskListResult,
  TaskOutputReadLimitation,
  TaskOutputDelta,
  TaskOutputReadResult,
  TaskUpdated,
} from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProtocolUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

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

export function parseTaskUpdated(
  notification: RpcNotification,
): TaskUpdated | null {
  if (
    notification.method !== "task/updated" ||
    !isRecord(notification.params)
  ) {
    return null;
  }
  const value = notification.params;
  if (
    typeof value.session_id !== "string" ||
    !isProtocolUuid(value.task_id) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.state)
  ) {
    return null;
  }
  return {
    sessionId: value.session_id,
    taskId: value.task_id,
    title: value.title,
    state: value.state,
    ...optionalString(value.topic, "topic"),
    ...optionalString(value.tool_call_id, "toolCallId"),
    ...optionalString(value.turn_id, "turnId"),
    ...optionalString(value.runtime_detail, "runtimeDetail"),
    ...optionalString(value.source, "source"),
    ...optionalString(value.role, "role"),
    ...optionalString(value.summary, "summary"),
    ...(isU32(value.artifact_count)
      ? { artifactCount: value.artifact_count }
      : {}),
    ...(value.runtime_policy_stamp === undefined
      ? {}
      : { runtimePolicyStamp: value.runtime_policy_stamp }),
  };
}

export function parseTaskOutputDelta(
  notification: RpcNotification,
): TaskOutputDelta | null {
  if (
    notification.method !== "task/output/delta" ||
    !isRecord(notification.params)
  ) {
    return null;
  }
  const value = notification.params;
  const cursor = parseCursor(value.cursor);
  if (
    typeof value.session_id !== "string" ||
    !isProtocolUuid(value.task_id) ||
    typeof value.text !== "string" ||
    !cursor ||
    (value.topic !== undefined && typeof value.topic !== "string")
  ) {
    return null;
  }
  return {
    sessionId: value.session_id,
    taskId: value.task_id,
    cursor,
    text: value.text,
    ...(typeof value.topic === "string" ? { topic: value.topic } : {}),
  };
}

export function parsePlanUpdated(
  notification: RpcNotification,
): PlanUpdated | null {
  if (
    notification.method !== "plan/updated" ||
    !isRecord(notification.params)
  ) {
    return null;
  }
  const value = notification.params;
  if (typeof value.session_id !== "string" || !isRecord(value.plan))
    return null;
  const plan = value.plan;
  if (
    !Array.isArray(plan.items) ||
    typeof plan.updated_at_ms !== "number" ||
    !Number.isSafeInteger(plan.updated_at_ms)
  ) {
    return null;
  }
  const items = plan.items.map(parsePlanItem);
  if (items.some((item) => item === null)) return null;
  return {
    sessionId: value.session_id,
    ...optionalString(value.topic, "topic"),
    ...optionalString(value.turn_id, "turnId"),
    ...optionalString(plan.title, "title"),
    updatedAtMs: plan.updated_at_ms,
    items: items as PlanItem[],
  };
}

export function parseSessionStatusReadResult(
  value: unknown,
): SessionStatusReadResult | null {
  if (!isRecord(value) || typeof value.session_id !== "string") return null;
  const stringFields = [
    "runtime_mode",
    "profile_id",
    "cwd",
    "workspace_root",
    "active_turn_id",
    "permission_profile",
    "approval_policy",
    "sandbox_mode",
    "sandbox",
    "filesystem_scope",
    "network",
    "tool_policy_id",
    "memory_scope",
  ] as const;
  if (
    stringFields.some(
      (key) => value[key] !== undefined && typeof value[key] !== "string",
    )
  ) {
    return null;
  }
  if (
    value.runtime_policy_stamp !== undefined &&
    !isRecord(value.runtime_policy_stamp)
  ) {
    return null;
  }
  const model = parseModel(value.model);
  if (!model.valid) return null;
  const mcpServers = value.mcp_servers ?? [];
  if (!Array.isArray(mcpServers) || !mcpServers.every(isString)) return null;
  const usage = parseUsage(value.usage);
  const health = parseHealth(value.health);
  const cursor = parseSessionCursor(value.cursor);
  if (!usage.valid || !health.valid || !cursor.valid) return null;
  return {
    session_id: value.session_id,
    ...copyOptionalStrings(value, stringFields),
    ...(isRecord(value.runtime_policy_stamp)
      ? { runtime_policy_stamp: value.runtime_policy_stamp }
      : {}),
    ...(model.value ? { model: model.value } : {}),
    mcp_servers: mcpServers,
    ...(usage.value ? { usage: usage.value } : {}),
    ...(health.value ? { health: health.value } : {}),
    ...(cursor.value ? { cursor: cursor.value } : {}),
  };
}

function parseUsage(value: unknown): {
  valid: boolean;
  value?: SessionUsageStatus;
} {
  if (value === undefined || value === null) return { valid: true };
  if (!isRecord(value)) return { valid: false };
  const keys = [
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
    "cached_output_tokens",
    "estimated_cost_micros_usd",
  ] as const;
  if (keys.some((key) => value[key] !== undefined && !isU64(value[key]))) {
    return { valid: false };
  }
  return {
    valid: true,
    value: Object.fromEntries(
      keys.flatMap((key) => (isU64(value[key]) ? [[key, value[key]]] : [])),
    ) as SessionUsageStatus,
  };
}

function parseHealth(value: unknown): {
  valid: boolean;
  value?: { status: string; message?: string };
} {
  if (value === undefined || value === null) return { valid: true };
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.status) ||
    (value.message !== undefined && typeof value.message !== "string")
  ) {
    return { valid: false };
  }
  return {
    valid: true,
    value: {
      status: value.status,
      ...(typeof value.message === "string" ? { message: value.message } : {}),
    },
  };
}

function parseSessionCursor(value: unknown): {
  valid: boolean;
  value?: SessionStatusReadResult["cursor"];
} {
  if (value === undefined || value === null) return { valid: true };
  if (
    !isRecord(value) ||
    typeof value.healthy !== "boolean" ||
    typeof value.replay_supported !== "boolean" ||
    (value.detail !== undefined && typeof value.detail !== "string")
  ) {
    return { valid: false };
  }
  let parsedCursor;
  if (value.cursor !== undefined && value.cursor !== null) {
    if (
      !isRecord(value.cursor) ||
      typeof value.cursor.stream !== "string" ||
      !isU64(value.cursor.seq)
    ) {
      return { valid: false };
    }
    parsedCursor = { stream: value.cursor.stream, seq: value.cursor.seq };
  }
  return {
    valid: true,
    value: {
      ...(parsedCursor ? { cursor: parsedCursor } : {}),
      healthy: value.healthy,
      replay_supported: value.replay_supported,
      ...(typeof value.detail === "string" ? { detail: value.detail } : {}),
    },
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

function parseCursor(value: unknown): OutputCursor | null {
  return isRecord(value) && isU64(value.offset)
    ? { offset: value.offset }
    : null;
}

function parseLimitation(value: unknown): TaskOutputReadLimitation | null {
  return isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
    ? { code: value.code, message: value.message }
    : null;
}

function parsePlanItem(value: unknown): PlanItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !["pending", "in_progress", "completed"].includes(String(value.status)) ||
    (value.priority !== undefined && typeof value.priority !== "string")
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    status: value.status as PlanItem["status"],
    ...(typeof value.priority === "string" ? { priority: value.priority } : {}),
  };
}

function parseModel(value: unknown): {
  valid: boolean;
  value?: { model: string; provider: string; title?: string };
} {
  if (value === undefined || value === null) return { valid: true };
  if (!isRecord(value)) return { valid: false };
  if (
    !["undefined", "null", "string"].includes(typeLabel(value.model)) ||
    !["undefined", "null", "string"].includes(typeLabel(value.provider)) ||
    (value.title !== undefined && typeof value.title !== "string")
  ) {
    return { valid: false };
  }
  if (typeof value.model !== "string" || typeof value.provider !== "string") {
    return { valid: true };
  }
  return {
    valid: true,
    value: {
      model: value.model,
      provider: value.provider,
      ...(typeof value.title === "string" ? { title: value.title } : {}),
    },
  };
}

function typeLabel(value: unknown): "undefined" | "null" | "string" | "other" {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return typeof value === "string" ? "string" : "other";
}

function optionalString<Key extends string>(value: unknown, key: Key) {
  return typeof value === "string"
    ? ({ [key]: value } as Record<Key, string>)
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
