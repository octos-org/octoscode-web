import AxeBuilder from "@axe-core/playwright";
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

async function prepareDeniedWrite(page: Page) {
  await start(page);
  await page
    .getByRole("button", { name: /Session settings|Workspace write/ })
    .first()
    .click();
  await page
    .locator('button[aria-haspopup="menu"]')
    .filter({ hasText: /Write|Read/ })
    .first()
    .click();
  await page.getByRole("menuitemradio", { name: /^Read/ }).click();
  await page.reload();
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  await composer.fill("Fail a write fixture");
  await composer.press("Enter");
  await page
    .locator("details")
    .filter({ hasText: "write_file" })
    .locator("summary")
    .click();
  const retry = page.getByRole("button", {
    name: "Switch to write and retry",
  });
  await expect(retry).toBeVisible();
  return { composer, retry };
}

test("shows action, impact, risk, and explicit approval choices with zero axe violations", async ({
  page,
}, testInfo) => {
  await start(page);
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("Request approval fixture");
  await composer.press("Enter");
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  await expect(approval).toBeVisible();
  await expect(approval.locator(".approval-impact")).toContainText(
    "Current workspace · Network not specified · No deletion indicated",
  );
  await expect(approval.locator("em")).toHaveText("Medium risk");
  await expect(approval.getByRole("button", { name: /Deny/ })).toBeVisible();
  await expect(
    approval.getByRole("button", { name: /Allow for this session/ }),
  ).toBeVisible();
  await expect(
    approval.getByRole("button", { name: /Allow once/ }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include(".approval-card")
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("approval-clarity.png"),
    fullPage: true,
  });
  await page.keyboard.press("y");
  await expect(approval).toBeHidden();
});

test("switches a permission-denied write to workspace-write and retries it", async ({
  page,
}) => {
  const { retry } = await prepareDeniedWrite(page);
  await retry.click();
  await expect(page.getByText("report.md written").last()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Switch to write and retry" }),
  ).toHaveCount(0);
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
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const picker = page.getByRole("dialog");
  await picker
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
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

test("permission retry requires an applied workspace-write response", async ({
  page,
}) => {
  let armed = false;
  let setId: string | null = null;
  let held: {
    socket: WebSocketRoute;
    frame: { id?: string; result?: { applied?: boolean } };
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
  held!.frame.result!.applied = false;
  const before = starts;
  held!.socket.send(JSON.stringify(held!.frame));
  setId = null;
  await expect(
    page.getByText("The server did not apply workspace write permission."),
  ).toBeVisible();
  expect(starts).toBe(before);
});
