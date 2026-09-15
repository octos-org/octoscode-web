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

  it("accepts complete and compacted canonical replay with atomic checkpoints", () => {
    expect(parseSessionHydrateResult(canonicalHydrate())).toMatchObject({
      replayed_projection_envelopes: [{ session_id: "s", seq: 5 }],
      projection_thread_sequences: { t: 5, compacted: 12 },
    });
    const legacy = canonicalHydrate();
    delete legacy.replayed_projection_envelopes;
    delete legacy.projection_thread_sequences;
    expect(parseSessionHydrateResult(legacy)).not.toBeNull();
  });

  it("rejects malformed, foreign, duplicate, or future replay before accepting its cursor", () => {
    for (const change of [
      { projection_thread_sequences: null },
      { projection_thread_sequences: { t: -1 } },
      { projection_thread_sequences: { t: Number.MAX_SAFE_INTEGER + 1 } },
      { projection_thread_sequences: { t: 4 } },
      { projection_thread_sequences: { "": 5 } },
      { projection_thread_sequences: {} },
      { replayed_projection_envelopes: undefined },
      { projection_thread_sequences: undefined },
      { replayed_projection_envelopes: [canonicalEvent(), canonicalEvent()] },
      {
        replayed_projection_envelopes: [
          { ...canonicalEvent(), session_id: "foreign" },
        ],
      },
      {
        replayed_projection_envelopes: [
          { ...canonicalEvent(), cursor: { stream: "s", seq: 11 } },
        ],
      },
      {
        replayed_projection_envelopes: [
          { ...canonicalEvent(), cursor: { stream: "foreign", seq: 1 } },
        ],
      },
      {
        replayed_projection_envelopes: [
          {
            ...canonicalEvent(),
            payload: { type: "turn_terminal", data: { outcome: "invented" } },
          },
        ],
      },
    ]) {
      expect(
        parseSessionHydrateResult({ ...canonicalHydrate(), ...change }),
      ).toBeNull();
    }
  });
});

function canonicalEvent() {
  return {
    thread_id: "t",
    turn_id: "turn",
    seq: 5,
    payload: { type: "turn_terminal", data: { outcome: "interrupted" } },
  };
}

function canonicalHydrate(): Record<string, unknown> {
  return {
    session_id: "s",
    cursor: { stream: "s", seq: 10 },
    replayed_projection_envelopes: [canonicalEvent()],
    projection_thread_sequences: { t: 5, compacted: 12 },
  };
}
