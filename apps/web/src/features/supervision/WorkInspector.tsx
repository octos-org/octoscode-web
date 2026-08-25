import type { ObservedEvent } from "../inspector/EventInspector.tsx";
import { EventInspector } from "../inspector/EventInspector.tsx";
import { taskIsCancellable, type SupervisionRuntimeState } from "./model.ts";

interface WorkInspectorProps {
  state: SupervisionRuntimeState;
  features: readonly string[];
  events: readonly ObservedEvent[];
  onRefresh: () => void;
  onOpenTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
}

export function WorkInspector({
  state,
  features,
  events,
  onRefresh,
  onOpenTask,
  onCancelTask,
}: WorkInspectorProps) {
  const policy = state.runtimeStatus?.runtime_policy_stamp;
  const runtimeRows = [
    ["Model", state.runtimeStatus?.model?.model ?? stringAt(policy, "model")],
    [
      "Profile",
      state.runtimeStatus?.profile_id ?? stringAt(policy, "profile_id"),
    ],
    ["Sandbox", state.runtimeStatus?.sandbox ?? stringAt(policy, "sandbox")],
    ["Network", state.runtimeStatus?.network ?? stringAt(policy, "network")],
    [
      "Approvals",
      state.runtimeStatus?.approval_policy ??
        stringAt(policy, "approval_policy"),
    ],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <aside className="inspector work-inspector">
      <section>
        <div className="section-heading compact-heading">
          <div>
            <span className="eyebrow">Runtime truth</span>
            <h2>Session</h2>
          </div>
          <button
            className="inspector-refresh"
            type="button"
            onClick={onRefresh}
          >
            {state.loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {runtimeRows.length ? (
          <dl className="runtime-facts">
            {runtimeRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">
            {state.statusAvailable
              ? "Runtime status has not loaded yet."
              : "session/status/read is not advertised."}
          </p>
        )}
      </section>

      <section className="work-section">
        <div className="section-heading compact-heading">
          <div>
            <span className="eyebrow">Current turn</span>
            <h2>Plan</h2>
          </div>
          <span className="count-badge">{state.plan?.items.length ?? 0}</span>
        </div>
        {state.plan?.items.length ? (
          <ol className="plan-list">
            {state.plan.items.map((item) => (
              <li className={`plan-${item.status}`} key={item.id}>
                <span>{planMark(item.status)}</span>
                <strong>{item.title}</strong>
                {item.priority ? <em>{item.priority}</em> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No model-authored plan is active.</p>
        )}
      </section>

      <section className="work-section">
        <div className="section-heading compact-heading">
          <div>
            <span className="eyebrow">Supervised</span>
            <h2>Tasks</h2>
          </div>
          <span className="count-badge">{state.tasks.length}</span>
        </div>
        {state.error ? (
          <p className="inspector-error" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.tasks.length ? (
          <div className="task-list">
            {state.tasks.map((task) => (
              <article className="task-card" key={task.id}>
                <button type="button" onClick={() => onOpenTask(task.id)}>
                  <span className={`task-state state-${task.state}`} />
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.role ?? task.toolName} · {task.status}
                    </small>
                  </span>
                  {task.artifactCount ? <em>{task.artifactCount}</em> : null}
                </button>
                {state.cancelAvailable && taskIsCancellable(task) ? (
                  <button
                    className="task-cancel"
                    type="button"
                    aria-label={`Cancel ${task.title}`}
                    onClick={() => onCancelTask(task.id)}
                  >
                    ×
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">
            {state.available
              ? "No background tasks in this session."
              : "Task supervision is not advertised."}
          </p>
        )}
      </section>

      <details className="wire-disclosure">
        <summary>Protocol diagnostics · {events.length}</summary>
        <EventInspector embedded events={events} features={features} />
      </details>
    </aside>
  );
}

function stringAt(value: Record<string, unknown> | undefined, key: string) {
  const candidate = value?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function planMark(status: string) {
  if (status === "completed") return "✓";
  if (status === "in_progress") return "●";
  return "○";
}
