import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import { isPreviewableImage } from "../timeline/attachments.ts";
import styles from "./SessionPanelTabs.module.css";

/**
 * Integration point for T-0012's ArtifactPreview, which takes the same props
 * (`name`, `path`, `loadBlob`) and adds PDF, Office and HTML. Until it lands
 * this shows what the app could already show: raster images and plain text.
 */
export interface FilePreviewProps {
  name: string;
  path?: string;
  loadBlob: (signal?: AbortSignal) => Promise<Blob>;
}

const TEXT_NAME =
  /\.(md|markdown|txt|csv|tsv|json|jsonl|ya?ml|toml|xml|html?|css|log|ini|sh|py|rs|go|java|kt|rb|php|c|h|cc|cpp|hpp|cs|swift|m|sql|ts|tsx|js|jsx|mjs|cjs)$/i;
const MAX_TEXT_BYTES = 1024 * 1024;

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "image"; url: string; blob: Blob }
  | { kind: "text"; text: string; blob: Blob }
  | { kind: "other"; blob: Blob };

export function FilePreview({ name, path, loadBlob }: FilePreviewProps) {
  const t = useUiText();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  // Callers pass a fresh closure each render; load once per file, not per render.
  const loadRef = useRef(loadBlob);
  loadRef.current = loadBlob;

  useEffect(() => {
    const abort = new AbortController();
    let url: string | null = null;
    setLoaded({ kind: "loading" });
    loadRef.current(abort.signal).then(
      async (blob) => {
        if (abort.signal.aborted) return;
        if (isPreviewableImage(name)) {
          url = URL.createObjectURL(blob);
          setLoaded({ kind: "image", url, blob });
        } else if (
          (TEXT_NAME.test(name) || blob.type.startsWith("text/")) &&
          blob.size <= MAX_TEXT_BYTES
        ) {
          const text = await blob.text();
          if (!abort.signal.aborted) setLoaded({ kind: "text", text, blob });
        } else setLoaded({ kind: "other", blob });
      },
      (reason: unknown) => {
        if (!abort.signal.aborted)
          setLoaded({ kind: "error", message: errorMessage(reason) });
      },
    );
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [name, path, retry]);

  const download = () => {
    if (!("blob" in loaded)) return;
    const url = URL.createObjectURL(loaded.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className={styles.preview}>
      {loaded.kind === "loading" ? (
        <p className={styles.empty} role="status">
          {t("Loading preview…")}
        </p>
      ) : loaded.kind === "error" ? (
        <div className={styles.empty} role="alert">
          <p>
            {t("Couldn't load this file: {reason}", { reason: loaded.message })}
          </p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            {t("Try again")}
          </button>
        </div>
      ) : loaded.kind === "image" ? (
        <img className={styles.previewImage} src={loaded.url} alt={name} />
      ) : loaded.kind === "text" ? (
        <pre className={styles.previewText} tabIndex={0}>
          {loaded.text}
        </pre>
      ) : (
        <p className={styles.empty}>
          {t("No preview for this kind of file yet. Download it to open it.")}
        </p>
      )}
      {"blob" in loaded ? (
        <button type="button" className={styles.action} onClick={download}>
          {t("Download")}
        </button>
      ) : null}
    </div>
  );
}
