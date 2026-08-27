import { useMemo, useState } from "react";
import type { WorkspaceProductState } from "./model.ts";
import { activityLabel, formatFileSize, sessionLabel } from "./model.ts";

interface SessionNavigatorProps {
  state: WorkspaceProductState;
  activeSessionId: string | null;
  switchBlocked: boolean;
  onRefresh: () => void;
  onSwitch: (sessionId: string) => void;
  onCreate: () => void;
  onDelete: (sessionId: string) => void;
}

export function SessionNavigator({
  state,
  activeSessionId,
  switchBlocked,
  onRefresh,
  onSwitch,
  onCreate,
  onDelete,
}: SessionNavigatorProps) {
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const sessions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? state.sessions.filter((session) =>
          [session.id, session.title, session.last_prompt].some((value) =>
            value?.toLocaleLowerCase().includes(normalized),
          ),
        )
      : state.sessions;
  }, [query, state.sessions]);

  return (
    <section className="session-navigator" aria-labelledby="sessions-title">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">Workspace</span>
          <h2 id="sessions-title">Sessions</h2>
        </div>
        <div className="navigator-actions">
          <button type="button" disabled={switchBlocked} onClick={onCreate}>
            New
          </button>
          <button type="button" onClick={onRefresh}>
            {state.loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {state.sessions.length > 3 ? (
        <input
          className="session-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sessions…"
          aria-label="Search sessions"
        />
      ) : null}

      {state.error ? (
        <p className="connection-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {switchBlocked ? (
        <p className="field-note">
          Session switching unlocks when the foreground queue settles.
        </p>
      ) : null}

      <div className="session-list">
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          const deleting = state.deletingSessionId === session.id;
          const activity = state.activityBySession[session.id];
          return (
            <article
              className={[
                active ? "active" : "",
                activity ? `activity-${activity.status}` : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={session.id}
            >
              <button
                className="session-row"
                type="button"
                disabled={active || switchBlocked || deleting}
                aria-current={active ? "page" : undefined}
                onClick={() => onSwitch(session.id)}
              >
                <span
                  className="session-presence"
                  title={
                    activity
                      ? `Background tasks: ${activityLabel(activity)}`
                      : "Background task state not loaded"
                  }
                />
                <span>
                  <strong>{sessionLabel(session)}</strong>
                  <small>
                    {shortSessionId(session.id)} · {session.message_count} msgs
                  </small>
                </span>
                {active || activity ? (
                  <em>
                    {[
                      active ? "Current" : "",
                      activity ? activityLabel(activity) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </em>
                ) : null}
              </button>
              {state.deleteAvailable && !active ? (
                confirmDelete === session.id ? (
                  <div className="session-delete-confirm">
                    <span>Delete permanently?</span>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => {
                        setConfirmDelete(null);
                        onDelete(session.id);
                      }}
                    >
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                ) : (
                  <button
                    className="session-delete"
                    type="button"
                    aria-label={`Delete ${sessionLabel(session)}`}
                    onClick={() => setConfirmDelete(session.id)}
                  >
                    ×
                  </button>
                )
              ) : null}
            </article>
          );
        })}
      </div>
      {!state.sessionsAvailable ? (
        <p className="field-note">session/list is not advertised.</p>
      ) : !state.loading && sessions.length === 0 ? (
        <p className="field-note">No sessions match this workspace.</p>
      ) : null}
      {state.activityAvailable ? (
        <p className="field-note session-activity-note">
          {state.activityLoading
            ? "Refreshing background work…"
            : state.activityUpdatedAt
              ? "Recent background work is read-only and refreshes every 10 seconds."
              : "Background work has not been loaded yet."}
        </p>
      ) : null}

      <details className="session-files">
        <summary>Session files · {state.files.length}</summary>
        {state.filesLoading ? <p>Loading files…</p> : null}
        {state.files.map((file) => (
          <div key={file.path}>
            <span>↳</span>
            <span>
              <strong>{file.filename}</strong>
              <small>{formatFileSize(file.size_bytes)}</small>
            </span>
          </div>
        ))}
        {!state.filesAvailable ? (
          <p>session/files.list is not advertised.</p>
        ) : !state.filesLoading && state.files.length === 0 ? (
          <p>No server-owned session files.</p>
        ) : null}
      </details>
    </section>
  );
}

function shortSessionId(id: string): string {
  const topic = id.split("#").at(-1);
  if (id.includes("#") && topic) return topic;
  return id.split(":").at(-1) || id;
}
