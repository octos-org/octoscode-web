import { isRecord } from "./rpc.ts";
import type { TurnLifecycleState, TurnStateGetResult } from "./types.ts";

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

export function parseTurnStateGetResult(
  value: unknown,
): TurnStateGetResult | null {
  if (
    !isRecord(value) ||
    typeof value.session_id !== "string" ||
    !value.session_id ||
    typeof value.turn_id !== "string" ||
    !value.turn_id ||
    !isTurnLifecycleState(value.state)
  )
    return null;
  const optionalStrings = ["started_at", "completed_at", "thread_id"] as const;
  if (
    optionalStrings.some(
      (key) => value[key] !== undefined && typeof value[key] !== "string",
    )
  )
    return null;
  if (
    value.committed_seqs !== undefined &&
    (!Array.isArray(value.committed_seqs) ||
      value.committed_seqs.some((seq) => !Number.isSafeInteger(seq) || seq < 0))
  )
    return null;
  return {
    session_id: value.session_id,
    turn_id: value.turn_id,
    state: value.state,
    committed_seqs: (value.committed_seqs as number[] | undefined) ?? [],
    ...(typeof value.started_at === "string"
      ? { started_at: value.started_at }
      : {}),
    ...(typeof value.completed_at === "string"
      ? { completed_at: value.completed_at }
      : {}),
    ...(typeof value.thread_id === "string"
      ? { thread_id: value.thread_id }
      : {}),
  };
}
