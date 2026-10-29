import { useId, useRef } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./LeaveConnectionDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export interface LeaveConnectionDialogProps {
  action: "disconnect" | "forget";
  unsavedDraft?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function LeaveConnectionDialog({
  action,
  unsavedDraft = false,
  onCancel,
  onConfirm,
}: LeaveConnectionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const forget = action === "forget";
  const t = useUiText();

  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy={titleId}
      describedBy={descriptionId}
      initialFocusRef={cancelRef}
      closeOnBackdrop
      onEscape={onCancel}
    >
      <h2 id={titleId}>
        {forget ? t("Forget this server?") : t("Disconnect from Octos?")}
      </h2>
      <div id={descriptionId} className={styles.description}>
        <p>
          {t(
            "Current and background work may stop when this connection closes. Queued messages will be discarded.",
          )}
        </p>
        {unsavedDraft ? (
          <p>
            {t(
              "This input has not been saved. Copy it before leaving this conversation.",
            )}
          </p>
        ) : null}
        <p>
          {forget
            ? t(
                "This also removes the saved server address and this tab’s sign-in details.",
              )
            : t("The server stays remembered so you can reconnect later.")}
        </p>
      </div>
      <div className={styles.actions}>
        <button ref={cancelRef} type="button" onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button type="button" className={styles.confirm} onClick={onConfirm}>
          {forget ? t("Forget server") : t("Disconnect")}
        </button>
      </div>
    </ModalSurface>
  );
}
