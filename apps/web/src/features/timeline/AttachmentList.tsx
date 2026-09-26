import { useContext, useEffect, useRef, useState } from "react";
import {
  AttachmentAccessContext,
  type AttachmentAccess,
} from "./attachment-access.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import { errorMessage } from "../../shared/errors.ts";
import { attachmentName, isPreviewableImage } from "./attachments.ts";
import styles from "./AttachmentList.module.css";

/** A message's delivered files: name, download, and an image preview. */
export function AttachmentList({ media }: { media: readonly string[] }) {
  const t = useUiText();
  const access = useContext(AttachmentAccessContext);
  return (
    <ul className={styles.attachments} aria-label={t("Attachments")}>
      {media.map((reference, index) => (
        <AttachmentItem
          key={`${index}:${reference}`}
          reference={reference}
          access={access}
        />
      ))}
    </ul>
  );
}

function AttachmentItem({
  reference,
  access,
}: {
  reference: string;
  access: AttachmentAccess | null;
}) {
  const t = useUiText();
  const name = attachmentName(reference);
  const image = isPreviewableImage(name);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const itemRef = useRef<HTMLLIElement>(null);

  // Load an image preview once it scrolls near the viewport, so a long
  // transcript does not fetch every delivered image up front.
  useEffect(() => {
    if (!image || !access) return;
    const abort = new AbortController();
    let url: string | null = null;
    const load = () => {
      access.download(reference, abort.signal).then(
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
      const url = URL.createObjectURL(await access.download(reference));
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
      className={styles.attachment}
      data-attachment={name}
      title={reference}
    >
      {preview ? (
        <img className={styles.preview} src={preview} alt={name} />
      ) : null}
      <div className={styles.row}>
        <span className={styles.name}>{name}</span>
        <button
          type="button"
          className={styles.download}
          disabled={!access || busy}
          aria-label={t("Download {name}", { name })}
          onClick={() => void download()}
        >
          {busy ? t("Downloading…") : t("Download")}
        </button>
      </div>
      {error ? (
        <p className={styles.error} role="status" title={error}>
          {t("This file could not be loaded.")}
        </p>
      ) : null}
    </li>
  );
}
