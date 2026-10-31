import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const SNAPSHOT = {
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.01,
};

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await expect(page.locator("aside")).toBeVisible();
}

async function startSession(page: Page, workspace: string) {
  await connect(page);
  const path = page.getByLabel("Server workspace path");
  await path.fill(workspace);
  await path.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

function protocolRequests(page: Page) {
  const methods: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const method = JSON.parse(String(payload)).method;
      if (method) methods.push(method);
    }),
  );
  return methods;
}

test("settings defaults use the standard rows and themed select", async ({
  page,
}) => {
  await startSession(page, "/workspace/unfinished-defaults");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const defaults = page.getByRole("region", { name: "Defaults", exact: true });
  await defaults.scrollIntoViewIfNeeded();
  const row = defaults.locator('[data-defaults-field="permission-mode"]');
  await expect(row).toHaveCSS("display", "flex");
  const select = row.getByRole("combobox");
  await expect(select).toHaveCSS("border-style", "solid");
  await expect(select).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-settings-defaults="true"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  const newSessions = row.locator("..");
  await newSessions.scrollIntoViewIfNeeded();
  await expect(newSessions).toHaveScreenshot("settings-defaults.png", SNAPSHOT);
});

test("agents without a session has a complete empty state", async ({
  page,
}) => {
  await connect(page);
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  const empty = page.locator('[data-fleet-empty-session="true"]');
  await expect(empty.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(empty).toContainText("Choose a workspace");
  await expect(
    empty.getByRole("button", { name: "New session" }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-fleet-empty-session="true"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await expect(empty).toHaveScreenshot("agents-empty.png", SNAPSHOT);
});

test("one workspace starts a new session without a redundant picker", async ({
  page,
}) => {
  const methods = protocolRequests(page);
  await startSession(page, "/workspace/unfinished-single-workspace");
  const primary = page
    .getByRole("button", { name: "New session", exact: true })
    .last();
  await expect(primary).toHaveText("New session");
  const before = methods.filter((method) => method === "session/open").length;
  await primary.click();
  await expect
    .poll(() => methods.filter((method) => method === "session/open").length)
    .toBe(before + 1);
  await expect(
    page.getByRole("dialog", { name: "Choose a workspace" }),
  ).toHaveCount(0);
});

test("the workspace picker fits its rows and keeps footer actions visible", async ({
  page,
}) => {
  await startSession(page, "/workspace/unfinished-picker-a");
  const navigation = page.locator("aside");
  await navigation
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  const path = page.getByLabel("Server workspace path");
  await path.fill("/workspace/unfinished-picker-b");
  await path.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  await navigation
    .getByRole("button", { name: "New session", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog", { name: "Choose a workspace" });
  await expect(dialog.getByRole("list")).toBeVisible();
  await expect(dialog.getByRole("list").locator("li")).toHaveCount(2);
  await expect(
    dialog.getByRole("button", { name: "Add workspace" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(dialog.getByText("New Session", { exact: true })).toHaveCount(0);
  const box = await dialog.boundingBox();
  expect(box!.height).toBeLessThan(560);
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await expect(dialog).toHaveScreenshot("workspace-picker.png", SNAPSHOT);
});

test("deleting the current session returns to the previous one, then to the new-session page", async ({
  page,
  request,
}) => {
  const workspace = "/workspace/unfinished-delete-current";
  await request.post(
    `${ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent(workspace)}`,
  );
  await startSession(page, workspace);
  const navigation = page.locator("aside");
  await navigation
    .getByRole("treeitem", { name: "unfinished-delete-current", exact: true })
    .hover();
  await navigation
    .getByRole("button", { name: "New session in unfinished-delete-current" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  await expect(
    navigation.locator('[role="treeitem"][data-session-id]'),
  ).toHaveCount(2);

  const deleteCurrent = async () => {
    const current = navigation.locator(
      '[role="treeitem"][data-session-id][aria-current="page"]',
    );
    await current.getByRole("button", { name: /More actions/ }).click();
    await page.getByRole("menuitem", { name: /Delete…/ }).click();
    await page
      .getByRole("dialog", { name: "Delete this session?" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
  };

  await deleteCurrent();
  await expect(
    navigation.locator('[role="treeitem"][data-session-id]'),
  ).toHaveCount(1);
  await expect(
    navigation.locator(
      '[role="treeitem"][data-session-id][aria-current="page"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();

  await deleteCurrent();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: /Choose a workspace|Add workspace/ }),
  ).toBeVisible();
});

test("Chinese token errors are distinct, focused, and do not move the card", async ({
  page,
}) => {
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
  await page.goto("/");
  const token = page.locator("#connection-token");
  await page.locator("#connection-origin").fill(ORIGIN);
  await token.fill("fixture-invalid-auth-token");
  const card = page.locator('form[class*="card"]');
  const before = await card.boundingBox();
  await page.locator('button[type="submit"]').click();
  await expect(
    page.getByRole("alert").filter({ hasText: "令牌不对" }),
  ).toBeVisible();
  await expect(token).toBeFocused();
  await expect(token).toHaveValue("fixture-invalid-auth-token");
  const after = await card.boundingBox();
  expect(after!.y).toBe(before!.y);
  await expect(card).toHaveScreenshot(
    "connection-token-error-zh.png",
    SNAPSHOT,
  );

  await page
    .locator("#connection-origin")
    .fill("ws://127.0.0.1:1/api/ui-protocol/ws");
  await page.locator('button[type="submit"]').click();
  const failure = page.getByRole("alert").filter({ hasText: "连不上" });
  await expect(failure).toBeVisible();
  await expect(failure).not.toContainText("令牌不对");
});
