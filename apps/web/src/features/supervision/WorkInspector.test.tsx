import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_SUPERVISION } from "./model.ts";
import { WorkInspector } from "./WorkInspector.tsx";

describe("WorkInspector", () => {
  it("renders runtime truth, plan, and supervised tasks", () => {
    const html = renderToStaticMarkup(
      <WorkInspector
        state={{
          ...EMPTY_SUPERVISION,
          available: true,
          cancelAvailable: true,
          runtimeStatus: {
            session_id: "s1",
            model: { model: "deepseek-v4", provider: "deepseek" },
            sandbox: "workspace_write",
            network: "blocked",
            mcp_servers: [],
          },
          plan: {
            sessionId: "s1",
            title: "Ship",
            updatedAtMs: 42,
            items: [{ id: "one", title: "Run checks", status: "in_progress" }],
          },
          tasks: [
            {
              id: "00000000-0000-4000-8000-000000000099",
              title: "Validate checks",
              toolName: "spawn_agent",
              role: "test_worker",
              state: "running",
              status: "checking",
              artifactCount: 1,
              outputFiles: [],
            },
          ],
        }}
        features={[]}
        events={[]}
        onRefresh={vi.fn()}
        onOpenTask={vi.fn()}
        onCancelTask={vi.fn()}
      />,
    );
    expect(html).toContain("deepseek-v4");
    expect(html).toContain("Run checks");
    expect(html).toContain("Validate checks");
    expect(html).toContain('aria-label="Cancel Validate checks"');
  });
});
