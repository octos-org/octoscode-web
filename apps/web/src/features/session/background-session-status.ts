import type { PromptTurnQueueSnapshot } from "../composer/turn-queue.ts";
import type { TimelineEntry } from "../timeline/model.ts";

export type BackgroundSessionState =
  "idle" | "running" | "waiting" | "completed" | "failed";

/** Only the record's live work or canonical turn terminals imply work status.
 * Opening, metadata, unread notifications and completed messages do not. */
export function backgroundSessionState(
  queue: PromptTurnQueueSnapshot,
  waiting: boolean,
  timeline: readonly TimelineEntry[],
): BackgroundSessionState {
  if (waiting) return "waiting";
  if (queue.active || queue.pending.length) return "running";
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (
      entry?.kind === "system" &&
      entry.id.startsWith("terminal:") &&
      entry.id.length > "terminal:".length
    ) {
      if (entry.status === "complete") return "completed";
      if (entry.status === "error") return "failed";
    }
  }
  return "idle";
}
