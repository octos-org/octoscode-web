import { useId } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { PeersPanel, type PeersPanelProps } from "./PeersPanel.tsx";
import styles from "./PeersDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export function PeersDialog({
  manager,
  error,
  sessionId,
  onClose,
}: PeersPanelProps & {
  sessionId: string;
  error: string | null;
  onClose(): void;
}) {
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
        <h2 id={titleId}>{t("Session peers")}</h2>
        <button type="button" onClick={onClose}>
          {t("Close peers")}
        </button>
      </header>
      <p className={styles.scope}>
        {t("Master:") + " "}
        {sessionId}
      </p>
      <p>
        {t(
          "Peers run in their own Sessions. Closing this panel does not stop them or switch your active Session.",
        )}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <PeersPanel manager={manager} />
    </ModalSurface>
  );
}
