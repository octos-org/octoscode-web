import { vi } from "vitest";
import { OctosUiClient } from "../../src/client.ts";

/** A scripted WebSocket stand-in: the test sets `readyState` and calls the
 * `on*` handlers itself. Shared by the client transport tests. */
export function createSocket() {
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

/** A client that takes its sockets from `sockets`, one per connect. */
export function clientOver(
  sockets: ReturnType<typeof createSocket>[],
  overrides: Partial<ConstructorParameters<typeof OctosUiClient>[0]> = {},
) {
  return new OctosUiClient({
    endpoint: "http://127.0.0.1:50080",
    webSocketFactory: () => sockets.shift() as unknown as WebSocket,
    ...overrides,
  });
}

/** One socket opened immediately; multi-socket races use `clientOver`. */
export async function connectClient(
  overrides: Partial<ConstructorParameters<typeof OctosUiClient>[0]> = {},
) {
  const socket = createSocket();
  const client = new OctosUiClient({
    endpoint: "http://127.0.0.1:50080",
    webSocketFactory: () => socket as unknown as WebSocket,
    ...overrides,
  });
  const connecting = client.connect();
  socket.readyState = 1;
  socket.onopen?.({} as Event);
  await connecting;
  return { socket, client };
}
