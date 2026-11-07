import { describe, expect, it } from "vitest";
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

describe("canonical payload input boundary", () => {
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

  it("retains unknown event payloads for forward-compatible sequence tracking", () => {
    for (const data of [null, 42, ["extension"], { outcome: "future" }]) {
      const wire = envelope("future_event", data);
      expect(parseProjectionEnvelope(wire)).toEqual(wire);
    }
  });
});
