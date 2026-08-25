import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildWorkspaceActivityModel,
  type ActivityFilter,
  type WorkspaceProductState,
} from "../workspace/model.ts";

interface ActivityNavigatorProps {
  open: boolean;
  state: WorkspaceProductState;
  activeSessionId: string | null;
  switchBlocked: boolean;
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
  onClose,
  onOpenSession,
  onInspectCurrentTask,
}: ActivityNavigatorProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setFilter("all");
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);
  const model = useMemo(
    () => buildWorkspaceActivityModel(state, query, filter),
    [filter, query, state],
  );
  if (!open) return null;

  return (
    <div
      className="activity-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`activity-dialog${switchBlocked ? " has-warning" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header className="activity-header">
          <div>
            <span className="eyebrow">Across recent sessions</span>
            <h2 id="activity-title">Activity</h2>
            <p>Server-owned tasks; no session is opened by this scan.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close activity">
            ×
          </button>
        </header>

        <div className="activity-toolbar">
          <label>
            <span className="sr-only">Search activity</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search session, task, role, or status…"
            />
          </label>
          <div className="activity-filters" aria-label="Activity status">
            {FILTERS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={filter === candidate}
                onClick={() => setFilter(candidate)}
              >
                {candidate} <span>{model.counts[candidate]}</span>
              </button>
            ))}
          </div>
        </div>

        {switchBlocked ? (
          <p className="activity-warning" role="status">
            The foreground queue must settle before opening another session.
          </p>
        ) : null}

        <div className="activity-results">
          {model.rows.map((row) => {
            const current = row.sessionId === activeSessionId;
            return (
              <article key={`${row.sessionId}:${row.taskId}`}>
                <span
                  className={`activity-state state-${row.state}`}
                  role="img"
                  aria-label={row.state}
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
                  disabled={!current && switchBlocked}
                  aria-label={
                    current
                      ? `Inspect ${row.title}`
                      : `Open ${row.sessionTitle}`
                  }
                  onClick={() => {
                    if (current) onInspectCurrentTask(row.taskId);
                    else onOpenSession(row.sessionId);
                    onClose();
                  }}
                >
                  {current ? "Inspect" : "Open session"}
                </button>
              </article>
            );
          })}
          {model.rows.length === 0 ? (
            <div className="activity-empty">
              <strong>No matching activity</strong>
              <span>
                {query.trim()
                  ? `No ${filter} task matches “${query.trim()}”.`
                  : filter === "all"
                    ? "No task snapshots are available yet."
                    : `No ${filter} tasks are available.`}
              </span>
            </div>
          ) : null}
        </div>

        <footer className="activity-footer">
          <span>
            {state.activityLoading
              ? "Refreshing task snapshots…"
              : "Read-only · refreshes every 10 seconds"}
          </span>
          <span>Esc closes</span>
        </footer>
      </section>
    </div>
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
