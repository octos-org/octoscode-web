import {
  CORE_UI_METHODS,
  isRecord,
  parseProjectionEnvelope,
  type RpcNotification,
  type SessionHydrateResult,
} from "@octos-org/octoscode-client";

export type TimelineKind =
  "user" | "assistant" | "reasoning" | "tool" | "system";
export type TimelineStatus = "running" | "complete" | "error" | "info";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  title: string;
  body: string;
  status: TimelineStatus;
  statusLabel?: string;
  turnId?: string;
  messageId?: string;
  streamId?: string;
  turnSettled?: true;
  toolSettled?: true;
}

export function timelineFromHydrate(
  result: SessionHydrateResult,
): TimelineEntry[] {
  let entries: TimelineEntry[] = [];
  const positions = new Map<string, number>();
  const hydrateEntry = (entry: TimelineEntry) => {
    const index = positions.get(entry.id);
    if (index === undefined) {
      positions.set(entry.id, entries.length);
      entries.push(entry);
    } else entries[index] = entry;
  };
  for (const message of [...(result.messages ?? [])].sort(
    (left, right) => left.seq - right.seq,
  )) {
    const turnId = message.turn_id;
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
    hydrateEntry({
      id: role === "user" && turnId ? `user:${turnId}` : `hydrated:${stableId}`,
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

  const replayed = [
    ...(result.replayed_tool_envelopes ?? []),
    ...(result.replayed_envelopes ?? []),
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
  return entries.map((entry) =>
    entry.turnId && terminalTurns.has(entry.turnId)
      ? { ...entry, turnSettled: true }
      : entry,
  );
}

/** Activity is about what is happening now, not whether a turn ever used a tool. */
export function timelineActivity(
  entries: readonly TimelineEntry[],
  activeTurnId: string | null,
): string | null {
  if (!activeTurnId || hasTerminal(entries, activeTurnId)) return null;
  const turn = entries.filter((entry) => entry.turnId === activeTurnId);
  const tool = turn.findLast(
    (entry) => entry.kind === "tool" && entry.status === "running",
  );
  if (tool) return `Running ${tool.title}…`;
  const current = turn.findLast(
    (entry) => entry.kind === "assistant" || entry.kind === "reasoning",
  );
  if (current?.status === "running") {
    return current.kind === "reasoning" ? "Thinking…" : "Writing response…";
  }
  return turn.some((entry) => entry.kind === "tool")
    ? "Preparing next step…"
    : "Working…";
}

export function addOptimisticUser(
  entries: readonly TimelineEntry[],
  turnId: string,
  text: string,
): TimelineEntry[] {
  return upsert(entries, {
    id: `user:${turnId}`,
    kind: "user",
    title: "You",
    body: text,
    status: "complete",
    turnId,
  });
}

export function addSystemMessage(
  entries: readonly TimelineEntry[],
  id: string,
  title: string,
  body: string,
  status: TimelineStatus = "info",
): TimelineEntry[] {
  return upsert(entries, { id, kind: "system", title, body, status });
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
        `invalid-projection:${Date.now()}`,
        "Protocol frame rejected",
        "projection/envelope did not match the negotiated v2 shape.",
        "error",
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
        id: `tool:${String(params.tool_call_id ?? turnId)}`,
        kind: "tool",
        title: String(params.tool_name ?? "Tool"),
        body: pretty(params.arguments),
        status: "running",
        turnId,
      });
    case CORE_UI_METHODS.TOOL_PROGRESS:
      return progressTool(
        entries,
        `tool:${String(params.tool_call_id ?? turnId)}`,
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
        String(params.message ?? "Unknown server error"),
      );
    case CORE_UI_METHODS.WARNING:
      return addSystemMessage(
        entries,
        `warning:${Date.now()}`,
        String(params.code ?? "Warning"),
        String(params.message ?? "The server reported a warning."),
        "error",
      );
    default:
      return entries.slice();
  }
}

export function terminalTurnId(notification: RpcNotification): string | null {
  if (
    notification.method === CORE_UI_METHODS.TURN_COMPLETED ||
    notification.method === CORE_UI_METHODS.TURN_ERROR
  ) {
    return isRecord(notification.params) &&
      typeof notification.params.turn_id === "string"
      ? notification.params.turn_id
      : null;
  }
  if (notification.method !== CORE_UI_METHODS.PROJECTION_ENVELOPE) return null;
  const envelope = parseProjectionEnvelope(notification.params);
  return envelope?.payload.type === "turn_terminal" ? envelope.turn_id : null;
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
    case "user_message":
      return upsert(entries, {
        id: `user:${turnId}`,
        kind: "user",
        title: "You",
        body: textOf(data),
        status: "complete",
        turnId,
      });
    case "assistant_delta":
      return appendText(
        settleReasoning(entries, turnId),
        `assistant:${turnId}:${String(data.assistant_segment_id ?? "default")}`,
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
      const streamId = `assistant:${turnId}:${String(data.assistant_segment_id ?? "default")}`;
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
        id: `tool:${String(data.tool_call_id ?? turnId)}`,
        kind: "tool",
        title: String(data.name ?? "Tool"),
        body: String(data.arguments_preview ?? ""),
        status: "running",
        turnId,
      });
    }
    case "tool_progress":
      return progressTool(
        entries,
        `tool:${String(data.tool_call_id ?? turnId)}`,
        {
          body: typeof data.message === "string" ? data.message : "",
        },
      );
    case "tool_end": {
      const raw = String(
        data.output_preview ?? data.error ?? data.reason ?? "",
      );
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
        String(data.outcome ?? "errored"),
        data.error ? pretty(data.error) : "",
      );
    }
    case "background/spawn_complete":
      return upsert(entries, {
        id: `background:${String(data.task_id ?? turnId)}`,
        kind: "assistant",
        title: "Background agent",
        body: String(data.content ?? "Background task completed."),
        status: "complete",
        turnId,
      });
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
  if (!value || (kind === "assistant" && existing?.status === "complete")) {
    return entries.slice();
  }
  return upsert(entries, {
    id,
    kind,
    title,
    body: `${existing?.body ?? ""}${value}`,
    status: "running",
    turnId,
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

function hasTerminal(
  entries: readonly TimelineEntry[],
  turnId: string,
): boolean {
  return entries.some(
    (entry) =>
      entry.id === `terminal:${turnId}` ||
      (entry.turnId === turnId && entry.turnSettled),
  );
}

function settleReasoning(
  entries: readonly TimelineEntry[],
  turnId: string,
): TimelineEntry[] {
  return entries.map((entry) =>
    entry.turnId === turnId &&
    entry.kind === "reasoning" &&
    entry.status === "running"
      ? { ...entry, status: "complete" }
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
    toolSettled: true,
    ...(hasTerminal(entries, turnId) ? { turnSettled: true } : {}),
  });
}

function coalesceHydratedTools(
  entries: TimelineEntry[],
  replayed: NonNullable<SessionHydrateResult["replayed_envelopes"]>,
): TimelineEntry[] {
  let next = entries;
  for (const envelope of replayed) {
    const { type, data } = envelope.payload;
    if (
      type !== "tool_end" ||
      !isRecord(data) ||
      typeof data.output_preview !== "string"
    )
      continue;
    const preview = data.output_preview.trim();
    if (!preview) continue;
    const toolId = `tool:${String(data.tool_call_id ?? envelope.turn_id)}`;
    const card = next.find((entry) => entry.id === toolId);
    if (!card) continue;
    // Hydrated rows have no tool_call_id. Only merge an unambiguous same-turn
    // exact output (or substantial preview prefix), retaining its full text
    // and transcript position. Unmatched rows remain available as disclosures.
    const candidates = next.filter(
      (entry) =>
        entry.kind === "tool" &&
        entry.id.startsWith("hydrated:") &&
        entry.turnId === envelope.turn_id &&
        (entry.body.trim() === preview ||
          (preview.length >= 80 && entry.body.trim().startsWith(preview))),
    );
    if (candidates.length !== 1) continue;
    const match = candidates[0]!;
    next = next
      .filter((entry) => entry.id !== toolId)
      .map((entry) =>
        entry.id === match.id ? { ...entry, ...card, body: entry.body } : entry,
      );
  }
  return next;
}

function upsert(
  entries: readonly TimelineEntry[],
  next: TimelineEntry,
): TimelineEntry[] {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index < 0) return [...entries, next];
  return entries.map((entry, current) => (current === index ? next : entry));
}

function patchEntry(
  entries: readonly TimelineEntry[],
  id: string,
  patch: {
    body?: string | undefined;
    status?: TimelineStatus;
    statusLabel?: string;
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
        }
      : entry,
  );
}

function textOf(value: Record<string, unknown>): string {
  return typeof value.text === "string" ? value.text : "";
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
