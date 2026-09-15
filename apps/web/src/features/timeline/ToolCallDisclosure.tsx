import { useId } from "react";
import type { TimelineEntry } from "./model.ts";
import { toolHeaderLine } from "./folds.ts";
import styles from "./TimelineFolds.module.css";

export interface ToolCallDisclosureProps {
  entry: TimelineEntry;
  expanded: boolean;
  onToggle: () => void;
}

/** One tool call: header line always visible, arguments/output behind disclosure. */
export function ToolCallDisclosure({
  entry,
  expanded,
  onToggle,
}: ToolCallDisclosureProps) {
  const bodyId = useId();
  const header = toolHeaderLine({
    title: entry.title,
    body: entry.body,
    status: entry.status,
    startedAtMs: entry.startedAtMs,
    endedAtMs: entry.endedAtMs,
  });
  return (
    <div className="entry-content">
      <button
        type="button"
        className={styles.foldHeaderButton}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span
          className={`${styles.foldChevron}${expanded ? ` ${styles.foldChevronOpen}` : ""}`}
          aria-hidden="true"
        >
          ›
        </span>
        <span className={styles.foldSummary}>{header}</span>
      </button>
      {expanded ? (
        <pre id={bodyId} className={styles.foldBody}>
          {entry.body}
        </pre>
      ) : null}
    </div>
  );
}