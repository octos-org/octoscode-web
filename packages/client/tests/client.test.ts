import { describe, expect, it, vi } from "vitest";
import { OctosUiClient } from "../src/client.ts";

describe("OctosUiClient", () => {
  it("rejects connect when the socket closes before opening", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });

    const connecting = client.connect();
    socket.onclose?.({} as CloseEvent);

    await expect(connecting).rejects.toThrow("connection closed");
    expect(client.status).toBe("error");
  });

  it("correlates successful JSON-RPC responses", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });

    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    const request = client.request<{ ok: boolean }>(
      "config/capabilities/list",
      {},
    );
    const frame = JSON.parse(String(socket.send.mock.calls[0]?.[0])) as {
      id: string;
    };
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: frame.id,
        result: { ok: true },
      }),
    } as MessageEvent);

    await expect(request).resolves.toEqual({ ok: true });
  });
});

function createSocket() {
  return {
    readyState: 0,
    onopen: null as ((event: Event) => void) | null,
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    onclose: null as ((event: CloseEvent) => void) | null,
    send: vi.fn(),
    close: vi.fn(),
  };
}
