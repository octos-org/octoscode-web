import { isRecord, type RpcNotification } from "./rpc.ts";
import { CORE_UI_METHODS } from "./generated/core-contract.ts";
import { isNonNegativeInteger } from "./wire-decoders.ts";
import type { TokenCostUpdate } from "./types.ts";

export function parseTokenCostUpdate(
  notification: RpcNotification,
): TokenCostUpdate | null {
  if (
    notification.method !== CORE_UI_METHODS.PROGRESS_UPDATED ||
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
