import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_WORKSPACE_PRODUCT } from "../workspace/model.ts";
import { ActivityNavigator } from "./ActivityNavigator.tsx";

describe("ActivityNavigator", () => {
  it("renders server tasks with current and background actions", () => {
    const task = {
      tool_name: "spawn_agent",
      tool_call_id: "call-1",
      state: "running",
      status: "checking",
      lifecycle_state: "active",
      runtime_state: "running",
      role: "reviewer",
      summary: "Review protocol drift",
      started_at: "2026-08-26T00:00:00Z",
      updated_at: "2026-08-26T00:01:00Z",
      output_files: [],
    };
    const html = renderToStaticMarkup(
      <ActivityNavigator
        open
        state={{
          ...EMPTY_WORKSPACE_PRODUCT,
          sessions: [
            { id: "coding:main", message_count: 2, title: "Implementation" },
            { id: "coding:review", message_count: 1, title: "Review" },
          ],
          activityTasksBySession: {
            "coding:main": [{ ...task, id: "current" }],
            "coding:review": [{ ...task, id: "background" }],
          },
        }}
        activeSessionId="coding:main"
        switchBlocked={false}
        onClose={vi.fn()}
        onOpenSession={vi.fn()}
        onInspectCurrentTask={vi.fn()}
      />,
    );
    expect(html).toContain("Across recent sessions");
    expect(html).toContain("Review protocol drift");
    expect(html).toContain("Inspect Review protocol drift");
    expect(html).toContain("Open Review");
  });
});
