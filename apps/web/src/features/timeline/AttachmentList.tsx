import { useContext, useEffect, useId, useRef, useState } from "react";
import {
  AttachmentAccessContext,
  type AttachmentAccess,
} from "./attachment-access.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import { errorMessage } from "../../shared/errors.ts";
import { ArtifactPreview } from "../artifact-preview/ArtifactPreview.tsx";
import {
  attachmentName,
  attachmentNameParts,
  formatAttachmentSize,
  isPreviewableImage,
} from "./attachments.ts";
import { FileIcon } from "../../ui/Icon.tsx";
import styles from "./AttachmentList.module.css";

/** A message's delivered files: name, download, and an image preview. */
export function AttachmentList({
  media,
  workspaceFile = false,
}: {
  media: readonly string[];
  workspaceFile?: boolean;
}) {
  const t = useUiText();
  const access = useContext(AttachmentAccessContext);
  return (
    <ul className={styles.attachments} aria-label={t("Attachments")}>
      {media.map((reference, index) => (
        <AttachmentItem
          key={`${index}:${reference}`}
          reference={reference}
          access={access}
          workspaceFile={workspaceFile}
        />
      ))}
    </ul>
  );
}

function AttachmentItem({
  reference,
  access,
  workspaceFile,
}: {
  reference: string;
  access: AttachmentAccess | null;
  workspaceFile: boolean;
}) {
  const t = useUiText();
  const name = attachmentName(reference);
  const nameParts = attachmentNameParts(reference);
  const image = isPreviewableImage(name);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [size, setSize] = useState<string | null>(null);
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const previewId = useId();
  const itemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let current = true;
    setSize(null);
    setSizeBytes(null);
    if (!access?.describe) return;
    access.describe(reference, workspaceFile).then(
      (info) => {
        if (current && info) {
          setSize(formatAttachmentSize(info.sizeBytes));
          setSizeBytes(info.sizeBytes);
        }
      },
      () => {
        // Size is optional metadata; byte preview/download remains authoritative.
      },
    );
    return () => {
      current = false;
    };
  }, [access, reference]);

  // Load an image preview once it scrolls near the viewport, so a long
  // transcript does not fetch every delivered image up front.
  useEffect(() => {
    if (!image || !access) return;
    const abort = new AbortController();
    let url: string | null = null;
    const load = () => {
      (workspaceFile
        ? (access.downloadWorkspaceFile ?? access.download)
        : access.download)(reference, abort.signal).then(
        (blob) => {
          if (abort.signal.aborted) return;
          url = URL.createObjectURL(blob);
          setPreview(url);
        },
        (reason: unknown) => {
          if (!abort.signal.aborted) setError(errorMessage(reason));
        },
      );
    };
    const node = itemRef.current;
    let observer: IntersectionObserver | null = null;
    if (node && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (records) => {
          if (records.some((record) => record.isIntersecting)) {
            observer?.disconnect();
            load();
          }
        },
        { rootMargin: "200px" },
      );
      observer.observe(node);
    } else load();
    return () => {
      observer?.disconnect();
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [access, image, reference]);

  const download = async () => {
    if (!access) return;
    setBusy(true);
    setError(null);
    try {
      const value = workspaceFile
        ? access.saveWorkspaceFile
          ? await access.saveWorkspaceFile(reference, sizeBytes ?? undefined)
          : await (access.downloadWorkspaceFile ?? access.download)(reference)
        : await (access.downloadForSave ?? access.download)(reference);
      const url = URL.createObjectURL(value);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.rel = "noopener";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      ref={itemRef}
      className={`${styles.attachment} ${previewOpen ? styles.expanded : ""}`}
      data-attachment={name}
      title={reference}
    >
      {preview && !previewOpen ? (
        <img
          className={styles.preview}
          src={preview}
          alt={name}
          width={1200}
          height={900}
        />
      ) : null}
      <div className={styles.row}>
        <FileIcon className={styles.fileIcon} />
        <span className={styles.name} translate="no">
          <span className={styles.nameStem}>{nameParts.stem}</span>
          {nameParts.extension ? (
            <span className={styles.nameExtension}>{nameParts.extension}</span>
          ) : null}
        </span>
        {size ? <span className={styles.fileSize}>{size}</span> : null}
        <button
          type="button"
          className={styles.download}
          disabled={
            !access ||
            (workspaceFile
              ? access.previewAvailable === false
              : access.deliveredPreviewAvailable === false)
          }
          aria-expanded={previewOpen}
          aria-controls={previewId}
          onClick={() => setPreviewOpen((value) => !value)}
        >
          {previewOpen ? t("Hide preview") : t("Preview")}
        </button>
        <button
          type="button"
          className={styles.download}
          disabled={
            !access ||
            busy ||
            (workspaceFile &&
              sizeBytes !== null &&
              sizeBytes > 32 * 1024 * 1024)
          }
          aria-label={t("Download {name}", { name })}
          onClick={() => void download()}
        >
          {busy ? t("Downloading…") : t("Download")}
        </button>
      </div>
      {previewOpen &&
      access &&
      (workspaceFile
        ? access.previewAvailable !== false
        : access.deliveredPreviewAvailable !== false) ? (
        <div id={previewId} className={styles.previewPanel}>
          <ArtifactPreview
            name={name}
            path={reference}
            {...(sizeBytes === null ? {} : { sizeBytes })}
            loadBlob={(signal) =>
              (workspaceFile
                ? (access.downloadWorkspaceFile ?? access.download)
                : access.download)(reference, signal)
            }
            {...(workspaceFile
              ? {
                  downloadBlob: (signal: AbortSignal | undefined) =>
                    access.saveWorkspaceFile
                      ? access.saveWorkspaceFile(
                          reference,
                          sizeBytes ?? undefined,
                          signal,
                        )
                      : (access.downloadWorkspaceFile ?? access.download)(
                          reference,
                          signal,
                        ),
                }
              : access.downloadForSave
                ? {
                    downloadBlob: (signal: AbortSignal | undefined) =>
                      access.downloadForSave!(reference, signal),
                  }
                : {})}
          />
        </div>
      ) : null}
      {error ? (
        <p className={styles.error} role="status" title={error}>
          {t("This file could not be loaded.")}
        </p>
      ) : null}
    </li>
  );
}
