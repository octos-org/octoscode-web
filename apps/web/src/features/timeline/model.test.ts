import { describe, expect, it } from "vitest";
import { foldNotification } from "./model.ts";

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
});
