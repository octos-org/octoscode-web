import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_SUPERVISION, type SupervisionRuntimeState } from "./model.ts";
import { SessionTrajectory } from "./SessionTrajectory.tsx";

const task = {
  id: "00000000-0000-4000-8000-000000000099",
  title: "Validate product checks",
  toolName: "spawn_agent",
  state: "running",
  status: "checking",
  artifactCount: 0,
  outputFiles: [],
};

describe("SessionTrajectory", () => {
  it("renders only capability-backed sections", () => {
    const none = renderTrajectory(EMPTY_SUPERVISION);
    expect(none).not.toContain("Session status");
    expect(none).not.toContain(">Plan<");
    expect(none).not.toContain("Background tasks");
    expect(none).not.toContain("Refresh");

    const planOnly = renderTrajectory({
      ...EMPTY_SUPERVISION,
      planAvailable: true,
    });
    expect(planOnly).toContain(">Plan<");
    expect(planOnly).not.toContain("Background tasks");
    expect(planOnly).not.toContain("Refresh");

    const statusOnly = renderTrajectory({
      ...EMPTY_SUPERVISION,
      statusAvailable: true,
    });
    expect(statusOnly).toContain("Session status");
    expect(statusOnly).toContain("Refresh");
    expect(statusOnly).not.toContain("Background tasks");
  });

  it("lists tasks without inventing a detail control when output is unavailable", () => {
    const listOnly = renderTrajectory({
      ...EMPTY_SUPERVISION,
      taskListAvailable: true,
      tasks: [task],
    });
    const withOutput = renderTrajectory({
      ...EMPTY_SUPERVISION,
      taskListAvailable: true,
      taskOutputAvailable: true,
      tasks: [task],
    });

    expect(listOnly).toContain("Background tasks");
    expect(listOnly).toContain("Validate product checks");
    expect(listOnly.match(/type="button"/g)).toHaveLength(1);
    expect(withOutput.match(/type="button"/g)).toHaveLength(2);
  });
});

function renderTrajectory(state: SupervisionRuntimeState): string {
  return renderToStaticMarkup(
    <SessionTrajectory
      state={state}
      onRefresh={vi.fn()}
      onOpenTask={vi.fn()}
      onCancelTask={vi.fn()}
    />,
  );
}
