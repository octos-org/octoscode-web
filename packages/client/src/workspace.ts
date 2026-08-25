import { isRecord, type RpcNotification } from "./rpc.ts";
import type {
  SessionDeleteResult,
  SessionFileInfo,
  SessionFilesListResult,
  SessionListEntry,
  SessionListResult,
  TokenCostUpdate,
} from "./types.ts";

export function parseSessionListResult(
  value: unknown,
): SessionListResult | null {
  if (!isRecord(value) || !Array.isArray(value.sessions)) return null;
  const sessions = value.sessions.map(parseSessionEntry);
  return sessions.some((entry) => entry === null)
    ? null
    : { sessions: sessions as SessionListEntry[] };
}

export function parseSessionDeleteResult(
  value: unknown,
): SessionDeleteResult | null {
  return isRecord(value) ? {} : null;
}

export function parseSessionFilesListResult(
  value: unknown,
): SessionFilesListResult | null {
  if (!isRecord(value) || !Array.isArray(value.files)) return null;
  const files = value.files.map(parseSessionFile);
  return files.some((file) => file === null)
    ? null
    : { files: files as SessionFileInfo[] };
}

export function parseTokenCostUpdate(
  notification: RpcNotification,
): TokenCostUpdate | null {
  if (
    notification.method !== "progress/updated" ||
    !isRecord(notification.params) ||
    typeof notification.params.session_id !== "string" ||
    !isRecord(notification.params.metadata) ||
    notification.params.metadata.kind !== "token_cost_update" ||
    !isRecord(notification.params.metadata.token_cost)
  ) {
    return null;
  }
  const value = notification.params.metadata.token_cost;
  const integerFields = [
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "total_tokens",
    "context_window",
  ] as const;
  if (
    integerFields.some(
      (key) => value[key] !== undefined && !isNonNegativeInteger(value[key]),
    ) ||
    ["response_cost", "session_cost"].some(
      (key) =>
        value[key] !== undefined &&
        (typeof value[key] !== "number" || !Number.isFinite(value[key])),
    ) ||
    ["currency", "model"].some(
      (key) => value[key] !== undefined && typeof value[key] !== "string",
    ) ||
    (notification.params.turn_id !== undefined &&
      typeof notification.params.turn_id !== "string")
  ) {
    return null;
  }
  return {
    sessionId: notification.params.session_id,
    ...optionalString(notification.params.turn_id, "turnId"),
    ...optionalNumber(value.input_tokens, "inputTokens"),
    ...optionalNumber(value.output_tokens, "outputTokens"),
    ...optionalNumber(value.reasoning_tokens, "reasoningTokens"),
    ...optionalNumber(value.cache_read_tokens, "cacheReadTokens"),
    ...optionalNumber(value.cache_write_tokens, "cacheWriteTokens"),
    ...optionalNumber(value.total_tokens, "totalTokens"),
    ...optionalNumber(value.response_cost, "responseCost"),
    ...optionalNumber(value.session_cost, "sessionCost"),
    ...optionalString(value.currency, "currency"),
    ...optionalString(value.model, "model"),
    ...optionalNumber(value.context_window, "contextWindow"),
  };
}

function parseSessionEntry(value: unknown): SessionListEntry | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonNegativeInteger(value.message_count) ||
    !optionalStringsValid(value, ["title", "updated_at", "last_prompt"])
  ) {
    return null;
  }
  return {
    id: value.id,
    message_count: value.message_count,
    ...optionalString(value.title, "title"),
    ...optionalString(value.updated_at, "updated_at"),
    ...optionalString(value.last_prompt, "last_prompt"),
  };
}

function parseSessionFile(value: unknown): SessionFileInfo | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.filename) ||
    !isNonEmptyString(value.path) ||
    !isNonNegativeInteger(value.size_bytes) ||
    typeof value.modified_at !== "string"
  ) {
    return null;
  }
  return {
    filename: value.filename,
    path: value.path,
    size_bytes: value.size_bytes,
    modified_at: value.modified_at,
  };
}

function optionalStringsValid(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every(
    (key) => value[key] === undefined || typeof value[key] === "string",
  );
}

function optionalString<Key extends string>(value: unknown, key: Key) {
  return typeof value === "string"
    ? ({ [key]: value } as Record<Key, string>)
    : {};
}

function optionalNumber<Key extends string>(value: unknown, key: Key) {
  return typeof value === "number"
    ? ({ [key]: value } as Record<Key, number>)
    : {};
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
