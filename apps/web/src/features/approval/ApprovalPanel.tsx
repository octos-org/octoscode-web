import type { KeyboardEvent } from "react";
import {
  approvalDiffPreviewId,
  isRecord,
  type ApprovalDecision,
  type ApprovalRequested,
  type ApprovalScope,
} from "@octos-org/octoscode-client/protocol";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import { approvalImpactDetails } from "./approval-presentation.ts";

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
  const t = useUiText();
  const command = approvalCommand(approval.typedDetails);
  const previewId = approvalDiffPreviewId(approval);
  const impact = approvalImpactDetails(approval);
  const risk = approval.risk?.toLowerCase();
  const riskLabel =
    risk === "high" || risk === "critical"
      ? "High risk"
      : risk === "medium"
        ? "Medium risk"
        : risk === "low"
          ? "Low risk"
          : "Risk not specified";

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      busy ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return;
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
      // Session-scoped takeover: other sessions stay reachable while it waits.
      hidesBackground={false}
      backdropClassName="takeover-wrap"
      dialogClassName="approval-card"
      labelledBy="approval-title"
      {...(busy || !onInterrupt ? {} : { onEscape: onInterrupt })}
      onKeyDown={handleKeyDown}
    >
      <div className="approval-strip">
        <span className="approval-dot" />
        <span>{t("Approval required")}</span>
        {approval.risk ? <em data-risk={risk}>{t(riskLabel)}</em> : null}
      </div>
      <div className="approval-body">
        <strong id="approval-title">{t(approval.title)}</strong>
        <p className="approval-impact">
          {t("Impact: {directory} · {network} · {deletion}", {
            directory: impact.directory
              ? t("Directory {path}", { path: impact.directory })
              : t("Current workspace"),
            network: t(
              impact.network === "allowed"
                ? "Network allowed"
                : impact.network === "blocked"
                  ? "Network blocked"
                  : "Network not specified",
            ),
            deletion: t(
              impact.destructive ? "May delete files" : "No deletion indicated",
            ),
          })}
        </p>
        <p>{approval.body}</p>
        {command ? <code>{command}</code> : null}
        <span className="approval-tool">
          {approval.toolName}
          {approval.approvalKind ? ` · ${t(approval.approvalKind)}` : ""}
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
            {t("Review diff") + " "}
            <kbd>D</kbd>
          </button>
        ) : null}
        <button
          className="takeover-button reject"
          type="button"
          disabled={busy}
          onClick={() => onDecide("deny", "request")}
        >
          {t("Deny") + " "}
          <kbd>N</kbd>
        </button>
        <button
          className="takeover-button"
          type="button"
          disabled={busy}
          onClick={() => onDecide("approve", "session")}
        >
          {t("Allow for this session") + " "}
          <kbd>S</kbd>
        </button>
        <button
          className="takeover-button primary"
          type="button"
          disabled={busy}
          onClick={() => onDecide("approve", "request")}
        >
          {busy ? t("Sending…") : t("Allow once")} <kbd>Y</kbd>
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
