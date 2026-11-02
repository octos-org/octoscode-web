import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

// T-0177: a launch whose socket closes used to show its error for half a
// second, until the automatic reconnect erased it. Each case holds the error
// for six seconds, longer than any reconnect here takes.
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const PERMISSION =
  "This account can't open the Profile for this folder. Choose another folder, or ask the server admin for access and try again.";
const CLOSED = "Octos UI Protocol connection closed";
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
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  await expect(alert).toHaveCount(0);
  expect(socket.attempts()).toBe(2);
});

test("the error also stays when every reconnect is refused", async ({
  page,
}) => {
  const workspace = `/workspace/close-refused-${Date.now()}`;
  const socket = await closeOnSessionOpen(page, {
    close: { code: 1008, reason: "auth_expired" },
    refuseReconnect: true,
  });
  await connect(page, workspace);
  await page.getByRole("button", { name: "Start session" }).click();

  const alert = page.getByRole("alert");
  await expect(alert.first()).toHaveText(PERMISSION);
  await page.waitForTimeout(SETTLE_MS);
  await expect(alert.first()).toHaveText(PERMISSION);
  await expect(page.getByLabel("Server workspace path")).toHaveValue(workspace);
  await expect(page.getByLabel("Auth token", { exact: true })).toHaveCount(0);
  // Backoff, not a storm: a handful of attempts in six seconds.
  expect(socket.attempts()).toBeLessThanOrEqual(6);
});

test("any other close keeps its own message and is not called a permission problem", async ({
  page,
}) => {
  await closeOnSessionOpen(page, {
    close: { code: 1011, reason: "internal error" },
  });
  await connect(page, `/workspace/close-1011-${Date.now()}`);
  const start = page.getByRole("button", { name: "Start session" });
  await start.click();

  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(CLOSED);
  await page.waitForTimeout(SETTLE_MS);
  await expect(alert).toHaveText(CLOSED);
  await expect(start).toBeEnabled();
});

test("the permission message is translated", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "octoscode.web.display.v1",
      JSON.stringify({
        version: 1,
        theme: "terminal",
        language: "zh",
        vimMode: false,
      }),
    );
  });
  await closeOnSessionOpen(page, {
    close: { code: 1008, reason: "auth_expired" },
  });
  await page.goto("/");
  await page.locator("#connection-origin").fill(FIXTURE_ORIGIN);
  await page.locator("#connection-token").fill("tab-scoped-e2e-token");
  await page.locator('form[class*="card"] button[type="submit"]').click();
  const path = page.getByLabel(/服务器工作区路径/);
  await path.fill(`/workspace/close-zh-${Date.now()}`);
  await path.press("Enter");

  await expect(page.getByRole("alert")).toHaveText(
    "此账号无权打开这个文件夹对应的配置档案。请换一个文件夹，或请服务器管理员开通权限后重试。",
  );
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

test("a healthy reconnect still clears the fatal an earlier recovery set", async ({
  page,
}) => {
  const socket = await closeOnSessionOpen(page, {});
  await connect(page, `/workspace/close-fatal-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();

  socket.control.rejectOpen = true;
  socket.sockets.at(-1)?.close({ code: 1012, reason: "fixture restart" });
  await expect(page.getByRole("alert").first()).toContainText(
    "could not be recovered",
    { timeout: 15_000 },
  );

  socket.control.rejectOpen = false;
  socket.sockets.at(-1)?.close({ code: 1012, reason: "fixture restart" });
  await expect(page.getByText("could not be recovered")).toHaveCount(0, {
    timeout: 15_000,
  });
});
