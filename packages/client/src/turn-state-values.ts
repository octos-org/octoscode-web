import type { TurnLifecycleState } from "./types.ts";

// UPCR-2026-011, verified against Core rc.9 (5ea987813de4).
// Unknown is an explicit server result, never evidence of rejection.
export function isTurnLifecycleState(
  value: unknown,
): value is TurnLifecycleState {
  return (
    typeof value === "string" &&
    [
      "active",
      "interrupting",
      "completed",
      "errored",
      "interrupted",
      "unknown",
    ].includes(value)
  );
}
