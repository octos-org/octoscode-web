import { describe, expect, it } from "vitest";
import type {
  ProjectionEnvelopeV2,
  SessionHydrateResult,
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
  it("uses unique message identity to link a parent-client transcript to its background child and retains attachments", () => {
    const background = event(
      1,
      "background/spawn_complete",
      {
        task_id: "task",
        parent_turn_id: "turn",
        response_to_client_message_id: "parent-client",
        message_id: "background-message",
        content: "Background result",
        media: ["report.md"],
      },
      { thread_id: "turn:background:task", turn_id: "turn:background:task" },
    );
    const data = snapshot([background], {
      messages: [
        {
          ...message(0, "assistant", "Background result", {
            thread_id: "parent-client",
            message_id: "background-message",
            source: "background",
          }),
          media: ["report.md"],
        },
      ],
      replayed_envelopes: [background],
      projection_thread_sequences: { "turn:background:task": 1 },
    });
    expect(timelineFromHydrate(data)).toMatchObject([
      {
        id: "hydrated:background-message",
        body: "Background result\n\nAttachment: report.md",
        turnId: "turn:background:task",
      },
    ]);
    expect(timelineFromHydrate(data)).toHaveLength(1);
  });

  it("does not choose a child when the same message identity claims two different streams", () => {
    const events = ["child-a", "child-b"].map((thread, index) =>
      event(
        1,
        "background/spawn_complete",
        {
          task_id: thread,
          parent_turn_id: "turn",
          response_to_client_message_id: "parent-client",
          message_id: "shared-message",
          content: "Shared result",
          media: ["report.md"],
        },
        {
          thread_id: thread,
          turn_id: thread,
          cursor: { stream: "s", seq: index + 1 },
        },
      ),
    );
    const data = snapshot(events, {
      messages: [
        {
          ...message(0, "assistant", "Shared result", {
            thread_id: "parent-client",
            message_id: "shared-message",
            source: "background",
          }),
          media: ["report.md"],
        },
      ],
      replayed_envelopes: events,
      projection_thread_sequences: { "child-a": 1, "child-b": 1 },
    });
    const restored = timelineFromHydrate(data);
    expect(
      restored.find((entry) => entry.id === "hydrated:shared-message")?.body,
    ).toBe("Shared result\n\nAttachment: report.md");
    expect(restored.map((entry) => entry.id)).toEqual([
      "hydrated:shared-message",
      "background:child-a",
      "background:child-b",
    ]);
  });

  it("retains global replay order when multiple complete threads have no durable anchors", () => {
    const events = [
      event(1, "user_message", { text: "A question" }),
      event(
        1,
        "user_message",
        { text: "B question" },
        {
          thread_id: "thread-b",
          turn_id: "turn-b",
          cursor: { stream: "s", seq: 2 },
        },
      ),
      event(
        2,
        "assistant_delta",
        { text: "A answer" },
        { cursor: { stream: "s", seq: 3 } },
      ),
      event(
        2,
        "assistant_delta",
        { text: "B answer" },
        {
          thread_id: "thread-b",
          turn_id: "turn-b",
          cursor: { stream: "s", seq: 4 },
        },
      ),
    ];
    expect(
      timelineFromHydrate(
        snapshot(events, {
          projection_thread_sequences: { thread: 2, "thread-b": 2 },
        }),
      ).map((entry) => entry.body),
    ).toEqual(["A question", "B question", "A answer", "B answer"]);
  });

  it("places an unpersisted foreground question before an interleaved durable background completion", () => {
    const background = event(
      1,
      "background/spawn_complete",
      {
        task_id: "task",
        message_id: "background-message",
        content: "Background result",
        media: [],
      },
      { thread_id: "child", turn_id: "child", cursor: { stream: "s", seq: 2 } },
    );
    const data = snapshot(
      [
        event(1, "user_message", { text: "Foreground question" }),
        background,
        event(
          2,
          "assistant_delta",
          { text: "Foreground partial answer" },
          { cursor: { stream: "s", seq: 3 } },
        ),
      ],
      {
        messages: [
          message(0, "assistant", "Background result", {
            thread_id: "parent-client",
            message_id: "background-message",
            source: "background",
          }),
        ],
        replayed_envelopes: [background],
        projection_thread_sequences: { thread: 2, child: 1 },
      },
    );
    expect(timelineFromHydrate(data).map((entry) => entry.body)).toEqual([
      "Foreground question",
      "Background result",
      "Foreground partial answer",
    ]);
  });

  it("preserves interleaved durable anchors from different threads", () => {
    const events = [
      event(
        1,
        "user_message",
        { text: "A question" },
        { client_message_id: "ua" },
      ),
      event(
        1,
        "user_message",
        { text: "B question" },
        {
          thread_id: "thread-b",
          turn_id: "turn-b",
          client_message_id: "ub",
          cursor: { stream: "s", seq: 2 },
        },
      ),
      event(
        2,
        "assistant_persisted",
        { text: "A answer", meta: { message_id: "ma" } },
        { cursor: { stream: "s", seq: 3 } },
      ),
      event(
        2,
        "assistant_persisted",
        { text: "B answer", meta: { message_id: "mb" } },
        {
          thread_id: "thread-b",
          turn_id: "turn-b",
          cursor: { stream: "s", seq: 4 },
        },
      ),
    ];
    const data = snapshot(events, {
      projection_thread_sequences: { thread: 2, "thread-b": 2 },
      messages: [
        message(0, "user", "A question", { client_message_id: "ua" }),
        message(1, "user", "B question", {
          client_message_id: "ub",
          thread_id: "thread-b",
        }),
        message(2, "assistant", "A answer", { message_id: "ma" }),
        message(3, "assistant", "B answer", {
          message_id: "mb",
          thread_id: "thread-b",
        }),
      ],
    });
    expect(timelineFromHydrate(data).map((entry) => entry.body)).toEqual([
      "A question",
      "B question",
      "A answer",
      "B answer",
    ]);
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

  it("keeps durable full answers and compacted thread reasoning while restoring terminal detail", () => {
    const data = snapshot(
      [
        event(20, "turn_terminal", {
          outcome: "errored",
          error: { code: "failure", message: "Provider stopped" },
        }),
      ],
      {
        projection_thread_sequences: { thread: 20 },
        messages: [
          message(0, "user", "Question"),
          message(1, "assistant", "Full durable answer", {
            reasoning_content: "Full reasoning",
          }),
        ],
      },
    );
    expect(timelineFromHydrate(data).map((entry) => entry.body)).toEqual([
      "Question",
      "Full reasoning",
      "Full durable answer",
      "Provider stopped",
    ]);
  });

  it("does not infer missing partial replay or erase ambiguous durable inputs", () => {
    const compacted = snapshot(
      [event(3, "assistant_delta", { text: "trailing fragment" })],
      {
        projection_thread_sequences: { thread: 3 },
        messages: [message(0, "assistant", "Full answer")],
      },
    );
    expect(timelineFromHydrate(compacted).map((entry) => entry.body)).toEqual([
      "Full answer",
    ]);
    const repeated = snapshot(
      [
        event(1, "user_message", { text: "Repeat" }),
        event(2, "user_message", { text: "Repeat" }),
      ],
      {
        messages: [message(0, "user", "Repeat"), message(1, "user", "Repeat")],
      },
    );
    const restored = timelineFromHydrate(repeated);
    expect(
      restored
        .filter((entry) => entry.id.startsWith("hydrated:"))
        .map((entry) => entry.body),
    ).toEqual(["Repeat", "Repeat"]);
  });

  it("keeps old Core interrupted/error state visible without inventing the lost prompt", () => {
    const hydrated = {
      session_id: "s",
      cursor: { stream: "s", seq: 1 },
      messages: [],
      turns: [{ turn_id: "turn", state: "interrupted" }],
    };
    const entries = timelineFromHydrate(hydrated);
    expect(entries).toMatchObject([
      {
        id: "terminal:turn",
        title: "Turn stopped",
        body: "This turn was stopped before it completed.",
        latestTurnOutcome: "interrupted",
      },
    ]);
    expect(entries.some((entry) => entry.kind === "user")).toBe(false);
    const later = timelineFromHydrate({
      ...hydrated,
      messages: [message(2, "assistant", "Done", { turn_id: "next" })],
      turns: [...hydrated.turns, { turn_id: "next", state: "completed" }],
    });
    expect(later.findLast((entry) => entry.latestTurnOutcome)).toMatchObject({
      turnId: "next",
      latestTurnOutcome: "completed",
    });
    expect(later[0]?.id).toBe("terminal:turn");
  });
});
