import type { PlanUpdated } from "@octos-org/octoscode-client/protocol";
import { CheckIcon } from "../../ui/Icon.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  planHeadline,
  planProgress,
  planStatusLabel,
} from "../supervision/plan.ts";
import type { SupervisedTask } from "../supervision/model.ts";
import styles from "./SessionPanelTabs.module.css";

export interface OverviewTabProps {
  planAvailable: boolean;
  /** The live plan, while its turn runs. */
  plan: PlanUpdated | null;
  /** The last plan this view saw, after its turn ended. */
  finishedPlan: PlanUpdated | null;
  taskListAvailable: boolean;
  tasks: readonly SupervisedTask[];
  onOpenTask?: ((taskId: string) => void) | undefined;
}

/** The plan and its progress, then background work; both update live. */
export function OverviewTab(props: OverviewTabProps) {
  const t = useUiText();
  const plan = props.plan ?? props.finishedPlan;
  const progress = plan ? planProgress(plan.items) : null;
  return (
    <div className={styles.stack}>
      <section className={styles.section} aria-labelledby="overview-plan">
        <div className={styles.sectionTitle}>
          <h3 id="overview-plan">{t("Plan")}</h3>
          {progress ? (
            <span>
              {/* An ended plan nobody ticked counts its items, not "0 done". */}
              {!props.plan && progress.completed === 0
                ? t("{count} plan items", { count: progress.total })
                : t("{done} of {total} done", {
                    done: progress.completed,
                    total: progress.total,
                  })}
            </span>
          ) : null}
        </div>
        {!props.planAvailable ? (
          <p className={styles.empty}>
            {t("This server doesn't share plans with the Web app.")}
          </p>
        ) : plan && progress ? (
          <>
            <p className={styles.planHeadline}>
              {planHeadline(plan) ??
                t(props.plan ? "Working on it" : "Last plan")}
            </p>
            {props.plan ? null : (
              <p className={styles.note}>
                {t("Its turn has ended. A new plan replaces it.")}
              </p>
            )}
            <div className={styles.meter} aria-hidden="true">
              {plan.items.map((item) => (
                <span key={item.id} data-status={item.status} />
              ))}
            </div>
            <ol className={styles.steps}>
              {plan.items.map((item) => (
                <li key={item.id} data-status={item.status}>
                  <span className={styles.stepMark} aria-hidden="true">
                    {item.status === "completed" ? (
                      <CheckIcon size={12} />
                    ) : null}
                  </span>
                  <span className={styles.stepTitle}>{item.title}</span>
                  <span className="sr-only">
                    {", "}
                    {t(planStatusLabel(item.status))}
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className={styles.empty}>
            {t(
              "No plan yet. When Octos plans a task, its steps and progress show here.",
            )}
          </p>
        )}
      </section>

      {props.taskListAvailable ? (
        <section className={styles.section} aria-labelledby="overview-tasks">
          <div className={styles.sectionTitle}>
            <h3 id="overview-tasks">{t("Background tasks")}</h3>
            <span>{props.tasks.length}</span>
          </div>
          {props.tasks.length ? (
            <ul className={styles.rows}>
              {props.tasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    className={styles.row}
                    disabled={!props.onOpenTask}
                    onClick={() => props.onOpenTask?.(task.id)}
                  >
                    <span
                      className={styles.taskState}
                      data-state={task.state}
                      aria-hidden="true"
                    />
                    <span className={styles.rowText}>
                      <strong>{task.title}</strong>
                      <small>{task.status}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              {t("No background tasks in this session.")}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
