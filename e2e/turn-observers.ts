import type { Page } from "@playwright/test";

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
