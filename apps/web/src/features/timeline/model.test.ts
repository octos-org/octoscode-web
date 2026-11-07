import { describe, expect, it } from "vitest";
import { foldNotification, type TimelineEntry } from "./model.ts";

describe("timeline projection", () => {
  const projection = (
    type: string,
    data: Record<string, unknown>,
    seq: number,
  ) => ({
    jsonrpc: "2.0" as const,
    method: "projection/envelope",
    params: {
      session_id: "coding:local:main",
      thread_id: "thread-1",
      turn_id: "turn-1",
      seq,
      payload: { type, data },
    },
  });

  it("keeps the real Core persisted answer final when later-sequenced deltas arrive", () => {
    let entries: TimelineEntry[] = [];
    let seq = 1;
    const segment = "turn-1:assistant:iteration:2";
    for (const text of ["ST", "REAM", "_", "ORDER"])
      entries = foldNotification(
        entries,
        projection(
          "assistant_delta",
          { text, assistant_segment_id: segment },
          seq++,
        ),
      );
    entries = foldNotification(
      entries,
      projection(
        "assistant_persisted",
        {
          text: "STREAM_ORDER_FIRST_COMPLETE",
          assistant_segment_id: segment,
          meta: { message_id: "message-1" },
        },
        seq++,
      ),
    );
    for (const text of ["_F", "IR", "ST", "_COMP", "L", "ETE"])
      entries = foldNotification(
        entries,
        projection(
          "assistant_delta",
          { text, assistant_segment_id: segment },
          seq++,
        ),
      );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      body: "STREAM_ORDER_FIRST_COMPLETE",
      status: "complete",
    });
    // Another segment in the same still-active turn is independent.
    entries = foldNotification(
      entries,
      projection(
        "assistant_delta",
        { text: "Next segment", assistant_segment_id: "next" },
        seq++,
      ),
    );
    expect(entries.at(-1)).toMatchObject({
      body: "Next segment",
      status: "running",
    });
  });
});
