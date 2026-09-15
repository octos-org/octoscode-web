import { describe, expect, it } from "vitest";
import { parseProjectionEnvelope } from "../src/projection.ts";

describe("projection envelope v2", () => {
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
