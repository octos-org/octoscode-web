import { useId, useMemo, useSyncExternalStore } from "react";
import type { DiffPreviewLine } from "@octos-org/octoscode-client/protocol";
import type { DiffReviewRuntimeState } from "./use-coding-safety.ts";
import {
  grammarLoadCount,
  subscribeGrammarLoaded,
} from "../markdown/highlight.ts";
import {
  canDecorateDiff,
  decorateDiffHunk,
  diffKind,
  diffLanguage,
  type DiffToken,
} from "./diff-presentation.ts";
import styles from "./ChangesView.module.css";
import { useUiText } from "../preferences/ui-text.tsx";
import type { SessionFileChange } from "../side-panel/session-changes.ts";

interface ChangesViewProps {
  state: DiffReviewRuntimeState;
  /** Files this Session's tools touched, newest first. */
  changes: readonly SessionFileChange[];
  onOpenPreview: (previewId: string) => void;
  onRefresh: () => void;
  onScopeChange: (scope: "turn" | "workspace") => void;
}

/**
 * The session panel's Changes tab: what this Session changed and the diff
 * Core kept for it, beside the conversation rather than over it.
 */
export function ChangesView({
  state,
  changes,
  onOpenPreview,
  onRefresh,
  onScopeChange,
}: ChangesViewProps) {
  const t = useUiText();
  const titleId = useId();
  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const file of state.result?.preview.files ?? []) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (diffKind(line.kind) === "added") additions += 1;
          if (diffKind(line.kind) === "removed") deletions += 1;
        }
      }
    }
    return { additions, deletions };
  }, [state.result]);
  const grammarVersion = useSyncExternalStore(
    subscribeGrammarLoaded,
    grammarLoadCount,
    grammarLoadCount,
  );
  const decorations = useMemo(() => {
    const files = state.result?.preview.files;
    if (!files || !canDecorateDiff(files)) return undefined;
    return files.map((file) =>
      file.hunks.map((hunk) =>
        decorateDiffHunk(hunk.lines, diffLanguage(file.path)),
      ),
    );
  }, [state.result, grammarVersion]);

  const preview = state.result?.preview;
  const shownPreview = state.scope === "turn" ? preview?.preview_id : null;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div
          className={styles.scope}
          role="group"
          aria-label={t("Changes scope")}
        >
          <button
            type="button"
            aria-pressed={state.scope === "turn"}
            disabled={!state.available}
            onClick={() => onScopeChange("turn")}
          >
            {t("This session")}
          </button>
          <button
            type="button"
            aria-pressed={state.scope === "workspace"}
            disabled={!state.workspaceAvailable}
            title={t("Workspace uncommitted changes")}
            onClick={() => onScopeChange("workspace")}
          >
            {t("Uncommitted (Git)")}
          </button>
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={onRefresh}
          disabled={state.loading}
        >
          {t("Refresh")}
        </button>
      </div>
      {state.scope === "turn" ? (
        changes.length ? (
          <ul
            className={styles.changed}
            aria-label={t("Changed in this session")}
          >
            {changes.map((change) => (
              <li key={change.path}>
                <button
                  type="button"
                  aria-current={
                    change.previewId && change.previewId === shownPreview
                      ? "true"
                      : undefined
                  }
                  disabled={!change.previewId || !state.available}
                  title={
                    change.previewId
                      ? change.path
                      : t("Core kept no diff for this change.")
                  }
                  onClick={() =>
                    change.previewId && onOpenPreview(change.previewId)
                  }
                >
                  <span
                    className={`file-status status-${operationStatus(change.operation)}`}
                    aria-hidden="true"
                  >
                    {operationMark(change.operation)}
                  </span>
                  <span className={styles.changedPath}>
                    <strong>{baseName(change.path)}</strong>
                    {folderName(change.path) ? (
                      <small>{folderName(change.path)}</small>
                    ) : null}
                  </span>
                  <em>{t(operationLabel(change.operation))}</em>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.plainNotice}>
            {t("Files Octos changes in this session show here.")}
          </p>
        )
      ) : (
        <p className={styles.plainNotice}>
          {t(
            "Includes staged, unstaged and untracked files. Changes may come from other sessions.",
          )}
        </p>
      )}
      <section className={styles.preview} aria-labelledby={titleId}>
        <header className={styles.previewHeader}>
          <h3 id={titleId} title={preview?.title}>
            {preview?.title ?? t("Review changes")}
          </h3>
          {state.result ? (
            <span className="diff-totals">
              <strong>+{totals.additions}</strong>
              <em>−{totals.deletions}</em>
            </span>
          ) : null}
        </header>
        {Boolean(preview?.files.length) &&
        !decorations &&
        !state.loading &&
        !state.error ? (
          <p className={styles.plainNotice}>
            {t("Large preview shown as plain text. All lines are included.")}
          </p>
        ) : null}
        {state.loading ? (
          <div className="review-empty" role="status">
            {t("Loading the server snapshot…")}
          </div>
        ) : state.error ? (
          <div className="review-empty review-error" role="alert">
            <strong>{t("Preview unavailable")}</strong>
            <span>{state.error}</span>
          </div>
        ) : !preview?.files.length ? (
          <div className="review-empty">
            {t(
              !preview && state.scope === "turn"
                ? "No session change preview yet. Switch to workspace changes."
                : "The preview is ready, but it contains no changed files.",
            )}
          </div>
        ) : (
          preview.files.map((file, index) => (
            <details className="diff-file" key={`${file.path}:${index}`} open>
              <summary>
                <span
                  className={`file-status status-${statusClass(file.status)}`}
                >
                  {fileStatusMark(file.status)}
                </span>
                <strong title={file.path}>{file.path}</strong>
                {file.old_path ? (
                  <small>
                    {t("from") + " "}
                    {file.old_path}
                  </small>
                ) : null}
                <em>{t(diffStatusLabel(file.status))}</em>
              </summary>
              {file.hunks.length ? (
                file.hunks.map((hunk, hunkIndex) => (
                  <section
                    className="diff-hunk"
                    key={`${hunk.header}:${hunkIndex}`}
                  >
                    <code className="diff-hunk-header">{hunk.header}</code>
                    <div className="diff-lines" role="table">
                      <div className="sr-only" role="rowgroup">
                        <div role="row">
                          <span role="columnheader">{t("Old line")}</span>
                          <span role="columnheader">{t("New line")}</span>
                          <span role="columnheader">{t("Change")}</span>
                          <span role="columnheader">{t("Code")}</span>
                        </div>
                      </div>
                      <div role="rowgroup">
                        {hunk.lines.map((line, lineIndex) => (
                          <DiffLine
                            key={`${lineIndex}:${line.old_line ?? ""}:${line.new_line ?? ""}`}
                            line={line}
                            tokens={
                              decorations?.[index]?.[hunkIndex]?.[lineIndex]
                            }
                          />
                        ))}
                      </div>
                    </div>
                  </section>
                ))
              ) : (
                <div className="diff-unavailable">
                  {t("Line-level diff unavailable for this mutation.")}
                </div>
              )}
            </details>
          ))
        )}
      </section>
    </div>
  );
}

function DiffLine({
  line,
  tokens,
}: {
  line: DiffPreviewLine;
  tokens: DiffToken[] | undefined;
}) {
  const kind = diffKind(line.kind);
  return (
    <div className={`diff-line diff-${kind}`} role="row">
      <span role="cell">{line.old_line ?? ""}</span>
      <span role="cell">{line.new_line ?? ""}</span>
      <span className="diff-prefix" role="cell" aria-label={kind}>
        {kind === "added" ? "+" : kind === "removed" ? "−" : " "}
      </span>
      <code role="cell" className={styles.code}>
        {tokens?.length
          ? tokens.map((token, index) => (
              <span
                key={index}
                className={`${token.className}${token.changed ? ` ${styles.changedWord}` : ""}`}
              >
                {token.content}
              </span>
            ))
          : line.content}
      </code>
    </div>
  );
}

function statusClass(status: string) {
  return status.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

function fileStatusMark(status: string) {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default:
      return "M";
  }
}

/** English source text for a diff file's status, for `useUiText`. */
function diffStatusLabel(status: string) {
  switch (status) {
    case "added":
      return "New";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    default:
      return "Edited";
  }
}

function operationLabel(operation: SessionFileChange["operation"]) {
  switch (operation) {
    case "create":
      return "New";
    case "write":
      return "Written";
    case "delete":
      return "Deleted";
    default:
      return "Edited";
  }
}

function operationStatus(operation: SessionFileChange["operation"]) {
  return operation === "create"
    ? "added"
    : operation === "delete"
      ? "deleted"
      : "modified";
}

function operationMark(operation: SessionFileChange["operation"]) {
  return fileStatusMark(operationStatus(operation));
}

function baseName(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function folderName(path: string) {
  const slash = path.replace(/\/+$/, "").lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : "";
}
