import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import {
  AttachmentDraftStore,
  IMAGE_ACCEPT,
  MAX_TURN_IMAGES,
} from "./attachment-drafts.ts";
import styles from "./AttachmentsDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

/** Candidate only: root mounts keyed by the owning store's full authority. */
export function AttachmentsDialog({
  store,
  onClose,
}: {
  store: AttachmentDraftStore;
  onClose(): void;
}) {
  const t = useUiText();
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const titleId = useId();
  const descriptionId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(
    () => () => {
      store.cancelUploads();
    },
    [store],
  );
  const close = () => {
    store.cancelUploads();
    onClose();
  };
  const uploadable = state.entries.some(
    (entry) => entry.status === "selected" || entry.status === "error",
  );
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy={titleId}
      describedBy={descriptionId}
      onEscape={close}
    >
      <header className={styles.header}>
        <h2 id={titleId}>{t("Turn images")}</h2>
        <button type="button" onClick={close}>
          {state.uploading ? t("Cancel uploads and close") : t("Close images")}
        </button>
      </header>
      <p id={descriptionId}>
        {t(
          "Choose up to four PNG, JPEG, GIF or WebP images, at most 20 MiB each. Selecting a file does not upload it. Upload explicitly to the server, then send it with this Session’s next prompt. Image understanding depends on the selected server model.",
        )}
      </p>
      <p className={styles.scope}>
        {t("Profile:") + " "}
        {store.scope.profileId}
        {" " + t("· Session:") + " "}
        {store.scope.sessionId}
      </p>
      <p>
        {t(
          "Closing cancels pending transfers and keeps local draft selections. Removing a draft does not delete an uploaded server file. A canceled transfer may already have reached the server.",
        )}
      </p>
      {state.disposed ? (
        <p role="alert">
          {t(
            "This Session authority is no longer current. Reopen images from the current Session.",
          )}
        </p>
      ) : null}
      {!store.uploadAvailable ? (
        <p role="status">
          {t("Image uploads are not advertised by this server.")}
        </p>
      ) : null}
      {selectionError ? <p role="alert">{selectionError}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {store.uploadAvailable ? (
        <label className={styles.picker}>
          {t("Choose image files")}
          <input
            ref={picker}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            disabled={
              state.disposed ||
              state.uploading ||
              state.entries.length >= MAX_TURN_IMAGES
            }
            onChange={(event) => {
              setSelectionError(null);
              setNotice(null);
              try {
                store.selectFiles(Array.from(event.target.files ?? []));
              } catch (error) {
                setSelectionError(
                  error instanceof Error
                    ? error.message
                    : "Could not select these images.",
                );
              }
              event.target.value = "";
            }}
          />
        </label>
      ) : null}
      <p aria-live="polite">
        {state.entries.length}
        {" " + t("of") + " "}
        {MAX_TURN_IMAGES}
        {" " + t("image slots used")}
      </p>
      <ul className={styles.entries} aria-label={t("Selected images")}>
        {state.entries.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.name}</strong>
            <span>
              {(entry.bytes / (1024 * 1024)).toFixed(2)}
              {" " + t("MiB ·") + " "}
              {entry.mime}
            </span>
            <span role="status">
              {entry.status === "ready"
                ? t("Uploaded; ready for this turn")
                : entry.status === "uploading"
                  ? t("Uploading…")
                  : entry.status === "error"
                    ? t("Upload not confirmed")
                    : t("Selected; not uploaded")}
            </span>
            {entry.error ? <p role="alert">{entry.error}</p> : null}
            <button
              type="button"
              onClick={() => store.remove(entry.id)}
              aria-label={t("Remove image {value0}", {
                value0: String(entry.name),
              })}
            >
              {t("Remove")}
            </button>
          </li>
        ))}
      </ul>
      <footer className={styles.actions}>
        {store.uploadAvailable ? (
          <button
            type="button"
            disabled={state.disposed || state.uploading || !uploadable}
            onClick={() => {
              setNotice(null);
              setSelectionError(null);
              void store
                .uploadSelected()
                .catch(() =>
                  setSelectionError(
                    "This Session cannot upload images now. Reopen images from its current authority.",
                  ),
                );
            }}
          >
            {t("Upload selected images")}
          </button>
        ) : null}
        {state.uploading ? (
          <button
            type="button"
            onClick={() => {
              store.cancelUploads();
              setNotice(
                "Transfers canceled locally. No server files were deleted.",
              );
            }}
          >
            {t("Cancel uploads")}
          </button>
        ) : null}
      </footer>
    </ModalSurface>
  );
}
