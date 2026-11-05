import { useState } from "react";
import { ArrowLeftIcon, FileIcon } from "../../ui/Icon.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import type { SupervisedTask } from "../supervision/model.ts";
import type { AttachmentAccess } from "../timeline/attachment-access.ts";
import { attachmentName, isWorkspaceUpload } from "../timeline/attachments.ts";
import { SentFilePreview } from "./SentFilePreview.tsx";
import type { SessionFileChange } from "./session-changes.ts";
import type { resolvePanelFile } from "./panel-selection.ts";
import styles from "./SessionPanelTabs.module.css";

export interface OutputsTabProps {
  /** Files this Session's tools created or wrote. */
  changes: readonly SessionFileChange[];
  /** Files Octos sent with its replies: server paths or upload handles. */
  delivered: readonly string[];
  /** Null when this server cannot serve Session files. */
  access: AttachmentAccess | null;
  tasks: readonly SupervisedTask[];
  selectedPath: string | null;
  selected: ReturnType<typeof resolvePanelFile>;
  onSelectPath: (path: string | null) => void;
  onOpenDelivered: (reference: string) => void;
  onOpenTask?: ((taskId: string) => void) | undefined;
}

/**
 * What this Session produced: files written in the folder, files sent to you,
 * and background work's outputs. Gathered from tool events, so a file shows
 * here whether or not the model chose to send it.
 */
export function OutputsTab(props: OutputsTabProps) {
  const t = useUiText();
  const [revision, setRevision] = useState(0);

  const written = props.changes.filter(
    (change) => change.operation !== "delete",
  );
  const taskOutputs = props.tasks.filter((task) => task.outputFiles.length);

  if (props.selectedPath) {
    const { change, reference, found } = props.selected;
    const access = props.access;
    const deleted = change?.operation === "delete";
    const workspaceRead =
      change &&
      access?.downloadWorkspaceFile &&
      access.workspacePathAvailable?.(change.path)
        ? access.downloadWorkspaceFile
        : null;
    // The same preview as the transcript: a written file through the
    // workspace reader, a sent one through the delivered-file route.
    const preview = deleted
      ? null
      : workspaceRead
        ? { reference: change!.path, workspaceFile: true }
        : reference && access && access.deliveredPreviewAvailable !== false
          ? { reference, workspaceFile: isWorkspaceUpload(reference) }
          : null;
    return (
      <div className={styles.stack}>
        <div className={styles.selectionActions}>
          <button
            type="button"
            className={styles.back}
            onClick={() => props.onSelectPath(null)}
          >
            <ArrowLeftIcon />
            {t("All outputs")}
          </button>
          {preview ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => setRevision((value) => value + 1)}
            >
              {t("Refresh")}
            </button>
          ) : null}
        </div>
        {workspaceRead && !deleted ? (
          <p className={styles.note}>{t("Current workspace file")}</p>
        ) : null}
        {preview && access ? (
          <SentFilePreview
            key={`${preview.reference}:${change?.previewId ?? ""}:${revision}`}
            reference={preview.reference}
            workspaceFile={preview.workspaceFile}
            access={access}
          />
        ) : found ? (
          <p className={styles.empty}>
            {t(
              deleted
                ? "This file was deleted. You can still review its retained diff."
                : "This server cannot preview this file. You can review its retained diff if available.",
            )}
          </p>
        ) : null}
      </div>
    );
  }

  if (!written.length && !props.delivered.length && !taskOutputs.length)
    return (
      <p className={styles.empty}>
        {t(
          "Nothing yet. Files Octos writes or sends in this session show here.",
        )}
      </p>
    );

  return (
    <div className={styles.stack}>
      {written.length ? (
        <section className={styles.section} aria-labelledby="outputs-written">
          <div className={styles.sectionTitle}>
            <h3 id="outputs-written">{t("Written in this folder")}</h3>
            <span>{written.length}</span>
          </div>
          <ul className={styles.rows}>
            {written.map((change) => (
              <li key={change.path}>
                <button
                  type="button"
                  className={styles.row}
                  title={change.path}
                  onClick={() => props.onSelectPath(change.path)}
                >
                  <FileIcon />
                  <span className={styles.rowText}>
                    <strong>{attachmentName(change.path)}</strong>
                    <small>
                      {[
                        folderOf(change.path),
                        change.bytesWritten === null
                          ? null
                          : formatBytes(change.bytesWritten),
                      ]
                        .filter(Boolean)
                        .join(" · ") ||
                        t(change.operation === "create" ? "New" : "Written")}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {props.delivered.length ? (
        <section className={styles.section} aria-labelledby="outputs-delivered">
          <div className={styles.sectionTitle}>
            <h3 id="outputs-delivered">{t("Sent to you")}</h3>
            <span>{props.delivered.length}</span>
          </div>
          <ul className={styles.rows}>
            {props.delivered.map((reference) => (
              <li key={reference}>
                <button
                  type="button"
                  className={styles.row}
                  disabled={!props.access}
                  title={reference}
                  onClick={() => props.onOpenDelivered(reference)}
                >
                  <FileIcon />
                  <span className={styles.rowText}>
                    <strong>{attachmentName(reference)}</strong>
                    <small>{folderOf(reference)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {taskOutputs.length ? (
        <section className={styles.section} aria-labelledby="outputs-tasks">
          <div className={styles.sectionTitle}>
            <h3 id="outputs-tasks">{t("From background tasks")}</h3>
            <span>{taskOutputs.length}</span>
          </div>
          <ul className={styles.rows}>
            {taskOutputs.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className={styles.row}
                  disabled={!props.onOpenTask}
                  onClick={() => props.onOpenTask?.(task.id)}
                >
                  <FileIcon />
                  <span className={styles.rowText}>
                    <strong>{task.title}</strong>
                    <small>
                      {task.outputFiles.map(attachmentName).join(", ")}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function folderOf(path: string) {
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
