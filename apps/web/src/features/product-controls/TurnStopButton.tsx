export interface TurnStopButtonProps {
  activeTurnId: string | null;
  interruptingTurnId: string | null;
  available: boolean;
  onInterrupt: () => void;
}

/** Capability-gated foreground interrupt control. */
export function TurnStopButton({
  activeTurnId,
  interruptingTurnId,
  available,
  onInterrupt,
}: TurnStopButtonProps) {
  if (!activeTurnId || !available) return null;
  const stopping = interruptingTurnId === activeTurnId;
  return (
    <button
      className="stop-button"
      type="button"
      onClick={onInterrupt}
      disabled={stopping}
    >
      {stopping ? "Stopping…" : "Stop"}
    </button>
  );
}
