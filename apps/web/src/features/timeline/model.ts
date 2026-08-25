import {
  isRecord,
  parseProjectionEnvelope,
  type RpcNotification,
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
  if (notification.method === "projection/envelope") {
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
    case "message/delta":
      return appendText(
        entries,
        `assistant:${turnId}`,
        "assistant",
        "Octos",
        params.text,
        turnId,
      );
    case "message/reasoning_delta":
      return appendText(
        entries,
        `reasoning:${turnId}`,
        "reasoning",
        "Reasoning",
        params.text,
        turnId,
      );
    case "tool/started":
      return upsert(entries, {
        id: `tool:${String(params.tool_call_id ?? turnId)}`,
        kind: "tool",
        title: String(params.tool_name ?? "Tool"),
        body: pretty(params.arguments),
        status: "running",
        turnId,
      });
    case "tool/progress":
      return patchEntry(
        entries,
        `tool:${String(params.tool_call_id ?? turnId)}`,
        {
          body: typeof params.message === "string" ? params.message : undefined,
        },
      );
    case "tool/completed":
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
    case "turn/completed":
      return addSystemMessage(
        entries,
        `terminal:${turnId}`,
        "Turn complete",
        usageText(params),
        "complete",
      );
    case "turn/error":
      return addSystemMessage(
        entries,
        `terminal:${turnId}`,
        String(params.code ?? "Turn failed"),
        String(params.message ?? "Unknown server error"),
        "error",
      );
    case "warning":
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
    notification.method === "turn/completed" ||
    notification.method === "turn/error"
  ) {
    return isRecord(notification.params) &&
      typeof notification.params.turn_id === "string"
      ? notification.params.turn_id
      : null;
  }
  if (notification.method !== "projection/envelope") return null;
  const envelope = parseProjectionEnvelope(notification.params);
  return envelope?.payload.type === "turn_terminal" ? envelope.turn_id : null;
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
    case "assistant_persisted":
      return upsert(entries, {
        id: `assistant:${turnId}:${String(data.assistant_segment_id ?? "default")}`,
        kind: "assistant",
        title: "Octos",
        body: textOf(data),
        status: "complete",
        turnId,
      });
    case "reasoning_delta":
      return appendText(
        entries,
        `reasoning:${turnId}`,
        "reasoning",
        "Reasoning",
        data.text,
        turnId,
      );
    case "tool_start":
      return upsert(entries, {
        id: `tool:${String(data.tool_call_id ?? turnId)}`,
        kind: "tool",
        title: String(data.name ?? "Tool"),
        body: String(data.arguments_preview ?? ""),
        status: "running",
        turnId,
      });
    case "tool_progress":
      return patchEntry(
        entries,
        `tool:${String(data.tool_call_id ?? turnId)}`,
        {
          body: textOf(data),
        },
      );
    case "tool_end":
      return patchEntry(
        entries,
        `tool:${String(data.tool_call_id ?? turnId)}`,
        {
          body: String(data.output_preview ?? data.error ?? data.reason ?? ""),
          status: data.status === "success" ? "complete" : "error",
        },
      );
    case "turn_terminal":
      return addSystemMessage(
        entries,
        `terminal:${turnId}`,
        data.outcome === "completed" ? "Turn complete" : "Turn settled",
        data.error ? pretty(data.error) : String(data.outcome ?? "complete"),
        data.outcome === "completed" ? "complete" : "error",
      );
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

function upsert(
  entries: readonly TimelineEntry[],
  next: TimelineEntry,
): TimelineEntry[] {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index < 0) return [...entries, next].slice(-200);
  return entries.map((entry, current) => (current === index ? next : entry));
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
