import { useEffect, useRef } from "react";
import {
  isRecord,
  type ApprovalDecision,
  type ApprovalRequested,
  type ApprovalScope,
} from "@octos-org/octoscode-client";

interface ApprovalPanelProps {
  approval: ApprovalRequested;
  busy: boolean;
  error: string | null;
  onDecide: (decision: ApprovalDecision, scope: ApprovalScope) => void;
  onInterrupt: () => void;
}

export function ApprovalPanel({
  approval,
  busy,
  error,
  onDecide,
  onInterrupt,
}: ApprovalPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => rootRef.current?.focus(), [approval.approvalId]);

  const command = approvalCommand(approval.typedDetails);

  return (
    <div className="takeover-wrap">
      <div
        ref={rootRef}
        className="approval-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (busy) return;
          if (event.key.toLowerCase() === "y") {
            event.preventDefault();
            onDecide("approve", "request");
          } else if (event.key.toLowerCase() === "s") {
            event.preventDefault();
            onDecide("approve", "session");
          } else if (event.key.toLowerCase() === "n") {
            event.preventDefault();
            onDecide("deny", "request");
          } else if (event.key === "Escape") {
            event.preventDefault();
            onInterrupt();
          }
        }}
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
      </div>
    </div>
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
