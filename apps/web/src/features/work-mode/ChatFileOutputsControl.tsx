import { useUiText } from "../preferences/ui-text.tsx";
import {
  chatFileOutputsState,
  type ChatPermissionFacts,
} from "./file-outputs.ts";

export interface ChatFileOutputsControlProps {
  /** The live server-permission facts for the open chat Session. */
  permission: ChatPermissionFacts;
  /** Server-reported failure of the latest set; nothing was retried. */
  error: string | null;
  /** Locks the action while a turn or another mutation is running. */
  disabled: boolean;
  /** Sends workspace_write + network deny through the real SET path. */
  onEnable: () => void;
  /** Sends read_only + network deny through the same path. */
  onRevoke: () => void;
  /** Re-reads the server's current permission after an unclear outcome. */
  onRefresh: () => void;
}

/**
 * The single permission entry for a chat's file outputs (proposal §6 T-E).
 * It is rendered only where the server negotiated `permission/profile/set`
 * for this Session — everywhere else the chat keeps inline drafts and this
 * control does not exist, so no file-write promise is shown.
 *
 * A failed or unclear set never retries here: the button state follows the
 * server's readback, and "Re-read" fetches it again instead of resending.
 */
export function ChatFileOutputsControl({
  permission,
  error,
  disabled,
  onEnable,
  onRevoke,
  onRefresh,
}: ChatFileOutputsControlProps) {
  const t = useUiText();
  const state = chatFileOutputsState(permission);
  if (state === "managed") return null;
  const busy = state === "applying" || permission.loading;
  return (
    <section className="field-note" aria-label={t("File outputs")}>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" disabled={busy} onClick={onRefresh}>
            {t("Re-read the server's permission")}
          </button>
        </p>
      ) : null}
      {state === "off" ? (
        <p>
          {t(
            "Answers stay inline in this chat. Allow file outputs to let Octos save files you ask for into this chat's own folder — the network stays off.",
          )}{" "}
          <button type="button" disabled={disabled || busy} onClick={onEnable}>
            {t("Allow file outputs")}
          </button>
        </p>
      ) : null}
      {state === "on" ? (
        <p>
          <strong>{t("File outputs on")}</strong>
          {" — "}
          {t(
            "New files this chat produces are saved in its own folder and listed in Outputs.",
          )}{" "}
          <button type="button" disabled={disabled || busy} onClick={onRevoke}>
            {t("Turn off file outputs")}
          </button>
        </p>
      ) : null}
      {state === "applying" ? (
        <p role="status">{t("Waiting for the server…")}</p>
      ) : null}
      {state === "unknown" ? (
        <p>
          {t("The server has not reported this chat's permission yet.")}{" "}
          <button type="button" disabled={busy} onClick={onRefresh}>
            {t("Re-read the server's permission")}
          </button>
        </p>
      ) : null}
    </section>
  );
}
