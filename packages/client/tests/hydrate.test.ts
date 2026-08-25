import { describe, expect, it } from "vitest";
import {
  parseReplayLossyEvent,
  parseSessionHydrateResult,
} from "../src/hydrate.ts";

describe("session hydrate contract", () => {
  it("parses authoritative messages and injects session scope into replay envelopes", () => {
    const result = parseSessionHydrateResult({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 12 },
      messages: [
        {
          seq: 1,
          role: "assistant",
          content: "done",
          persisted_at: "2026-08-26T00:00:00Z",
          media: [],
        },
      ],
      replayed_tool_envelopes: [
        {
          thread_id: "thread-1",
          seq: 2,
          cursor: { stream: "coding:local:main", seq: 11 },
          turn_id: "turn-1",
          payload: {
            type: "tool_end",
            data: { tool_call_id: "tool-1", status: "complete" },
          },
        },
      ],
    });

    expect(result).toMatchObject({
      session_id: "coding:local:main",
      messages: [{ content: "done" }],
      replayed_tool_envelopes: [
        { session_id: "coding:local:main", thread_id: "thread-1" },
      ],
    });
  });

  it("fails closed on malformed message rows", () => {
    expect(
      parseSessionHydrateResult({
        session_id: "coding:local:main",
        cursor: { stream: "session", seq: 1 },
        messages: [{ seq: "one" }],
      }),
    ).toBeNull();
  });

  it("parses the explicit replay-loss signal", () => {
    expect(
      parseReplayLossyEvent({
        session_id: "coding:local:main",
        dropped_count: 4,
        last_durable_cursor: { stream: "session", seq: 22 },
      }),
    ).toEqual({
      session_id: "coding:local:main",
      dropped_count: 4,
      last_durable_cursor: { stream: "session", seq: 22 },
    });
  });
});
