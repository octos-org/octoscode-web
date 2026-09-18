import { describe, expect, it, vi } from "vitest";
import { APPUI_SERVER_METHODS, supportsMethod } from "../src/index.ts";
import { OctosUiClient } from "../src/client.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

/** `server/shutdown`: stop a local `octos serve --solo` from a client. */

function capabilities(methods: string[]): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: methods,
    supported_notifications: [],
    supported_features: [],
  };
}

describe("server/shutdown", () => {
  it("is offered only when the server advertises it", () => {
    // A hosted, fleet or --stdio server never advertises it; the UI hides the
    // Stop control whenever this is false.
    expect(
      supportsMethod(capabilities([]), APPUI_SERVER_METHODS.SHUTDOWN),
    ).toBe(false);
    expect(
      supportsMethod(
        capabilities([APPUI_SERVER_METHODS.SHUTDOWN]),
        APPUI_SERVER_METHODS.SHUTDOWN,
      ),
    ).toBe(true);
  });

  it("sends server/shutdown and resolves once the server acknowledges", async () => {
    const { client, socket } = await connected();
    const stopping = client.stopServer();
    const frame = lastFrame(socket);
    expect(frame).toMatchObject({ method: "server/shutdown", params: {} });
    respond(socket, frame.id, { stopping: true });
    await expect(stopping).resolves.toEqual({ stopping: true });
  });

  it("rejects an acknowledgement that does not say it is stopping", async () => {
    const { client, socket } = await connected();
    const stopping = client.stopServer();
    respond(socket, lastFrame(socket).id, { stopping: false });
    await expect(stopping).rejects.toThrow(/invalid result/);
  });
});

async function connected() {
  const socket = {
    readyState: 0,
    send: vi.fn(),
    close: vi.fn(),
    onopen: undefined as ((event: Event) => void) | undefined,
    onclose: undefined as ((event: CloseEvent) => void) | undefined,
    onerror: undefined as ((event: Event) => void) | undefined,
    onmessage: undefined as ((event: MessageEvent) => void) | undefined,
  };
  const client = new OctosUiClient({
    endpoint: "http://127.0.0.1:50080",
    webSocketFactory: () => socket as unknown as WebSocket,
  });
  const connecting = client.connect();
  socket.readyState = 1;
  socket.onopen?.({} as Event);
  await connecting;
  return { client, socket };
}

function lastFrame(socket: { send: ReturnType<typeof vi.fn> }) {
  return JSON.parse(String(socket.send.mock.calls.at(-1)?.[0])) as {
    id: string;
    method: string;
    params: unknown;
  };
}

function respond(
  socket: { onmessage?: ((event: MessageEvent) => void) | undefined },
  id: string,
  result: unknown,
) {
  socket.onmessage?.({
    data: JSON.stringify({ jsonrpc: "2.0", id, result }),
  } as MessageEvent);
}
