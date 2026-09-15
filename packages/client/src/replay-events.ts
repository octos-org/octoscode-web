import { isRecord } from "./rpc.ts";
import { parseUiCursor } from "./wire-decoders.ts";
import type { ReplayLossyEvent } from "./types.ts";

export function parseReplayLossyEvent(value: unknown): ReplayLossyEvent | null {
  if (
    !isRecord(value) ||
    typeof value.session_id !== "string" ||
    typeof value.dropped_count !== "number" ||
    !Number.isSafeInteger(value.dropped_count) ||
    value.dropped_count < 0
  ) {
    return null;
  }
  const cursor =
    value.last_durable_cursor === undefined
      ? undefined
      : parseUiCursor(value.last_durable_cursor);
  if (cursor === null) return null;
  return {
    session_id: value.session_id,
    dropped_count: value.dropped_count,
    ...(cursor === undefined ? {} : { last_durable_cursor: cursor }),
  };
}
