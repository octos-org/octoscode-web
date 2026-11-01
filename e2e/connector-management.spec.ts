import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function start(page: Page, workspace: string, stable = false) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(origin);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/srv/work/${workspace}${stable ? "" : `-${Date.now()}`}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

async function openConnectors(page: Page, chinese = false) {
  const navigation = page.locator("aside");
  const settingsButton = navigation.getByRole("button", {
    name: chinese ? "设置" : "Settings",
    exact: true,
  });
  if (!(await settingsButton.isVisible())) {
    await page
      .getByRole("button", {
        name: chinese
          ? "打开会话列表"
          : /^(Open session list|Open navigation)$/,
        exact: !chinese,
      })
      .click();
  }
  await settingsButton.click();
  const settings = page.getByRole("dialog", {
    name: chinese ? "设置" : "Settings",
  });
  await settings
    .getByRole("button", {
      name: chinese ? "连接器" : "Connectors",
      exact: true,
    })
    .click();
  return settings;
}

async function useChinese(page: Page) {
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("/theme");
  await composer.press("Enter");
  const preferences = page.getByRole("dialog");
  await preferences
    .locator('label:has-text("Language") select')
    .selectOption("zh");
  await preferences
    .getByRole("button", { name: "关闭偏好设置", exact: true })
    .click();
  await expect(preferences).toHaveCount(0);
}

function connector(settings: ReturnType<Page["getByRole"]>, id: string) {
  return settings.locator(`[data-connector-id="${id}"]`);
}

test("manages HTTP connectors and keeps existing stdio controls", async ({
  page,
}) => {
  await start(page, "connector-management");
  const settings = await openConnectors(page);
  const legacy = connector(settings, "legacy");
  const docs = connector(settings, "docs");
  await expect(legacy).toContainText("Legacy HTTP");
  await expect(docs).toContainText("Documentation MCP");

  await settings.getByRole("button", { name: "Add HTTP connector" }).click();
  const add = settings.getByRole("form", { name: "Add HTTP connector" });
  await add.getByLabel("Connector name").fill("Team docs");
  await add.getByLabel("HTTP URL").fill("https://mcp.example.test/team");
  await add.getByRole("button", { name: "Save connector" }).click();
  const created = connector(settings, "http-3");
  await expect(created).toContainText("Team docs");
  await expect(created).toContainText("connected");

  await created.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = settings.getByRole("form", { name: "Edit connector" });
  await edit.getByLabel("Connector name").fill("Team docs updated");
  await edit.getByLabel("HTTP URL").fill("https://mcp.example.test/v2");
  await edit.getByRole("button", { name: "Save connector" }).click();
  await expect(created).toContainText("Team docs updated");

  await created.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(created).toContainText("disabled");
  await expect(
    created.getByRole("button", { name: "Reconnect" }),
  ).toBeDisabled();
  await created.getByRole("button", { name: "Enable", exact: true }).click();
  await created.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(created).toContainText("connected");

  await docs.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(docs).toContainText("disabled");
  await docs.getByRole("button", { name: "Enable", exact: true }).click();
  await docs.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(docs).toContainText("connected");

  await created.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(created).toContainText("Delete Team docs updated?");
  await created.getByRole("button", { name: "Confirm delete" }).click();
  await expect(created).toHaveCount(0);
  await expect(settings.getByText(/oauth/i)).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
});

test("a forbidden mutation explains and disables management without losing status", async ({
  page,
}) => {
  await start(page, "connector-management-denied");
  const settings = await openConnectors(page);
  const legacy = connector(settings, "legacy");
  await expect(legacy).toContainText("connection refused");
  await legacy.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = settings.getByRole("form", { name: "Edit connector" });
  await edit.getByLabel("Connector name").fill("Should not be saved");
  await edit.getByRole("button", { name: "Save connector" }).click();
  await expect(
    settings.getByText(
      "You do not have permission to manage this profile's connectors.",
    ),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Add HTTP connector" }),
  ).toBeDisabled();
  await expect(legacy.getByRole("button", { name: "Edit" })).toBeDisabled();
  await expect(legacy).toContainText("Legacy HTTP");
  await expect(legacy).toContainText("connection refused");
});

test("a delayed refresh blocks mutations and always releases busy state", async ({
  page,
}) => {
  let listCalls = 0;
  let release: (() => void) | undefined;
  const heldListIds = new Set<string>();
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message)) as {
        id?: string;
        method?: string;
      };
      if (frame.method === "mcp/status/list") {
        listCalls += 1;
        if (listCalls === 2 && frame.id) heldListIds.add(frame.id);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message)) as { id?: string };
      if (frame.id && heldListIds.has(frame.id)) {
        release = () => socket.send(message);
        return;
      }
      socket.send(message);
    });
  });
  await start(page, "connector-management");
  const settings = await openConnectors(page);
  await settings.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await expect(
    settings.getByRole("button", { name: "Add HTTP connector" }),
  ).toBeDisabled();
  await expect(
    connector(settings, "docs").getByRole("button", { name: "Disable" }),
  ).toBeDisabled();
  release?.();
  await expect(
    settings.getByRole("button", { name: "Add HTTP connector" }),
  ).toBeEnabled();
  await expect(settings.getByRole("button", { name: "Refresh" })).toBeEnabled();
  const docs = connector(settings, "docs");
  await docs.getByRole("button", { name: "Disable" }).click();
  await expect(docs.getByRole("button", { name: "Enable" })).toBeVisible();
  expect(listCalls).toBe(3);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Chinese connector management is accessible on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "one visual engine");
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await start(page, "connector-management", true);
    await useChinese(page);
    const settings = await openConnectors(page, true);
    await settings.getByRole("button", { name: "添加 HTTP 连接器" }).click();
    const add = settings.getByRole("form", { name: "添加 HTTP 连接器" });
    await add.getByLabel("连接器名称").fill("团队知识库");
    await add.getByLabel("HTTP URL").fill("https://mcp.example.test/team");
    await add.getByRole("button", { name: "保存连接器" }).click();
    await expect(connector(settings, "http-3")).toContainText("团队知识库");
    await expect(
      settings.getByText("已连接", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      settings.getByText("需要运维先在服务器上配置白名单"),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    await page.evaluate(() => document.fonts.ready);
    await expect(settings).toHaveScreenshot(
      `connector-management-${viewport.name}.png`,
      { animations: "disabled" },
    );
  });
}

test.afterEach(async ({ request }) => {
  await request.post(`${origin}/__test__/connectors/reset`);
});
