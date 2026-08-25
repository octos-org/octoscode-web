import { describe, expect, it } from "vitest";
import { parseProjectionEnvelope } from "../src/projection.ts";

describe("projection envelope v2", () => {
  it("accepts the narrow canonical wire shape", () => {
    expect(
      parseProjectionEnvelope({
        session_id: "coding:local:main",
        thread_id: "thread-1",
        seq: 3,
        cursor: { stream: "ui", seq: 9 },
        turn_id: "turn-1",
        payload: { type: "assistant_delta", data: { text: "hello" } },
      }),
    ).toMatchObject({
      session_id: "coding:local:main",
      seq: 3,
      turn_id: "turn-1",
      payload: { type: "assistant_delta" },
    });
  });

  it("fails closed when identity or payload fields are missing", () => {
    expect(
      parseProjectionEnvelope({
        session_id: "coding:local:main",
        seq: 3,
        payload: { type: "assistant_delta", data: {} },
      }),
    ).toBeNull();
  });
});
