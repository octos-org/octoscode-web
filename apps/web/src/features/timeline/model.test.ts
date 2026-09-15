import {
  parseSessionHydrateResult,
  type SessionHydrateResult,
} from "@octos-org/octoscode-client";
import { describe, expect, it, vi } from "vitest";
import parallelToolFixture from "./fixtures/rc9-parallel-tools.json";
import {
  addOptimisticUser,
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
    const rejected = project(entries, "tool_end", {
      output_preview: "No call identity",
    });
    expect(rejected.slice(0, -1)).toEqual(entries);
    expect(rejected.at(-1)).toMatchObject({
      kind: "system",
      title: "Protocol frame rejected",
    });
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
  it("restores the three real rc.9 parallel calls with full output and authoritative start order", () => {
    // Captured 2026-09-15 from rc.9. Scope/IDs, host path and non-tool prose
    // are anonymized; recorded 200-byte ASCII/UTF-8 output previews and the
    // different start/persistence order are retained.
    const hydrate = parseSessionHydrateResult(parallelToolFixture)!;
    expect(hydrate).not.toBeNull();
    const durable = hydrate.messages!.filter(
      (message) => message.role === "tool",
    );
    expect(durable.map((message) => message.content.slice(0, 2))).toEqual([
      "/w",
      "??",
      " 1",
    ]);
    const result = timelineFromHydrate(freeze(hydrate));
    const tools = result.filter((entry) => entry.kind === "tool");
    expect(tools.map((entry) => entry.id)).toEqual([
      "tool:read-call",
      "tool:pwd-call",
      "tool:status-call",
    ]);
    expect(tools.map((entry) => entry.body).sort()).toEqual(
      durable.map((message) => message.content).sort(),
    );
    expect(
      result
        .filter((entry) => entry.kind !== "tool")
        .map((entry) => entry.messageId),
    ).toEqual(
      hydrate
        .messages!.filter((message) => message.role !== "tool")
        .map((message) => message.message_id),
    );
  });

  it.each([
    "missing start",
    "conflicting start",
    "raw tool",
    "reasoning",
    "other thread",
  ])(
    "does not reorder identified tool cards across %s boundaries",
    (boundary) => {
      const hydrate = toolHistory();
      hydrate.messages![1]!.seq = 3;
      hydrate.messages![2]!.seq = 2;
      const start = hydrate.replayed_tool_envelopes!.find(
        (entry) => entry.seq === 1,
      )!;
      if (boundary === "missing start") {
        hydrate.replayed_tool_envelopes =
          hydrate.replayed_tool_envelopes!.filter((entry) => entry !== start);
      } else if (boundary === "conflicting start") {
        hydrate.replayed_tool_envelopes!.push({ ...start, seq: 5 });
      } else if (boundary === "other thread") {
        start.thread_id = "other-thread";
      } else {
        hydrate.messages![1]!.seq = 4;
        hydrate.messages![3]!.seq = 5;
        hydrate.messages!.push({
          seq: 3,
          role: boundary === "raw tool" ? "tool" : "assistant",
          content: "An independent row",
          ...(boundary === "reasoning"
            ? { reasoning_content: "A separate thought" }
            : {}),
          message_id: "boundary",
          thread_id: "thread-1",
          persisted_at: "2026-09-15T00:00:00Z",
          media: [],
        });
      }
      const result = timelineFromHydrate(freeze(hydrate));
      const identified = result.filter((entry) => entry.id.startsWith("tool:"));
      expect(identified.map((entry) => entry.id)).toEqual([
        "tool:status-call",
        "tool:pwd-call",
      ]);
      if (boundary === "raw tool" || boundary === "reasoning") {
        expect(
          result.findIndex((entry) => entry.messageId === "boundary"),
        ).toBeGreaterThan(
          result.findIndex((entry) => entry.id === "tool:status-call"),
        );
        expect(
          result.findIndex((entry) => entry.messageId === "boundary"),
        ).toBeLessThan(
          result.findIndex((entry) => entry.id === "tool:pwd-call"),
        );
      }
    },
  );

  it("retains both call identities when the same truncated prefix could name one durable row", () => {
    const hydrate = toolHistory();
    hydrate.messages = hydrate.messages!.filter(
      (message) => message.message_id !== "status-message",
    );
    hydrate.messages![1]!.content = `${"x".repeat(200)} remaining output`;
    for (const envelope of hydrate.replayed_tool_envelopes!) {
      if (envelope.payload.type === "tool_end") {
        envelope.payload.data = {
          ...(envelope.payload.data as Record<string, unknown>),
          output_preview: `${"x".repeat(200)}...`,
        };
      }
    }
    const tools = timelineFromHydrate(freeze(hydrate)).filter(
      (entry) => entry.kind === "tool",
    );
    expect(tools).toHaveLength(3);
    expect(
      tools.filter((entry) => entry.id.startsWith("hydrated:")),
    ).toHaveLength(1);
  });

  it("restores rc.9 tools without message turn IDs in their original transcript order", () => {
    const hydrate = freeze(toolHistory());
    const before = structuredClone(hydrate);
    const result = timelineFromHydrate(hydrate);

    expect(result.map((entry) => entry.kind)).toEqual([
      "user",
      "tool",
      "tool",
      "assistant",
    ]);
    expect(result.slice(1, 3)).toMatchObject([
      {
        id: "tool:pwd-call",
        title: "bash",
        body: "/workspace/project",
        messageId: "pwd-message",
        turnId: "turn-1",
      },
      {
        id: "tool:status-call",
        title: "bash",
        body: "## main\nNothing to commit",
        messageId: "status-message",
        turnId: "turn-1",
      },
    ]);
    expect(timelineFromHydrate(hydrate)).toEqual(result);
    expect(hydrate).toEqual(before);
  });

  it.each(["missing", "conflicting", "unknown"])(
    "preserves raw tools when the thread-to-turn mapping is %s",
    (mapping) => {
      const hydrate = toolHistory();
      if (mapping === "missing") delete hydrate.turns;
      if (mapping === "conflicting") {
        hydrate.turns!.push({
          turn_id: "turn-2",
          thread_id: "thread-1",
          state: "completed",
        });
      }
      if (mapping === "unknown") {
        hydrate.turns![0]!.thread_id = "unrelated-thread";
      }
      const tools = timelineFromHydrate(freeze(hydrate)).filter(
        (entry) => entry.kind === "tool",
      );
      expect(tools).toHaveLength(4);
      expect(tools.filter((entry) => entry.id.startsWith("hydrated:"))).toEqual(
        [
          expect.objectContaining({ body: "/workspace/project" }),
          expect.objectContaining({ body: "## main\nNothing to commit" }),
        ],
      );
      expect(tools.slice(0, 2).every((entry) => !entry.turnId)).toBe(true);
    },
  );

  it("accepts a repeated identical mapping while retaining explicit message turn identity", () => {
    const hydrate = toolHistory();
    hydrate.turns!.push({ ...hydrate.turns![0]! });
    hydrate.messages![1]!.turn_id = "explicit-other-turn";
    const tools = timelineFromHydrate(freeze(hydrate)).filter(
      (entry) => entry.kind === "tool",
    );
    expect(tools).toHaveLength(3);
    expect(tools[0]).toMatchObject({
      id: "hydrated:pwd-message",
      turnId: "explicit-other-turn",
    });
    expect(tools[1]).toMatchObject({
      id: "tool:status-call",
      messageId: "status-message",
    });
  });

  it.each([1, 2])(
    "keeps ambiguous output when two calls could belong to %i raw transcript rows",
    (rawCount) => {
      const hydrate = toolHistory();
      for (const message of hydrate.messages!) {
        if (message.role === "tool") message.content = "same result";
      }
      if (rawCount === 1) {
        hydrate.messages = hydrate.messages!.filter(
          (message) => message.message_id !== "status-message",
        );
      }
      for (const envelope of hydrate.replayed_tool_envelopes!) {
        if (envelope.payload.type === "tool_end") {
          envelope.payload.data = {
            ...(envelope.payload.data as Record<string, unknown>),
            output_preview: "same result",
          };
        }
      }
      const tools = timelineFromHydrate(freeze(hydrate)).filter(
        (entry) => entry.kind === "tool",
      );
      expect(tools).toHaveLength(rawCount + 2);
      expect(tools.every((entry) => entry.body === "same result")).toBe(true);
      expect(
        tools.filter((entry) => entry.id.startsWith("hydrated:")),
      ).toHaveLength(rawCount);
    },
  );

  it("does not count duplicate replay envelopes as separate tool identities", () => {
    const hydrate = toolHistory();
    hydrate.replayed_envelopes = [...hydrate.replayed_tool_envelopes!];
    expect(
      timelineFromHydrate(freeze(hydrate)).filter(
        (entry) => entry.kind === "tool",
      ),
    ).toHaveLength(2);
  });

  it.each([
    ["a".repeat(2048), "…"],
    ["界".repeat(682), "…"],
    ["a".repeat(200), "..."],
    [`${"界".repeat(66)}a`, "..."],
  ])(
    "coalesces Core's UTF-8-truncated output while retaining the full durable result",
    (prefix, suffix) => {
      const hydrate = toolHistory();
      const output = `${prefix}🙂full remaining output`;
      hydrate.messages![1]!.content = output;
      const end = hydrate.replayed_tool_envelopes!.find(
        (entry) => entry.seq === 2,
      )!;
      end.payload.data = {
        ...(end.payload.data as Record<string, unknown>),
        output_preview: `${prefix}${suffix}`,
      };
      const tools = timelineFromHydrate(freeze(hydrate)).filter(
        (entry) => entry.kind === "tool",
      );
      expect(tools).toHaveLength(2);
      expect(tools[0]).toMatchObject({
        id: "tool:pwd-call",
        messageId: "pwd-message",
        body: output,
      });
    },
  );

  it.each([
    ["Not a protocol truncation boundary ".repeat(4), "…"],
    ["Not a protocol truncation boundary ".repeat(4), "..."],
    [" ".repeat(2048), "…"],
    [" ".repeat(200), "..."],
  ])(
    "does not infer identity from an ordinary ellipsis or whitespace-only prefix",
    (prefix, suffix) => {
      const hydrate = toolHistory();
      hydrate.messages![1]!.content = `${prefix}complete result`;
      const end = hydrate.replayed_tool_envelopes!.find(
        (entry) => entry.seq === 2,
      )!;
      end.payload.data = {
        ...(end.payload.data as Record<string, unknown>),
        output_preview: `${prefix}${suffix}`,
      };
      expect(
        timelineFromHydrate(freeze(hydrate)).filter(
          (entry) => entry.kind === "tool",
        ),
      ).toHaveLength(3);
    },
  );

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

describe("durable background completion", () => {
  const completion = {
    task_id: "research-task",
    parent_turn_id: "turn-1",
    message_id: "research-message",
    content: "Research complete",
    source: "background",
    persisted_at: "2026-09-15T00:00:00Z",
    media: ["research/report.md", "research/chart.png"],
  };

  it("merges replay by message identity at its durable position and retains every attachment", () => {
    const hydrate = freeze<SessionHydrateResult>({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 100 },
      messages: [
        {
          seq: 1,
          role: "assistant",
          content: completion.content,
          message_id: completion.message_id,
          thread_id: "child-thread",
          source: completion.source,
          persisted_at: completion.persisted_at,
          media: [...completion.media],
        },
        {
          seq: 2,
          role: "user",
          content: "A later question",
          persisted_at: "2026-09-15T00:00:01Z",
          media: [],
        },
      ],
      replayed_envelopes: [
        {
          session_id: "coding:local:main",
          thread_id: "child-thread",
          turn_id: "child-turn",
          seq: 1,
          payload: { type: "background/spawn_complete", data: completion },
        },
      ],
    });
    const result = timelineFromHydrate(hydrate);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "hydrated:research-message",
      messageId: "research-message",
      title: "Background agent",
      body: "Research complete\n\nAttachment: research/report.md\nAttachment: research/chart.png",
    });
    expect(result[1]?.kind).toBe("user");
    expect(
      project(
        freeze(result),
        "background/spawn_complete",
        completion,
        "child-turn",
      ),
    ).toEqual(result);
  });

  it("retains live attachments and makes completion replay idempotent without settling the parent again", () => {
    const foreground = project([], "turn_terminal", { outcome: "completed" });
    const result = project(
      freeze(foreground),
      "background/spawn_complete",
      completion,
      "child-turn",
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(foreground[0]);
    expect(result[1]).toMatchObject({
      id: "background:research-task",
      messageId: "research-message",
      body: "Research complete\n\nAttachment: research/report.md\nAttachment: research/chart.png",
      turnId: "child-turn",
    });
    expect(
      project(
        freeze(result),
        "background/spawn_complete",
        completion,
        "child-turn",
      ),
    ).toEqual(result);
    expect(timelineActivity(result, "turn-1")).toBeNull();
  });
});

describe("late canonical user messages", () => {
  it("places an observer's late question before its own replies without changing other row order", () => {
    let entries = project(
      [],
      "assistant_persisted",
      { text: "Previous answer" },
      "previous-turn",
    );
    entries = project(entries, "reasoning_delta", { text: "Investigating" });
    entries = project(entries, "tool_start", {
      tool_call_id: "read",
      name: "read_file",
    });
    entries = project(entries, "assistant_delta", { text: "Current answer" });
    entries = project(
      entries,
      "assistant_delta",
      { text: "Other turn answer" },
      "other-turn",
    );
    const before = freeze(entries);
    const result = project(before, "user_message", {
      text: "Current question",
    });
    expect(result.map((entry) => entry.body)).toEqual([
      "Previous answer",
      "Current question",
      "Investigating",
      "",
      "Current answer",
      "Other turn answer",
    ]);
    expect(result.filter((entry) => entry.kind !== "user")).toEqual(before);
    expect(
      project(freeze(result), "user_message", { text: "Current question" }),
    ).toEqual(result);
  });

  it("confirms an optimistic prompt in place when its canonical message arrives", () => {
    let entries = addOptimisticUser([], "turn-1", "Local question");
    entries = project(entries, "assistant_delta", { text: "Answer" });
    const result = project(freeze(entries), "user_message", {
      text: "Local question",
    });
    expect(result.map((entry) => entry.body)).toEqual([
      "Local question",
      "Answer",
    ]);
    expect(result[0]?.id).toBe("user:turn-1");
  });
});

describe("multiple user inputs in one turn", () => {
  function user(entries: readonly TimelineEntry[], seq: number, text: string) {
    return foldNotification(entries, {
      jsonrpc: "2.0",
      method: "projection/envelope",
      params: {
        session_id: "coding:local:main",
        thread_id: "thread-1",
        turn_id: "turn-1",
        seq,
        payload: { type: "user_message", data: { text } },
      },
    });
  }

  it("preserves every hydrated steer with its durable identity and position", () => {
    const hydrate: SessionHydrateResult = {
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 20 },
      turns: [{ turn_id: "turn-1", thread_id: "thread-1", state: "completed" }],
      messages: [
        { role: "user", content: "Original question", message_id: "question" },
        { role: "assistant", content: "Working on it", message_id: "prelude" },
        { role: "user", content: "Also check tests", message_id: "steer-1" },
        { role: "user", content: "Also check tests", message_id: "steer-2" },
        { role: "assistant", content: "Done", message_id: "answer" },
      ].map((message, seq) => ({
        ...message,
        seq,
        thread_id: "thread-1",
        persisted_at: "2026-09-15T00:00:00Z",
        media: [],
      })),
    };
    const result = timelineFromHydrate(freeze(hydrate));
    expect(result.map((entry) => entry.messageId)).toEqual([
      "question",
      "prelude",
      "steer-1",
      "steer-2",
      "answer",
    ]);
    expect(new Set(result.map((entry) => entry.id)).size).toBe(5);
    expect(result.every((entry) => entry.turnId === "turn-1")).toBe(true);
  });

  it("keeps later steers after previous activity and distinct even when text repeats", () => {
    let entries = project([], "assistant_delta", { text: "Working" });
    entries = user(entries, 23, "Original question");
    entries = user(entries, 24, "Also check tests");
    entries = user(entries, 25, "Also check tests");
    expect(entries.map((entry) => entry.body)).toEqual([
      "Original question",
      "Working",
      "Also check tests",
      "Also check tests",
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(4);
    expect(user(freeze(entries), 24, "Also check tests")).toEqual(entries);
  });

  it("does not let a drained steer replace the optimistic prompt before it persists", () => {
    let entries = addOptimisticUser([], "turn-1", "Original question");
    entries = project(entries, "assistant_delta", { text: "Working" });
    // rc.9 persists drained steering immediately, while the original prompt
    // can be committed later as part of the final response's message batch.
    entries = user(entries, 10, "Also check tests");
    entries = user(entries, 23, "Original question");
    expect(entries.map((entry) => entry.body)).toEqual([
      "Original question",
      "Working",
      "Also check tests",
    ]);
    expect(entries[0]?.id).toBe("user:turn-1");
    expect(user(freeze(entries), 10, "Also check tests")).toEqual(entries);
  });
});

describe("deterministic notices and readable errors", () => {
  it("retains same-millisecond warnings and rejects without depending on wall-clock time", () => {
    const warning = {
      jsonrpc: "2.0" as const,
      method: "warning",
      params: { code: "provider_busy", message: "Retry after this turn." },
    };
    const invalid = {
      jsonrpc: "2.0" as const,
      method: "projection/envelope",
      params: { seq: 1 },
    };
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1);
      const first = foldNotification([], warning);
      const second = foldNotification(freeze(first), warning);
      const third = foldNotification(freeze(second), invalid);
      const fourth = foldNotification(freeze(third), invalid);
      expect(fourth).toHaveLength(4);
      expect(new Set(fourth.map((entry) => entry.id)).size).toBe(4);
      vi.setSystemTime(999999);
      expect(foldNotification([], warning)).toEqual(first);
      expect(foldNotification(second, invalid)).toEqual(third);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a terminal error's message without exposing protocol metadata", () => {
    const result = project([], "turn_terminal", {
      outcome: "errored",
      error: {
        code: "provider_unavailable",
        message:
          "The selected model is unavailable. Choose another model and try again.",
        data: { internal_request_id: "request-123", attempt: 3 },
      },
    });
    expect(result[0]).toMatchObject({
      title: "Turn failed",
      body: "The selected model is unavailable. Choose another model and try again.",
      status: "error",
    });
  });

  it("uses a readable error code when the server supplies an empty message", () => {
    expect(
      project([], "turn_terminal", {
        outcome: "rate_limited",
        error: { code: "rate_limited", message: "  " },
      })[0]?.body,
    ).toBe("Server error (rate_limited).");
  });
});

/** rc.9 supplies thread IDs on transcript rows, without typed turn IDs. */
function toolHistory(): SessionHydrateResult {
  return {
    session_id: "coding:local:main",
    cursor: { stream: "coding:local:main", seq: 100 },
    messages: [
      {
        seq: 1,
        role: "user",
        content: "Check the working directory and status",
        message_id: "question-message",
      },
      {
        seq: 2,
        role: "tool",
        content: "/workspace/project",
        message_id: "pwd-message",
      },
      {
        seq: 3,
        role: "tool",
        content: "## main\nNothing to commit",
        message_id: "status-message",
      },
      {
        seq: 4,
        role: "assistant",
        content: "The working tree is clean.",
        message_id: "answer-message",
      },
    ].map((message) => ({
      ...message,
      thread_id: "thread-1",
      persisted_at: "2026-09-15T00:00:00Z",
      media: [],
    })),
    turns: [{ turn_id: "turn-1", thread_id: "thread-1", state: "completed" }],
    replayed_tool_envelopes: [
      {
        seq: 4,
        payload: {
          type: "tool_end",
          data: {
            tool_call_id: "status-call",
            status: "complete",
            output_preview: "## main\nNothing to commit",
          },
        },
      },
      {
        seq: 1,
        payload: {
          type: "tool_start",
          data: { tool_call_id: "pwd-call", name: "bash" },
        },
      },
      {
        seq: 3,
        payload: {
          type: "tool_start",
          data: { tool_call_id: "status-call", name: "bash" },
        },
      },
      {
        seq: 2,
        payload: {
          type: "tool_end",
          data: {
            tool_call_id: "pwd-call",
            status: "complete",
            output_preview: "/workspace/project",
          },
        },
      },
    ].map((envelope) => ({
      ...envelope,
      session_id: "coding:local:main",
      thread_id: "thread-1",
      turn_id: "turn-1",
    })),
  };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
