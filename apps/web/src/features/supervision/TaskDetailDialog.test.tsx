import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_SUPERVISION } from "./model.ts";
import { TaskDetailDialog } from "./TaskDetailDialog.tsx";

describe("TaskDetailDialog", () => {
  it("renders captured output and artifact evidence", () => {
    const taskId = "00000000-0000-4000-8000-000000000099";
    const html = renderToStaticMarkup(
      <TaskDetailDialog
        state={{
          ...EMPTY_SUPERVISION,
          artifactsAvailable: true,
          tasks: [
            {
              id: taskId,
              title: "Validate checks",
              toolName: "spawn_agent",
              state: "completed",
              status: "completed",
              artifactCount: 1,
              outputFiles: [],
            },
          ],
          detail: {
            ...EMPTY_SUPERVISION.detail,
            active: true,
            taskId,
            text: "68 tests passed",
            artifacts: {
              session_id: "s1",
              task_id: taskId,
              artifacts: [
                {
                  id: "report",
                  title: "Check report",
                  kind: "text",
                  status: "ready",
                },
              ],
            },
          },
        }}
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onReadArtifact={vi.fn()}
        onLoadMoreArtifact={vi.fn()}
      />,
    );
    expect(html).toContain("Validate checks");
    expect(html).toContain("68 tests passed");
    expect(html).toContain("Check report");
  });
});
