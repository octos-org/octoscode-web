import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

// T-0177: a launch whose socket closes used to show its error for half a
// second, until the automatic reconnect erased it. Each case holds the error
// for six seconds, longer than any reconnect here takes.
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const PERMISSION =
  "This account can't open the Profile for this folder. Choose another folder, or ask the server admin for access and try again.";
const SETTLE_MS = 6_000;

type CloseOnOpen = {
  close: { code: number; reason: string } | null;
  refuseReconnect: boolean;
  /** Replies with an RPC error instead, as a server that lost the Session. */
  rejectOpen: boolean;
};

async function closeOnSessionOpen(page: Page, options: Partial<CloseOnOpen>) {
  const control: CloseOnOpen = {
    close: null,
    refuseReconnect: false,
    rejectOpen: false,
    ...options,
  };
  const sockets: WebSocketRoute[] = [];
  let attempts = 0;
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    attempts += 1;
    if (control.refuseReconnect && attempts > 1) {
      socket.close({ code: 1013, reason: "refused by test" });
      return;
    }
    sockets.push(socket);
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (request.method === "session/open" && control.rejectOpen) {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32603, message: "session store unavailable" },
          }),
        );
        return;
      }
      if (request.method === "session/open" && control.close) {
        const close = control.close;
        control.close = null;
        socket.close(close);
        return;
      }
      server.send(message);
    });
  });
  return { control, sockets, attempts: () => attempts };
}

async function connect(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill(workspace);
}

test("a 1008 launch explains the Profile and keeps the login across the reconnect", async ({
  page,
}) => {
  const workspace = `/workspace/close-1008-${Date.now()}`;
  const socket = await closeOnSessionOpen(page, {
    close: { code: 1008, reason: "auth_expired" },
  });
  await connect(page, workspace);
  const start = page.getByRole("button", { name: "Start session" });
  await start.click();

  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(PERMISSION);
  await page.waitForTimeout(SETTLE_MS);
  // One alert, not two: the sidebar's copy would offer a Retry that cannot
  // retry a launch.
  await expect(alert).toHaveText(PERMISSION);
  await expect(page.getByLabel("Server workspace path")).toHaveValue(workspace);
  await expect(start).toBeEnabled();
  await expect(page.getByLabel("Auth token", { exact: true })).toHaveCount(0);
  expect(socket.attempts()).toBe(2);

  // The token survived: the same button retries, and success clears the error.
  await start.click();
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  await expect(alert).toHaveCount(0);
  expect(socket.attempts()).toBe(2);

  // A new Session failing the same way from inside the open one keeps both
  // the error and the open Session; the sidebar is the surface left to say it.
  const selected = page.locator('[role="treeitem"][aria-current="page"]');
  const openSession = await selected.getAttribute("data-session-id");
  socket.control.close = { code: 1008, reason: "auth_expired" };
  await page
    .getByRole("button", { name: "New session", exact: true })
    .first()
    .click();
  await expect(alert.first()).toContainText(PERMISSION);
  await page.waitForTimeout(SETTLE_MS);
  await expect(alert.first()).toContainText(PERMISSION);
  await expect(composer).toBeEnabled();
  await expect(selected).toHaveAttribute("data-session-id", openSession!);
  expect(socket.attempts()).toBe(3);
});

test("a new Session that fails from an open one keeps both the error and the Session", async ({
  page,
}) => {
  const socket = await closeOnSessionOpen(page, {});
  await connect(page, `/workspace/close-open-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();

  socket.control.close = { code: 1008, reason: "auth_expired" };
  await page
    .getByRole("button", { name: "New session", exact: true })
    .first()
    .click();

  // The Session recovers underneath, so the sidebar is the surface left to say it.
  await expect(page.getByRole("alert").first()).toContainText(PERMISSION);
  await page.waitForTimeout(SETTLE_MS);
  await expect(page.getByRole("alert").first()).toContainText(PERMISSION);
  await expect(composer).toBeEnabled();
  expect(socket.attempts()).toBe(2);
});
