import { describe, expect, it } from "vitest";
import { foldNotification, timelineFromHydrate } from "./model.ts";

describe("timeline projection", () => {
  it("folds canonical assistant deltas by segment", () => {
    const first = foldNotification([], {
      jsonrpc: "2.0",
      method: "projection/envelope",
      params: {
        session_id: "coding:local:main",
        thread_id: "thread-1",
        seq: 1,
        turn_id: "turn-1",
        payload: {
          type: "assistant_delta",
          data: { text: "hel", assistant_segment_id: "segment-1" },
        },
      },
    });
    const second = foldNotification(first, {
      jsonrpc: "2.0",
      method: "projection/envelope",
      params: {
        session_id: "coding:local:main",
        thread_id: "thread-1",
        seq: 2,
        turn_id: "turn-1",
        payload: {
          type: "assistant_delta",
          data: { text: "lo", assistant_segment_id: "segment-1" },
        },
      },
    });

    expect(second).toHaveLength(1);
    expect(second[0]?.body).toBe("hello");
  });

  it("surfaces invalid negotiated projection frames", () => {
    const result = foldNotification([], {
      jsonrpc: "2.0",
      method: "projection/envelope",
      params: { seq: 1 },
    });
    expect(result[0]).toMatchObject({ kind: "system", status: "error" });
  });

  it("rebuilds durable transcript rows and reasoning from hydrate", () => {
    const result = timelineFromHydrate({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 8 },
      messages: [
        {
          seq: 1,
          role: "user",
          content: "fix the test",
          turn_id: "turn-1",
          persisted_at: "2026-08-26T00:00:00Z",
          media: [],
        },
        {
          seq: 2,
          role: "assistant",
          content: "Done",
          turn_id: "turn-1",
          persisted_at: "2026-08-26T00:00:01Z",
          reasoning_content: "Inspecting the failure",
          message_id: "message-1",
          media: ["report.md"],
        },
      ],
    });

    expect(result.map((entry) => entry.kind)).toEqual([
      "user",
      "reasoning",
      "assistant",
    ]);
    expect(result[2]).toMatchObject({
      messageId: "message-1",
      body: "Done\n\nAttachment: report.md",
    });
  });

  it("coalesces a replayed persisted envelope by durable message id", () => {
    const hydrated = timelineFromHydrate({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 8 },
      messages: [
        {
          seq: 2,
          role: "assistant",
          content: "old",
          turn_id: "turn-1",
          persisted_at: "2026-08-26T00:00:01Z",
          message_id: "message-1",
          media: [],
        },
      ],
    });
    const result = foldNotification(hydrated, {
      jsonrpc: "2.0",
      method: "projection/envelope",
      params: {
        session_id: "coding:local:main",
        thread_id: "thread-1",
        seq: 4,
        cursor: { stream: "coding:local:main", seq: 9 },
        turn_id: "turn-1",
        payload: {
          type: "assistant_persisted",
          data: {
            text: "canonical",
            assistant_segment_id: "segment-1",
            meta: { message_id: "message-1" },
          },
        },
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.body).toBe("canonical");
  });

  it("uses the core v2 tool progress and completion wire values", () => {
    const start = foldNotification([], {
      jsonrpc: "2.0",
      method: "projection/envelope",
      params: {
        session_id: "coding:local:main",
        thread_id: "thread-1",
        seq: 1,
        turn_id: "turn-1",
        payload: {
          type: "tool_start",
          data: { tool_call_id: "tool-1", name: "shell" },
        },
      },
    });
    const progress = foldNotification(start, {
      jsonrpc: "2.0",
      method: "projection/envelope",
      params: {
        session_id: "coding:local:main",
        thread_id: "thread-1",
        seq: 2,
        turn_id: "turn-1",
        payload: {
          type: "tool_progress",
          data: { tool_call_id: "tool-1", message: "running tests" },
        },
      },
    });
    const end = foldNotification(progress, {
      jsonrpc: "2.0",
      method: "projection/envelope",
      params: {
        session_id: "coding:local:main",
        thread_id: "thread-1",
        seq: 3,
        turn_id: "turn-1",
        payload: {
          type: "tool_end",
          data: {
            tool_call_id: "tool-1",
            status: "complete",
            output_preview: "3 passed",
          },
        },
      },
    });

    expect(progress[0]?.body).toBe("running tests");
    expect(end[0]).toMatchObject({ body: "3 passed", status: "complete" });
  });
});
