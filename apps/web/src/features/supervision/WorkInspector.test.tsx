import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_SUPERVISION } from "./model.ts";
import { WorkInspector } from "./WorkInspector.tsx";

describe("WorkInspector", () => {
  it("renders runtime truth, plan, and supervised tasks", () => {
    const html = renderToStaticMarkup(
      <WorkInspector
        open={false}
        state={{
          ...EMPTY_SUPERVISION,
          taskListAvailable: true,
          taskOutputAvailable: true,
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
        onClose={vi.fn()}
        tokenCost={{
          sessionId: "s1",
          inputTokens: 128_000,
          outputTokens: 340,
          sessionCost: 0.12,
          contextWindow: 1_000_000,
        }}
      />,
    );
    expect(html).toContain("deepseek-v4");
    expect(html).toContain("deepseek");
    expect(html).toContain("Run checks");
    expect(html).toContain("Validate checks");
    expect(html).toContain("Context · 13%");
    expect(html).toContain('aria-label="Cancel Validate checks"');
    expect(html).toContain('id="work-inspector"');
    expect(html).toContain('aria-label="Close work inspector"');
  });
});
