import { taskIsCancellable, type SupervisionRuntimeState } from "./model.ts";
import styles from "./SessionTrajectory.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

interface SessionTrajectoryProps {
  state: SupervisionRuntimeState;
  onRefresh: () => void;
  onOpenTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
}

/** Session-local plan and background work; never a cross-workspace Activity hub. */
export function SessionTrajectory({
  state,
  onRefresh,
  onOpenTask,
  onCancelTask,
}: SessionTrajectoryProps) {
  const t = useUiText();
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <h2>{t("Trajectory")}</h2>
          <p>{t("Plan and background work for this session.")}</p>
        </div>
        {state.taskListAvailable || state.statusAvailable ? (
          <button type="button" onClick={onRefresh} disabled={state.loading}>
            {state.loading ? t("Refreshing…") : t("Refresh")}
          </button>
        ) : null}
      </header>

      {state.error ? (
        <div className={styles.error} role="alert">
          {state.error}
        </div>
      ) : null}

      {state.statusAvailable ? (
        <section className={styles.section} aria-labelledby="trajectory-status">
          <div className={styles.sectionTitle}>
            <h3 id="trajectory-status">{t("Session status")}</h3>
          </div>
          {state.runtimeStatus ? (
            <dl className={styles.statusList}>
              <div>
                <dt>{t("Model")}</dt>
                <dd>
                  {state.runtimeStatus.model?.title ??
                    state.runtimeStatus.model?.model ??
                    t("Not reported")}
                </dd>
              </div>
              <div>
                <dt>{t("Permission")}</dt>
                <dd>
                  {state.runtimeStatus.permission_profile ?? t("Not reported")}
                </dd>
              </div>
              <div>
                <dt>{t("Health")}</dt>
                <dd>
                  {state.runtimeStatus.health?.status ?? t("Not reported")}
                </dd>
              </div>
            </dl>
          ) : (
            <p className={styles.empty}>
              {t("Session status has not loaded yet.")}
            </p>
          )}
        </section>
      ) : null}

      {state.planAvailable ? (
        <section className={styles.section} aria-labelledby="trajectory-plan">
          <div className={styles.sectionTitle}>
            <h3 id="trajectory-plan">{t("Plan")}</h3>
            <span>{state.plan?.items.length ?? 0}</span>
          </div>
          {state.plan?.items.length ? (
            <ol className={styles.plan}>
              {state.plan.items.map((item) => (
                <li data-status={item.status} key={item.id}>
                  <span aria-hidden="true">{planMark(item.status)}</span>
                  <strong>{item.title}</strong>
                  {item.priority ? <small>{item.priority}</small> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.empty}>{t("No plan is active.")}</p>
          )}
        </section>
      ) : null}

      {state.taskListAvailable ? (
        <section className={styles.section} aria-labelledby="trajectory-tasks">
          <div className={styles.sectionTitle}>
            <h3 id="trajectory-tasks">{t("Background tasks")}</h3>
            <span>{state.tasks.length}</span>
          </div>
          {state.tasks.length ? (
            <div className={styles.tasks}>
              {state.tasks.map((task) => (
                <article key={task.id}>
                  {state.taskOutputAvailable || state.artifactsAvailable ? (
                    <button
                      type="button"
                      className={styles.taskBody}
                      onClick={() => onOpenTask(task.id)}
                    >
                      <TaskSummary task={task} />
                    </button>
                  ) : (
                    <div className={styles.taskBody}>
                      <TaskSummary task={task} />
                    </div>
                  )}
                  {state.cancelAvailable && taskIsCancellable(task) ? (
                    <button
                      type="button"
                      className={styles.cancel}
                      aria-label={t("Cancel {value0}", {
                        value0: String(task.title),
                      })}
                      onClick={() => onCancelTask(task.id)}
                    >
                      {t("Cancel")}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
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

function TaskSummary({
  task,
}: {
  task: SupervisionRuntimeState["tasks"][number];
}) {
  return (
    <>
      <span
        className={styles.taskState}
        data-state={task.state}
        aria-hidden="true"
      />
      <span>
        <strong>{task.title}</strong>
        <small>{task.status}</small>
      </span>
    </>
  );
}

function planMark(status: string): string {
  if (status === "completed") return "✓";
  if (status === "in_progress") return "●";
  return "○";
}
