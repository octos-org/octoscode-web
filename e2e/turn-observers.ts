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
