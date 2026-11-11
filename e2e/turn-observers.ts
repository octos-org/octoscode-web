import { expect, type Page } from "@playwright/test";

/** Shared by the multi-session specs: what the page itself sent. */
export interface StartedTurn {
  sessionId: string;
  turnId: string;
  text: string;
}

export function observeStartedTurns(page: Page): () => StartedTurn[] {
  const started: StartedTurn[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = String(payload);
      if (!frame.includes('"method":"turn/start"')) return;
      const request = JSON.parse(frame) as {
        params?: {
          session_id?: unknown;
          turn_id?: unknown;
          input?: Array<{ text?: unknown }>;
        };
      };
      if (
        typeof request.params?.session_id === "string" &&
        typeof request.params.turn_id === "string"
      ) {
        started.push({
          sessionId: request.params.session_id,
          turnId: request.params.turn_id,
          text:
            typeof request.params.input?.[0]?.text === "string"
              ? request.params.input[0].text
              : "",
        });
      }
    });
  });
  return () => started.slice();
}

export function observeInterrupts(page: Page): () => number {
  let interrupts = 0;
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (String(payload).includes('"method":"turn/interrupt"')) {
        interrupts += 1;
      }
    });
  });
  return () => interrupts;
}

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

/** Counts this page's WebSocket transports: open now, ever created, most open at once. */
export function observeTransports(page: Page) {
  const open = new Set<number>();
  let created = 0;
  let peak = 0;
  page.on("websocket", (socket) => {
    const id = ++created;
    open.add(id);
    peak = Math.max(peak, open.size);
    socket.on("close", () => open.delete(id));
  });
  return { live: () => open.size, created: () => created, peak: () => peak };
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

/**
 * Uncaught page errors and console errors. A fixture without pairing answers
 * the silent `/pair/info` probe with 404, which the browser still logs; that
 * one is not a defect.
 */
export function trackRuntimeErrors(page: Page) {
  const unhandled: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => unhandled.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (message.location().url.endsWith("/pair/info") && text.includes("404"))
      return;
    consoleErrors.push(text);
  });
  return () => ({
    unhandled: unhandled.slice(),
    consoleErrors: consoleErrors.slice(),
  });
}
