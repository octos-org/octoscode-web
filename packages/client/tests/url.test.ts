import { describe, expect, it } from "vitest";
import { buildUiProtocolUrl } from "../src/url.ts";

describe("buildUiProtocolUrl", () => {
  it("turns an HTTP server origin into the AppUI WebSocket endpoint", () => {
    const url = new URL(
      buildUiProtocolUrl({
        endpoint: "http://127.0.0.1:50080",
        token: "secret token",
        features: ["projection.envelope.v2", "approval.typed.v1"],
      }),
    );

    expect(url.protocol).toBe("ws:");
    expect(url.pathname).toBe("/api/ui-protocol/ws");
    expect(url.searchParams.get("token")).toBe("secret token");
    expect(url.searchParams.getAll("ui_feature")).toEqual([
      "projection.envelope.v2",
      "approval.typed.v1",
    ]);
  });

  it("preserves an explicit WebSocket path and unrelated query parameters", () => {
    const url = new URL(
      buildUiProtocolUrl({
        endpoint: "wss://octos.example/custom/ws?tenant=dev",
      }),
    );
    expect(url.pathname).toBe("/custom/ws");
    expect(url.searchParams.get("tenant")).toBe("dev");
  });
});
