import { useEffect, useState } from "react";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import { sandboxDocument } from "./sandbox-document.ts";
import { sanitizeSandboxMarkup } from "./sandbox-markup.ts";
import styles from "./ArtifactPreview.module.css";

export function SandboxPreview({
  blob,
  name,
  svg,
}: {
  blob: Blob;
  name: string;
  svg: boolean;
}) {
  const t = useUiText();
  const [document, setDocument] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setDocument(undefined);
    setError(null);
    void blob.text().then(
      (source) => {
        if (current) {
          setDocument(
            sandboxDocument(
              sanitizeSandboxMarkup(source, svg ? "svg" : "html"),
            ),
          );
        }
      },
      (reason: unknown) => {
        if (current) setError(errorMessage(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [blob, svg]);
  if (error) {
    return (
      <div className={styles.message} role="alert" title={error}>
        {t("This preview could not be loaded. Try again or download the file.")}
      </div>
    );
  }
  return document ? (
    <iframe
      className={styles.sandbox}
      title={t("Sandboxed preview of {name}", { name })}
      srcDoc={document}
      sandbox=""
      referrerPolicy="no-referrer"
    />
  ) : (
    <div className={styles.message} role="status">
      {t("Loading preview…")}
    </div>
  );
}
