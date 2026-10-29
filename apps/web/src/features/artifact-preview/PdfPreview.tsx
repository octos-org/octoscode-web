import { useEffect, useRef, useState } from "react";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./PdfPreview.module.css";

const MAX_CANVAS_PIXELS = 4_000_000;
const MAX_CANVAS_EDGE = 2_048;

export function PdfPreview({ blob, name }: { blob: Blob; name: string }) {
  const t = useUiText();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageText, setPageText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    let current = true;
    let task: PDFDocumentLoadingTask | undefined;
    let port: Worker | undefined;
    setRendering(true);
    setError(null);
    setPageNumber(1);
    void Promise.all([blob.arrayBuffer(), import("pdfjs-dist")]).then(
      ([buffer, pdfjs]) => {
        if (!current) return;
        port = new PdfWorker();
        const worker = pdfjs.PDFWorker.create({ port });
        task = pdfjs.getDocument({
          data: new Uint8Array(buffer),
          worker,
          useWasm: false,
          disableFontFace: true,
          maxImageSize: 16_777_216,
        });
        void task.promise.then(
          (value) => {
            if (!current) {
              void task?.destroy();
              return;
            }
            setDocument(value);
            setPageCount(value.numPages);
          },
          (reason: unknown) => {
            if (current) {
              setError(errorMessage(reason));
              setRendering(false);
            }
          },
        );
      },
      (reason: unknown) => {
        if (current) {
          setError(errorMessage(reason));
          setRendering(false);
        }
      },
    );
    return () => {
      current = false;
      if (task) void task.destroy();
      port?.terminate();
    };
  }, [blob]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let current = true;
    let cancel: (() => void) | undefined;
    setRendering(true);
    setError(null);
    void document.getPage(pageNumber).then(
      (page) => {
        if (!current || !canvasRef.current) {
          page.cleanup();
          return;
        }
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          1.5,
          MAX_CANVAS_EDGE / base.width,
          MAX_CANVAS_EDGE / base.height,
          Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)),
        );
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is unavailable");
        const task = page.render({ canvas, canvasContext: context, viewport });
        cancel = () => task.cancel();
        void Promise.all([task.promise, page.getTextContent()]).then(
          ([, text]) => {
            if (!current) return;
            setPageText(
              text.items
                .map((item) => ("str" in item ? item.str : ""))
                .join(" "),
            );
            setRendering(false);
            page.cleanup();
          },
          (reason: unknown) => {
            if (current) {
              setError(errorMessage(reason));
              setRendering(false);
            }
          },
        );
      },
      (reason: unknown) => {
        if (current) {
          setError(errorMessage(reason));
          setRendering(false);
        }
      },
    );
    return () => {
      current = false;
      cancel?.();
    };
  }, [document, pageNumber]);

  return (
    <div className={styles.pdf} aria-busy={rendering}>
      {pageCount > 1 ? (
        <div className={styles.toolbar}>
          <button
            type="button"
            disabled={pageNumber <= 1 || rendering}
            onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
          >
            {t("Previous page")}
          </button>
          <label>
            {t("Page")}
            <input
              type="number"
              name="page"
              autoComplete="off"
              min={1}
              max={pageCount}
              value={pageNumber}
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isSafeInteger(value)) {
                  setPageNumber(Math.min(pageCount, Math.max(1, value)));
                }
              }}
            />
            <span aria-live="polite">
              {t("of {count}", { count: pageCount })}
            </span>
          </label>
          <button
            type="button"
            disabled={pageNumber >= pageCount || rendering}
            onClick={() =>
              setPageNumber((value) => Math.min(pageCount, value + 1))
            }
          >
            {t("Next page")}
          </button>
        </div>
      ) : null}
      {error ? (
        <div className={styles.error} role="alert" title={error}>
          {t(
            "The PDF couldn't be rendered. Download it to open it in another app.",
          )}
        </div>
      ) : null}
      <div className={styles.canvasPage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label={t("Page {page} of {name}", { page: pageNumber, name })}
        />
      </div>
      {pageText ? (
        <details className={styles.textAlternative}>
          <summary>{t("Page text")}</summary>
          <pre>{pageText}</pre>
        </details>
      ) : null}
    </div>
  );
}
