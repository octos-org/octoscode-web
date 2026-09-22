import {
  CORE_UI_METHODS,
  isRecord,
  parseProjectionEnvelope,
  type RpcNotification,
  type SessionHydrateResult,
} from "@octos-org/octoscode-client/protocol";
import {
  addSystemMessage,
  hasTerminal,
  nextNoticeId,
  upsert,
  type TimelineEntry,
  type TimelineKind,
  type TimelineStatus,
} from "./entry-model.ts";

// The entry shape and the shell-side reducers live in `entry-model.ts` so the
// app shell can write a system notice without loading the transcript fold.
export {
  addSystemMessage,
  terminalTurnId,
  timelineActivity,
} from "./entry-model.ts";
export type {
  TimelineEntry,
  TimelineKind,
  TimelineStatus,
} from "./entry-model.ts";

export interface HydratedAssistantIdentity {
  messageId: string;
  turnId: string;
  segmentId: string;
}

export interface HydratedTimelineIdentityOptions {
  previous?: readonly TimelineEntry[];
  assistantIdentities?: readonly HydratedAssistantIdentity[];
}

export function timelineFromHydrate(
  result: SessionHydrateResult,
  identities: HydratedTimelineIdentityOptions = {},
): TimelineEntry[] {
  let entries: TimelineEntry[] = [];
  // rc.9 transcript rows carry a thread_id but usually no turn_id. Only a
  // unique server-provided mapping can supply the missing turn identity.
  const turnByThread = new Map<string, string | null>();
  for (const turn of [
    ...(result.turns ?? []),
    ...(result.replayed_projection_envelopes ?? []),
  ]) {
    if (!turn.thread_id || !turn.turn_id) continue;
    const existing = turnByThread.get(turn.thread_id);
    turnByThread.set(
      turn.thread_id,
      existing === undefined || existing === turn.turn_id ? turn.turn_id : null,
    );
  }
  const positions = new Map<string, number>();
  const hydrateEntry = (entry: TimelineEntry) => {
    const index = positions.get(entry.id);
    if (index === undefined) {
      positions.set(entry.id, entries.length);
      entries.push(entry);
    } else entries[index] = entry;
  };
  const messageTurnId = (message: {
    turn_id?: string | undefined;
    thread_id?: string | undefined;
  }): string | undefined =>
    message.turn_id ??
    (message.thread_id
      ? (turnByThread.get(message.thread_id) ?? undefined)
      : undefined);
  const userInputsByTurn = new Map<string, number>();
  for (const message of result.messages ?? []) {
    const turnId = messageTurnId(message);
    if (message.role.toLowerCase() === "user" && turnId !== undefined)
      userInputsByTurn.set(turnId, (userInputsByTurn.get(turnId) ?? 0) + 1);
  }
  for (const message of [...(result.messages ?? [])].sort(
    (left, right) => left.seq - right.seq,
  )) {
    const turnId = messageTurnId(message);
    const stableId =
      message.message_id ??
      message.client_message_id ??
      `${message.thread_id ?? "session"}:${message.seq}`;
    if (message.reasoning_content) {
      hydrateEntry({
        id: `reasoning:${stableId}`,
        kind: "reasoning",
        title: "Reasoning",
        body: message.reasoning_content,
        status: "complete",
        ...(turnId ? { turnId } : {}),
      });
    }
    const role = message.role.toLowerCase();
    // A turn can contain several persisted user inputs (turn/steer). Turn
    // identity associates their activity; it is not a unique message key.
    // Only a turn's SOLE persisted prompt is unambiguous: it takes the
    // canonical `user:<turn>` key so its optimistic row and replayed
    // user_message echo reconcile onto it exactly once. Several inputs for
    // one turn keep their own message identity and are never collapsed.
    const soleUserOfTurn =
      role === "user" &&
      turnId !== undefined &&
      userInputsByTurn.get(turnId) === 1;
    hydrateEntry({
      id: soleUserOfTurn ? `user:${turnId}` : `hydrated:${stableId}`,
      kind:
        role === "user"
          ? "user"
          : role === "assistant"
            ? "assistant"
            : role === "tool"
              ? "tool"
              : "system",
      title:
        role === "user"
          ? "You"
          : role === "assistant"
            ? message.source === "background"
              ? "Background agent"
              : "Octos"
            : role === "tool"
              ? "Tool output"
              : message.role,
      body: appendMedia(message.content, message.media),
      status: "complete",
      ...(turnId ? { turnId } : {}),
      ...(message.message_id ? { messageId: message.message_id } : {}),
    });
  }

  // Hydrate prose is authoritative. Retain only a one-to-one, explicitly
  // witnessed message/turn/segment relationship; never correlate by text.
  const claims = [
    ...(identities.previous ?? []).flatMap((entry) =>
      entry.kind === "assistant" &&
      entry.messageId &&
      entry.turnId &&
      entry.streamId?.startsWith(`assistant:${entry.turnId}:`)
        ? [
            {
              messageId: entry.messageId,
              turnId: entry.turnId,
              streamId: entry.streamId,
            },
          ]
        : [],
    ),
    ...(identities.assistantIdentities ?? []).map((identity) => ({
      ...identity,
      streamId: `assistant:${identity.turnId}:${identity.segmentId}`,
    })),
  ];
  const messageCounts = new Map<string, number>();
  for (const message of result.messages ?? []) {
    if (message.message_id)
      messageCounts.set(
        message.message_id,
        (messageCounts.get(message.message_id) ?? 0) + 1,
      );
  }
  const byMessage = new Map<string, Set<string>>();
  const byStream = new Map<string, Set<string>>();
  for (const claim of claims) {
    const messages = byMessage.get(claim.messageId) ?? new Set<string>();
    messages.add(JSON.stringify([claim.turnId, claim.streamId]));
    byMessage.set(claim.messageId, messages);
    const streams = byStream.get(claim.streamId) ?? new Set<string>();
    streams.add(claim.messageId);
    byStream.set(claim.streamId, streams);
  }
  for (const claim of claims) {
    if (
      messageCounts.get(claim.messageId) !== 1 ||
      byMessage.get(claim.messageId)?.size !== 1 ||
      byStream.get(claim.streamId)?.size !== 1
    )
      continue;
    entries = entries.map((entry) =>
      entry.kind === "assistant" &&
      entry.messageId === claim.messageId &&
      entry.turnId === claim.turnId
        ? { ...entry, streamId: claim.streamId }
        : entry,
    );
  }

  const replayed = [
    ...new Map(
      [
        ...(result.replayed_projection_envelopes ?? []).filter((event) =>
          [
            "tool_start",
            "tool_progress",
            "tool_end",
            "background/spawn_complete",
          ].includes(event.payload.type),
        ),
        ...(result.replayed_tool_envelopes ?? []),
        ...(result.replayed_envelopes ?? []),
      ].map((event) => [JSON.stringify([event.thread_id, event.seq]), event]),
    ).values(),
  ].sort(
    (left, right) =>
      (left.cursor?.seq ?? left.seq) - (right.cursor?.seq ?? right.seq),
  );
  for (const envelope of replayed) {
    entries = foldNotification(entries, {
      jsonrpc: "2.0",
      method: CORE_UI_METHODS.PROJECTION_ENVELOPE,
      params: envelope,
    });
  }
  entries = coalesceHydratedTools(entries, replayed);
  const terminalTurns = new Map(
    (result.turns ?? [])
      .filter((turn) =>
        ["completed", "errored", "interrupted"].includes(turn.state),
      )
      .map((turn) => [turn.turn_id, turn.state]),
  );
  const runningTurns = new Set(
    entries
      .filter((entry) => entry.status === "running")
      .map((entry) => entry.turnId),
  );
  for (const turnId of runningTurns) {
    const outcome = turnId ? terminalTurns.get(turnId) : undefined;
    if (turnId && outcome) {
      entries = sweepTurnStreamtails(entries, turnId, outcome);
    }
  }
  // A cold rc.9 reload can contain a terminal turn with no persisted message.
  // Render that server truth instead of returning an empty, apparently unused
  // conversation. This does not claim that attached execution survived reload.
  const turnOrder = new Map(
    (result.turns ?? []).map((turn, index) => [turn.turn_id, index]),
  );
  for (const [turnId, outcome] of terminalTurns) {
    if (
      outcome !== "completed" &&
      !entries.some((entry) => entry.id === `terminal:${turnId}`)
    ) {
      const lastTurnIndex = entries.findLastIndex(
        (entry) => entry.turnId === turnId,
      );
      entries = settleTimelineTurn(
        entries,
        turnId,
        outcome,
        outcome === "interrupted"
          ? "This turn was stopped before it completed."
          : "This turn failed before it completed.",
      );
      const nextTurnIndex = entries.findIndex(
        (entry, index) =>
          index > lastTurnIndex &&
          entry.turnId &&
          (turnOrder.get(entry.turnId) ?? -1) > turnOrder.get(turnId)!,
      );
      if (nextTurnIndex >= 0) {
        entries.splice(nextTurnIndex, 0, entries.pop()!);
      }
    }
  }
  entries = entries.map((entry) => {
    const outcome = entry.turnId ? terminalTurns.get(entry.turnId) : undefined;
    return outcome
      ? {
          ...entry,
          turnSettled: true,
          textTerminal: outcome as NonNullable<TimelineEntry["textTerminal"]>,
        }
      : entry;
  });
  return withHydratedTurnOutcome(entries, result);
}

export function withHydratedTurnOutcome(
  entries: TimelineEntry[],
  hydrated: SessionHydrateResult,
): TimelineEntry[] {
  // Core returns turns in lifecycle order; message sequence alone is not enough.
  const latest = hydrated.turns?.at(-1);
  if (!latest) return entries;
  const terminal = ["completed", "errored", "interrupted"].includes(
    latest.state,
  );
  return entries.map(({ latestTurnOutcome: _previous, ...entry }) => ({
    ...entry,
    ...(terminal && entry.turnId === latest.turn_id
      ? { latestTurnOutcome: latest.state }
      : {}),
  }));
}

/** Activity is about what is happening now, not whether a turn ever used a tool. */
export function addOptimisticUser(
  entries: readonly TimelineEntry[],
  turnId: string,
  text: string,
): TimelineEntry[] {
  return upsertUser(entries, {
    id: `user:${turnId}`,
    kind: "user",
    title: "You",
    body: text,
    status: "complete",
    turnId,
  });
}

export function foldNotification(
  entries: readonly TimelineEntry[],
  notification: RpcNotification,
): TimelineEntry[] {
  if (notification.method === CORE_UI_METHODS.PROJECTION_ENVELOPE) {
    const envelope = parseProjectionEnvelope(notification.params);
    if (!envelope) {
      return addSystemMessage(
        entries,
        nextNoticeId(entries, "invalid-projection"),
        "Protocol frame rejected",
        "projection/envelope did not match the negotiated v2 shape.",
        "error",
      );
    }
    if (
      envelope.payload.type === "user_message" &&
      isRecord(envelope.payload.data)
    ) {
      return upsertCanonicalUser(
        entries,
        envelope.turn_id,
        `user-event:${JSON.stringify([envelope.thread_id, envelope.seq])}`,
        textOf(envelope.payload.data),
      );
    }
    return foldProjection(
      entries,
      envelope.turn_id,
      envelope.payload.type,
      envelope.payload.data,
    );
  }

  const params = notification.params;
  if (!isRecord(params)) return entries.slice();
  const turnId =
    typeof params.turn_id === "string" ? params.turn_id : "unscoped";

  if (
    hasTerminal(entries, turnId) &&
    [
      CORE_UI_METHODS.MESSAGE_DELTA,
      CORE_UI_METHODS.MESSAGE_REASONING_DELTA,
    ].some((method) => method === notification.method)
  ) {
    return entries.slice();
  }

  switch (notification.method) {
    case CORE_UI_METHODS.MESSAGE_DELTA:
      return appendText(
        settleReasoning(entries, turnId),
        `assistant:${turnId}`,
        "assistant",
        "Octos",
        params.text,
        turnId,
      );
    case CORE_UI_METHODS.MESSAGE_REASONING_DELTA:
      return appendText(
        entries,
        `reasoning:${turnId}`,
        "reasoning",
        "Reasoning",
        params.text,
        turnId,
      );
    case CORE_UI_METHODS.TOOL_STARTED:
      return startTool(settleReasoning(entries, turnId), {
        id: `tool:${stringOf(params.tool_call_id, turnId)}`,
        kind: "tool",
        title: stringOf(params.tool_name, "Tool"),
        body: pretty(params.arguments),
        status: "running",
        turnId,
        startedAtMs: Date.now(),
      });
    case CORE_UI_METHODS.TOOL_PROGRESS:
      return progressTool(
        entries,
        `tool:${stringOf(params.tool_call_id, turnId)}`,
        {
          body: typeof params.message === "string" ? params.message : undefined,
        },
      );
    case CORE_UI_METHODS.TOOL_COMPLETED:
      return completeTool(entries, turnId, params.tool_call_id, {
        ...(typeof params.output_preview === "string"
          ? { body: params.output_preview }
          : {}),
        status: params.success === false ? "error" : "complete",
        statusLabel: params.success === false ? "Failed" : "Done",
      });
    case CORE_UI_METHODS.TURN_COMPLETED:
      return settleTimelineTurn(
        entries,
        turnId,
        "completed",
        usageText(params),
      );
    case CORE_UI_METHODS.TURN_ERROR:
      return settleTimelineTurn(
        entries,
        turnId,
        "errored",
        stringOf(params.message, "Unknown server error"),
      );
    case CORE_UI_METHODS.WARNING:
      return addSystemMessage(
        entries,
        nextNoticeId(entries, CORE_UI_METHODS.WARNING),
        stringOf(params.code, "Warning"),
        stringOf(params.message, "The server reported a warning."),
        "error",
      );
    case "file_attached":
      return addSystemMessage(
        entries,
        `file-attached:${turnId}:${stringOf(params.file_name, "unknown")}`,
        "File attached",
        stringOf(params.file_name, ""),
        "info",
      );
    default:
      return entries.slice();
  }
}

/** The turn a notification carries activity for, regardless of method. */
export function notificationTurnId(
  notification: RpcNotification,
): string | null {
  if (notification.method === CORE_UI_METHODS.PROJECTION_ENVELOPE) {
    return parseProjectionEnvelope(notification.params)?.turn_id ?? null;
  }
  return isRecord(notification.params) &&
    typeof notification.params.turn_id === "string"
    ? notification.params.turn_id
    : null;
}

export function terminalTurnOutcome(
  notification: RpcNotification,
): "completed" | "failed" | null {
  if (notification.method === CORE_UI_METHODS.TURN_COMPLETED) {
    return "completed";
  }
  if (notification.method === CORE_UI_METHODS.TURN_ERROR) return "failed";
  if (notification.method !== CORE_UI_METHODS.PROJECTION_ENVELOPE) return null;
  const envelope = parseProjectionEnvelope(notification.params);
  if (
    envelope?.payload.type !== "turn_terminal" ||
    !isRecord(envelope.payload.data)
  ) {
    return null;
  }
  return envelope.payload.data.outcome === "completed" ? "completed" : "failed";
}

function foldProjection(
  entries: readonly TimelineEntry[],
  turnId: string,
  type: string,
  data: unknown,
): TimelineEntry[] {
  if (!isRecord(data)) return entries.slice();
  // Persistence/terminal can overtake foreground text. Core deliberately
  // continues forwarding spawned tool activity after the foreground terminal.
  if (
    hasTerminal(entries, turnId) &&
    ["assistant_delta", "reasoning_delta"].includes(type)
  ) {
    return entries.slice();
  }
  switch (type) {
    case "assistant_delta":
      return appendText(
        settleReasoning(entries, turnId),
        `assistant:${turnId}:${stringOf(data.assistant_segment_id, "default")}`,
        "assistant",
        "Octos",
        data.text,
        turnId,
      );
    case "assistant_persisted": {
      const meta = isRecord(data.meta) ? data.meta : undefined;
      const messageId =
        meta && typeof meta.message_id === "string"
          ? meta.message_id
          : undefined;
      const hydrated = messageId
        ? entries.find((entry) => entry.messageId === messageId)
        : undefined;
      const streamId = `assistant:${turnId}:${stringOf(data.assistant_segment_id, "default")}`;
      return upsert(settleReasoning(entries, turnId), {
        id: hydrated?.id ?? streamId,
        kind: "assistant",
        title: "Octos",
        body: appendMedia(textOf(data), mediaOf(meta?.media)),
        status: "complete",
        turnId,
        streamId,
        ...(hasTerminal(entries, turnId) ? { turnSettled: true } : {}),
        ...(messageId ? { messageId } : {}),
      });
    }
    case "reasoning_delta":
      return appendText(
        entries,
        `reasoning:${turnId}:${reasoningSegment(entries, turnId)}`,
        "reasoning",
        "Reasoning",
        data.text,
        turnId,
      );
    case "tool_start": {
      // A tool call ends the current reasoning segment: settle any running
      // reasoning entry so it doesn't keep a stale "running" badge.
      const settled = settleReasoning(entries, turnId);
      return startTool(settled, {
        id: `tool:${stringOf(data.tool_call_id, turnId)}`,
        kind: "tool",
        title: stringOf(data.name, "Tool"),
        body: stringOf(data.arguments_preview),
        status: "running",
        turnId,
        startedAtMs: Date.now(),
      });
    }
    case "tool_progress":
      return progressTool(
        entries,
        `tool:${stringOf(data.tool_call_id, turnId)}`,
        {
          body: typeof data.message === "string" ? data.message : "",
        },
      );
    case "tool_end": {
      const raw = stringOf(data.output_preview ?? data.error ?? data.reason);
      return completeTool(entries, turnId, data.tool_call_id, {
        body: raw,
        status:
          data.status === "complete"
            ? "complete"
            : data.status === "skipped"
              ? "info"
              : "error",
        statusLabel:
          data.status === "skipped"
            ? "Skipped"
            : data.status === "aborted"
              ? "Stopped"
              : data.status === "complete"
                ? "Done"
                : "Failed",
      });
    }
    case "turn_terminal": {
      return settleTimelineTurn(
        entries,
        turnId,
        stringOf(data.outcome, "errored"),
        terminalErrorText(data.error),
      );
    }
    case "background/spawn_complete": {
      const messageId = stringOf(data.message_id);
      const hydrated = messageId
        ? entries.find(
            (entry) =>
              entry.kind === "assistant" && entry.messageId === messageId,
          )
        : undefined;
      return upsert(entries, {
        id: hydrated?.id ?? `background:${stringOf(data.task_id, turnId)}`,
        kind: "assistant",
        title: "Background agent",
        body: appendMedia(
          stringOf(data.content, "Background task completed."),
          mediaOf(data.media),
        ),
        status: "complete",
        turnId,
        ...(messageId ? { messageId } : {}),
        ...(hasTerminal(entries, turnId) ? { turnSettled: true } : {}),
      });
    }
    default:
      return entries.slice();
  }
}

function appendMedia(content: string, media: readonly string[]): string {
  if (!media.length) return content;
  const attachments = media.map((path) => `Attachment: ${path}`).join("\n");
  return content ? `${content}\n\n${attachments}` : attachments;
}

/**
 * Reasoning segments are bounded by tool calls: each tool_start increments
 * the segment counter for the turn, so post-tool reasoning starts a new
 * collapsible block instead of appending to an ever-growing single entry.
 */
function reasoningSegment(
  entries: readonly TimelineEntry[],
  turnId: string,
): number {
  let tools = 0;
  for (const entry of entries) {
    if (entry.turnId === turnId && entry.id.startsWith("tool:")) {
      tools += 1;
    }
  }
  return tools;
}

function appendText(
  entries: readonly TimelineEntry[],
  id: string,
  kind: TimelineKind,
  title: string,
  value: unknown,
  turnId: string,
): TimelineEntry[] {
  if (typeof value !== "string") return entries.slice();
  const existing = entries.find(
    (entry) => entry.id === id || entry.streamId === id,
  );
  // rc11 can emit its canonical full persisted segment before queued streaming
  // deltas with larger cursors. Receipt finality wins over delivery order.
  if (
    !value ||
    (kind === "assistant" &&
      (existing?.status === "complete" || existing?.status === "error"))
  ) {
    return entries.slice();
  }
  return upsert(entries, {
    id,
    kind,
    title,
    body: `${existing?.body ?? ""}${value}`,
    status: "running",
    turnId,
    startedAtMs: existing?.startedAtMs ?? Date.now(),
    endedAtMs: Date.now(),
  });
}

/**
 * When a turn completes, its streaming segment entries are superseded by
 * the persisted transcript: drop tails whose text the persisted body
 * already contains (they would render twice — issue #32) and settle any
 * that remain, so no assistant/reasoning entry keeps a stale "running"
 * badge after the terminal event.
 */
function sweepTurnStreamtails(
  entries: readonly TimelineEntry[],
  turnId: string,
  outcome: string,
): TimelineEntry[] {
  const persistedBodies = entries
    .filter(
      (entry) =>
        entry.turnId === turnId &&
        entry.kind === "assistant" &&
        entry.status === "complete",
    )
    .map((entry) => entry.body.trim());
  let changed = false;
  const next: TimelineEntry[] = [];
  for (const entry of entries) {
    if (
      entry.turnId === turnId &&
      entry.status === "running" &&
      (entry.kind === "assistant" ||
        entry.kind === "reasoning" ||
        entry.kind === "tool")
    ) {
      changed = true;
      const body = entry.body.trim();
      if (
        entry.kind === "assistant" &&
        (body === "" || persistedBodies.some((full) => full.includes(body)))
      ) {
        // Duplicate tail: the persisted message already covers it.
        continue;
      }
      next.push({
        ...entry,
        ...(entry.startedAtMs !== undefined
          ? { endedAtMs: entry.endedAtMs ?? Date.now() }
          : {}),
        status:
          entry.kind === "tool"
            ? outcome === "completed" || outcome === "interrupted"
              ? "info"
              : "error"
            : "complete",
        ...(entry.kind === "tool"
          ? { statusLabel: outcome === "completed" ? "Finished" : "Stopped" }
          : {}),
      });
      continue;
    }
    next.push(entry);
  }
  return changed ? next : entries.slice();
}

function settleReasoning(
  entries: readonly TimelineEntry[],
  turnId: string,
): TimelineEntry[] {
  return entries.map((entry) =>
    entry.turnId === turnId &&
    entry.kind === "reasoning" &&
    entry.status === "running"
      ? {
          ...entry,
          status: "complete",
          ...(entry.startedAtMs !== undefined
            ? { endedAtMs: entry.endedAtMs ?? Date.now() }
            : {}),
        }
      : entry,
  );
}

export function settleTimelineTurn(
  entries: readonly TimelineEntry[],
  turnId: string,
  outcome: string,
  body = "",
): TimelineEntry[] {
  return upsert(sweepTurnStreamtails(entries, turnId, outcome), {
    id: `terminal:${turnId}`,
    kind: "system",
    title:
      outcome === "completed"
        ? "Turn complete"
        : outcome === "interrupted"
          ? "Turn stopped"
          : "Turn failed",
    body,
    status:
      outcome === "completed"
        ? "complete"
        : outcome === "interrupted"
          ? "info"
          : "error",
    turnId,
    latestTurnOutcome: outcome,
  });
}

function mediaOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function startTool(
  entries: readonly TimelineEntry[],
  entry: TimelineEntry,
): TimelineEntry[] {
  if (entries.find((current) => current.id === entry.id)?.toolSettled) {
    return entries.slice();
  }
  return upsert(
    entries,
    entry.turnId && hasTerminal(entries, entry.turnId)
      ? {
          ...entry,
          status: "info",
          statusLabel: "Background",
          turnSettled: true,
        }
      : entry,
  );
}

function progressTool(
  entries: readonly TimelineEntry[],
  id: string,
  patch: { body?: string | undefined },
): TimelineEntry[] {
  const existing = entries.find((entry) => entry.id === id);
  if (existing?.toolSettled) {
    return entries.slice();
  }
  return patchEntry(entries, id, {
    ...patch,
    ...(existing?.turnId && hasTerminal(entries, existing.turnId)
      ? { status: "info", statusLabel: "Background" }
      : {}),
  });
}

function completeTool(
  entries: readonly TimelineEntry[],
  turnId: string,
  toolCallId: unknown,
  result: { body?: string; status: TimelineStatus; statusLabel: string },
): TimelineEntry[] {
  // A result can arrive after its start was lost or evicted. Keep the output
  // using its server-provided call identity; never invent an unscoped tool.
  if (typeof toolCallId !== "string" || !toolCallId.trim())
    return entries.slice();
  const id = `tool:${toolCallId}`;
  const existing = entries.find((entry) => entry.id === id);
  return upsert(entries, {
    ...(existing ?? {
      id,
      kind: "tool",
      title: "Tool output",
      body: "",
      turnId,
    }),
    ...result,
    ...(existing?.startedAtMs !== undefined ? { endedAtMs: Date.now() } : {}),
    toolSettled: true,
    ...(hasTerminal(entries, turnId) ? { turnSettled: true } : {}),
  });
}

function coalesceHydratedTools(
  entries: TimelineEntry[],
  replayed: NonNullable<SessionHydrateResult["replayed_envelopes"]>,
): TimelineEntry[] {
  const cards = new Map<
    string,
    { card: TimelineEntry; candidates: TimelineEntry[] }
  >();
  const starts = new Map<string, { thread: string; seq: number } | null>();
  for (const envelope of replayed) {
    const { type, data } = envelope.payload;
    if (
      type === "tool_start" &&
      isRecord(data) &&
      typeof data.tool_call_id === "string"
    ) {
      const id = `tool:${data.tool_call_id}`;
      const previous = starts.get(id);
      starts.set(
        id,
        previous === undefined ||
          (previous?.thread === envelope.thread_id &&
            previous.seq === envelope.seq)
          ? { thread: envelope.thread_id, seq: envelope.seq }
          : null,
      );
    }
    if (
      type !== "tool_end" ||
      !isRecord(data) ||
      typeof data.output_preview !== "string"
    )
      continue;
    const preview = data.output_preview.trim();
    if (!preview) continue;
    const truncatedPrefix = toolPreviewPrefix(data.output_preview);
    const toolId = `tool:${stringOf(data.tool_call_id, envelope.turn_id)}`;
    const card = entries.find((entry) => entry.id === toolId);
    if (!card) continue;
    const candidates = entries.filter(
      (entry) =>
        entry.kind === "tool" &&
        entry.id.startsWith("hydrated:") &&
        entry.turnId === envelope.turn_id &&
        (entry.body.trim() === preview ||
          (preview.length >= 80 && entry.body.trim().startsWith(preview)) ||
          (truncatedPrefix !== null &&
            entry.body.trim().startsWith(truncatedPrefix))),
    );
    cards.set(toolId, { card, candidates });
  }
  // Hydrated rows have no tool_call_id. Require a one-to-one match in both
  // directions before replacing a raw row; a greedy merge can erase ambiguity
  // when two calls have the same output. Keep each matched row's full text.
  const owners = new Map<string, number>();
  for (const { candidates } of cards.values()) {
    for (const candidate of candidates) {
      owners.set(candidate.id, (owners.get(candidate.id) ?? 0) + 1);
    }
  }
  const replacements = new Map<string, TimelineEntry>();
  const merged = new Set<string>();
  for (const { card, candidates } of cards.values()) {
    const match = candidates[0];
    if (candidates.length !== 1 || !match || owners.get(match.id) !== 1)
      continue;
    replacements.set(match.id, { ...match, ...card, body: match.body });
    merged.add(card.id);
  }
  const next = entries
    .filter((entry) => !merged.has(entry.id))
    .map((entry) => replacements.get(entry.id) ?? entry);
  // Parallel tools can persist in completion order. Restore authoritative
  // start order only inside consecutive, fully identified tool groups.
  // Missing/conflicting starts, raw rows and other content remain boundaries.
  for (let index = 0; index < next.length;) {
    const first = next[index]!;
    const start = merged.has(first.id) ? starts.get(first.id) : null;
    let end = index + 1;
    if (start) {
      while (
        end < next.length &&
        next[end]!.turnId === first.turnId &&
        merged.has(next[end]!.id) &&
        starts.get(next[end]!.id)?.thread === start.thread
      ) {
        end += 1;
      }
      next.splice(
        index,
        end - index,
        ...next
          .slice(index, end)
          .sort(
            (left, right) =>
              starts.get(left.id)!.seq - starts.get(right.id)!.seq,
          ),
      );
    }
    index = end;
  }
  return next;
}

function toolPreviewPrefix(preview: string): string | null {
  const limit = preview.endsWith("...")
    ? 200
    : preview.endsWith("…")
      ? 2048
      : 0;
  if (!limit) return null;
  const prefix = preview.slice(0, limit === 200 ? -3 : -1);
  // rc.9 agent completion previews use 200 UTF-8 bytes + "..."; the protocol
  // boundary separately caps other producers at 2048 bytes + "…".
  // Recognize those boundaries, not arbitrary prose ending in an ellipsis.
  const encoder = new TextEncoder();
  const bytes = encoder.encode(prefix).length;
  const normalized = prefix.trim();
  return bytes >= limit - 3 &&
    bytes <= limit &&
    encoder.encode(normalized).length >= 80
    ? normalized
    : null;
}

function upsertCanonicalUser(
  entries: readonly TimelineEntry[],
  turnId: string,
  eventId: string,
  text: string,
): TimelineEntry[] {
  const replayed = entries.find((entry) => entry.streamId === eventId);
  const users = entries.filter(
    (entry) => entry.kind === "user" && entry.turnId === turnId,
  );
  const optimistic = users.find(
    (entry) =>
      entry.id === `user:${turnId}` && !entry.streamId && entry.body === text,
  );
  const user: TimelineEntry = {
    id:
      replayed?.id ??
      optimistic?.id ??
      (users.length ? eventId : `user:${turnId}`),
    kind: "user",
    title: "You",
    body: text,
    status: "complete",
    turnId,
    streamId: eventId,
  };
  // A drained steer can precede persistence of the original prompt. Match an
  // optimistic prompt by its text; never replace it with an unrelated input.
  // Only the first observed question may need moving before its replies.
  return users.length ? upsert(entries, user) : upsertUser(entries, user);
}

function upsertUser(
  entries: readonly TimelineEntry[],
  user: TimelineEntry,
): TimelineEntry[] {
  const existing = entries.findIndex((entry) => entry.id === user.id);
  const firstReply = entries.findIndex(
    (entry) =>
      entry.turnId === user.turnId &&
      ["reasoning", "tool", "assistant"].includes(entry.kind),
  );
  if (firstReply < 0 || (existing >= 0 && existing < firstReply)) {
    return upsert(entries, user);
  }
  // Canonical user_message can arrive after streaming replies. Place only its
  // display row before that turn's activity; retain every other row's order.
  const next = entries.filter((entry) => entry.id !== user.id);
  next.splice(firstReply, 0, user);
  return next;
}

function patchEntry(
  entries: readonly TimelineEntry[],
  id: string,
  patch: {
    body?: string | undefined;
    status?: TimelineStatus;
    statusLabel?: string;
    endedAtMs?: number;
  },
): TimelineEntry[] {
  return entries.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          ...(patch.body === undefined ? {} : { body: patch.body }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.statusLabel === undefined
            ? {}
            : { statusLabel: patch.statusLabel }),
          ...(patch.endedAtMs === undefined
            ? {}
            : { endedAtMs: patch.endedAtMs }),
        }
      : entry,
  );
}

function textOf(value: Record<string, unknown>): string {
  return typeof value.text === "string" ? value.text : "";
}

function stringOf(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function terminalErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (!isRecord(error)) return "";
  const message = stringOf(error.message).trim();
  if (message) return message;
  const code = stringOf(error.code).trim();
  return code
    ? `Server error (${code}).`
    : "The server could not complete this turn.";
}

function pretty(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function usageText(value: Record<string, unknown>): string {
  const input = typeof value.tokens_in === "number" ? value.tokens_in : null;
  const output = typeof value.tokens_out === "number" ? value.tokens_out : null;
  return input === null && output === null
    ? "The server settled this turn."
    : `${input ?? 0} in · ${output ?? 0} out`;
}
