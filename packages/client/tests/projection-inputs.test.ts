import { describe, expect, it } from "vitest";
import { parseSessionHydrateResult } from "../src/hydrate.ts";
import { parseProjectionEnvelope } from "../src/projection.ts";

function envelope(type: string, data: unknown) {
  return {
    session_id: "coding:local:main",
    thread_id: "thread-1",
    turn_id: "turn-1",
    seq: 3,
    cursor: { stream: "coding:local:main", seq: 9 },
    payload: { type, data },
  };
}

const file = { path: "report.md", mime: "text/markdown", size_bytes: 0 };
const validPayloads = [
  ["user_message", { text: "", files: [file] }],
  ["assistant_delta", { text: "", assistant_segment_id: "segment-1" }],
  ["reasoning_delta", { text: "" }],
  [
    "assistant_persisted",
    {
      text: "Answer",
      assistant_segment_id: "segment-1",
      meta: {
        message_id: "message-1",
        persisted_at: "2026-09-15T00:00:00Z",
        media: ["report.md"],
      },
    },
  ],
  ["tool_start", { tool_call_id: "tool-1", name: "bash" }],
  ["tool_progress", { tool_call_id: "tool-1", message: "" }],
  ["tool_end", { tool_call_id: "tool-1", status: "complete" }],
  ["file_attached", { ...file, attachment_owner: {} }],
  ["turn_terminal", { outcome: "completed" }],
  [
    "background/spawn_complete",
    {
      parent_turn_id: "turn-1",
      task_id: "task-1",
      content: "Result",
      message_id: "background-1",
      source: "background",
      persisted_at: "2026-09-15T00:00:00Z",
      media: ["report.md"],
    },
  ],
] as const;

describe("canonical payload input boundary", () => {
  it.each(validPayloads)(
    "accepts Core %s and additive fields",
    (type, data) => {
      const wire = envelope(type, { ...data, future_field: { version: 3 } });
      expect(parseProjectionEnvelope(wire)).toEqual(wire);
    },
  );

  it.each(validPayloads)("rejects non-object data for known %s", (type) => {
    for (const data of [null, false, 0, "", [], undefined]) {
      expect(parseProjectionEnvelope(envelope(type, data))).toBeNull();
    }
  });

  it("does not treat an unsupported or incomplete outcome as a terminal", () => {
    for (const outcome of [undefined, null, "", "cancelled", "failed", 0, {}]) {
      expect(
        parseProjectionEnvelope(envelope("turn_terminal", { outcome })),
      ).toBeNull();
    }
    for (const outcome of [
      "completed",
      "errored",
      "interrupted",
      "rate_limited",
    ]) {
      expect(
        parseProjectionEnvelope(envelope("turn_terminal", { outcome })),
      ).not.toBeNull();
    }
  });

  it("requires a structured terminal error without constraining its opaque data", () => {
    for (const error of ["failed", {}, { code: "E" }, { message: "failed" }]) {
      expect(
        parseProjectionEnvelope(
          envelope("turn_terminal", { outcome: "errored", error }),
        ),
      ).toBeNull();
    }
    const wire = envelope("turn_terminal", {
      outcome: "errored",
      error: { code: "E", message: "failed", data: { toString: null } },
    });
    expect(parseProjectionEnvelope(wire)).toEqual(wire);
  });

  it("rejects coercion-prone identities and tool names before the timeline sees them", () => {
    for (const value of [
      undefined,
      null,
      "",
      " \n",
      0,
      [],
      { toString: null },
    ]) {
      for (const field of ["name", "tool_call_id"]) {
        expect(
          parseProjectionEnvelope(
            envelope("tool_start", {
              tool_call_id: "tool-1",
              name: "bash",
              [field]: value,
            }),
          ),
        ).toBeNull();
      }
      for (const [type, data] of [
        ["tool_progress", { message: "running" }],
        ["tool_end", { status: "complete" }],
      ] as const) {
        expect(
          parseProjectionEnvelope(
            envelope(type, { ...data, tool_call_id: value }),
          ),
        ).toBeNull();
      }
    }
  });

  it("accepts every supported tool state and rejects unknown states", () => {
    for (const status of ["complete", "error", "skipped", "aborted"]) {
      expect(
        parseProjectionEnvelope(
          envelope("tool_end", { tool_call_id: "tool-1", status }),
        ),
      ).not.toBeNull();
    }
    for (const status of [undefined, null, "", "running", "completed", 0, {}]) {
      expect(
        parseProjectionEnvelope(
          envelope("tool_end", { tool_call_id: "tool-1", status }),
        ),
      ).toBeNull();
    }
  });

  it("checks every consumed text field without rejecting legitimate empty text", () => {
    for (const [type, data, field] of [
      ["user_message", {}, "text"],
      ["assistant_delta", {}, "text"],
      ["assistant_persisted", {}, "text"],
      ["reasoning_delta", {}, "text"],
      ["tool_progress", { tool_call_id: "tool-1" }, "message"],
      ["background/spawn_complete", { task_id: "task-1" }, "content"],
    ] as const) {
      for (const value of [undefined, null, 0, false, [], { toString: null }]) {
        expect(
          parseProjectionEnvelope(envelope(type, { ...data, [field]: value })),
        ).toBeNull();
      }
      expect(
        parseProjectionEnvelope(envelope(type, { ...data, [field]: "" })),
      ).not.toBeNull();
    }
  });

  it("distinguishes absent/null Rust Option fields from invalid supplied values", () => {
    for (const [type, data, field] of [
      [
        "tool_start",
        { tool_call_id: "tool-1", name: "bash" },
        "arguments_preview",
      ],
      ["tool_end", { tool_call_id: "tool-1", status: "complete" }, "error"],
      ["tool_end", { tool_call_id: "tool-1", status: "complete" }, "reason"],
      [
        "tool_end",
        { tool_call_id: "tool-1", status: "complete" },
        "output_preview",
      ],
      ["turn_terminal", { outcome: "completed" }, "error"],
      ["turn_terminal", { outcome: "completed" }, "token_usage"],
    ] as const) {
      for (const value of [undefined, null]) {
        expect(
          parseProjectionEnvelope(envelope(type, { ...data, [field]: value })),
        ).not.toBeNull();
      }
      for (const value of [0, false, []]) {
        expect(
          parseProjectionEnvelope(envelope(type, { ...data, [field]: value })),
        ).toBeNull();
      }
    }
  });

  it("bounds numeric payload fields without silently losing u64 precision", () => {
    const numericEnvelopes = (value: unknown) => [
      envelope("tool_end", {
        tool_call_id: "tool-1",
        status: "complete",
        duration_ms: value,
      }),
      envelope("file_attached", {
        ...file,
        size_bytes: value,
        attachment_owner: { tool_call_id: "tool-1" },
      }),
      ...[
        "input_tokens",
        "output_tokens",
        "reasoning_tokens",
        "cache_read_tokens",
        "cache_write_tokens",
      ].map((key) =>
        envelope("turn_terminal", {
          outcome: "completed",
          token_usage: { [key]: value },
        }),
      ),
    ];
    for (const value of [0, -0, 12, Number.MAX_SAFE_INTEGER]) {
      for (const wire of numericEnvelopes(value)) {
        expect(parseProjectionEnvelope(wire)).not.toBeNull();
      }
    }
    for (const value of [
      -1,
      0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      {},
    ]) {
      for (const wire of numericEnvelopes(value)) {
        expect(parseProjectionEnvelope(wire)).toBeNull();
      }
    }
    expect(
      parseProjectionEnvelope(
        envelope("turn_terminal", { outcome: "completed", token_usage: {} }),
      ),
    ).not.toBeNull();
    expect(
      parseProjectionEnvelope(
        envelope("turn_terminal", {
          outcome: "completed",
          token_usage: { input_tokens: null },
        }),
      ),
    ).toBeNull();
  });

  it("validates file references, ownership and persisted media", () => {
    for (const files of [null, {}, [null], [{ ...file, size_bytes: "12" }]]) {
      expect(
        parseProjectionEnvelope(envelope("user_message", { text: "", files })),
      ).toBeNull();
    }
    for (const attachment_owner of [
      null,
      [],
      { tool_call_id: { toString: null } },
    ]) {
      expect(
        parseProjectionEnvelope(
          envelope("file_attached", { ...file, attachment_owner }),
        ),
      ).toBeNull();
    }
    for (const media of [null, "report.md", [12]]) {
      expect(
        parseProjectionEnvelope(
          envelope("assistant_persisted", {
            text: "Result",
            meta: { message_id: "message-1", media },
          }),
        ),
      ).toBeNull();
      expect(
        parseProjectionEnvelope(
          envelope("background/spawn_complete", {
            task_id: "task-1",
            content: "Result",
            media,
          }),
        ),
      ).toBeNull();
    }
  });

  it("rejects invalid supplied assistant/background identity metadata", () => {
    for (const value of [null, 0, "", " \n", [], { toString: null }]) {
      expect(
        parseProjectionEnvelope(
          envelope("assistant_persisted", {
            text: "Result",
            meta: { message_id: value },
          }),
        ),
      ).toBeNull();
      for (const field of ["task_id", "parent_turn_id", "message_id"]) {
        expect(
          parseProjectionEnvelope(
            envelope("background/spawn_complete", {
              task_id: "task-1",
              content: "Result",
              [field]: value,
            }),
          ),
        ).toBeNull();
      }
    }
    for (const meta of [null, false, "message-1", []]) {
      expect(
        parseProjectionEnvelope(
          envelope("assistant_persisted", {
            text: "Result",
            meta,
          }),
        ),
      ).toBeNull();
    }
  });

  it("preserves cursor-absent legacy replay and optional identity metadata", () => {
    for (const [type, data] of [
      ["assistant_delta", { text: "Partial" }],
      ["assistant_persisted", { text: "Result" }],
      [
        "assistant_persisted",
        { text: "Result", meta: { message_id: "message-1" } },
      ],
      ["background/spawn_complete", { task_id: "task-1", content: "Result" }],
    ] as const) {
      const {
        cursor: _cursor,
        session_id: _scope,
        ...replay
      } = envelope(type, data);
      expect(
        parseSessionHydrateResult({
          session_id: "coding:local:main",
          cursor: { stream: "coding:local:main", seq: 9 },
          replayed_envelopes: [replay],
        })?.replayed_envelopes,
      ).toEqual([{ ...replay, session_id: "coding:local:main" }]);
    }
    for (const value of [null, 0, "", [], { toString: null }]) {
      expect(
        parseProjectionEnvelope(
          envelope("assistant_delta", {
            text: "Partial",
            assistant_segment_id: value,
          }),
        ),
      ).toBeNull();
    }
  });

  it("rejects malformed known replay before accepting a hydrate snapshot", () => {
    const wire = envelope("turn_terminal", null);
    expect(
      parseSessionHydrateResult({
        session_id: wire.session_id,
        cursor: wire.cursor,
        replayed_envelopes: [wire],
      }),
    ).toBeNull();
  });

  it("retains unknown event payloads for forward-compatible sequence tracking", () => {
    for (const data of [null, 42, ["extension"], { outcome: "future" }]) {
      const wire = envelope("future_event", data);
      expect(parseProjectionEnvelope(wire)).toEqual(wire);
    }
  });
});
