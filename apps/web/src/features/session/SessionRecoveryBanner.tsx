import { useState } from "react";
import type { SessionRecoverySnapshot } from "./durable-session.ts";
import { RefreshIcon } from "../../ui/ShellIcons.tsx";

/** Phases where the client is actively working and the user waits. */
function inFlight(phase: SessionRecoverySnapshot["phase"]): boolean {
  return phase === "reconnecting" || phase === "hydrating";
}

/**
 * The banner shown while a Session's state is not trustworthy.
 *
 * Automatic recovery runs once; when it fails the record is quarantined and
 * nothing re-arms it while the shared socket stays up. So a stalled recovery
 * offers Reload session (a fresh open + hydrate of this Session) instead of
 * leaving the browser reload as the only exit, and says plainly that it is
 * not reconnecting on its own.
 */
export function SessionRecoveryBanner({
  recovery,
  onReload,
  t,
}: {
  recovery: SessionRecoverySnapshot;
  onReload?: () => Promise<void>;
  t: (text: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const waiting = inFlight(recovery.phase);
  const title = waiting
    ? recovery.phase === "reconnecting"
      ? "Reconnecting to Octos"
      : "Restoring session state"
    : "Session recovery required";
  const explanation = waiting
    ? t(
        "Your session is reconnecting. Queued messages will wait until it is ready.",
      )
    : t(
        "This session stopped following the server and will not recover on its own. Reload it to fetch the conversation again. Nothing is sent again.",
      );
  return (
    <div className={`recovery-banner recovery-${recovery.phase}`} role="status">
      <span className="recovery-banner-mark">
        <RefreshIcon size={16} />
      </span>
      <span>
        <strong>{t(title)}</strong>
        <small>{recovery.detail ?? explanation}</small>
        {recovery.detail && !waiting ? <small>{explanation}</small> : null}
        {failed ? (
          <small className="recovery-banner-error">{failed}</small>
        ) : null}
      </span>
      {!waiting && onReload ? (
        <button
          type="button"
          className="recovery-banner-action"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setFailed(null);
            void onReload()
              .catch((reason: unknown) =>
                setFailed(
                  `${t("Could not reload the session.")} ${
                    reason instanceof Error ? reason.message : String(reason)
                  }`,
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? t("Reloading…") : t("Reload session")}
        </button>
      ) : null}
    </div>
  );
}
