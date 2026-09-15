import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const TAB_KEY = "octoscode-web.tab-connection.v3";

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/storage-check");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

async function warnsOnLeave(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

test("failed Forget stays visible across identity edits until saved data can actually be cleared", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await page
    .getByRole("textbox", { name: "Message Octos" })
    .fill("A draft that must not silently return after Forget");
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage)
        throw new DOMException("Read-only storage", "SecurityError");
      write.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === sessionStorage)
        throw new DOMException("Read-only storage", "SecurityError");
      remove.call(this, key);
    };
    (window as unknown as { restoreStorage: () => void }).restoreStorage =
      () => {
        Storage.prototype.setItem = write;
        Storage.prototype.removeItem = remove;
      };
  });
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Forget server", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  const warning = page
    .getByRole("alert")
    .filter({ hasText: "Saved data could not be cleared" });
  await expect(warning).toBeVisible();
  expect(await warnsOnLeave(page)).toBe(true);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), TAB_KEY),
  ).toContain("A draft that must not silently return");
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("new-identity-token");
  await expect(warning).toBeVisible();
  expect(await warnsOnLeave(page)).toBe(true);
  await page.evaluate(() =>
    (window as unknown as { restoreStorage: () => void }).restoreStorage(),
  );
  await page
    .getByRole("button", { name: "Forget saved connection", exact: true })
    .click();
  await expect(warning).toHaveCount(0);
  expect(await warnsOnLeave(page)).toBe(false);
  expect(
    (await page.evaluate((key) => sessionStorage.getItem(key), TAB_KEY)) ?? "",
  ).not.toContain("A draft that must not silently return");
  expect(errors).toEqual([]);
});

test("denied storage getters still allow an in-memory connection and readable cleanup feedback", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    for (const key of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, key, {
        configurable: true,
        get() {
          throw new DOMException("Storage denied", "SecurityError");
        },
      });
    }
  });
  await start(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Saved data could not be cleared" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Octos" })
    .fill("Memory-only editing still works");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("Memory-only editing still works");
  expect(await warnsOnLeave(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("a 51st unsent draft keeps the existing 50 intact and blocks navigation until cleared", async ({
  page,
}) => {
  await start(page);
  await page.evaluate((key) => {
    const connection = JSON.parse(sessionStorage.getItem(key)!);
    connection.composerDrafts = Array.from({ length: 50 }, (_, index) => [
      JSON.stringify([
        `/workspace/saved-${index}`,
        "_main",
        `session-${index}`,
      ]),
      `Retained text ${index}`,
    ]);
    sessionStorage.setItem(key, JSON.stringify(connection));
  }, TAB_KEY);
  await page.reload();
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await expect(input).toBeVisible();
  const draft = "The 51st draft stays here until I send, clear, or copy it";
  await input.fill(draft);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "already keeps 50 unsent drafts" }),
  ).toBeVisible();
  expect(await warnsOnLeave(page)).toBe(true);
  const sidebar = page.getByRole("complementary", {
    name: "Product navigation",
  });
  await sidebar
    .getByRole("button", { name: "New session", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("dialog", { name: /New session|Choose a workspace/ }),
  ).toHaveCount(0);
  await expect(input).toHaveValue(draft);
  const retained = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!).composerDrafts,
    TAB_KEY,
  );
  expect(retained).toHaveLength(50);
  expect(retained[0][1]).toBe("Retained text 0");
  const originalSession = await sidebar
    .getByRole("treeitem", { name: /Session / })
    .first()
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!originalSession) throw new Error("Expected current Session title");
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Disconnect from Octos?",
    exact: true,
  });
  await expect(confirmation).toContainText("This input has not been saved");
  await confirmation
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  expect(await warnsOnLeave(page)).toBe(true);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await sidebar
    .locator('button[role="treeitem"]')
    .filter({ hasText: originalSession })
    .click();
  await expect(input).toHaveValue(draft);
  await input.fill("");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "already keeps 50 unsent drafts" }),
  ).toHaveCount(0);
  expect(await warnsOnLeave(page)).toBe(false);
  await sidebar
    .getByRole("button", { name: "New session", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Choose a workspace", exact: true }),
  ).toBeVisible();
});
