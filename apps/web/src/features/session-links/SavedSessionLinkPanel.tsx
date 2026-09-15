import { useId } from "react";
import type { SavedSessionReference } from "./saved-session-link.ts";
import styles from "./SavedSessionLinkPanel.module.css";

export interface SavedSessionLinkPanelProps {
  reference: SavedSessionReference;
  serverOrigin: string;
  opening?: boolean;
  error?: string | null;
  onOpen: () => void;
  onDismiss: () => void;
}

/** An untrusted bookmark is a visible user choice, never an automatic open. */
export function SavedSessionLinkPanel({
  reference,
  serverOrigin,
  opening = false,
  error = null,
  onOpen,
  onDismiss,
}: SavedSessionLinkPanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <section
      className={styles.panel}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={opening}
    >
      <h2 id={titleId}>Open saved conversation</h2>
      <p id={descriptionId} className={styles.description}>
        Open this conversation on the connected server. Check that the server
        and workspace match the link you saved.
      </p>
      <dl className={styles.destination}>
        <div>
          <dt>Server</dt>
          <dd>{serverOrigin}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>{reference.workspaceRoot}</dd>
        </div>
      </dl>
      <details className={styles.details}>
        <summary>Conversation details</summary>
        <dl className={styles.destination}>
          <div>
            <dt>Profile</dt>
            <dd>{reference.profileId}</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{reference.sessionId}</dd>
          </div>
        </dl>
      </details>
      <p className={styles.note}>
        If the conversation no longer exists, the server may open an empty
        session. Opening the link does not send a message.
      </p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button type="button" disabled={opening} onClick={onDismiss}>
          Dismiss link
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={opening}
          onClick={onOpen}
        >
          {opening ? "Opening conversation…" : "Open conversation"}
        </button>
      </div>
      {opening ? (
        <span className="sr-only" role="status">
          Checking the session and loading its conversation.
        </span>
      ) : null}
    </section>
  );
}
