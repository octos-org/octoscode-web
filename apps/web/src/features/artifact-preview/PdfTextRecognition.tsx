import { useEffect, useRef, useState } from "react";
import { useUiLanguage, useUiText } from "../preferences/ui-text.tsx";
import {
  OcrError,
  ocrReading,
  type OcrFailure,
  type OcrLanguage,
  type OcrPhase,
  type OcrResult,
  type PdfOcr,
} from "./pdf-ocr.ts";
import styles from "./PdfPreview.module.css";

type Run =
  | { state: "idle" }
  | { state: "running"; phase: OcrPhase; progress: number }
  | { state: "done"; result: OcrResult }
  | { state: "failed"; failure: OcrFailure };

const FAILURES: Record<OcrFailure, string> = {
  unavailable: "Text recognition isn't available on this server.",
  timeout: "Text recognition took too long and was stopped.",
  failed: "Text recognition failed.",
  cancelled: "Text recognition was cancelled.",
};

/**
 * Local OCR for a page without a text layer, only when asked: the page is
 * rendered and read in this browser, and the result lives only as long as the
 * open file (T-0568).
 */
export function PdfTextRecognition({
  pageNumber,
  renderPage,
  ocr,
  results,
}: {
  pageNumber: number;
  /** The current page as a PNG at the preview's pixel cap. */
  renderPage: (signal: AbortSignal) => Promise<Blob>;
  ocr: PdfOcr;
  results: Map<string, OcrResult>;
}) {
  const t = useUiText();
  const uiLanguage = useUiLanguage();
  const [language, setLanguage] = useState<OcrLanguage>(
    uiLanguage === "zh" ? "chi_sim+eng" : "eng",
  );
  const key = `${pageNumber}:${language}`;
  const [run, setRun] = useState<Run>({ state: "idle" });
  const running = useRef<AbortController | undefined>(undefined);

  // Another page or language shows what is known for it and stops a run.
  useEffect(() => {
    const known = results.get(key);
    setRun(known ? { state: "done", result: known } : { state: "idle" });
    return () => {
      running.current?.abort();
      running.current = undefined;
    };
  }, [key, results]);

  const start = () => {
    const controller = new AbortController();
    running.current = controller;
    const current = () => running.current === controller;
    setRun({ state: "running", phase: "preparing", progress: 0 });
    void renderPage(controller.signal)
      .then((image) =>
        ocr.recognize(
          image,
          language,
          (phase, progress) => {
            if (current()) setRun({ state: "running", phase, progress });
          },
          controller.signal,
        ),
      )
      .then(
        (result) => {
          results.set(key, result);
          if (current()) setRun({ state: "done", result });
        },
        (error: unknown) => {
          if (current())
            setRun({
              state: "failed",
              failure: error instanceof OcrError ? error.failure : "failed",
            });
        },
      )
      .finally(() => {
        if (current()) running.current = undefined;
      });
  };
  const cancel = () => {
    running.current?.abort();
    running.current = undefined;
    setRun({ state: "failed", failure: "cancelled" });
  };

  if (run.state === "running") {
    return (
      <div className={styles.recognition}>
        <p role="status">
          {run.phase === "preparing"
            ? t("Loading the text recognizer…")
            : t("Recognizing page {page}… {percent}%", {
                page: pageNumber,
                percent: Math.round(run.progress * 100),
              })}
        </p>
        <div className={styles.recognitionControls}>
          <progress
            aria-label={t("Text recognition progress")}
            max={1}
            {...(run.phase === "recognizing" ? { value: run.progress } : {})}
          />
          <button type="button" onClick={cancel}>
            {t("Cancel")}
          </button>
        </div>
      </div>
    );
  }

  const reading = run.state === "done" ? ocrReading(run.result) : null;
  return (
    <div className={styles.recognition}>
      {run.state === "done" && reading !== "unreadable" ? (
        <>
          <p
            role="status"
            className={reading === "uncertain" ? styles.warn : undefined}
          >
            {reading === "uncertain"
              ? t(
                  "Low confidence ({confidence}%). Check this text against the page.",
                  { confidence: run.result.confidence },
                )
              : t(
                  "Text recognized on page {page} in this browser ({confidence}% confidence). It may contain errors.",
                  { page: pageNumber, confidence: run.result.confidence },
                )}
          </p>
          <pre>{run.result.text}</pre>
        </>
      ) : null}
      {run.state === "done" && reading === "unreadable" ? (
        <p role="status">
          {t(
            "No reliable text was recognized on page {page} ({confidence}% confidence). If the page is in another language, choose it and try again.",
            { page: pageNumber, confidence: run.result.confidence },
          )}
        </p>
      ) : null}
      {run.state === "failed" ? (
        <p
          {...(run.failure === "cancelled"
            ? { role: "status" }
            : { role: "alert", className: styles.failure })}
        >
          {t(FAILURES[run.failure])}
        </p>
      ) : null}
      <div className={styles.recognitionControls}>
        <label>
          {t("Language")}
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as OcrLanguage)}
          >
            <option value="eng">{t("English")}</option>
            <option value="chi_sim+eng">{t("Chinese and English")}</option>
          </select>
        </label>
        {run.state === "done" && reading !== "unreadable" ? null : (
          <button type="button" onClick={start}>
            {run.state === "idle"
              ? t("Recognize text on page {page}", { page: pageNumber })
              : t("Try again")}
          </button>
        )}
      </div>
      {run.state === "idle" ? (
        <p className={styles.note}>
          {language === "eng"
            ? t(
                "Runs in this browser; the file isn't uploaded. The first run downloads up to 6 MB.",
              )
            : t(
                "Runs in this browser; the file isn't uploaded. The first run downloads up to 8 MB.",
              )}
        </p>
      ) : null}
    </div>
  );
}
