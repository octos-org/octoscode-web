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
  const failed = terminal.status === "error";
  const outcome =
    terminal.latestTurnOutcome === "completed"
      ? "complete"
      : failed
        ? "failed"
        : "ended";
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
          t("{count} files changed", { count: summary.changedFiles.length }),
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
        <p className={failed ? styles.error : styles.meta}>
          {t(terminal.body)}
        </p>
      ) : null}
    </section>
  );
}
