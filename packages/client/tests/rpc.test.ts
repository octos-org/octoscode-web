import { describe, expect, it } from "vitest";
import { createRequest, parseIncomingFrame } from "../src/rpc.ts";

describe("JSON-RPC frames", () => {
  it("creates a JSON-RPC 2.0 request", () => {
    expect(
      createRequest("7", "session/open", { session_id: "coding:local:main" }),
    ).toEqual({
      jsonrpc: "2.0",
      id: "7",
      method: "session/open",
      params: { session_id: "coding:local:main" },
    });
  });

  it("parses notifications without inventing defaults", () => {
    expect(
      parseIncomingFrame(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "warning",
          params: { code: "gap" },
        }),
      ),
    ).toEqual({
      kind: "notification",
      value: { jsonrpc: "2.0", method: "warning", params: { code: "gap" } },
    });
  });

  it("rejects malformed envelopes", () => {
    expect(parseIncomingFrame('{"method":"warning"}')).toEqual({
      kind: "invalid",
      reason: "frame is not a JSON-RPC 2.0 object",
    });
  });
});
