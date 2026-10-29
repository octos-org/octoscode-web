import { useId } from "react";
import type { TurnRecoveryState } from "./use-turn-controller.ts";
import styles from "./TurnRecoveryNotice.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export function TurnRecoveryNotice({
  recovery,
  onRetry,
  onContinue,
}: {
  recovery: TurnRecoveryState;
  onRetry: () => void;
  /** Release the local wait; never stops or resends the held turn. */
  onContinue?: () => void;
}) {
  const titleId = useId();
  const t = useUiText();
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
            ? t("Checking the last response")
            : t("Response status is uncertain")}
        </h2>
        <p>
          {checking
            ? t(
                "Checking whether Octos is still working or has finished. Your message will not be sent again.",
              )
            : t(
                "Octos has not confirmed whether the last response is still running or has finished. Sending is paused so the same work is not started twice.",
              )}
        </p>
        {recovery.phase === "unavailable" ? (
          <p>
            {t(
              "This server does not support checking response status. You can copy your text and manage the connection in Settings.",
            )}
          </p>
        ) : null}
        {recovery.phase === "error" ? (
          <p>{t("The status check failed. You can try again.")}</p>
        ) : null}
        {!checking && onContinue ? (
          <p>
            {t(
              "If the response was lost, for example because the server restarted, continue without confirming its outcome. This does not stop or resend it; queued messages send next.",
            )}
          </p>
        ) : null}
      </div>
      <div className={styles.actions}>
        {recovery.phase !== "unavailable" ? (
          <button type="button" onClick={onRetry} disabled={checking}>
            {checking ? t("Checking status…") : t("Check status")}
          </button>
        ) : null}
        {!checking && onContinue ? (
          <button type="button" onClick={onContinue}>
            {t("Continue without it")}
          </button>
        ) : null}
      </div>
      <small>
        {t("Queued messages remain here. You can remove them below.")}
      </small>
    </section>
  );
}
