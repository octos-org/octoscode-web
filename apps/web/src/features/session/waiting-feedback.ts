export const WAITING_FEEDBACK_THRESHOLD_MS = 15_000;

export interface WaitingFeedback {
  readonly phase: string;
  readonly elapsedSeconds: number;
}

/** Preserve the live activity label, but make a long wait understandable. */
export function waitingFeedback(input: {
  readonly activityLabel: string;
  readonly turnStarting: boolean;
  readonly elapsedMs: number;
  readonly thresholdMs?: number;
}): WaitingFeedback | null {
  const threshold = input.thresholdMs ?? WAITING_FEEDBACK_THRESHOLD_MS;
  if (input.elapsedMs < threshold) return null;
  return {
    phase: input.turnStarting
      ? "Waiting for the server to accept this turn"
      : input.activityLabel === "Working…"
        ? "Waiting for the model’s first response"
        : input.activityLabel,
    elapsedSeconds: Math.max(0, Math.floor(input.elapsedMs / 1000)),
  };
}
