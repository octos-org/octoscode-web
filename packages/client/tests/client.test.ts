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

  it("emits canonical approval and user-question response methods", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    const approval = client.respondApproval({
      session_id: "s1",
      approval_id: "a1",
      decision: "approve",
      approval_scope: "session",
    });
    const question = client.respondUserQuestion({
      session_id: "s1",
      question_id: "q1",
      answers: [{ selected_labels: ["Fast"] }],
    });

    const frames = socket.send.mock.calls.map(([frame]) =>
      JSON.parse(String(frame)),
    ) as Array<{ id: string; method: string; params: unknown }>;
    expect(frames).toMatchObject([
      {
        method: "approval/respond",
        params: {
          session_id: "s1",
          approval_id: "a1",
          decision: "approve",
          approval_scope: "session",
        },
      },
      {
        method: "user_question/respond",
        params: {
          session_id: "s1",
          question_id: "q1",
          answers: [{ selected_labels: ["Fast"] }],
        },
      },
    ]);
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: frames[0]?.id,
        result: {
          approval_id: "a1",
          accepted: true,
          status: "accepted",
          runtime_resumed: true,
        },
      }),
    } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: frames[1]?.id,
        result: {
          question_id: "q1",
          accepted: true,
          runtime_resumed: true,
        },
      }),
    } as MessageEvent);
    await expect(Promise.all([approval, question])).resolves.toHaveLength(2);
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
