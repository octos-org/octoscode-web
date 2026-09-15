import { useId } from "react";
import type { TurnRecoveryState } from "./use-turn-controller.ts";
import styles from "./TurnRecoveryNotice.module.css";

export function TurnRecoveryNotice({
  recovery,
  onRetry,
}: {
  recovery: TurnRecoveryState;
  onRetry: () => void;
}) {
  const titleId = useId();
  const checking = recovery.phase === "checking";
  return (
    <section
      className={styles.notice}
      aria-labelledby={titleId}
      aria-busy={checking}
    >
      <div role="status" aria-live="polite">
        <h2 id={titleId}>
          {checking
            ? "Checking the last response"
            : "Response status is uncertain"}
        </h2>
        <p>
          {checking
            ? "Checking whether Octos is still working or has finished. Your message will not be sent again."
            : "Octos has not confirmed whether the last response is still running or has finished. Sending is paused so the same work is not started twice."}
        </p>
        {recovery.phase === "unavailable" ? (
          <p>
            This server does not support checking response status. You can copy
            your text and manage the connection in Settings.
          </p>
        ) : null}
        {recovery.phase === "error" ? (
          <p>The status check failed. You can try again.</p>
        ) : null}
      </div>
      {recovery.phase !== "unavailable" ? (
        <button type="button" onClick={onRetry} disabled={checking}>
          {checking ? "Checking status…" : "Check status"}
        </button>
      ) : null}
      <small>Queued messages remain here. You can remove them below.</small>
    </section>
  );
}
