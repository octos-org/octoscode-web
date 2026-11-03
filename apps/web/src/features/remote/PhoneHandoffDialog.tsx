import { useId, useState } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import { createRemoteHandoffUrl } from "./remote-handoff.ts";
import styles from "./PhoneHandoffAction.module.css";

export function PhoneHandoffDialog({
  endpoint,
  folders,
  onClose,
}: {
  endpoint: string;
  folders: readonly string[];
  onClose: () => void;
}) {
  const t = useUiText();
  const titleId = useId();
  const [{ link, error }] = useState(() => {
    try {
      return {
        link: createRemoteHandoffUrl(window.location.href, endpoint, folders),
        error: false,
      };
    } catch {
      return { link: null, error: true };
    }
  });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">(
    "idle",
  );
  return (
    <>
      <ModalSurface
        backdropClassName="review-backdrop"
        dialogClassName="review-dialog"
        labelledBy={titleId}
        onEscape={onClose}
        closeOnBackdrop
      >
        <div className={styles.content}>
          <h2 id={titleId}>{t("Continue on phone")}</h2>
          {error ? (
            <p role="alert">
              {t(
                "Could not create a phone link. Check the server address and the number of folders.",
              )}
            </p>
          ) : (
            <>
              <p>
                {t(
                  "Open this link on your phone, then enter your server token. The link includes these folder paths, but no token.",
                )}
              </p>
              <ul>
                {folders
                  .filter(Boolean)
                  .filter((path, index, all) => all.indexOf(path) === index)
                  .map((path) => (
                    <li key={path}>{path}</li>
                  ))}
              </ul>
              <textarea
                aria-label={t("Phone link")}
                readOnly
                rows={3}
                value={link!}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link!);
                    setCopyState("copied");
                  } catch {
                    setCopyState("manual");
                  }
                }}
              >
                {t("Copy link")}
              </button>
              <p role="status">
                {copyState === "copied"
                  ? t("Phone link copied.")
                  : copyState === "manual"
                    ? t(
                        "Clipboard unavailable. Select and copy the link below.",
                      )
                    : ""}
              </p>
            </>
          )}
          <button type="button" onClick={onClose}>
            {t("Close")}
          </button>
        </div>
      </ModalSurface>
    </>
  );
}
