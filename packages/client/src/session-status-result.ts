import { isRecord } from "./rpc.ts";
import type { SessionStatusReadResult, SessionUsageStatus } from "./types.ts";
import { parseContextSnapshot } from "./context.ts";

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
  const contextSnapshot = parseContextSnapshot(value, value.session_id);
  return {
    session_id: value.session_id,
    ...(contextSnapshot ? { contextSnapshot } : {}),
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

function isU64(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
