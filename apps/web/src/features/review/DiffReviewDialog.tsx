import { useEffect, useMemo, useRef } from "react";
import type { DiffPreviewLine } from "@octos-org/octoscode-client";
import type { DiffReviewRuntimeState } from "../session/use-octos-session.ts";

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
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => rootRef.current?.focus(), [state.latestPreviewId]);

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const file of state.result?.preview.files ?? []) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (isAdded(line.kind)) additions += 1;
          if (isRemoved(line.kind)) deletions += 1;
        }
      }
    }
    return { additions, deletions };
  }, [state.result]);

  if (!state.active) return null;
  const preview = state.result?.preview;

  return (
    <div className="review-backdrop" role="presentation">
      <div
        ref={rootRef}
        className="review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header className="review-header">
          <div>
            <span className="eyebrow">Authoritative diff preview</span>
            <h2 id="review-title">{preview?.title ?? "Review changes"}</h2>
          </div>
          <div className="review-header-actions">
            {state.result ? (
              <span className="diff-totals">
                <strong>+{totals.additions}</strong>
                <em>−{totals.deletions}</em>
              </span>
            ) : null}
            <button type="button" onClick={onRefresh} disabled={state.loading}>
              Refresh
            </button>
            <button type="button" onClick={onClose} aria-label="Close review">
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
          {state.loading ? (
            <div className="review-empty">Loading the server snapshot…</div>
          ) : state.error ? (
            <div className="review-empty review-error" role="alert">
              <strong>Preview unavailable</strong>
              <span>{state.error}</span>
            </div>
          ) : !preview?.files.length ? (
            <div className="review-empty">
              The preview is ready, but it contains no changed files.
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
                  <strong>{file.path}</strong>
                  {file.old_path ? <small>from {file.old_path}</small> : null}
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
                        {hunk.lines.map((line, lineIndex) => (
                          <DiffLine
                            key={`${lineIndex}:${line.old_line ?? ""}:${line.new_line ?? ""}`}
                            line={line}
                          />
                        ))}
                      </div>
                    </section>
                  ))
                ) : (
                  <div className="diff-unavailable">
                    Line-level diff unavailable for this mutation.
                  </div>
                )}
              </details>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function DiffLine({ line }: { line: DiffPreviewLine }) {
  const kind = isAdded(line.kind)
    ? "added"
    : isRemoved(line.kind)
      ? "removed"
      : "context";
  return (
    <div className={`diff-line diff-${kind}`} role="row">
      <span role="cell">{line.old_line ?? ""}</span>
      <span role="cell">{line.new_line ?? ""}</span>
      <span className="diff-prefix" aria-hidden="true">
        {kind === "added" ? "+" : kind === "removed" ? "−" : " "}
      </span>
      <code role="cell">{line.content || " "}</code>
    </div>
  );
}

function isAdded(kind: string) {
  return ["added", "insert", "inserted"].includes(kind);
}

function isRemoved(kind: string) {
  return ["removed", "delete", "deleted"].includes(kind);
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
