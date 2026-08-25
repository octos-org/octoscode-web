import { describe, expect, it } from "vitest";
import {
  appendTaskArtifactPage,
  appendTaskOutputDelta,
  applyTaskUpdated,
  EMPTY_TASK_DETAIL,
  taskIsCancellable,
  tasksFromList,
} from "./model.ts";

describe("supervision model", () => {
  it("maps authoritative lists and merges sparse live updates", () => {
    const tasks = tasksFromList([
      {
        id: "00000000-0000-4000-8000-000000000099",
        tool_name: "spawn_agent",
        tool_call_id: "tool-1",
        state: "running",
        status: "checking",
        lifecycle_state: "running",
        runtime_state: "running",
        role: "test_worker",
        artifact_count: 1,
        started_at: "2026-08-26T00:00:00Z",
        updated_at: "2026-08-26T00:00:01Z",
        output_files: [],
      },
    ]);
    const next = applyTaskUpdated(tasks, {
      sessionId: "s1",
      taskId: tasks[0]!.id,
      title: "Tests",
      state: "completed",
      summary: "All checks passed",
    });
    expect(next[0]).toMatchObject({
      title: "All checks passed",
      state: "completed",
      role: "test_worker",
      artifactCount: 1,
    });
    expect(taskIsCancellable(next[0]!)).toBe(false);
  });

  it("deduplicates replayed output deltas by byte cursor", () => {
    const taskId = "00000000-0000-4000-8000-000000000099";
    const detail = {
      ...EMPTY_TASK_DETAIL,
      active: true,
      taskId,
      text: "hello ",
      output: {
        session_id: "s1",
        task_id: taskId,
        source: "runtime_projection",
        cursor: { offset: 0 },
        next_cursor: { offset: 6 },
        text: "hello ",
        bytes_read: 6,
        total_bytes: 6,
        truncated: false,
        complete: true,
        live_tail_supported: true,
        is_snapshot_projection: true,
        task_status: "running",
        runtime_state: "running",
        lifecycle_state: "running",
        output_files: [],
        limitations: [],
      },
    };
    const replayed = appendTaskOutputDelta(detail, {
      sessionId: "s1",
      taskId,
      cursor: { offset: 0 },
      text: "hello world",
    });
    expect(replayed.text).toBe("hello world");
    expect(replayed.output?.next_cursor.offset).toBe(11);
    expect(
      appendTaskOutputDelta(replayed, {
        sessionId: "s1",
        taskId,
        cursor: { offset: 0 },
        text: "hello world",
      }),
    ).toBe(replayed);
  });

  it("uses UTF-8 byte offsets and fails closed on a live output gap", () => {
    const taskId = "00000000-0000-4000-8000-000000000099";
    const detail = {
      ...EMPTY_TASK_DETAIL,
      taskId,
      text: "猫",
      output: {
        session_id: "s1",
        task_id: taskId,
        source: "runtime_projection",
        cursor: { offset: 0 },
        next_cursor: { offset: 3 },
        text: "猫",
        bytes_read: 3,
        total_bytes: 3,
        truncated: false,
        complete: true,
        live_tail_supported: true,
        is_snapshot_projection: true,
        task_status: "running",
        runtime_state: "running",
        lifecycle_state: "running",
        output_files: [],
        limitations: [],
      },
    };
    const appended = appendTaskOutputDelta(detail, {
      sessionId: "s1",
      taskId,
      cursor: { offset: 3 },
      text: " ok",
    });
    expect(appended.text).toBe("猫 ok");
    expect(appended.output?.next_cursor.offset).toBe(6);
    expect(
      appendTaskOutputDelta(detail, {
        sessionId: "s1",
        taskId,
        cursor: { offset: 4 },
        text: "gap",
      }).error,
    ).toContain("cursor gap");
  });

  it("appends matching artifact pages", () => {
    const taskId = "00000000-0000-4000-8000-000000000099";
    const base = {
      session_id: "s1",
      task_id: taskId,
      artifact: {
        id: "report",
        title: "Report",
        kind: "text",
        status: "ready",
      },
      content: "first ",
      next_cursor: { offset: 6 },
      has_more: true,
    };
    expect(
      appendTaskArtifactPage(base, {
        ...base,
        content: "second",
        cursor: { offset: 6 },
        next_cursor: { offset: 12 },
        has_more: false,
      }),
    ).toMatchObject({ content: "first second", has_more: false });
  });
});
