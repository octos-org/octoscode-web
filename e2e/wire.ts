import type { WebSocketRoute } from "@playwright/test";

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
