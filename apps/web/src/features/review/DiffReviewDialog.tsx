import { useMemo, useSyncExternalStore } from "react";
import type { DiffPreviewLine } from "@octos-org/octoscode-client/protocol";
import type { DiffReviewRuntimeState } from "./use-coding-safety.ts";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
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
import styles from "./DiffReviewDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

interface DiffReviewDialogProps {
  state: DiffReviewRuntimeState;
  onClose: () => void;
  onRefresh: () => void;
}

export function DiffReviewDialog({
  state,
  onClose,
  onRefresh,
}: DiffReviewDialogProps) {
  const t = useUiText();
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
    if (!state.active || !files || !canDecorateDiff(files)) return undefined;
    return files.map((file) =>
      file.hunks.map((hunk) =>
        decorateDiffHunk(hunk.lines, diffLanguage(file.path)),
      ),
    );
  }, [state.active, state.result, grammarVersion]);

  if (!state.active) return null;
  const preview = state.result?.preview;

  return (
    <ModalSurface
      backdropClassName="review-backdrop"
      dialogClassName={`review-dialog ${styles.dialog}`}
      labelledBy="review-title"
      onEscape={onClose}
    >
      <header className="review-header">
        <div>
          <span className="eyebrow">{t("Authoritative diff preview")}</span>
          <h2 id="review-title" title={preview?.title}>
            {preview?.title ?? t("Review changes")}
          </h2>
        </div>
        <div className="review-header-actions">
          {state.result ? (
            <span className="diff-totals">
              <strong>+{totals.additions}</strong>
              <em>−{totals.deletions}</em>
            </span>
          ) : null}
          <button type="button" onClick={onRefresh} disabled={state.loading}>
            {t("Refresh")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close review")}
          >
            ×
          </button>
        </div>
      </header>
      <div className="review-status">
        <span>
          {state.result?.status ?? (state.loading ? "loading" : "error")}
        </span>
        {state.result ? <span>{state.result.source}</span> : null}
        <code>{state.latestPreviewId}</code>
      </div>
      <div className="review-content">
        {Boolean(preview?.files.length) &&
        !decorations &&
        !state.loading &&
        !state.error ? (
          <p className={styles.plainNotice}>
            Large preview shown as plain text. All lines are included.
          </p>
        ) : null}
        {state.loading ? (
          <div className="review-empty">
            {t("Loading the server snapshot…")}
          </div>
        ) : state.error ? (
          <div className="review-empty review-error" role="alert">
            <strong>{t("Preview unavailable")}</strong>
            <span>{state.error}</span>
          </div>
        ) : !preview?.files.length ? (
          <div className="review-empty">
            {t("The preview is ready, but it contains no changed files.")}
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
                <em>{file.status}</em>
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
      </div>
    </ModalSurface>
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
