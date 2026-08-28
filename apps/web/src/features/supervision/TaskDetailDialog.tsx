import type { TaskArtifactRecord } from "@octos-org/octoscode-client";
import type { SupervisionRuntimeState } from "./model.ts";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./TaskDetailDialog.module.css";

interface TaskDetailDialogProps {
  state: SupervisionRuntimeState;
  onClose: () => void;
  onLoadMore: () => void;
  onReadArtifact: (artifact: TaskArtifactRecord) => void;
  onLoadMoreArtifact: () => void;
}

export function TaskDetailDialog({
  state,
  onClose,
  onLoadMore,
  onReadArtifact,
  onLoadMoreArtifact,
}: TaskDetailDialogProps) {
  if (!state.detail.active) return null;
  const task = state.tasks.find(
    (candidate) => candidate.id === state.detail.taskId,
  );
  const selected = state.detail.selectedArtifact;

  return (
    <ModalSurface
      backdropClassName="review-backdrop"
      dialogClassName="task-dialog"
      labelledBy="task-detail-title"
      onEscape={onClose}
    >
      <header className="review-header">
        <div>
          <span className="eyebrow">Supervised task</span>
          <h2 id="task-detail-title">{task?.title ?? "Task output"}</h2>
        </div>
        <div className="review-header-actions">
          <span
            className={`task-status-pill state-${task?.state ?? "unknown"}`}
          >
            {task?.state ?? "loading"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task output"
          >
            ×
          </button>
        </div>
      </header>
      <div
        className={`task-detail-grid ${
          state.taskOutputAvailable && state.artifactsAvailable
            ? ""
            : styles.singlePane
        }`}
      >
        {state.taskOutputAvailable ? (
          <section className="task-output-pane">
            <div className="task-pane-heading">
              <span>Output</span>
              {state.detail.output ? (
                <small>
                  {state.detail.output.total_bytes.toLocaleString()} bytes ·{" "}
                  {state.detail.output.source}
                </small>
              ) : null}
            </div>
            {state.detail.loading ? (
              <div className="review-empty">Reading task output…</div>
            ) : (
              <pre>{state.detail.text || "No output has been captured."}</pre>
            )}
            {state.detail.output && !state.detail.output.complete ? (
              <button
                className="task-load-more"
                type="button"
                disabled={state.detail.loadingMore}
                onClick={onLoadMore}
              >
                {state.detail.loadingMore ? "Loading…" : "Load more output"}
              </button>
            ) : null}
          </section>
        ) : null}
        {state.artifactsAvailable ? (
          <aside className="artifact-pane">
            <div className="task-pane-heading">
              <span>Artifacts</span>
              <small>{state.detail.artifacts?.artifacts.length ?? 0}</small>
            </div>
            <div className="artifact-list">
              {(state.detail.artifacts?.artifacts ?? []).map((artifact) => (
                <button
                  type="button"
                  key={artifact.id}
                  aria-pressed={selected?.artifact.id === artifact.id}
                  onClick={() => onReadArtifact(artifact)}
                >
                  <strong>{artifact.title}</strong>
                  <small>
                    {artifact.path ?? `${artifact.kind} · ${artifact.status}`}
                  </small>
                </button>
              ))}
              {!state.detail.artifacts?.artifacts.length ? (
                <p>No artifacts were reported.</p>
              ) : null}
            </div>
            {state.detail.artifactLoading ? (
              <div className="artifact-content">Reading artifact…</div>
            ) : selected ? (
              <div className="artifact-content">
                <strong>{selected.artifact.title}</strong>
                <pre>
                  {selected.content ??
                    selected.artifact.content ??
                    "No text content."}
                </pre>
                {selected.has_more ? (
                  <button
                    className="task-load-more"
                    type="button"
                    disabled={state.detail.artifactLoading}
                    onClick={onLoadMoreArtifact}
                  >
                    {state.detail.artifactLoading
                      ? "Loading…"
                      : "Load more artifact"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
      {state.detail.error ? (
        <div className="task-detail-error" role="alert">
          {state.detail.error}
        </div>
      ) : null}
    </ModalSurface>
  );
}
