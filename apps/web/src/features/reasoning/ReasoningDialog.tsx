import { useId } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import {
  REASONING_CHOICES,
  reasoningEffort,
  type ReasoningEffort,
} from "./model.ts";
import styles from "./ReasoningDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export interface ReasoningDialogProps {
  sessionId: string;
  value: ReasoningEffort | undefined;
  disabled: boolean;
  onSelect: (value: ReasoningEffort | undefined) => void;
  onClose: () => void;
  showReasoning?: boolean;
  onShowReasoningChange?: (value: boolean) => void;
}

/** The host binds selection to the confirmed record, never the global model. */
export function ReasoningDialog({
  sessionId,
  value,
  disabled,
  onSelect,
  onClose,
  showReasoning = true,
  onShowReasoningChange,
}: ReasoningDialogProps) {
  const t = useUiText();
  const titleId = useId();
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy={titleId}
      onEscape={onClose}
    >
      <header className={styles.header}>
        <h2 id={titleId}>{t("Thinking effort")}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("Close thinking effort")}
        >
          {t("Close")}
        </button>
      </header>
      <p className={styles.scope}>{sessionId}</p>
      {onShowReasoningChange ? (
        <label>
          <input
            type="checkbox"
            checked={showReasoning}
            onChange={(event) => onShowReasoningChange(event.target.checked)}
          />
          {t("Show reasoning in this Session’s transcript")}
        </label>
      ) : null}
      <p>
        {t(
          "Visibility is a browser preference; it does not change stored reasoning or model effort.",
        )}
      </p>
      <p>
        {t(
          "Each new prompt captures this Session’s choice when queued. Changing it does not alter a running turn or already queued prompts.",
        )}
      </p>
      <label>
        {t("Effort for new prompts")}
        <select
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => onSelect(reasoningEffort(event.target.value))}
        >
          {REASONING_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {t(choice.label)}
            </option>
          ))}
        </select>
      </label>
      <p>
        {t(
          "Core saves the choice when the next user turn starts. Profile default clears the Session override at that point. Providers may ignore effort for models without reasoning controls.",
        )}
      </p>
    </ModalSurface>
  );
}
