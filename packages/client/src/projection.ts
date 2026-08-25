import { isRecord } from "./rpc.ts";
import type {
  ProjectionEnvelopeV2,
  ProjectionPayload,
  UiCursor,
} from "./types.ts";

export function parseProjectionEnvelope(
  value: unknown,
): ProjectionEnvelopeV2 | null {
  if (!isRecord(value) || !isRecord(value.payload)) return null;
  if (
    typeof value.session_id !== "string" ||
    typeof value.thread_id !== "string" ||
    typeof value.seq !== "number" ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0 ||
    typeof value.turn_id !== "string" ||
    typeof value.payload.type !== "string" ||
    !("data" in value.payload)
  ) {
    return null;
  }

  let cursor: UiCursor | undefined;
  if (value.cursor !== undefined) {
    const parsedCursor = parseCursor(value.cursor);
    if (parsedCursor === null) return null;
    cursor = parsedCursor;
  }

  const payload: ProjectionPayload = {
    type: value.payload.type,
    data: value.payload.data,
  };

  return {
    session_id: value.session_id,
    thread_id: value.thread_id,
    seq: value.seq,
    turn_id: value.turn_id,
    payload,
    ...(typeof value.topic === "string" ? { topic: value.topic } : {}),
    ...(typeof value.client_message_id === "string"
      ? { client_message_id: value.client_message_id }
      : {}),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function parseCursor(value: unknown): UiCursor | null {
  if (
    !isRecord(value) ||
    typeof value.stream !== "string" ||
    typeof value.seq !== "number" ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0
  ) {
    return null;
  }
  return { stream: value.stream, seq: value.seq };
}
