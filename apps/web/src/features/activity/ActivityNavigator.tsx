import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildWorkspaceActivityModel,
  type ActivityFilter,
  type WorkspaceProductState,
} from "../workspace/model.ts";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { useUiText } from "../preferences/ui-text.tsx";

interface ActivityNavigatorProps {
  open: boolean;
  state: WorkspaceProductState;
  activeSessionId: string | null;
  switchBlocked: boolean;
  inspectAvailable?: boolean;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onInspectCurrentTask: (taskId: string) => void;
}

const FILTERS: ActivityFilter[] = ["all", "running", "failed", "done"];

export function ActivityNavigator({
  open,
  state,
  activeSessionId,
  switchBlocked,
  inspectAvailable = false,
  onClose,
  onOpenSession,
  onInspectCurrentTask,
}: ActivityNavigatorProps) {
  const t = useUiText();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setFilter("all");
  }, [open]);
  const model = useMemo(
    () => buildWorkspaceActivityModel(state, query, filter),
    [filter, query, state],
  );
  if (!open) return null;

  return (
    <ModalSurface
      backdropClassName="activity-backdrop"
      dialogClassName={`activity-dialog${switchBlocked ? " has-warning" : ""}`}
      labelledBy="activity-title"
      initialFocusRef={searchRef}
      closeOnBackdrop
      onEscape={onClose}
    >
      <header className="activity-header">
        <div>
          <span className="eyebrow">{t("Across recent sessions")}</span>
          <h2 id="activity-title">{t("Activity")}</h2>
          <p>{t("Server-owned tasks; no session is opened by this scan.")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("Close activity")}
        >
          ×
        </button>
      </header>

      <div className="activity-toolbar">
        <label>
          <span className="sr-only">{t("Search activity")}</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search session, task, role, or status…")}
          />
        </label>
        <div className="activity-filters" aria-label={t("Activity status")}>
          {FILTERS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={filter === candidate}
              onClick={() => setFilter(candidate)}
            >
              {t(candidate)} <span>{model.counts[candidate]}</span>
            </button>
          ))}
        </div>
      </div>

      {switchBlocked ? (
        <p className="activity-warning" role="status">
          {t("Finish the workspace transition before opening another session.")}
        </p>
      ) : null}

      <div className="activity-results">
        {!state.activityAvailable ? (
          <p role="status">
            {t("This server does not advertise task snapshots.")}
          </p>
        ) : null}
        {state.error ? <p role="status">{state.error}</p> : null}
        {model.rows.map((row) => {
          const current = row.sessionId === activeSessionId;
          return (
            <article key={`${row.sessionId}:${row.taskId}`}>
              <span
                className={`activity-state state-${row.state}`}
                role="img"
                aria-label={t(row.state)}
              />
              <div>
                <strong>{row.title}</strong>
                <span>{row.sessionTitle}</span>
                <small>
                  {row.detail || row.taskId}
                  {row.updatedAt
                    ? ` · ${formatActivityTime(row.updatedAt)}`
                    : ""}
                </small>
              </div>
              <button
                type="button"
                disabled={current ? !inspectAvailable : switchBlocked}
                title={
                  current && !inspectAvailable
                    ? t("Task details are unavailable on this connection")
                    : undefined
                }
                aria-label={
                  current
                    ? t("Inspect {value0}", { value0: String(row.title) })
                    : t("Open {value0}", { value0: String(row.sessionTitle) })
                }
                onClick={() => {
                  if (current) onInspectCurrentTask(row.taskId);
                  else onOpenSession(row.sessionId);
                  onClose();
                }}
              >
                {current ? t("Inspect") : t("Open session")}
              </button>
            </article>
          );
        })}
        {model.rows.length === 0 ? (
          <div className="activity-empty">
            <strong>{t("No matching activity")}</strong>
            <span>
              {query.trim()
                ? t("No {value0} task matches “{value1}”.", {
                    value0: String(filter),
                    value1: String(query.trim()),
                  })
                : filter === "all"
                  ? t("No task snapshots are available yet.")
                  : t("No {value0} tasks are available.", {
                      value0: String(filter),
                    })}
            </span>
          </div>
        ) : null}
      </div>

      <footer className="activity-footer">
        <span>
          {state.activityLoading
            ? t("Refreshing task snapshots…")
            : state.activityAvailable
              ? t("Read-only · refreshes every 10 seconds")
              : t("Read-only · snapshots unavailable")}
        </span>
        <span>{t("Esc closes")}</span>
      </footer>
    </ModalSurface>
  );
}

function formatActivityTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
