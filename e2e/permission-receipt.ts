import type { Page } from "@playwright/test";

export type PermissionSetResult = SetReply["result"];

interface SetReply {
  id?: string;
  result: {
    applied?: boolean;
    current?: { mode?: string; network?: string };
  };
}

/**
 * Frames pass through and `turn/start` is counted. Once armed, the server's
 * reply to the next `permission/profile/set` is held until the test releases
 * it, edited first if the test says so, so the page can be driven while its
 * permission receipt is outstanding.
 */
export async function holdPermissionReceipt(page: Page) {
  let armed = false;
  let setId: string | null = null;
  let held: { send: (text: string) => void; frame: SetReply } | null = null;
  let starts = 0;
  const updates: unknown[] = [];
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "turn/start") starts += 1;
      if (armed && frame.method === "permission/profile/set") {
        armed = false;
        setId = frame.id;
        updates.push(frame.params.update);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (setId && frame.id === setId && frame.result) {
        held = { send: (text) => socket.send(text), frame };
        return;
      }
      socket.send(message);
    });
  });
  return {
    arm: () => {
      armed = true;
    },
    isHeld: () => held !== null,
    starts: () => starts,
    /** The `update` of every set the page sent while armed. */
    updates,
    release(edit?: (result: SetReply["result"]) => void) {
      const reply = held!;
      held = null;
      setId = null;
      edit?.(reply.frame.result);
      reply.send(JSON.stringify(reply.frame));
    },
  };
}
