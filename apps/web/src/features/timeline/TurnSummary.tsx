import type { TimelineEntry } from "./entry-model.ts";
import { summarizeTurn } from "./turn-summary.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./TurnSummary.module.css";

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
  return (
    <section
      className={`${styles.summary}${summary.failedSteps ? ` ${styles.warning}` : ""}`}
      aria-label={t("Turn summary")}
      data-failed-steps={summary.failedSteps}
    >
      <div className={styles.heading}>
        <strong>{terminal.title}</strong>
        {summary.failedSteps ? (
          <span className={styles.failure}>
            {t("⚠ {count} steps failed", { count: summary.failedSteps })}
          </span>
        ) : null}
      </div>
      <p className={styles.meta}>
        {summary.seconds === undefined
          ? null
          : t("Duration {seconds}s", { seconds: summary.seconds })}
        {summary.seconds === undefined ? "" : " · "}
        {t("{count} files changed", { count: summary.changedFiles.length })}
        {summary.usage
          ? " · " +
            t("{input} tokens in · {output} tokens out", {
              input: summary.usage.input,
              output: summary.usage.output,
            })
          : ""}
      </p>
      <p className={styles.outputs}>
        {summary.outputFiles.length
          ? t("Output files: {files}", {
              files: summary.outputFiles.join(", "),
            })
          : t("No output files")}
      </p>
      {terminal.latestTurnOutcome !== "completed" && terminal.body ? (
        <p className={styles.error}>{terminal.body}</p>
      ) : null}
    </section>
  );
}
