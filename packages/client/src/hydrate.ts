import { isRecord } from "./rpc.ts";
import { parseProjectionEnvelope } from "./projection.ts";
import type {
  HydratedMessage,
  HydratedTurn,
  ProjectionEnvelopeV2,
  ReplayLossyEvent,
  SessionHydrateResult,
} from "./types.ts";
import { parseUiCursor } from "./wire-decoders.ts";

export function parseSessionHydrateResult(
  value: unknown,
): SessionHydrateResult | null {
  if (!isRecord(value) || typeof value.session_id !== "string") return null;
  const sessionId = value.session_id;
  const cursor = parseUiCursor(value.cursor);
  if (!cursor) return null;

  const messages = parseOptionalArray(value.messages, parseHydratedMessage);
  const turns = parseOptionalArray(value.turns, parseHydratedTurn);
  const replayedEnvelopes = parseOptionalArray(
    value.replayed_envelopes,
    (entry) => parseHydratedEnvelope(entry, sessionId),
  );
  const replayedToolEnvelopes = parseOptionalArray(
    value.replayed_tool_envelopes,
    (entry) => parseHydratedEnvelope(entry, sessionId),
  );
  if (
    messages === null ||
    turns === null ||
    replayedEnvelopes === null ||
    replayedToolEnvelopes === null ||
    !isOptionalArray(value.threads) ||
    !isOptionalArray(value.pending_approvals) ||
    !isOptionalArray(value.pending_questions)
  ) {
    return null;
  }

  return {
    session_id: sessionId,
    cursor,
    ...(value.context === undefined ? {} : { context: value.context }),
    ...(value.context_state === undefined
      ? {}
      : { context_state: value.context_state }),
    ...(messages === undefined ? {} : { messages }),
    ...(value.threads === undefined ? {} : { threads: value.threads }),
    ...(turns === undefined ? {} : { turns }),
    ...(value.pending_approvals === undefined
      ? {}
      : { pending_approvals: value.pending_approvals }),
    ...(value.pending_questions === undefined
      ? {}
      : { pending_questions: value.pending_questions }),
    ...(replayedEnvelopes === undefined
      ? {}
      : { replayed_envelopes: replayedEnvelopes }),
    ...(replayedToolEnvelopes === undefined
      ? {}
      : { replayed_tool_envelopes: replayedToolEnvelopes }),
  };
}

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

function parseHydratedMessage(value: unknown): HydratedMessage | null {
  if (
    !isRecord(value) ||
    typeof value.seq !== "number" ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0 ||
    typeof value.role !== "string" ||
    typeof value.content !== "string" ||
    typeof value.persisted_at !== "string"
  ) {
    return null;
  }
  const optionalStrings = [
    "turn_id",
    "thread_id",
    "client_message_id",
    "reasoning_content",
    "message_id",
    "source",
  ] as const;
  if (
    optionalStrings.some(
      (key) => value[key] !== undefined && typeof value[key] !== "string",
    ) ||
    (value.media !== undefined &&
      (!Array.isArray(value.media) ||
        value.media.some((entry) => typeof entry !== "string")))
  ) {
    return null;
  }
  return {
    seq: value.seq,
    role: value.role,
    content: value.content,
    persisted_at: value.persisted_at,
    media: (value.media as string[] | undefined) ?? [],
    ...copyOptionalStrings(value, optionalStrings),
  };
}

function parseHydratedTurn(value: unknown): HydratedTurn | null {
  if (
    !isRecord(value) ||
    typeof value.turn_id !== "string" ||
    typeof value.state !== "string"
  ) {
    return null;
  }
  const optionalStrings = ["started_at", "completed_at", "thread_id"] as const;
  if (
    optionalStrings.some(
      (key) => value[key] !== undefined && typeof value[key] !== "string",
    )
  ) {
    return null;
  }
  return {
    turn_id: value.turn_id,
    state: value.state,
    ...copyOptionalStrings(value, optionalStrings),
  };
}

function parseHydratedEnvelope(
  value: unknown,
  sessionId: string,
): ProjectionEnvelopeV2 | null {
  if (!isRecord(value)) return null;
  return parseProjectionEnvelope({ ...value, session_id: sessionId });
}

function parseOptionalArray<T>(
  value: unknown,
  parse: (entry: unknown) => T | null,
): T[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parse);
  return parsed.some((entry) => entry === null) ? null : (parsed as T[]);
}

function isOptionalArray(value: unknown): value is unknown[] | undefined {
  return value === undefined || Array.isArray(value);
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
