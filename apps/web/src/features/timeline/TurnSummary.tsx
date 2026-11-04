import type { TimelineEntry } from "./entry-model.ts";
import { summarizeTurn } from "./turn-summary.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./TurnSummary.module.css";

/**
 * The close of a turn. A turn that completed reads as done: steps that failed
 * and were retried say so quietly, steps that stayed failed are named in red,
 * and only a turn that itself failed is drawn as a warning.
 */
export function TurnSummary({
  turnId,
  entries,
}: {
  turnId: string;
  entries: readonly TimelineEntry[];
}) {
  const t = useUiText();
  const terminal = entries.find((entry) => entry.id === `terminal:${turnId}`);
  if (!terminal) return null;
  const summary = summarizeTurn(entries, turnId);
  const recorded = summary.changedFiles.length + summary.unlistedChanges;
  const failed = terminal.status === "error";
  const outcome =
    terminal.latestTurnOutcome === "completed"
      ? "complete"
      : failed
        ? "failed"
        : "ended";
  const terminalSummary = t(
    terminal.latestTurnOutcome === "interrupted"
      ? "This turn was stopped before it completed."
      : "This turn failed before it completed.",
  );
  const terminalDetail =
    terminal.body !== "This turn was stopped before it completed." &&
    terminal.body !== "This turn failed before it completed."
      ? terminal.body
      : "";
  return (
    <section
      className={`${styles.summary}${failed ? ` ${styles.warning}` : ""}`}
      aria-label={t("Turn summary")}
      data-outcome={outcome}
      data-failed-steps={summary.failedSteps}
      data-retried-steps={summary.retriedSteps}
    >
      <div className={styles.heading}>
        <strong>{t(terminal.title)}</strong>
        {failed ? (
          summary.failedSteps + summary.retriedSteps ? (
            <span className={styles.failure}>
              {t("⚠ {count} steps failed", {
                count: summary.failedSteps + summary.retriedSteps,
              })}
            </span>
          ) : null
        ) : (
          <>
            {summary.retriedSteps ? (
              <span className={styles.retried}>
                {t("Retried automatically {count} times", {
                  count: summary.retriedSteps,
                })}
              </span>
            ) : null}
            {summary.failedSteps ? (
              <span className={styles.failure}>
                {t("{count} steps failed", { count: summary.failedSteps })}
              </span>
            ) : null}
          </>
        )}
      </div>
      <p className={styles.meta}>
        {[
          summary.seconds
            ? t("Duration {seconds}s", { seconds: summary.seconds })
            : null,
          !summary.changesUnknown
            ? t("{count} files changed", { count: recorded })
            : recorded
              ? t("{count} files recorded; other changes not counted", {
                  count: recorded,
                })
              : t("Changes not counted"),
          summary.usage
            ? t("{input} tokens in · {output} tokens out", {
                input: summary.usage.input,
                output: summary.usage.output,
              })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className={styles.outputs}>
        {summary.outputFiles.length
          ? t("Output files: {files}", {
              files: summary.outputFiles.join(", "),
            })
          : t("No output files")}
      </p>
      {terminal.latestTurnOutcome !== "completed" && terminal.body ? (
        <>
          <p className={failed ? styles.error : styles.meta}>
            {terminalSummary}
          </p>
          {terminalDetail ? (
            <details>
              <summary>{t("Technical details")}</summary>
              <p className={failed ? styles.error : styles.meta}>
                {terminalDetail}
              </p>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
