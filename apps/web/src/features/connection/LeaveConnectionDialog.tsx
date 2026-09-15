import { useId, useRef } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./LeaveConnectionDialog.module.css";

export interface LeaveConnectionDialogProps {
  action: "disconnect" | "forget";
  onCancel: () => void;
  onConfirm: () => void;
}

export function LeaveConnectionDialog({
  action,
  onCancel,
  onConfirm,
}: LeaveConnectionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const forget = action === "forget";

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
        {forget ? "Forget this server?" : "Disconnect from Octos?"}
      </h2>
      <div id={descriptionId} className={styles.description}>
        <p>
          Current and background work may stop when this connection closes.
          Queued messages will be discarded.
        </p>
        <p>
          {forget
            ? "This also removes the saved server address and this tab’s sign-in details."
            : "The server stays remembered so you can reconnect later."}
        </p>
      </div>
      <div className={styles.actions}>
        <button ref={cancelRef} type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.confirm} onClick={onConfirm}>
          {forget ? "Forget server" : "Disconnect"}
        </button>
      </div>
    </ModalSurface>
  );
}
