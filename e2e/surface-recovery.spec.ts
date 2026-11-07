import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const modelManagementModule =
  /\/(?:assets\/ModelManagementSettings-[^/]+\.js|src\/features\/product-settings\/ModelManagementSettings\.tsx)(?:\?.*)?$/;

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/surface-recovery");
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(composerInput(page)).toBeVisible();
}

function composerInput(page: Page) {
  return page.getByRole("textbox", { name: "Message Octos" });
}

function settingsTrigger(page: Page) {
  return page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true });
}

test("a failed model-management chunk preserves the owner, queue, draft and Stop", async ({
  page,
}) => {
  let closed = 0;
  const starts: string[] = [];
  const interrupts: string[] = [];
  page.on("websocket", (socket) => socket.on("close", () => closed++));
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "turn/start") {
        starts.push(frame.params.turn_id);
        socket.send(
          JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
        );
        return;
      }
      if (frame.method === "turn/interrupt")
        interrupts.push(frame.params.turn_id);
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  // Armed before navigation: the settings chunk is now idle-preloaded
  // (#131), so the failure must apply from the very first fetch onward,
  // not just at click time.
  await page.route(modelManagementModule, (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "Resource unavailable",
    }),
  );
  await start(page);
  const composer = composerInput(page);
  await composer.fill("Keep this response active");
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await composer.fill("Keep this queued message");
  await composer.press("Enter");
  await composer.fill("Keep this unsent draft");
  const previouslyClosed = closed;
  await settingsTrigger(page).click();
  await page.getByRole("button", { name: "Models", exact: true }).click();
  const error = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(error).toBeVisible();
  await expect(
    error.getByRole("heading", { name: "Model management unavailable" }),
  ).toBeVisible();
  await expect(
    error.getByRole("button", { name: "Models", exact: true }),
  ).toBeFocused();
  await expect(error).toContainText("Reloading may stop running work");
  expect(closed).toBe(previouslyClosed);
  expect(starts).toHaveLength(1);
  expect(interrupts).toHaveLength(0);
  await error
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(settingsTrigger(page)).toBeFocused();
  await expect(composer).toHaveValue("Keep this unsent draft");
  await expect(
    page.getByText("Keep this queued message", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => interrupts.length).toBe(1);
});

test("a late clipboard command result does not enter a different conversation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((resolve) => {
            Object.assign(window, { finishCopy: resolve });
          }),
      },
    });
  });
  await start(page);
  const composer = composerInput(page);
  await composer.fill("Write a short response for the clipboard");
  await composer.press("Enter");
  await expect(page.locator(".entry-assistant").last()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await composer.fill("/copy");
  await composer.press("Enter");
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(window, "finishCopy")))
    .toBe("function");
  const previousUrl = page.url();
  const workspace = page.getByRole("button", {
    name: "surface-recovery",
    exact: true,
  });
  await workspace.hover();
  await page
    .getByRole("button", { name: "New session in surface-recovery" })
    .click();
  await expect(page).not.toHaveURL(previousUrl);
  await page.evaluate(() => Reflect.get(window, "finishCopy")());
  await expect(page.getByText("Copied", { exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(previousUrl);
});
