import type { KeyboardEvent } from "react";
import {
  approvalDiffPreviewId,
  isRecord,
  type ApprovalDecision,
  type ApprovalRequested,
  type ApprovalScope,
} from "@octos-org/octoscode-client";
import { ModalSurface } from "../../ui/ModalSurface.tsx";

interface ApprovalPanelProps {
  approval: ApprovalRequested;
  busy: boolean;
  error: string | null;
  onDecide: (decision: ApprovalDecision, scope: ApprovalScope) => void;
  onInterrupt?: (() => void) | undefined;
  onReviewDiff?: (previewId: string) => void;
}

export function ApprovalPanel({
  approval,
  busy,
  error,
  onDecide,
  onInterrupt,
  onReviewDiff,
}: ApprovalPanelProps) {
  const command = approvalCommand(approval.typedDetails);
  const previewId = approvalDiffPreviewId(approval);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (busy) return;
    if (event.key.toLowerCase() === "d" && previewId && onReviewDiff) {
      event.preventDefault();
      onReviewDiff(previewId);
    } else if (event.key.toLowerCase() === "y") {
      event.preventDefault();
      onDecide("approve", "request");
    } else if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      onDecide("approve", "session");
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      onDecide("deny", "request");
    }
  };

  return (
    <ModalSurface
      backdropClassName="takeover-wrap"
      dialogClassName="approval-card"
      labelledBy="approval-title"
      {...(busy || !onInterrupt ? {} : { onEscape: onInterrupt })}
      onKeyDown={handleKeyDown}
    >
      <div className="approval-strip">
        <span className="approval-dot" />
        <span>Approval required</span>
        {approval.risk ? <em>{approval.risk} risk</em> : null}
      </div>
      <div className="approval-body">
        <strong id="approval-title">{approval.title}</strong>
        <p>{approval.body}</p>
        {command ? <code>{command}</code> : null}
        <span className="approval-tool">
          {approval.toolName}
          {approval.approvalKind ? ` · ${approval.approvalKind}` : ""}
        </span>
        {error ? <span className="takeover-error">{error}</span> : null}
      </div>
      <div className="approval-actions">
        {previewId && onReviewDiff ? (
          <button
            className="takeover-button"
            type="button"
            disabled={busy}
            onClick={() => onReviewDiff(previewId)}
          >
            Review diff <kbd>D</kbd>
          </button>
        ) : null}
        <button
          className="takeover-button reject"
          type="button"
          disabled={busy}
          onClick={() => onDecide("deny", "request")}
        >
          No <kbd>N</kbd>
        </button>
        <button
          className="takeover-button"
          type="button"
          disabled={busy}
          onClick={() => onDecide("approve", "session")}
        >
          This session <kbd>S</kbd>
        </button>
        <button
          className="takeover-button primary"
          type="button"
          disabled={busy}
          onClick={() => onDecide("approve", "request")}
        >
          {busy ? "Sending…" : "Yes"} <kbd>Y</kbd>
        </button>
      </div>
    </ModalSurface>
  );
}

function approvalCommand(typedDetails: unknown): string | null {
  if (!isRecord(typedDetails) || !isRecord(typedDetails.command)) return null;
  const command = typedDetails.command;
  if (typeof command.command_line === "string") return command.command_line;
  if (Array.isArray(command.argv) && command.argv.every(isString)) {
    return command.argv.join(" ");
  }
  return null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
