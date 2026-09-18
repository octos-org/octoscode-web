import type { SessionStripState } from "../session-config/SessionStatusStrip.tsx";
import type { TurnActivity } from "./turn-activity.ts";

/**
 * The strip's third segment: the live activity word while a response is being
 * produced, otherwise null (the strip falls back to its plain state word).
 * Pure; reused by the strip and by wiring tests.
 */
export function stripStateThinking(
  state: SessionStripState,
  activity: TurnActivity | null,
): string | null {
  return state.kind === "responding" && activity ? activity.label : null;
}
