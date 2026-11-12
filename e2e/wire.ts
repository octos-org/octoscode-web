import type { Page, WebSocketRoute } from "@playwright/test";

/** Either end of a routed WebSocket (`page.routeWebSocket`). */
type Sender = Pick<WebSocketRoute, "send">;
type RequestId = string | number;

/** Answers JSON-RPC request `id` with `result`. */
export function sendResult(socket: Sender, id: RequestId, result: unknown) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

/** Refuses JSON-RPC request `id` with `error`. */
export function sendError(
  socket: Sender,
  id: RequestId,
  error: { code: number; message: string; data?: unknown },
) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, error }));
}

/**
 * Pushes one `projection/envelope` for `turn`: `seq` within `thread`, at
 * cursor `cursor` of the turn's Session stream.
 */
export function sendEnvelope(
  socket: Sender,
  turn: { session_id: string; turn_id: string },
  at: { thread: string; seq: number; cursor: number },
  type: string,
  data: unknown,
) {
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "projection/envelope",
      params: {
        session_id: turn.session_id,
        turn_id: turn.turn_id,
        thread_id: at.thread,
        seq: at.seq,
        cursor: { stream: turn.session_id, seq: at.cursor },
        payload: { type, data },
      },
    }),
  );
}

/** A request the page sent. */
export interface WireRequest {
  id: string | number;
  method?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as sent
  params: any;
}

/**
 * Routes the page's protocol socket to the fixture through `onRequest`, which
 * sees each request first, with the page end of the route to answer it on.
 * Returning true keeps that request from the fixture.
 */
export function interceptRequests(
  page: Page,
  onRequest: (request: WireRequest, socket: WebSocketRoute) => boolean | void,
): Promise<void> {
  return page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (onRequest(JSON.parse(String(message)), socket) !== true)
        server.send(message);
    });
  });
}
