import { useSyncExternalStore } from "react";
import { FileIcon } from "../../ui/Icon.tsx";
import { CloseIcon } from "../../ui/ShellIcons.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  attachmentNameParts,
  formatAttachmentSize,
} from "../timeline/attachments.ts";
import type {
  AttachmentDraft,
  AttachmentDraftStore,
} from "./attachment-drafts.ts";
import styles from "./AttachmentTray.module.css";

/** What this Session's next message carries, inside the composer. */
export function AttachmentTray({
  store,
  onRetry,
  onRemoved,
}: {
  store: AttachmentDraftStore;
  onRetry: () => void;
  onRemoved: () => void;
}) {
  const t = useUiText();
  const { entries } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  if (!entries.length) return null;
  return (
    <ul className={styles.tray} aria-label={t("Attached files")}>
      {entries.map((entry) => (
        <TrayItem
          key={entry.id}
          entry={entry}
          onRetry={onRetry}
          onRemove={() => {
            store.remove(entry.id);
            onRemoved();
          }}
        />
      ))}
    </ul>
  );
}

function TrayItem({
  entry,
  onRetry,
  onRemove,
}: {
  entry: AttachmentDraft;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const t = useUiText();
  const { stem, extension } = attachmentNameParts(entry.name);
  const stalled = entry.status === "selected" || entry.status === "error";
  return (
    <li className={styles.item} data-status={entry.status} title={entry.name}>
      <FileIcon className={styles.icon} />
      <span className={styles.name} translate="no">
        <span className={styles.stem}>{stem}</span>
        {extension ? <span>{extension}</span> : null}
      </span>
      <span className={styles.status} role="status">
        {entry.status === "uploading"
          ? t("Uploading…")
          : entry.status === "error"
            ? t("Upload failed")
            : entry.status === "selected"
              ? t("Not uploaded")
              : formatAttachmentSize(entry.bytes)}
      </span>
      {stalled ? (
        <button
          type="button"
          className={styles.retry}
          aria-label={t("Retry uploading {name}", { name: entry.name })}
          onClick={onRetry}
        >
          {t("Retry")}
        </button>
      ) : null}
      <button
        type="button"
        className={styles.remove}
        aria-label={t("Remove {name}", { name: entry.name })}
        title={t("Remove {name}", { name: entry.name })}
        onClick={onRemove}
      >
        <CloseIcon />
      </button>
    </li>
  );
}
