import { describe, expect, it } from "vitest";
import { appendTaskOutputDelta, EMPTY_TASK_DETAIL } from "./model.ts";

describe("supervision model", () => {
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
});
