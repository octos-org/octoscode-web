import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./ReadOnlyDeniedNotice.module.css";

interface ReadOnlyDeniedNoticeProps {
  /** A response is running, so switching stops it first. */
  stopsResponse: boolean;
  busy: boolean;
  error: string | null;
  /** Inside a takeover card rather than standing alone in the dock. */
  embedded?: boolean;
  onSwitch: () => void;
  onDismiss: () => void;
}

/** A write just failed on read-only access: offer the way out, never take it. */
export function ReadOnlyDeniedNotice({
  stopsResponse,
  busy,
  error,
  embedded = false,
  onSwitch,
  onDismiss,
}: ReadOnlyDeniedNoticeProps) {
  const t = useUiText();
  return (
    <div className={embedded ? styles.embedded : styles.docked} role="status">
      <div className={styles.copy}>
        <strong>
          {t("This Session is read only, so Octos can't change files")}
        </strong>
        <span>
          {t(
            stopsResponse
              ? "This stops the current response, switches to write, and redoes your request. Network access stays the same."
              : "This switches to write and redoes your request. Network access stays the same.",
          )}
        </span>
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <div className={styles.actions}>
        <button
          className="takeover-button"
          type="button"
          disabled={busy}
          onClick={onDismiss}
        >
          {t("Stay read only")}
        </button>
        <button
          className="takeover-button primary"
          type="button"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={onSwitch}
        >
          {t(busy ? "Switching to write…" : "Switch to write and continue")}
        </button>
      </div>
    </div>
  );
}
