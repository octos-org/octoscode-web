import {
  CORE_UI_METHODS,
  isRecord,
  type ProjectionEnvelopeV2,
  type SessionHydrateResult,
} from "@octos-org/octoscode-client";
import {
  foldNotification,
  timelineFromHydrate,
  withHydratedTurnOutcome,
  type HydratedTimelineIdentityOptions,
  type TimelineEntry,
} from "./model.ts";

export function timelineFromCanonicalHydrate(
  result: SessionHydrateResult,
  identities: HydratedTimelineIdentityOptions = {},
): TimelineEntry[] {
  return withHydratedTurnOutcome(
    restoreCanonicalHydrate(result, timelineFromHydrate(result, identities)),
    result,
  );
}

/**
 * Core #2296 retains either a complete canonical thread or terminal records
 * plus a continuation checkpoint. Rebuild complete threads in event order;
 * keep the ordinary durable projection for compacted/missing histories.
 * Durable bodies win over bounded previews. Ambiguous identity never deletes
 * a transcript row, including repeated same-turn user inputs.
 */
export function restoreCanonicalHydrate(
  result: SessionHydrateResult,
  durable: TimelineEntry[],
): TimelineEntry[] {
  const threads = new Map<string, ProjectionEnvelopeV2[]>();
  const threadByTurn = new Map<string, string | null>();
  const threadByMessage = new Map<string, string | null>();
  for (const event of result.replayed_projection_envelopes ?? []) {
    const events = threads.get(event.thread_id) ?? [];
    events.push(event);
    threads.set(event.thread_id, events);
    const previous = threadByTurn.get(event.turn_id);
    threadByTurn.set(
      event.turn_id,
      previous === undefined || previous === event.thread_id
        ? event.thread_id
        : null,
    );
    const data = event.payload.data;
    const meta = isRecord(data) && isRecord(data.meta) ? data.meta : undefined;
    const messageId =
      event.payload.type === "assistant_persisted"
        ? meta?.message_id
        : event.payload.type === "background/spawn_complete" && isRecord(data)
          ? data.message_id
          : undefined;
    if (typeof messageId === "string") {
      const previous = threadByMessage.get(messageId);
      threadByMessage.set(
        messageId,
        previous === undefined || previous === event.thread_id
          ? event.thread_id
          : null,
      );
    }
  }
  const threadByEntry = new Map<string, string>();
  const clientByEntry = new Map<string, string>();
  for (const message of result.messages ?? []) {
    const stableId =
      message.message_id ??
      message.client_message_id ??
      `${message.thread_id ?? "session"}:${message.seq}`;
    const id = `hydrated:${stableId}`;
    if (message.thread_id) {
      threadByEntry.set(id, message.thread_id);
      threadByEntry.set(`reasoning:${stableId}`, message.thread_id);
    }
    if (message.client_message_id)
      clientByEntry.set(id, message.client_message_id);
  }
  const entryThread = (entry: TimelineEntry) => {
    // Background transcript rows can retain the parent client-message thread.
    // A unique canonical message identity proves the child stream instead.
    if (entry.messageId && threadByMessage.has(entry.messageId))
      return threadByMessage.get(entry.messageId);
    return (
      (entry.turnId ? threadByTurn.get(entry.turnId) : undefined) ??
      threadByEntry.get(entry.id)
    );
  };
  const updates = new Map<string, TimelineEntry | null>();
  const aliases = new Map<string, string>();
  const extras: TimelineEntry[] = [];
  const completeEvents: ProjectionEnvelopeV2[] = [];
  let fallback = durable;
  for (const [thread, unordered] of threads) {
    const events = [...unordered].sort((left, right) => left.seq - right.seq);
    const checkpoint = result.projection_thread_sequences?.[thread];
    const complete =
      checkpoint === events.length &&
      events.every((event, index) => event.seq === index + 1);
    if (!complete) {
      // A compacted thread deliberately omits deltas. Never append an
      // unproven partial prefix to a durable answer or infer missing content.
      for (const event of events) {
        if (event.payload.type === "turn_terminal")
          fallback = fold(fallback, event);
      }
      continue;
    }
    completeEvents.push(...events);
    const sources = durable.filter((entry) => entryThread(entry) === thread);
    const replay = events.reduce(fold, [] as TimelineEntry[]);
    const clientByEvent = new Map(
      events
        .filter((event) => event.client_message_id)
        .map((event) => [
          `user-event:${JSON.stringify([event.thread_id, event.seq])}`,
          event.client_message_id!,
        ]),
    );
    const sourceIndex = new Map<string, TimelineEntry[]>();
    const addIndex = (key: string, source: TimelineEntry) => {
      const entries = sourceIndex.get(key) ?? [];
      entries.push(source);
      sourceIndex.set(key, entries);
    };
    const bodyKey = (entry: TimelineEntry) =>
      `body:${JSON.stringify([entry.kind, entry.body])}`;
    for (const source of sources) {
      addIndex(`id:${source.id}`, source);
      if (source.messageId) addIndex(`message:${source.messageId}`, source);
      const clientId =
        source.kind === "user" ? clientByEntry.get(source.id) : undefined;
      if (clientId) addIndex(`client:${clientId}`, source);
      if (["user", "assistant"].includes(source.kind))
        addIndex(bodyKey(source), source);
    }
    const bodyCounts = new Map<string, number>();
    for (const entry of replay) {
      if (["user", "assistant"].includes(entry.kind))
        bodyCounts.set(
          bodyKey(entry),
          (bodyCounts.get(bodyKey(entry)) ?? 0) + 1,
        );
    }
    const proposals = replay.map((entry) => {
      const clientId =
        entry.kind === "user" && entry.streamId
          ? clientByEvent.get(entry.streamId)
          : undefined;
      const keys = [
        `id:${entry.id}`,
        ...(entry.messageId ? [`message:${entry.messageId}`] : []),
        ...(clientId ? [`client:${clientId}`] : []),
      ];
      const exact = [
        ...new Set(keys.flatMap((key) => sourceIndex.get(key) ?? [])),
      ];
      if (exact.length) return exact;
      // Older retained user events may omit client_message_id. Match only a
      // unique complete body in both projections within this proven thread.
      if (
        !["user", "assistant"].includes(entry.kind) ||
        bodyCounts.get(bodyKey(entry)) !== 1
      )
        return [];
      return sourceIndex.get(bodyKey(entry)) ?? [];
    });
    const claims = new Map<string, number>();
    for (const candidates of proposals)
      for (const source of candidates)
        claims.set(source.id, (claims.get(source.id) ?? 0) + 1);
    const matched = new Map<string, number>();
    const merged = replay.map((entry, index) => {
      const candidates = proposals[index]!;
      const source = candidates[0];
      if (candidates.length !== 1 || !source || claims.get(source.id) !== 1)
        return entry;
      matched.set(source.id, index);
      aliases.set(source.id, entry.id);
      return {
        ...source,
        ...entry,
        id: source.id,
        // Terminal error detail is authoritative from replay; transcript
        // messages and tool outputs keep their full durable bodies.
        body: entry.kind === "system" ? entry.body || source.body : source.body,
        ...(entry.kind === "assistant"
          ? { streamId: entry.streamId ?? entry.id }
          : {}),
      };
    });
    const reasoned = replay
      .filter((entry) => entry.kind === "reasoning")
      .map((entry) => entry.body)
      .join("");
    const sourceReasoning = sources
      .filter((entry) => entry.kind === "reasoning")
      .map((entry) => entry.body)
      .join("");
    const replacedReasoning =
      reasoned.length > 0 && reasoned === sourceReasoning;
    for (const source of sources) {
      if (source.kind === "reasoning" && replacedReasoning)
        updates.set(source.id, null);
    }
    // Existing rows are global durable anchors. Do not gather a thread into
    // a block: background threads can interleave A/question, B/question,
    // A/answer, B/answer. Only insert newly reconstructed rows at an anchor.
    for (const entry of merged) {
      if (matched.has(entry.id)) {
        updates.set(entry.id, entry);
      } else extras.push(entry);
    }
  }
  // Preserve the global canonical order of newly recovered rows, including a
  // foreground question that predates a persisted background-child reply.
  // Existing durable anchors still never move across another thread's rows.
  completeEvents.sort((a, b) =>
    a.cursor && b.cursor
      ? a.cursor.seq - b.cursor.seq
      : a.thread_id === b.thread_id
        ? a.seq - b.seq
        : 0,
  );
  const replayOrder = new Map(
    completeEvents
      .reduce(fold, [] as TimelineEntry[])
      .map((entry, index) => [entry.id, index]),
  );
  for (const [id, alias] of aliases) {
    const order = replayOrder.get(alias);
    if (order !== undefined) replayOrder.set(id, order);
  }
  const anchors = fallback
    .filter((entry) => updates.get(entry.id) && replayOrder.has(entry.id))
    .sort((a, b) => replayOrder.get(a.id)! - replayOrder.get(b.id)!);
  const before = new Map<string, TimelineEntry[]>();
  const after = new Map<string, TimelineEntry[]>();
  const unanchored: TimelineEntry[] = [];
  extras.sort(
    (a, b) =>
      (replayOrder.get(a.id) ?? Infinity) - (replayOrder.get(b.id) ?? Infinity),
  );
  let anchorIndex = 0;
  for (const entry of extras) {
    const order = replayOrder.get(entry.id) ?? Infinity;
    while (
      anchorIndex < anchors.length &&
      replayOrder.get(anchors[anchorIndex]!.id)! < order
    )
      anchorIndex++;
    const anchor = anchors[anchorIndex] ?? anchors.at(-1);
    if (!anchor) {
      unanchored.push(entry);
      continue;
    }
    const target = anchors[anchorIndex] ? before : after;
    const rows = target.get(anchor.id) ?? [];
    rows.push(entry);
    target.set(anchor.id, rows);
  }
  const entries: TimelineEntry[] = [];
  for (const entry of fallback) {
    entries.push(...(before.get(entry.id) ?? []));
    const update = updates.get(entry.id);
    if (update !== null) entries.push(update ?? entry);
    entries.push(...(after.get(entry.id) ?? []));
  }
  // A not-yet-persisted active/interrupted thread has no durable anchor.
  // Its original question and stream still belong after prior history.
  return [...entries, ...unanchored];
}

function fold(
  entries: readonly TimelineEntry[],
  event: ProjectionEnvelopeV2,
): TimelineEntry[] {
  return foldNotification(entries, {
    jsonrpc: "2.0",
    method: CORE_UI_METHODS.PROJECTION_ENVELOPE,
    params: event,
  });
}
