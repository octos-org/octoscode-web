import styles from "./TurnStopButton.module.css";

export interface TurnStopButtonProps {
  activeTurnId: string | null;
  interruptingTurnId: string | null;
  available: boolean;
  /**
   * Product projection for a local `turn/start` request that Core has not
   * accepted yet. Starting is status, not an interruptible turn.
   */
  starting: boolean;
  onInterrupt: () => void;
}

/** Capability-gated foreground interrupt control. */
export function TurnStopButton({
  activeTurnId,
  interruptingTurnId,
  available,
  starting,
  onInterrupt,
}: TurnStopButtonProps) {
  if (!activeTurnId) return null;
  if (starting) {
    return (
      <button
        className={`${styles.control} ${styles.starting}`}
        type="button"
        disabled
        aria-busy="true"
        aria-live="polite"
      >
        Starting…
      </button>
    );
  }
  if (!available) return null;
  const stopping = interruptingTurnId === activeTurnId;
  return (
    <button
      className={`${styles.control} ${styles.stop}`}
      type="button"
      onClick={onInterrupt}
      disabled={stopping}
      aria-busy={stopping || undefined}
    >
      {stopping ? "Stopping…" : "Stop"}
    </button>
  );
}
