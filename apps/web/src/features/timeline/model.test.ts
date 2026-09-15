import { describe, expect, it } from "vitest";
import {
  addSystemMessage,
  foldNotification,
  terminalTurnOutcome,
  timelineActivity,
  timelineFromHydrate,
  type TimelineEntry,
} from "./model.ts";

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

  it("preserves received history so the view can reveal earlier activity", () => {
    let entries: TimelineEntry[] = [];
    for (let index = 0; index < 205; index += 1) {
      entries = addSystemMessage(
        entries,
        `event:${index}`,
        "Event",
        String(index),
      );
    }

    expect(entries).toHaveLength(205);
    expect(entries[0]).toMatchObject({ id: "event:0", body: "0" });
    expect(entries.at(-1)?.body).toBe("204");
  });

  it("decodes canonical terminal outcomes for transport ownership", () => {
    expect(
      terminalTurnOutcome({
        jsonrpc: "2.0",
        method: "projection/envelope",
        params: {
          session_id: "coding:local:main",
          thread_id: "thread-1",
          seq: 3,
          turn_id: "turn-1",
          payload: {
            type: "turn_terminal",
            data: { outcome: "completed" },
          },
        },
      }),
    ).toBe("completed");
    expect(
      terminalTurnOutcome({
        jsonrpc: "2.0",
        method: "turn/error",
        params: { session_id: "coding:local:main", turn_id: "turn-1" },
      }),
    ).toBe("failed");
  });

  it("sweeps stale streaming tails when the turn completes", () => {
    let entries: TimelineEntry[] = [];
    const push = (payload: Record<string, unknown>, seq: number) => {
      entries = foldNotification(entries, {
        jsonrpc: "2.0",
        method: "projection/envelope",
        params: {
          session_id: "coding:local:main",
          thread_id: "thread-1",
          seq,
          turn_id: "turn-1",
          payload,
        },
      });
    };

    // Two streaming segments (a segment boundary split mid-word).
    push(
      {
        type: "assistant_delta",
        data: {
          text: "TypeScript is a strongly ",
          assistant_segment_id: "segment-1",
        },
      },
      1,
    );
    push(
      {
        type: "assistant_delta",
        data: {
          text: "typed superset of JavaScript",
          assistant_segment_id: "segment-2",
        },
      },
      2,
    );
    // Persisted transcript covers the whole reply.
    push(
      {
        type: "assistant_persisted",
        data: {
          text: "TypeScript is a strongly typed superset of JavaScript",
          message_id: "msg-1",
        },
      },
      3,
    );
    push({ type: "turn_terminal", data: { outcome: "completed" } }, 4);

    const assistant = entries.filter(
      (entry) => entry.turnId === "turn-1" && entry.kind === "assistant",
    );
    // The persisted message is the single authoritative assistant entry.
    expect(assistant).toHaveLength(1);
    expect(assistant[0]?.status).toBe("complete");
    expect(assistant[0]?.body).toContain("typed superset");
    // Nothing is left with a stale "running" badge after the terminal event.
    expect(entries.some((entry) => entry.status === "running")).toBe(false);
  });
});

function project(
  entries: readonly TimelineEntry[],
  type: string,
  data: Record<string, unknown>,
  turnId = "turn-1",
): TimelineEntry[] {
  return foldNotification(entries, {
    jsonrpc: "2.0",
    method: "projection/envelope",
    params: {
      session_id: "coding:local:main",
      thread_id: "thread-1",
      seq: 1,
      turn_id: turnId,
      payload: { type, data },
    },
  });
}

describe("streaming lifecycle regressions", () => {
  it.each([
    ["skipped", "Skipped"],
    ["aborted", "Stopped"],
  ])(
    "keeps the tool outcome %s explicit in its disclosure",
    (status, statusLabel) => {
      let entries = project([], "tool_start", {
        tool_call_id: "tool-1",
        name: "shell",
      });
      entries = project(entries, "tool_end", {
        tool_call_id: "tool-1",
        status,
        reason: "The operation did not run to completion.",
      });
      expect(entries[0]).toMatchObject({
        statusLabel,
        body: "The operation did not run to completion.",
      });
      expect(entries[0]?.status).not.toBe("running");
    },
  );

  it.each(["completed", "errored", "interrupted"])(
    "settles every active entry by turn identity on %s, regardless of entry id",
    (outcome) => {
      const entries: TimelineEntry[] = [
        {
          id: "nonstandard-reasoning-id",
          kind: "reasoning",
          title: "Reasoning",
          body: "Investigating",
          status: "running",
          turnId: "turn-1",
        },
        {
          id: "assistant:turn-1",
          kind: "assistant",
          title: "Octos",
          body: "Partial answer",
          status: "running",
          turnId: "turn-1",
        },
        {
          id: "tool:one",
          kind: "tool",
          title: "read_file",
          body: "README.md",
          status: "running",
          turnId: "turn-1",
        },
        {
          id: "other",
          kind: "reasoning",
          title: "Reasoning",
          body: "Another turn",
          status: "running",
          turnId: "turn-2",
        },
      ];
      const result = project(entries, "turn_terminal", { outcome });
      expect(
        result
          .filter((entry) => entry.turnId === "turn-1")
          .every((entry) => entry.status !== "running"),
      ).toBe(true);
      expect(result.find((entry) => entry.id === "other")?.status).toBe(
        "running",
      );
      expect(
        result.find((entry) => entry.id === "nonstandard-reasoning-id")?.body,
      ).toBe("Investigating");
    },
  );

  it.each(["turn/completed", "turn/error"])(
    "settles legacy notifications for %s",
    (method) => {
      const entries = foldNotification([], {
        jsonrpc: "2.0",
        method: "message/reasoning_delta",
        params: { turn_id: "turn-1", text: "Investigating" },
      });
      const result = foldNotification(entries, {
        jsonrpc: "2.0",
        method,
        params: { turn_id: "turn-1" },
      });
      expect(result.every((entry) => entry.status !== "running")).toBe(true);
    },
  );

  it("keeps authoritative persisted text when its queued delta arrives late", () => {
    let entries = project([], "assistant_delta", {
      assistant_segment_id: "answer",
      text: "Final ",
    });
    entries = project(entries, "assistant_persisted", {
      assistant_segment_id: "answer",
      text: "Final answer",
      meta: { message_id: "msg-1", media: ["report.md"] },
    });
    entries = project(entries, "assistant_delta", {
      assistant_segment_id: "answer",
      text: "answer",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      body: "Final answer\n\nAttachment: report.md",
      status: "complete",
      messageId: "msg-1",
    });
  });

  it("recognizes a late delta even when persistence coalesced with a hydrated message id", () => {
    let entries = timelineFromHydrate({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 10 },
      messages: [
        {
          seq: 1,
          role: "assistant",
          content: "Final answer",
          message_id: "message-1",
          turn_id: "turn-1",
          persisted_at: "2026-09-14T00:00:00Z",
          media: [],
        },
      ],
    });
    entries = project(entries, "assistant_persisted", {
      text: "Final answer",
      assistant_segment_id: "answer",
      meta: { message_id: "message-1" },
    });
    entries = project(entries, "assistant_delta", {
      text: "answer",
      assistant_segment_id: "answer",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      body: "Final answer",
      status: "complete",
    });
  });

  it("does not reopen foreground text after a terminal", () => {
    let entries = project([], "reasoning_delta", { text: "Reasoning" });
    entries = project(entries, "turn_terminal", { outcome: "completed" });
    const terminal = entries;
    for (const [type, data] of [
      ["reasoning_delta", { text: " late tail" }],
      ["assistant_delta", { text: " late answer" }],
    ] as const) {
      entries = project(entries, type, data);
    }
    expect(entries).toEqual(terminal);
  });

  it("retains Core's post-terminal background tool sequence without reviving foreground activity", () => {
    let entries = project([], "turn_terminal", { outcome: "completed" });
    entries = project(entries, "tool_start", {
      tool_call_id: "background",
      name: "run_pipeline",
    });
    expect(entries.at(-1)).toMatchObject({
      kind: "tool",
      status: "info",
      statusLabel: "Background",
    });
    entries = project(entries, "tool_progress", {
      tool_call_id: "background",
      message: "Stage 2 complete",
    });
    expect(entries.at(-1)?.body).toBe("Stage 2 complete");
    expect(timelineActivity(entries, "turn-1")).toBeNull();
    entries = project(entries, "tool_end", {
      tool_call_id: "background",
      status: "complete",
      output_preview: "Final background result",
    });
    expect(entries.at(-1)).toMatchObject({
      body: "Final background result",
      status: "complete",
      statusLabel: "Done",
    });
    expect(entries.every((entry) => entry.status !== "running")).toBe(true);
    expect(timelineActivity(entries, "turn-1")).toBeNull();
  });

  it("retains a tool result without its start and protects it from late start/progress", () => {
    let entries = project([], "turn_terminal", { outcome: "completed" });
    entries = project(entries, "tool_end", {
      tool_call_id: "missing-start",
      status: "complete",
      output_preview: "Durable tool result",
    });
    const completed = entries;
    expect(entries.at(-1)).toMatchObject({
      id: "tool:missing-start",
      kind: "tool",
      title: "Tool output",
      body: "Durable tool result",
      status: "complete",
    });
    entries = project(entries, "tool_start", {
      tool_call_id: "missing-start",
      name: "run_pipeline",
      arguments_preview: "Old arguments",
    });
    entries = project(entries, "tool_progress", {
      tool_call_id: "missing-start",
      message: "Old progress",
    });
    expect(entries).toEqual(completed);
    expect(timelineActivity(entries, "turn-1")).toBeNull();
    expect(
      project(entries, "tool_end", { output_preview: "No call identity" }),
    ).toEqual(entries);
  });

  it("keeps a tool started before the foreground terminal readable while it continues in background", () => {
    let entries = project([], "tool_start", {
      tool_call_id: "continuing",
      name: "run_pipeline",
    });
    entries = project(entries, "turn_terminal", { outcome: "completed" });
    entries = project(entries, "tool_progress", {
      tool_call_id: "continuing",
      message: "Background stage finished",
    });
    expect(
      entries.find((entry) => entry.id === "tool:continuing"),
    ).toMatchObject({
      body: "Background stage finished",
      status: "info",
      statusLabel: "Background",
    });
    expect(timelineActivity(entries, "turn-1")).toBeNull();
  });

  it("retains the legacy post-terminal background tool sequence", () => {
    let entries: TimelineEntry[] = [];
    const push = (method: string, params: Record<string, unknown>) => {
      entries = foldNotification(entries, {
        jsonrpc: "2.0",
        method,
        params: { turn_id: "turn-1", ...params },
      });
    };
    push("turn/completed", {});
    push("tool/started", {
      tool_call_id: "background",
      tool_name: "run_pipeline",
    });
    push("tool/progress", {
      tool_call_id: "background",
      message: "Stage 2 complete",
    });
    expect(entries.at(-1)).toMatchObject({
      status: "info",
      body: "Stage 2 complete",
    });
    push("tool/completed", {
      tool_call_id: "background",
      success: true,
      output_preview: "Legacy background result",
    });
    expect(entries.at(-1)).toMatchObject({
      status: "complete",
      body: "Legacy background result",
    });
    expect(timelineActivity(entries, "turn-1")).toBeNull();
  });

  it("settles thinking when an answer begins without deleting reasoning that matches the answer", () => {
    let entries = project([], "reasoning_delta", { text: "42" });
    entries = project(entries, "assistant_delta", {
      text: "The answer is 42",
      assistant_segment_id: "answer",
    });
    expect(entries.find((entry) => entry.kind === "reasoning")?.status).toBe(
      "complete",
    );
    entries = project(entries, "assistant_persisted", {
      text: "The answer is 42",
      assistant_segment_id: "answer",
    });
    entries = project(entries, "turn_terminal", { outcome: "completed" });
    expect(entries.find((entry) => entry.kind === "reasoning")?.body).toBe(
      "42",
    );
  });

  it("keeps background child completion after the foreground has settled", () => {
    let entries = project([], "turn_terminal", { outcome: "completed" });
    entries = project(
      entries,
      "background/spawn_complete",
      {
        task_id: "task-1",
        content: "Background result",
        parent_turn_id: "turn-1",
      },
      "child-1",
    );
    expect(entries.at(-1)).toMatchObject({
      body: "Background result",
      status: "complete",
    });
  });

  it("keeps activity visible through a tool-to-answer gap and removes it at terminal", () => {
    let entries: TimelineEntry[] = [];
    expect(timelineActivity(entries, "turn-1")).toBe("Working…");
    entries = project(entries, "reasoning_delta", { text: "Read the file" });
    expect(timelineActivity(entries, "turn-1")).toBe("Thinking…");
    entries = project(entries, "tool_start", {
      name: "read_file",
      tool_call_id: "read-1",
    });
    expect(timelineActivity(entries, "turn-1")).toBe("Running read_file…");
    entries = project(entries, "tool_end", {
      tool_call_id: "read-1",
      status: "complete",
      output_preview: "File contents",
    });
    expect(timelineActivity(entries, "turn-1")).toBe("Preparing next step…");
    entries = project(entries, "assistant_delta", {
      text: "Here is the answer",
    });
    expect(timelineActivity(entries, "turn-1")).toBe("Writing response…");
    entries = project(entries, "turn_terminal", { outcome: "completed" });
    expect(timelineActivity(entries, "turn-1")).toBeNull();
    expect(timelineActivity(entries, null)).toBeNull();
  });
});

describe("hydrated tool presentation", () => {
  it("respects a terminal hydrate snapshot without adding a row per historical turn", () => {
    const result = timelineFromHydrate({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 10 },
      messages: [
        {
          seq: 1,
          role: "assistant",
          content: "Already done",
          turn_id: "turn-1",
          persisted_at: "2026-09-14T00:00:00Z",
          media: [],
        },
      ],
      turns: [{ turn_id: "turn-1", state: "completed" }],
    });
    expect(result).toHaveLength(1);
    expect(project(result, "reasoning_delta", { text: "Late replay" })).toEqual(
      result,
    );
    expect(timelineActivity(result, "turn-1")).toBeNull();
  });

  it("merges a unique raw tool transcript and replay card, retaining full output and transcript position", () => {
    const output = "Full file output. ".repeat(100);
    const result = timelineFromHydrate({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 10 },
      messages: [
        {
          seq: 1,
          role: "tool",
          content: output,
          turn_id: "turn-1",
          message_id: "tool-message",
          persisted_at: "2026-09-14T00:00:00Z",
          media: [],
        },
        {
          seq: 2,
          role: "assistant",
          content: "Done",
          turn_id: "turn-1",
          persisted_at: "2026-09-14T00:00:01Z",
          media: [],
        },
      ],
      replayed_tool_envelopes: [
        {
          session_id: "coding:local:main",
          thread_id: "thread-1",
          seq: 3,
          turn_id: "turn-1",
          payload: {
            type: "tool_start",
            data: { tool_call_id: "read-1", name: "read_file" },
          },
        },
        {
          session_id: "coding:local:main",
          thread_id: "thread-1",
          seq: 4,
          turn_id: "turn-1",
          payload: {
            type: "tool_end",
            data: {
              tool_call_id: "read-1",
              status: "complete",
              output_preview: output.slice(0, 160),
            },
          },
        },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "tool:read-1",
      kind: "tool",
      title: "read_file",
      body: output,
      messageId: "tool-message",
    });
    expect(result[1]?.kind).toBe("assistant");
  });

  it("preserves unmatched raw tools as collapsible output and settles replay using hydrated turn state", () => {
    const result = timelineFromHydrate({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 10 },
      messages: [
        {
          seq: 1,
          role: "tool",
          content: "Unmatched output",
          turn_id: "turn-1",
          persisted_at: "2026-09-14T00:00:00Z",
          media: [],
        },
      ],
      turns: [{ turn_id: "turn-1", state: "interrupted" }],
      replayed_tool_envelopes: [
        {
          session_id: "coding:local:main",
          thread_id: "thread-1",
          seq: 3,
          turn_id: "turn-1",
          payload: {
            type: "tool_start",
            data: { tool_call_id: "read-1", name: "read_file" },
          },
        },
      ],
    });
    expect(result[0]).toMatchObject({
      kind: "tool",
      title: "Tool output",
      body: "Unmatched output",
    });
    expect(result.every((entry) => entry.status !== "running")).toBe(true);
    expect(timelineActivity(result, "turn-1")).toBeNull();
  });
});
