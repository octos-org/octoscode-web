import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/approval-clarity-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

async function prepareReadOnly(page: Page, network = "Network blocked") {
  await start(page);
  await page
    .getByRole("button", { name: /Session settings|Workspace write/ })
    .first()
    .click();
  const settings = page.getByRole("dialog", { name: "Session settings" });
  await settings
    .locator('button[aria-haspopup="menu"]')
    .filter({ hasText: /Write|Read/ })
    .first()
    .click();
  await page
    .getByRole("menuitemradio", { name: new RegExp(`^Read · ${network}`) })
    .click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Session settings" }),
  ).toHaveCount(0);
  await page.reload();
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  return composer;
}

async function prepareDeniedWrite(page: Page) {
  const composer = await prepareReadOnly(page);
  await composer.fill("Fail a write fixture");
  await composer.press("Enter");
  const retry = page.getByRole("button", {
    name: "Switch to write and continue",
  });
  await expect(retry).toBeVisible();
  return { composer, retry };
}

test("switching stops the running workaround, then redoes the request with write access", async ({
  page,
}) => {
  const sent: string[] = [];
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const { method } = JSON.parse(String(message));
      if (
        method === "permission/profile/set" ||
        method === "turn/interrupt" ||
        method === "turn/start"
      )
        sent.push(method);
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  const composer = await prepareReadOnly(page);
  await composer.fill("Fail a write and ask to work around it");
  await composer.press("Enter");
  // The approval card covers the dock, so the way out has to live inside it.
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  const retry = approval.getByRole("button", {
    name: "Switch to write and continue",
  });
  await expect(retry).toBeVisible();
  await expect(approval.getByRole("status")).toContainText(
    "This stops the current response",
  );
  sent.length = 0;
  await retry.click();
  await expect(approval).toBeHidden();
  await expect(
    page.locator("details").filter({ hasText: "report.md written" }),
  ).toHaveCount(1);
  expect(sent).toEqual([
    "permission/profile/set",
    "turn/interrupt",
    "turn/start",
  ]);
});

test("a late permission retry never starts in or clears another Session", async ({
  page,
}) => {
  let armed = false;
  let setId: string | null = null;
  let held: { socket: WebSocketRoute; message: string | Buffer } | null = null;
  let starts = 0;
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "turn/start") starts += 1;
      if (armed && frame.method === "permission/profile/set") {
        armed = false;
        setId = frame.id;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (setId && frame.id === setId && frame.result) {
        held = { socket, message };
        return;
      }
      socket.send(message);
    });
  });
  const { composer, retry } = await prepareDeniedWrite(page);
  armed = true;
  await retry.click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await page
    .locator("aside")
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  const picker = page.getByRole("dialog");
  await picker
    .getByLabel("Server workspace path")
    .fill("/workspace/permission-retry-other");
  await picker.getByLabel("Server workspace path").press("Enter");
  await composer.fill("DO NOT LOSE: unrelated B draft");
  const before = starts;
  const response = held!;
  response.socket.send(response.message);
  setId = null;
  await page.waitForTimeout(300);
  await expect(composer).toHaveValue("DO NOT LOSE: unrelated B draft");
  expect(starts).toBe(before);
});

test("permission retry refuses a response that broadens network access", async ({
  page,
}) => {
  let armed = false;
  let setId: string | null = null;
  let held: {
    socket: WebSocketRoute;
    frame: { id?: string; result?: { current?: { network?: string } } };
  } | null = null;
  let starts = 0;
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "turn/start") starts += 1;
      if (armed && frame.method === "permission/profile/set") {
        armed = false;
        setId = frame.id;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (setId && frame.id === setId && frame.result) {
        held = { socket, frame };
        return;
      }
      socket.send(message);
    });
  });
  const { retry } = await prepareDeniedWrite(page);
  armed = true;
  await retry.click();
  await expect.poll(() => Boolean(held)).toBe(true);
  held!.frame.result!.current!.network = "allow";
  const before = starts;
  held!.socket.send(JSON.stringify(held!.frame));
  setId = null;
  await expect(
    page.getByText("The server did not apply workspace write permission."),
  ).toBeVisible();
  expect(starts).toBe(before);
});
