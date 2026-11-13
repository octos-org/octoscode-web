import { expect, type Page } from "@playwright/test";

/** The params of every `method` request the page sent, in order. */
export function observeSent(
  page: Page,
  method: string,
): () => Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = String(payload);
      if (!frame.includes(`"method":"${method}"`)) return;
      sent.push(
        (JSON.parse(frame) as { params: Record<string, unknown> }).params,
      );
    });
  });
  return () => sent.slice();
}

/** One JSON-RPC frame, tagged with the socket it used: ids restart per socket. */
export interface WireFrame {
  socket: number;
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/** Every JSON-RPC frame the page sends and receives. */
export function observeFrames(page: Page) {
  const sent: WireFrame[] = [];
  const received: WireFrame[] = [];
  let sockets = 0;
  page.on("websocket", (socket) => {
    const ordinal = sockets++;
    const take =
      (into: WireFrame[]) =>
      ({ payload }: { payload: string | Buffer }) => {
        try {
          into.push({ ...JSON.parse(String(payload)), socket: ordinal });
        } catch {
          // Not JSON-RPC.
        }
      };
    socket.on("framesent", take(sent));
    socket.on("framereceived", take(received));
  });
  const replyTo = (frame: WireFrame) =>
    received.find(
      (candidate) =>
        candidate.id === frame.id &&
        candidate.socket === frame.socket &&
        candidate.method === undefined,
    );
  return {
    sent,
    received,
    /** What the page sent as `method`, in order. */
    calls: (method: string) => sent.filter((frame) => frame.method === method),
    /** Notifications the page received as `method`, in order. */
    events: (method: string) =>
      received.filter((frame) => frame.method === method),
    replyTo,
    /** Waits until the server has answered `frame`. */
    async settled(frame: WireFrame) {
      await expect.poll(() => replyTo(frame) !== undefined).toBe(true);
    },
  };
}
