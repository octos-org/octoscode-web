import { useEffect, useState } from "react";
import type { TaskArtifactRecord } from "@octos-org/octoscode-client/protocol";
import type { SupervisionRuntimeState } from "./model.ts";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./TaskDetailDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";
import { ArtifactPreview } from "../artifact-preview/ArtifactPreview.tsx";
import {
  artifactKind,
  type ArtifactKind,
} from "../artifact-preview/artifact-kind.ts";

function previewKind(
  kind: string,
  path?: string,
  content?: string,
  blobAvailable = false,
): ArtifactKind | undefined {
  const byPath = path ? artifactKind(path) : "unsupported";
  if (content !== undefined && !blobAvailable) {
    if (kind === "markdown") return "markdown";
    if (kind === "json") return "code";
    return "text";
  }
  if (byPath !== "unsupported") return byPath;
  if (content !== undefined) return "text";
  if (kind === "markdown") return "markdown";
  if (kind === "json") return "code";
  if (["text", "report", "log"].includes(kind)) return "text";
  return undefined;
}

interface TaskDetailDialogProps {
  state: SupervisionRuntimeState;
  onClose: () => void;
  onLoadMore: () => void;
  onReadArtifact: (artifact: TaskArtifactRecord) => void;
  onLoadMoreArtifact: () => void;
  workspaceReadAvailable?: boolean;
  profileFileReadAvailable?: boolean;
  describeArtifact?:
    | ((
        path: string,
        workspaceFile?: boolean,
      ) => Promise<{
        sizeBytes?: number;
        saveAvailable?: boolean;
      } | null>)
    | undefined;
  loadArtifact?:
    ((path: string, signal?: AbortSignal) => Promise<Blob>) | undefined;
  downloadArtifact?:
    ((path: string, signal?: AbortSignal) => Promise<Blob>) | undefined;
}

export function TaskDetailDialog({
  state,
  onClose,
  onLoadMore,
  onReadArtifact,
  onLoadMoreArtifact,
  workspaceReadAvailable = false,
  profileFileReadAvailable = false,
  describeArtifact,
  loadArtifact,
  downloadArtifact,
}: TaskDetailDialogProps) {
  const t = useUiText();
  const selected = state.detail.selectedArtifact;
  const selectedPath = selected?.artifact.path;
  const [sizeResult, setSizeResult] = useState<{
    path: string;
    pending: boolean;
    sizeBytes?: number;
    saveAvailable?: boolean;
  }>();
  useEffect(() => {
    if (!selectedPath || !describeArtifact) {
      setSizeResult(undefined);
      return;
    }
    let current = true;
    setSizeResult({ path: selectedPath, pending: true });
    describeArtifact(selectedPath, !selectedPath.startsWith("pf/")).then(
      (info) => {
        if (current) {
          setSizeResult({
            path: selectedPath,
            pending: false,
            ...(info?.sizeBytes !== undefined
              ? { sizeBytes: info.sizeBytes }
              : {}),
            ...(info?.saveAvailable !== undefined
              ? { saveAvailable: info.saveAvailable }
              : {}),
          });
        }
      },
      () => {
        if (current) setSizeResult({ path: selectedPath, pending: false });
      },
    );
    return () => {
      current = false;
    };
  }, [selectedPath, describeArtifact]);
  if (!state.detail.active) return null;
  const task = state.tasks.find(
    (candidate) => candidate.id === state.detail.taskId,
  );
  const selectedBlobAvailable = Boolean(
    selectedPath &&
    loadArtifact &&
    (selectedPath.startsWith("pf/")
      ? profileFileReadAvailable
      : workspaceReadAvailable),
  );
  const sizePending = Boolean(
    selectedPath &&
    describeArtifact &&
    (sizeResult?.path !== selectedPath || sizeResult.pending),
  );
  const currentSize =
    sizeResult?.path === selectedPath ? sizeResult : undefined;
  const sizeBytes = currentSize?.sizeBytes;
  const saveAvailable = currentSize?.saveAvailable;
  const selectedPathKind = selectedPath
    ? artifactKind(selectedPath)
    : "unsupported";
  const textArtifact =
    ["markdown", "code", "text"].includes(selectedPathKind) ||
    (selectedPathKind === "unsupported" &&
      selected &&
      ["text", "report", "log", "markdown", "json"].includes(
        selected.artifact.kind,
      ));
  const canDownloadText = Boolean(
    selectedBlobAvailable ||
    !selectedPath ||
    (textArtifact &&
      (selected.content !== undefined ||
        selected.artifact.content !== undefined)),
  );

  return (
    <ModalSurface
      backdropClassName="review-backdrop"
      dialogClassName={`task-dialog ${styles.dialog}`}
      labelledBy="task-detail-title"
      onEscape={onClose}
    >
      <header className="review-header">
        <div>
          <span className="eyebrow">{t("Supervised task")}</span>
          <h2 id="task-detail-title" title={task?.title}>
            {task?.title ?? t("Task output")}
          </h2>
        </div>
        <div className="review-header-actions">
          <span
            className={`task-status-pill state-${task?.state ?? "unknown"}`}
          >
            {task?.state ?? t("loading")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close task output")}
          >
            ×
          </button>
        </div>
      </header>
      <div
        className={`task-detail-grid ${styles.detailGrid} ${
          state.taskOutputAvailable && state.artifactsAvailable
            ? ""
            : styles.singlePane
        }`}
      >
        {state.taskOutputAvailable ? (
          <section className="task-output-pane">
            <div className="task-pane-heading">
              <span>{t("Output")}</span>
              {state.detail.output ? (
                <small>
                  {state.detail.output.total_bytes.toLocaleString()}
                  {" " + t("bytes ·")} {state.detail.output.source}
                </small>
              ) : null}
            </div>
            {state.detail.loading ? (
              <div className="review-empty">{t("Reading task output…")}</div>
            ) : (
              <pre>
                {state.detail.text || t("No output has been captured.")}
              </pre>
            )}
            {state.detail.output && !state.detail.output.complete ? (
              <button
                className="task-load-more"
                type="button"
                disabled={state.detail.loadingMore}
                onClick={onLoadMore}
              >
                {state.detail.loadingMore
                  ? t("Loading…")
                  : t("Load more output")}
              </button>
            ) : null}
          </section>
        ) : null}
        {state.artifactsAvailable ? (
          <aside
            className={`artifact-pane ${selected ? styles.artifactSelected : ""}`}
          >
            <div className="task-pane-heading">
              <span>{t("Artifacts")}</span>
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
                <p>{t("No artifacts were reported.")}</p>
              ) : null}
            </div>
            {selected ? (
              <div className="artifact-content">
                <ArtifactPreview
                  key={selected.artifact.id}
                  name={
                    selected.artifact.path?.split(/[\\/]/).at(-1) ??
                    selected.artifact.title
                  }
                  kind={previewKind(
                    selected.artifact.kind,
                    selected.artifact.path,
                    selected.content ?? selected.artifact.content,
                    selectedBlobAvailable,
                  )}
                  workspaceFile={
                    selectedBlobAvailable &&
                    workspaceReadAvailable &&
                    !selectedPath!.startsWith("pf/")
                  }
                  sizeRequired={selectedBlobAvailable}
                  sizePending={sizePending}
                  downloadAvailable={
                    saveAvailable === false ? false : canDownloadText
                  }
                  {...(sizeBytes === undefined ? {} : { sizeBytes })}
                  {...(selected.artifact.path
                    ? { path: selected.artifact.path }
                    : {})}
                  text={selected.content ?? selected.artifact.content}
                  hasMore={selected.has_more}
                  onLoadMore={onLoadMoreArtifact}
                  {...(selectedBlobAvailable && loadArtifact
                    ? {
                        loadBlob: (signal?: AbortSignal) =>
                          loadArtifact(selectedPath!, signal),
                      }
                    : {})}
                  {...(selectedBlobAvailable && downloadArtifact
                    ? {
                        downloadBlob: (signal?: AbortSignal) =>
                          downloadArtifact(selected.artifact.path!, signal),
                      }
                    : {})}
                />
                {state.detail.artifactLoading ? (
                  <div role="status">{t("Reading artifact…")}</div>
                ) : null}
              </div>
            ) : state.detail.artifactLoading ? (
              <div className="artifact-content">{t("Reading artifact…")}</div>
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
