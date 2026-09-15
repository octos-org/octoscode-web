import { isRecord } from "./rpc.ts";
import { parseProjectionEnvelope } from "./projection.ts";
import type {
  HydratedMessage,
  HydratedTurn,
  ProjectionEnvelopeV2,
  SessionHydrateResult,
} from "./types.ts";
import { isNonNegativeInteger, parseUiCursor } from "./wire-decoders.ts";

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
  const replayedProjectionEnvelopes = parseOptionalArray(
    value.replayed_projection_envelopes,
    (entry) => parseHydratedEnvelope(entry, sessionId),
  );
  const threadSequences = parseThreadSequences(
    value.projection_thread_sequences,
  );
  if (
    messages === null ||
    turns === null ||
    replayedEnvelopes === null ||
    replayedToolEnvelopes === null ||
    replayedProjectionEnvelopes === null ||
    threadSequences === null ||
    // Core supplies these as one atomic snapshot. A partial extension cannot
    // prove which text was retained or where live continuation begins.
    (replayedProjectionEnvelopes === undefined) !==
      (threadSequences === undefined) ||
    (replayedProjectionEnvelopes !== undefined &&
      !validReplayCheckpoint(
        replayedProjectionEnvelopes,
        threadSequences!,
        cursor,
      )) ||
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
    ...(replayedProjectionEnvelopes === undefined
      ? {}
      : { replayed_projection_envelopes: replayedProjectionEnvelopes }),
    ...(threadSequences === undefined
      ? {}
      : { projection_thread_sequences: threadSequences }),
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
  if (
    !isRecord(value) ||
    (value.session_id !== undefined && value.session_id !== sessionId)
  )
    return null;
  return parseProjectionEnvelope({ ...value, session_id: sessionId });
}

function parseThreadSequences(
  value: unknown,
): Record<string, number> | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (
    entries.some(
      ([thread, seq]) => !thread.trim() || !isNonNegativeInteger(seq),
    )
  )
    return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

function validReplayCheckpoint(
  replay: ProjectionEnvelopeV2[],
  checkpoints: Record<string, number>,
  cursor: NonNullable<SessionHydrateResult["cursor"]>,
): boolean {
  const seen = new Set<string>();
  return replay.every((event) => {
    const key = JSON.stringify([event.thread_id, event.seq]);
    if (seen.has(key)) return false;
    seen.add(key);
    const checkpoint = Object.hasOwn(checkpoints, event.thread_id)
      ? checkpoints[event.thread_id]
      : undefined;
    return (
      checkpoint !== undefined &&
      event.seq <= checkpoint &&
      (!event.cursor ||
        (event.cursor.stream === cursor.stream &&
          event.cursor.seq <= cursor.seq))
    );
  });
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

export { parseReplayLossyEvent } from "./replay-events.ts";
