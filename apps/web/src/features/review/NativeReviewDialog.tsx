import { useState, useSyncExternalStore } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import type { NativeReviewBinding } from "./native-review.ts";
import styles from "./NativeReviewDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export interface NativeReviewDialogProps {
  binding: NativeReviewBinding;
  initialPrompt?: string;
  onClose(): void;
}

export function NativeReviewDialog(props: NativeReviewDialogProps) {
  return (
    <BoundNativeReviewDialog key={props.binding.authorityKey} {...props} />
  );
}

function BoundNativeReviewDialog({
  binding,
  initialPrompt = "",
  onClose,
}: NativeReviewDialogProps) {
  const t = useUiText();
  const blockedReason = useSyncExternalStore(
    binding.subscribe,
    binding.blockedReason,
    binding.blockedReason,
  );
  const [prompt, setPrompt] = useState(initialPrompt);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  function start() {
    if (started || blockedReason) return;
    setError(null);
    try {
      binding.start(prompt);
      setStarted(true);
      onClose();
    } catch (cause) {
      setError(
        (cause instanceof Error
          ? cause.message
          : "Native review could not start."
        ).slice(0, 512),
      );
    }
  }
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy="native-review-title"
      onEscape={onClose}
    >
      <header className={styles.header}>
        <h2 id="native-review-title">{t("Native code review")}</h2>
        <button type="button" onClick={onClose}>
          {t("Close review")}
        </button>
      </header>
      <p className={styles.scope}>{binding.scope.sessionId}</p>
      <p>
        {t(
          "Run the server's native review specialists on the current project changes. This starts a Session turn; it is not a diff preview.",
        )}
      </p>
      <p>
        {t(
          "Results and any errors appear in this Session. You can queue ordinary prompts while review runs, or stop it using the Session's Stop control.",
        )}
      </p>
      <label>
        {t("Review instructions (optional)")}
        <textarea
          rows={5}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={started || !binding.isCurrent()}
          placeholder={t("Leave empty to review the current project changes.")}
        />
      </label>
      {blockedReason ? <p role="status">{blockedReason}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        disabled={started || Boolean(blockedReason)}
        onClick={start}
      >
        {t("Start native review")}
      </button>
    </ModalSurface>
  );
}
