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
  turnId?: string;
  messageId?: string;
  omittedCount?: number;
}

const TIMELINE_LIMIT = 200;
const TRUNCATION_ENTRY_ID = "timeline:truncated";

export function timelineFromHydrate(
  result: SessionHydrateResult,
): TimelineEntry[] {
  let entries: TimelineEntry[] = [];
  for (const message of [...(result.messages ?? [])].sort(
    (left, right) => left.seq - right.seq,
  )) {
    const turnId = message.turn_id;
    const stableId =
      message.message_id ??
      message.client_message_id ??
      `${message.thread_id ?? "session"}:${message.seq}`;
    if (message.reasoning_content) {
      entries = upsert(entries, {
        id: `reasoning:${stableId}`,
        kind: "reasoning",
        title: "Reasoning",
        body: message.reasoning_content,
        status: "complete",
        ...(turnId ? { turnId } : {}),
      });
    }
    const role = message.role.toLowerCase();
    entries = upsert(entries, {
      id: role === "user" && turnId ? `user:${turnId}` : `hydrated:${stableId}`,
      kind:
        role === "user"
          ? "user"
          : role === "assistant"
            ? "assistant"
            : "system",
      title:
        role === "user"
          ? "You"
          : role === "assistant"
            ? message.source === "background"
              ? "Background agent"
              : "Octos"
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
  return entries;
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

  switch (notification.method) {
    case CORE_UI_METHODS.MESSAGE_DELTA:
      return appendText(
        entries,
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
      return upsert(entries, {
        id: `tool:${String(params.tool_call_id ?? turnId)}`,
        kind: "tool",
        title: String(params.tool_name ?? "Tool"),
        body: pretty(params.arguments),
        status: "running",
        turnId,
      });
    case CORE_UI_METHODS.TOOL_PROGRESS:
      return patchEntry(
        entries,
        `tool:${String(params.tool_call_id ?? turnId)}`,
        {
          body: typeof params.message === "string" ? params.message : undefined,
        },
      );
    case CORE_UI_METHODS.TOOL_COMPLETED:
      return patchEntry(
        entries,
        `tool:${String(params.tool_call_id ?? turnId)}`,
        {
          ...(typeof params.output_preview === "string"
            ? { body: params.output_preview }
            : {}),
          status: params.success === false ? "error" : "complete",
        },
      );
    case CORE_UI_METHODS.TURN_COMPLETED:
      return addSystemMessage(
        entries,
        `terminal:${turnId}`,
        "Turn complete",
        usageText(params),
        "complete",
      );
    case CORE_UI_METHODS.TURN_ERROR:
      return addSystemMessage(
        entries,
        `terminal:${turnId}`,
        String(params.code ?? "Turn failed"),
        String(params.message ?? "Unknown server error"),
        "error",
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
        entries,
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
      return upsert(entries, {
        id:
          hydrated?.id ??
          `assistant:${turnId}:${String(data.assistant_segment_id ?? "default")}`,
        kind: "assistant",
        title: "Octos",
        body: textOf(data),
        status: "complete",
        turnId,
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
      const settled = entries.map((entry) =>
        entry.turnId === turnId &&
        entry.kind === "reasoning" &&
        entry.status === "running"
          ? { ...entry, status: "complete" as const }
          : entry,
      );
      return upsert(settled, {
        id: `tool:${String(data.tool_call_id ?? turnId)}`,
        kind: "tool",
        title: String(data.name ?? "Tool"),
        body: String(data.arguments_preview ?? ""),
        status: "running",
        turnId,
      });
    }
    case "tool_progress":
      return patchEntry(
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
      // Cap tool output in the timeline; the trajectory view holds the
      // full output. Keeps the streaming timeline readable.
      const body = raw.length > 500 ? raw.slice(0, 497) + "…" : raw;
      return patchEntry(
        entries,
        `tool:${String(data.tool_call_id ?? turnId)}`,
        {
          body,
          status:
            data.status === "complete"
              ? "complete"
              : data.status === "skipped"
                ? "info"
                : "error",
        },
      );
    }
    case "turn_terminal": {
      const settled =
        data.outcome === "completed"
          ? sweepTurnStreamtails(entries, turnId)
          : entries;
      return addSystemMessage(
        settled,
        `terminal:${turnId}`,
        data.outcome === "completed" ? "Turn complete" : "Turn settled",
        data.error ? pretty(data.error) : String(data.outcome ?? "complete"),
        data.outcome === "completed" ? "complete" : "error",
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
 * Reasoning segments are bounded by tool calls: each tool_end increments
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
  const existing = entries.find((entry) => entry.id === id);
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
      (entry.id.startsWith(`assistant:${turnId}:`) ||
        entry.id.startsWith(`reasoning:${turnId}`))
    ) {
      changed = true;
      const body = entry.body.trim();
      if (body !== "" && persistedBodies.some((full) => full.includes(body))) {
        // Duplicate tail: the persisted message already covers it.
        continue;
      }
      next.push({ ...entry, status: "complete" });
      continue;
    }
    next.push(entry);
  }
  return changed ? next : entries.slice();
}

function upsert(
  entries: readonly TimelineEntry[],
  next: TimelineEntry,
): TimelineEntry[] {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index < 0) return appendWithinVisibleBound(entries, next);
  return entries.map((entry, current) => (current === index ? next : entry));
}

function appendWithinVisibleBound(
  entries: readonly TimelineEntry[],
  next: TimelineEntry,
): TimelineEntry[] {
  const priorMarker = entries.find((entry) => entry.id === TRUNCATION_ENTRY_ID);
  const content = [
    ...entries.filter((entry) => entry.id !== TRUNCATION_ENTRY_ID),
    next,
  ];
  if (!priorMarker && content.length <= TIMELINE_LIMIT) return content;

  const kept = content.slice(-(TIMELINE_LIMIT - 1));
  const omittedCount =
    (priorMarker?.omittedCount ?? 0) +
    Math.max(0, content.length - kept.length);
  return [
    {
      id: TRUNCATION_ENTRY_ID,
      kind: "system",
      title: "Earlier activity omitted",
      body: `${omittedCount} older timeline ${omittedCount === 1 ? "entry is" : "entries are"} outside this browser's rendering window. Reopen the durable session to hydrate authoritative history.`,
      status: "info",
      omittedCount,
    },
    ...kept,
  ];
}

function patchEntry(
  entries: readonly TimelineEntry[],
  id: string,
  patch: { body?: string | undefined; status?: TimelineStatus },
): TimelineEntry[] {
  return entries.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          ...(patch.body === undefined ? {} : { body: patch.body }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
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
