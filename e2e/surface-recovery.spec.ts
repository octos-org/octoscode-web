import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const settingsModule =
  /\/(?:assets\/SettingsDialog-[^/]+\.js|src\/features\/product-controls\/SettingsDialog\.tsx)(?:\?.*)?$/;
const reviewModule =
  /\/(?:assets\/DiffReviewDialog-[^/]+\.js|src\/features\/review\/DiffReviewDialog\.tsx)(?:\?.*)?$/;

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
  await expect(
    page.getByRole("combobox", { name: "Message Octos" }),
  ).toBeVisible();
}

function settingsTrigger(page: Page) {
  return page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true });
}

test("a failed Settings chunk preserves the owner, queue, draft and Stop", async ({
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
  await start(page);
  const composer = page.getByRole("combobox", { name: "Message Octos" });
  await composer.fill("Keep this response active");
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await composer.fill("Keep this queued message");
  await composer.press("Enter");
  await composer.fill("Keep this unsent draft");
  const previouslyClosed = closed;
  await page.route(settingsModule, (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "Resource unavailable",
    }),
  );
  await settingsTrigger(page).click();
  const error = page.getByRole("dialog", { name: "Settings unavailable" });
  await expect(error).toBeVisible();
  await expect(
    error.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await expect(error).toContainText("Reloading may stop running work");
  expect(closed).toBe(previouslyClosed);
  expect(starts).toHaveLength(1);
  expect(interrupts).toHaveLength(0);
  await error.getByRole("button", { name: "Close", exact: true }).click();
  await expect(settingsTrigger(page)).toBeFocused();
  await expect(composer).toHaveValue("Keep this unsent draft");
  await expect(
    page.getByText("Keep this queued message", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => interrupts.length).toBe(1);
});

test("a slow Settings import can be canceled and never opens after cancellation", async ({
  page,
}) => {
  await start(page);
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fulfilled = false;
  await page.route(settingsModule, async (route) => {
    const response = await route.fetch();
    await released;
    await route.fulfill({ response });
    fulfilled = true;
  });
  const composer = page.getByRole("combobox", { name: "Message Octos" });
  await composer.fill("Keep typing after cancellation");
  await settingsTrigger(page).click();
  const loading = page.getByRole("dialog", { name: "Loading settings…" });
  await expect(loading).toBeVisible();
  await loading.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(settingsTrigger(page)).toBeFocused();
  release();
  await expect.poll(() => fulfilled).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(composer).toHaveValue("Keep typing after cancellation");
  await settingsTrigger(page).click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
});

test("Escape from a failed review returns to approval without interrupting", async ({
  page,
}) => {
  const interrupts: string[] = [];
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "turn/interrupt")
        interrupts.push(frame.params.turn_id);
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "approval/requested") {
        frame.params.typed_details.diff = {
          preview_id: "00000000-0000-4000-8000-000000000042",
        };
        socket.send(JSON.stringify(frame));
      } else socket.send(message);
    });
  });
  await start(page);
  await page.route(reviewModule, (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "Resource unavailable",
    }),
  );
  const composer = page.getByRole("combobox", { name: "Message Octos" });
  await composer.fill("Request approval fixture");
  await composer.press("Enter");
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  const reviewTrigger = approval.getByRole("button", { name: /Review diff/ });
  await reviewTrigger.click();
  const error = page.getByRole("dialog", { name: "Review unavailable" });
  await expect(error).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(error).toBeHidden();
  await expect(reviewTrigger).toBeFocused();
  expect(interrupts).toEqual([]);
  await page.keyboard.press("Escape");
  await expect.poll(() => interrupts.length).toBe(1);
});

test("a failed local-command chunk restores input and never sends command text to the model", async ({
  page,
}) => {
  const starts: string[] = [];
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "turn/start") starts.push(frame.params.input);
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await start(page);
  await page.route(
    /\/(?:assets\/execute-local-command-[^/]+\.js|src\/features\/commands\/execute-local-command\.tsx?)(?:\?.*)?$/,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Resource unavailable",
      }),
  );
  const composer = page.getByRole("combobox", { name: "Message Octos" });
  await composer.fill("/help");
  await composer.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Command unavailable. Nothing was sent.",
  );
  await expect(composer).toHaveValue("/help");
  expect(starts).toEqual([]);
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
  const composer = page.getByRole("combobox", { name: "Message Octos" });
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
