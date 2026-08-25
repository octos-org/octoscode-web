import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_WORKSPACE_PRODUCT } from "./model.ts";
import { SessionNavigator } from "./SessionNavigator.tsx";

describe("SessionNavigator", () => {
  it("renders authoritative sessions and server-owned files", () => {
    const html = renderToStaticMarkup(
      <SessionNavigator
        state={{
          ...EMPTY_WORKSPACE_PRODUCT,
          sessionsAvailable: true,
          deleteAvailable: true,
          filesAvailable: true,
          sessions: [
            {
              id: "coding:local:main",
              message_count: 12,
              title: "Ship the Web client",
            },
            {
              id: "coding:local:review",
              message_count: 4,
              last_prompt: "Review the diff",
            },
          ],
          files: [
            {
              filename: "check.txt",
              path: "pf/coding/check.txt",
              size_bytes: 12_400,
              modified_at: "2026-08-26T00:00:00Z",
            },
          ],
        }}
        activeSessionId="coding:local:main"
        switchBlocked={false}
        onRefresh={vi.fn()}
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(html).toContain("Ship the Web client");
    expect(html).toContain("Review the diff");
    expect(html).toContain("Current");
    expect(html).toContain("12.4 KB");
    expect(html).not.toContain("Delete Ship the Web client");
    expect(html).toContain("Delete Review the diff");
  });
});
