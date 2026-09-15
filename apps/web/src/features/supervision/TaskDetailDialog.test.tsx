import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_SUPERVISION } from "./model.ts";
import { TaskDetailDialog } from "./TaskDetailDialog.tsx";

describe("TaskDetailDialog", () => {
  it("renders only panes backed by advertised detail methods", () => {
    const taskId = "00000000-0000-4000-8000-000000000099";
    const state = {
      ...EMPTY_SUPERVISION,
      tasks: [
        {
          id: taskId,
          title: "Inspect evidence",
          toolName: "spawn_agent",
          state: "completed" as const,
          status: "completed",
          artifactCount: 0,
          outputFiles: [],
        },
      ],
      detail: {
        ...EMPTY_SUPERVISION.detail,
        active: true,
        taskId,
      },
    };
    const callbacks = {
      onClose: vi.fn(),
      onLoadMore: vi.fn(),
      onReadArtifact: vi.fn(),
      onLoadMoreArtifact: vi.fn(),
    };

    const outputOnly = renderToStaticMarkup(
      <TaskDetailDialog
        {...callbacks}
        state={{ ...state, taskOutputAvailable: true }}
      />,
    );
    expect(outputOnly).toContain("Output");
    expect(outputOnly).not.toContain("Artifacts");

    const artifactOnly = renderToStaticMarkup(
      <TaskDetailDialog
        {...callbacks}
        state={{ ...state, artifactsAvailable: true }}
      />,
    );
    expect(artifactOnly).not.toContain("Output");
    expect(artifactOnly).not.toContain("No output has been captured.");
    expect(artifactOnly).toContain("Artifacts");
    expect(artifactOnly).toContain("No artifacts were reported.");
  });
});
