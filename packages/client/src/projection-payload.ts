import { isRecord } from "./rpc.ts";
import {
  isNonEmptyString,
  isNonNegativeInteger,
  isStringArray,
} from "./wire-decoders.ts";

/**
 * Guard the canonical fields consumed by this client before cursor/lifecycle
 * mutation. Based on PayloadV2 in the pinned Core contract, not a second DTO
 * schema: additive fields and unknown event types remain forward compatible.
 * Segment/meta and background metadata may be absent in older replay fixtures;
 * a supplied value must still be safe to consume. Rust Option fields also
 * accept JSON null.
 */
export function isProjectionPayloadData(type: string, data: unknown): boolean {
  switch (type) {
    case "user_message":
      return (
        isRecord(data) &&
        typeof data.text === "string" &&
        (data.files === undefined ||
          (Array.isArray(data.files) && data.files.every(isFileRef)))
      );
    case "reasoning_delta":
      return isRecord(data) && typeof data.text === "string";
    case "assistant_delta":
    case "assistant_persisted":
      return (
        isRecord(data) &&
        typeof data.text === "string" &&
        optional(data.assistant_segment_id, isNonEmptyString) &&
        (type !== "assistant_persisted" || optional(data.meta, isMessageMeta))
      );
    case "tool_start":
      return (
        isRecord(data) &&
        isNonEmptyString(data.tool_call_id) &&
        isNonEmptyString(data.name) &&
        nullable(data.arguments_preview, isString)
      );
    case "tool_progress":
      return (
        isRecord(data) &&
        isNonEmptyString(data.tool_call_id) &&
        typeof data.message === "string"
      );
    case "tool_end":
      return (
        isRecord(data) &&
        isNonEmptyString(data.tool_call_id) &&
        ["complete", "error", "skipped", "aborted"].includes(
          data.status as string,
        ) &&
        ["error", "reason", "output_preview"].every((key) =>
          nullable(data[key], isString),
        ) &&
        nullable(data.duration_ms, isNonNegativeInteger)
      );
    case "file_attached":
      return isFileRef(data) && isAttachmentOwner(data.attachment_owner);
    case "turn_terminal":
      return (
        isRecord(data) &&
        ["completed", "errored", "interrupted", "rate_limited"].includes(
          data.outcome as string,
        ) &&
        nullable(data.error, isTerminalError) &&
        nullable(data.token_usage, isTokenUsage)
      );
    case "background/spawn_complete":
      return (
        isRecord(data) &&
        isNonEmptyString(data.task_id) &&
        typeof data.content === "string" &&
        ["parent_turn_id", "message_id"].every((key) =>
          optional(data[key], isNonEmptyString),
        ) &&
        ["source", "persisted_at"].every((key) =>
          optional(data[key], isString),
        ) &&
        ["response_to_client_message_id", "tool_call_id"].every((key) =>
          nullable(data[key], isNonEmptyString),
        ) &&
        optional(data.media, isStringArray)
      );
    default:
      // An unrecognized event can be skipped without creating a sequence gap.
      return true;
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function optional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

function nullable(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === null || optional(value, check);
}

function isFileRef(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.mime === "string" &&
    isNonNegativeInteger(value.size_bytes)
  );
}

function isMessageMeta(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.message_id) &&
    optional(value.persisted_at, isString) &&
    optional(value.media, isStringArray)
  );
}

function isAttachmentOwner(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["assistant_segment_id", "tool_call_id"].every((key) =>
      nullable(value[key], isNonEmptyString),
    )
  );
}

function isTerminalError(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

function isTokenUsage(value: unknown): boolean {
  return (
    isRecord(value) &&
    [
      "input_tokens",
      "output_tokens",
      "reasoning_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
    ].every((key) => optional(value[key], isNonNegativeInteger))
  );
}
