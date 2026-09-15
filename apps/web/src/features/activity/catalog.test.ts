import { describe, expect, it, vi } from "vitest";
import { readActivityCatalog } from "./catalog.ts";
import {
  buildWorkspaceActivityModel,
  EMPTY_WORKSPACE_PRODUCT,
} from "../workspace/model.ts";
describe("confirmed-session activity catalog", () => {
  it("retains active work beyond 100 tasks and searches the confirmed display label", async () => {
    const tasks = Array.from({ length: 101 }, (_, i) => ({
      id: `task-${i}`,
      tool_name: "bash",
      tool_call_id: `call-${i}`,
      state: i === 100 ? "running" : "completed",
      status: i === 100 ? "running" : "completed",
      lifecycle_state: i === 100 ? "active" : "terminal",
      runtime_state: i === 100 ? "running" : "completed",
      started_at: "2026-09-06T00:00:00Z",
      updated_at: "2026-09-06T00:01:00Z",
      output_files: [],
    }));
    const catalog = await readActivityCatalog(
      {
        listTasks: async () => ({ session_id: "s1", tasks }),
      },
      ["s1"],
    );
    expect(catalog.tasksBySession.s1).toHaveLength(101);
    const model = buildWorkspaceActivityModel(
      {
        ...EMPTY_WORKSPACE_PRODUCT,
        activityTasksBySession: catalog.tasksBySession,
        activitySessionLabels: { s1: "Design review" },
      },
      "design",
      "running",
    );
    expect(model.rows.map((row) => row.taskId)).toEqual(["task-100"]);
    expect(model.rows[0]?.sessionTitle).toBe("Design review");
  });
  it("never opens Sessions and isolates wrong-session/failing snapshots", async () => {
    const listTasks = vi
      .fn()
      .mockImplementation(async ({ session_id }: { session_id: string }) => {
        if (session_id === "bad") throw new Error("unavailable");
        return {
          session_id: session_id === "wrong" ? "private" : session_id,
          tasks: [],
        };
      });
    const result = await readActivityCatalog({ listTasks }, [
      "a",
      "bad",
      "wrong",
      "a",
      "b",
    ]);
    expect(Object.keys(result.tasksBySession).sort()).toEqual(["a", "b"]);
    expect(result.unavailableSessions.sort()).toEqual(["bad", "wrong"]);
    expect(listTasks).toHaveBeenCalledTimes(4);
  });
  it("bounds simultaneous reads without imposing an eight-session wall", async () => {
    let active = 0,
      peak = 0;
    const listTasks = vi
      .fn()
      .mockImplementation(async ({ session_id }: { session_id: string }) => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        return { session_id, tasks: [] };
      });
    const result = await readActivityCatalog(
      { listTasks },
      Array.from({ length: 15 }, (_, i) => `s${i}`),
    );
    expect(Object.keys(result.tasksBySession)).toHaveLength(15);
    expect(peak).toBeLessThanOrEqual(4);
  });
});
