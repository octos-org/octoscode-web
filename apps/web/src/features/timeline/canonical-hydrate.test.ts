import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ProjectionEnvelopeV2,
  type SessionHydrateResult,
} from "@octos-org/octoscode-client";
import { foldNotification } from "./model.ts";
import { timelineFromCanonicalHydrate as timelineFromHydrate } from "./canonical-hydrate.ts";

function event(
  seq: number,
  type: string,
  data: unknown,
  extra: Partial<ProjectionEnvelopeV2> = {},
): ProjectionEnvelopeV2 {
  return {
    session_id: "s",
    thread_id: "thread",
    turn_id: "turn",
    seq,
    cursor: { stream: "s", seq },
    payload: { type, data },
    ...extra,
  };
}
function snapshot(
  events: ProjectionEnvelopeV2[],
  extra: Partial<SessionHydrateResult> = {},
): SessionHydrateResult {
  return {
    session_id: "s",
    cursor: { stream: "s", seq: 100 },
    messages: [],
    replayed_projection_envelopes: events,
    projection_thread_sequences: { thread: events.length },
    ...extra,
  };
}
function message(
  seq: number,
  role: string,
  content: string,
  extra: Record<string, string> = {},
) {
  return {
    seq,
    role,
    content,
    media: [],
    persisted_at: "2026-09-15T00:00:00Z",
    thread_id: "thread",
    ...extra,
  };
}

describe("canonical hydrate recovery", () => {
  // Replayed entries carry wall-clock start/end stamps. Tests that build the
  // same snapshot twice must compare equal, so pin the clock for the file.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores an interrupted unpersisted prompt, partial answer, and error instead of an empty conversation", () => {
    const data = snapshot(
      [
        event(1, "user_message", { text: "Investigate the failure" }),
        event(2, "assistant_delta", { text: "I found the first cause" }),
        event(3, "turn_terminal", {
          outcome: "interrupted",
          error: {
            code: "connection_closed",
            message: "Connection closed before turn completed",
          },
        }),
      ],
      {
        turns: [{ turn_id: "turn", thread_id: "thread", state: "interrupted" }],
      },
    );
    const restored = timelineFromHydrate(data);
    expect(restored.map((entry) => [entry.kind, entry.body])).toEqual([
      ["user", "Investigate the failure"],
      ["assistant", "I found the first cause"],
      ["system", "Connection closed before turn completed"],
    ]);
    expect(restored.every((entry) => entry.status !== "running")).toBe(true);
    expect(timelineFromHydrate(data)).toEqual(restored);
  });

  it("reconstructs event order without duplicating durable messages, reasoning, tools, or same-turn steers", () => {
    const fullOutput = "x".repeat(220);
    const events = [
      event(
        1,
        "user_message",
        { text: "Question" },
        { client_message_id: "question" },
      ),
      event(2, "reasoning_delta", { text: "Before tool" }),
      event(3, "tool_start", {
        tool_call_id: "call",
        name: "read_file",
        arguments_preview: "file",
      }),
      event(4, "tool_end", {
        tool_call_id: "call",
        status: "complete",
        output_preview: `${"x".repeat(200)}...`,
      }),
      event(
        5,
        "user_message",
        { text: "Also test it" },
        { client_message_id: "steer1" },
      ),
      event(
        6,
        "user_message",
        { text: "Also test it" },
        { client_message_id: "steer2" },
      ),
      event(7, "reasoning_delta", { text: "After tool" }),
      event(8, "assistant_delta", { text: "The answer" }),
      event(9, "assistant_persisted", {
        text: "The answer",
        meta: { message_id: "answer" },
      }),
      event(10, "turn_terminal", { outcome: "completed" }),
    ];
    const data = snapshot(events, {
      messages: [
        message(0, "user", "Question", { client_message_id: "question" }),
        message(1, "tool", fullOutput),
        message(2, "user", "Also test it", { client_message_id: "steer1" }),
        message(3, "user", "Also test it", { client_message_id: "steer2" }),
        message(4, "assistant", "The answer", {
          message_id: "answer",
          reasoning_content: "Before toolAfter tool",
        }),
      ],
      turns: [{ turn_id: "turn", thread_id: "thread", state: "completed" }],
    });
    const entries = timelineFromHydrate(data);
    expect(entries.map((entry) => [entry.kind, entry.body])).toEqual([
      ["user", "Question"],
      ["reasoning", "Before tool"],
      ["tool", fullOutput],
      ["user", "Also test it"],
      ["user", "Also test it"],
      ["reasoning", "After tool"],
      ["assistant", "The answer"],
      ["system", ""],
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(timelineFromHydrate(data)).toEqual(entries);
    const late = foldNotification(entries, {
      jsonrpc: "2.0",
      method: "projection/envelope",
      params: event(11, "assistant_delta", { text: "late" }),
    });
    expect(late).toEqual(entries);
  });
});
