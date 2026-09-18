import { useId, useState } from "react";
import type { PlanUpdated } from "@octos-org/octoscode-client/protocol";
import {
  planHeadline,
  planProgress,
  planStatusLabel,
  planUpdatedLabel,
} from "./plan.ts";
import styles from "./PlanCard.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

/**
 * The agent's live checklist, pinned above the composer while its turn runs.
 *
 * Collapsed by default once nothing is in progress, so a finished plan never
 * costs composer room. The summary line is the live region: assistive tech
 * hears "3 of 5 done · Running the checks", not a re-read of every row.
 */
export function PlanCard({
  plan,
  now = Date.now(),
}: {
  plan: PlanUpdated;
  now?: number;
}) {
  const t = useUiText();
  const listId = useId();
  const titleId = useId();
  const progress = planProgress(plan.items);
  const [collapsed, setCollapsed] = useState(false);
  const headline = planHeadline(plan);
  const updated = planUpdatedLabel(plan.updatedAtMs, now);
  const summary = t("{done} of {total} done", {
    done: progress.completed,
    total: progress.total,
  });

  return (
    <section
      className={styles.card}
      aria-labelledby={titleId}
      data-plan-card="true"
    >
      <h2 className={styles.heading}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={() => setCollapsed((current) => !current)}
        >
          <span className={styles.chevron} aria-hidden="true">
            {collapsed ? "▸" : "▾"}
          </span>
          <span className={styles.title} id={titleId}>
            {headline ?? t("Plan")}
          </span>
          <span className={styles.summary}>{summary}</span>
        </button>
      </h2>
      {/* One short announcement per replacement; the list itself is not live. */}
      <p className={styles.announcement} role="status" aria-live="polite">
        {t("Plan: {summary}", { summary })}
      </p>
      <ol className={styles.items} id={listId} hidden={collapsed}>
        {plan.items.map((item) => (
          <li
            key={item.id}
            className={styles.item}
            data-plan-item-status={item.status}
          >
            <span className={styles.mark} aria-hidden="true" />
            <span className={styles.itemTitle}>{item.title}</span>
            {item.priority ? (
              <span className={styles.priority}>{item.priority}</span>
            ) : null}
            <span className={styles.status}>
              {t(planStatusLabel(item.status))}
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.updated} hidden={collapsed}>
        {t(updated.source, updated.params)}
      </p>
    </section>
  );
}
