import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/draft-recovery");
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

test("reload restores exact unsent text without dispatching it, and sent drafts stay cleared", async ({
  page,
}) => {
  const starts: unknown[] = [];
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "turn/start") starts.push(frame.params);
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  const text = "  尚未发送的审阅说明 👩🏽‍💻\n\n保留最后的空白  ";
  await input.fill(text);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "尚未发送",
  );
  await page.reload();
  await expect(input).toHaveValue(text);
  expect(starts).toHaveLength(0);
  await input.press("Enter");
  await expect.poll(() => starts.length).toBe(1);
  await expect(input).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeHidden();
  await page.reload();
  await expect(input).toHaveValue("");
  expect(starts).toHaveLength(1);
});

test("a rejected draft storage write preserves editing and warns before text can be lost", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("先前已经保存的草稿");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage)
        throw new DOMException("Storage full", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await input.fill("仍然可以编辑和复制，不应白屏");
  await expect(input).toHaveValue("仍然可以编辑和复制，不应白屏");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Draft changes could not be saved" }),
  ).toBeVisible();
  const warned = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(warned).toBe(true);
  // A failed deletion is still dirty: reloading must not silently resurrect
  // an older submitted draft just because the visible input became empty.
  await input.fill("");
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  expect(errors).toEqual([]);
});
