import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApprovalPanel } from "./ApprovalPanel.tsx";

describe("ApprovalPanel", () => {
  it("renders octoscode request/session/deny choices and typed command context", () => {
    const html = renderToStaticMarkup(
      <ApprovalPanel
        approval={{
          sessionId: "s1",
          approvalId: "a1",
          turnId: "t1",
          toolName: "shell",
          title: "Run tests?",
          body: "The agent wants to validate the change.",
          approvalKind: "command",
          risk: "medium",
          typedDetails: {
            kind: "command",
            command: { command_line: "pnpm check" },
          },
        }}
        busy={false}
        error={null}
        onDecide={vi.fn()}
        onInterrupt={vi.fn()}
      />,
    );

    expect(html).toContain("Run tests?");
    expect(html).toContain("pnpm check");
    expect(html).toContain("This session");
    expect(html).toContain("No");
    expect(html).toContain("Yes");
  });

  it("offers the octoscode D review action for typed diff approvals", () => {
    const html = renderToStaticMarkup(
      <ApprovalPanel
        approval={{
          sessionId: "s1",
          approvalId: "a1",
          turnId: "t1",
          toolName: "apply_patch",
          title: "Apply change?",
          body: "Review the authoritative server preview.",
          typedDetails: {
            kind: "diff",
            diff: {
              preview_id: "00000000-0000-4000-8000-000000000042",
            },
          },
        }}
        busy={false}
        error={null}
        onDecide={vi.fn()}
        onInterrupt={vi.fn()}
        onReviewDiff={vi.fn()}
      />,
    );

    expect(html).toContain("Review diff");
    expect(html).toContain("D</kbd>");
  });
});
