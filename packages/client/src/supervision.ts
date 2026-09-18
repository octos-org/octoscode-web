import { isProtocolUuid } from "./protocol-id.ts";
export { isProtocolUuid } from "./protocol-id.ts";
import {
  isNonEmptyString,
  isU32,
  parseCursor,
} from "./supervision-primitives.ts";
import { isRecord, type RpcNotification } from "./rpc.ts";
import { CORE_UI_METHODS } from "./generated/core-contract.ts";
import type {
  PlanItem,
  PlanUpdated,
  TaskOutputDelta,
  TaskUpdated,
} from "./types.ts";

export function parseTaskUpdated(
  notification: RpcNotification,
): TaskUpdated | null {
  if (
    notification.method !== CORE_UI_METHODS.TASK_UPDATED ||
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
    notification.method !== CORE_UI_METHODS.TASK_OUTPUT_DELTA ||
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
    notification.method !== CORE_UI_METHODS.PLAN_UPDATED ||
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

function parsePlanItem(value: unknown): PlanItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.status !== "string" ||
    !["pending", "in_progress", "completed"].includes(value.status) ||
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

function optionalString<Key extends string>(value: unknown, key: Key) {
  return typeof value === "string"
    ? ({ [key]: value } as Record<Key, string>)
    : null;
}
