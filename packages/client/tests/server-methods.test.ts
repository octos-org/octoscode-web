import { describe, expect, it, vi } from "vitest";
import { connectClient } from "./fixtures/socket-client.ts";

/** `server/shutdown`: stop a local `octos serve --solo` from a client. */

describe("server/shutdown", () => {
  it("sends server/shutdown and resolves once the server acknowledges", async () => {
    const { client, socket } = await connectClient();
    const stopping = client.stopServer();
    const frame = lastFrame(socket);
    expect(frame).toMatchObject({ method: "server/shutdown", params: {} });
    respond(socket, frame.id, { stopping: true });
    await expect(stopping).resolves.toEqual({ stopping: true });
  });
});

function lastFrame(socket: { send: ReturnType<typeof vi.fn> }) {
  return JSON.parse(String(socket.send.mock.calls.at(-1)?.[0])) as {
    id: string;
    method: string;
    params: unknown;
  };
}

function respond(
  socket: { onmessage: ((event: MessageEvent) => void) | null },
  id: string,
  result: unknown,
) {
  socket.onmessage?.({
    data: JSON.stringify({ jsonrpc: "2.0", id, result }),
  } as MessageEvent);
}
