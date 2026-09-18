import type { TimelineEntry, TimelineStatus } from "./model.ts";

// Small presentation helpers used before a coding Session is opened. Hydrate
// and live projection reducers stay with the lazy, authoritative record engine.
const TIMELINE_LIMIT = 200;
const TRUNCATION_ENTRY_ID = "timeline:truncated";

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

export function upsert(
  entries: readonly TimelineEntry[],
  next: TimelineEntry,
): TimelineEntry[] {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index < 0) return appendWithinVisibleBound(entries, next);
  const previous = entries[index];
  if (
    previous?.textTerminal &&
    previous.turnId === next.turnId &&
    next.textTerminal === undefined
  )
    next = { ...next, textTerminal: previous.textTerminal };
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
