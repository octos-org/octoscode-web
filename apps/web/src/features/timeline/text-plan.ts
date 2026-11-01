import type {
  PlanItemStatus,
  PlanUpdated,
} from "@octos-org/octoscode-client/protocol";
import type { TimelineEntry } from "./entry-model.ts";

/**
 * The checklist core's system prompt asks the model to open a multi-step task
 * with ("Plan:" then `- [ ]` items). It arrives as ordinary assistant text, not
 * as a `plan/updated` event, so without this the transcript shows a markdown
 * checklist that never ticks while the panel says there is no plan. Parsing it
 * once here gives the transcript and the panel the same source.
 */
export interface TextPlanItem {
  title: string;
  done: boolean;
}

export interface TextPlan {
  items: TextPlanItem[];
  /** Assistant text after the checklist, still rendered as markdown. */
  rest: string;
}

const HEADING = /^\s*(?:\*\*)?(?:plan|计划)(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*$/i;
const ITEM = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/;

/** A leading "Plan:" heading followed by at least two checklist items. */
export function parseTextPlan(body: string): TextPlan | null {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && !lines[index]!.trim()) index += 1;
  if (index >= lines.length || !HEADING.test(lines[index]!)) return null;
  index += 1;
  const items: TextPlanItem[] = [];
  for (; index < lines.length; index += 1) {
    const match = ITEM.exec(lines[index]!);
    if (!match) {
      if (!lines[index]!.trim() && items.length === 0) continue;
      break;
    }
    items.push({ title: match[2]!, done: match[1] !== " " });
  }
  if (items.length < 2) return null;
  return { items, rest: lines.slice(index).join("\n").trim() };
}

/**
 * The newest text plan in the transcript as a `PlanUpdated`, so the Overview
 * and Trajectory render it exactly like a structured plan.
 */
export function latestTextPlan(
  entries: readonly TimelineEntry[],
  sessionId: string,
): { plan: PlanUpdated; ended: boolean } | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind !== "assistant") continue;
    const parsed = parseTextPlan(entry.body);
    if (!parsed) continue;
    const ended =
      entry.turnId === undefined ||
      entries.some((other) => other.id === `terminal:${entry.turnId}`);
    return {
      ended,
      plan: {
        sessionId,
        ...(entry.turnId ? { turnId: entry.turnId } : {}),
        updatedAtMs: entry.endedAtMs ?? entry.startedAtMs ?? 0,
        items: parsed.items.map((item, position) => ({
          id: `${entry.id}:${position}`,
          title: item.title,
          status: (item.done ? "completed" : "pending") as PlanItemStatus,
        })),
      },
    };
  }
  return null;
}
