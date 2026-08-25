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
});
