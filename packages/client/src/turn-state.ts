import { isRecord } from "./rpc.ts";
import type { TurnStateGetResult } from "./types.ts";
import { isTurnLifecycleState } from "./turn-state-values.ts";

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
    // UPCR-2026-031: only meaningful beside `unknown`; anything else is
    // outside the contract and dropped rather than trusted.
    ...(value.state === "unknown" && value.running === false
      ? { running: false as const }
      : {}),
  };
}
