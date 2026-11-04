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
    .getByRole("button", { name: /Close settings|关闭设置/ })
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

test("adds a stdio connector from the server's allowlist, never a command", async ({
  page,
}) => {
  await start(page, "connector-management");
  const settings = await openConnectors(page);
  await expect(
    settings.getByText(
      "Add HTTP connectors, or stdio connectors from the server's allowlist.",
    ),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Add stdio connector" }).click();
  const add = settings.getByRole("form", { name: "Add stdio connector" });
  const entry = add.getByLabel("Allowlist entry");
  await expect(entry.locator("option")).toHaveText([
    "Shared files",
    "Echo tools",
  ]);
  await expect(entry).toHaveAccessibleDescription(
    "Read-only access to the shared project folder",
  );
  // Only the name is typed; the server's operator fixed the command.
  await expect(add.getByRole("textbox")).toHaveCount(1);
  await expect(add.getByLabel("Connector name")).toHaveValue("Shared files");
  await entry.selectOption("echo");
  await expect(add.getByLabel("Connector name")).toHaveValue("Echo tools");
  await expect(
    add.getByText("Read-only access to the shared project folder"),
  ).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await add.getByRole("button", { name: "Save connector" }).click();
  const created = connector(settings, "stdio-3");
  await expect(created).toContainText("Echo tools");
  await expect(created).toContainText("stdio");
  await expect(created).toContainText("connected");
});

test("an empty allowlist says an operator has to configure it", async ({
  page,
}) => {
  await start(page, "connector-management-empty");
  const settings = await openConnectors(page);
  await expect(
    settings.getByText(
      "No stdio connectors can be added: an operator needs to configure the server allowlist first.",
    ),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Add stdio connector" }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Add HTTP connector" }),
  ).toBeEnabled();
});

test("session-only access sees management greyed out before trying", async ({
  page,
}) => {
  const mutations: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const method = (JSON.parse(String(payload)) as { method?: string })
        .method;
      if (method?.startsWith("mcp/connector/")) mutations.push(method);
    }),
  );
  await start(page, "connector-management-readonly");
  const settings = await openConnectors(page);
  await expect(
    settings.getByText(
      "Management is disabled because this access can read sessions but cannot change the profile.",
    ),
  ).toBeVisible();
  for (const name of ["Add HTTP connector", "Add stdio connector"])
    await expect(settings.getByRole("button", { name })).toBeDisabled();
  const docs = connector(settings, "docs");
  await expect(docs).toContainText("Documentation MCP");
  for (const name of ["Edit", "Disable", "Reconnect", "Delete"])
    await expect(
      docs.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  await expect(settings.getByRole("button", { name: "Refresh" })).toBeEnabled();
  expect(mutations).toEqual([]);
});

test("an older server without the facts keeps the refusal fallback", async ({
  page,
}) => {
  await start(page, "connector-management-denied");
  const settings = await openConnectors(page);
  const legacy = connector(settings, "legacy");
  await expect(legacy).toContainText("connection refused");
  await expect(
    settings.getByText(
      "HTTP connectors can be added here. stdio connectors require an operator-configured server allowlist.",
    ),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Add stdio connector" }),
  ).toHaveCount(0);
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

/**
 * Rewrite only `mcp/status/list` results at the WebSocket boundary and record
 * every connector mutation the page sends.
 */
async function patchStatus(
  page: Page,
  patch: (result: Record<string, unknown>) => Record<string, unknown>,
) {
  const mutations: string[] = [];
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const lists = new Set<string>();
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message)) as {
        id?: string;
        method?: string;
      };
      if (frame.method === "mcp/status/list" && frame.id) lists.add(frame.id);
      if (frame.method?.startsWith("mcp/connector/"))
        mutations.push(frame.method);
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message)) as {
        id?: string;
        result?: Record<string, unknown>;
      };
      if (frame.id && lists.delete(frame.id) && frame.result)
        socket.send(JSON.stringify({ ...frame, result: patch(frame.result) }));
      else socket.send(message);
    });
  });
  return mutations;
}

for (const [label, patch] of [
  [
    "a non-boolean can_manage",
    (result: Record<string, unknown>) => ({ ...result, can_manage: "false" }),
  ],
  [
    "a duplicated allowlist entry",
    (result: Record<string, unknown>) => ({
      ...result,
      stdio_allowlist: [{ entry_id: "duplicate" }, { entry_id: "duplicate" }],
    }),
  ],
] as const) {
  test(`${label} is reported, and management stays off`, async ({ page }) => {
    const mutations = await patchStatus(page, patch);
    await start(page, "connector-management");
    const settings = await openConnectors(page);
    await expect(settings.getByRole("alert")).toContainText(
      "The server sent connector management details this page can't read",
    );
    await expect(
      settings.getByRole("button", { name: "Add HTTP connector" }),
    ).toBeDisabled();
    await expect(
      settings.getByRole("button", { name: "Add stdio connector" }),
    ).toHaveCount(0);
    const docs = connector(settings, "docs");
    await expect(docs).toContainText("Documentation MCP");
    for (const name of ["Edit", "Disable", "Reconnect", "Delete"])
      await expect(
        docs.getByRole("button", { name, exact: true }),
      ).toBeDisabled();
    await expect(
      settings.getByText(
        "HTTP connectors can be added here. stdio connectors require an operator-configured server allowlist.",
      ),
    ).toHaveCount(0);
    expect(mutations).toEqual([]);
  });
}

test("an unknown unavailable reason is not called a permission problem", async ({
  page,
}) => {
  const mutations = await patchStatus(page, (result) => ({
    ...result,
    can_manage: false,
    manage_unavailable_reason: "temporary_maintenance",
  }));
  await start(page, "connector-management");
  await useChinese(page);
  const settings = await openConnectors(page, true);
  const notice = settings.getByText("当前无法管理连接器。", { exact: true });
  await expect(notice).toBeVisible();
  await expect(settings.getByText(/权限/)).toHaveCount(0);
  for (const name of ["添加 HTTP 连接器", "添加 stdio 连接器"])
    await expect(settings.getByRole("button", { name })).toBeDisabled();
  for (const button of await connector(settings, "docs")
    .getByRole("button")
    .all())
    await expect(button).toBeDisabled();
  expect(mutations).toEqual([]);
});

async function addHttpConnector(
  settings: ReturnType<Page["getByRole"]>,
  name: string,
  url: string,
) {
  await settings.getByRole("button", { name: "Add HTTP connector" }).click();
  const add = settings.getByRole("form", { name: "Add HTTP connector" });
  await add.getByLabel("Connector name").fill(name);
  await add.getByLabel("HTTP URL").fill(url);
  await add.getByRole("button", { name: "Save connector" }).click();
  return add;
}

const NOTHING_LOADED =
  "No connectors are loaded for this Session. One that was saved but hasn't taken effect isn't listed here.";
const AFTER_RESTART = "Saved, takes effect after the server restarts";

test("a connector saved but not loaded stays visible and manageable", async ({
  page,
}) => {
  await start(page, "connector-management-pinned");
  const settings = await openConnectors(page);
  await expect(settings.getByText(NOTHING_LOADED)).toBeVisible();

  const add = await addHttpConnector(
    settings,
    "Team docs",
    "https://team-docs.invalid/mcp",
  );
  await expect(add).toHaveCount(0);
  const row = connector(settings, "mcp-1");
  await expect(row).toContainText("Team docs");
  await expect(row).toContainText(AFTER_RESTART);
  await expect(row).toContainText("https://team-docs.invalid/mcp");
  await expect(row).toContainText("Waiting to take effect");
  // It has never run, so nothing may claim otherwise.
  await expect(row).not.toContainText("connected");
  await expect(row).not.toContainText("tools");
  await expect(row.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
  await expect(settings.getByText(NOTHING_LOADED)).toHaveCount(0);
  await expect(settings).toContainText("1 waiting to take effect");

  // The list stays empty until the server loads it, so neither refreshing nor
  // leaving the page may lose the row.
  await settings.getByRole("button", { name: "Refresh" }).click();
  await expect(settings.getByRole("button", { name: "Refresh" })).toBeEnabled();
  await expect(row).toContainText(AFTER_RESTART);
  await settings.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(row).toHaveCount(0);
  await settings
    .getByRole("button", { name: "Connectors", exact: true })
    .click();
  await expect(row).toContainText(AFTER_RESTART);

  await row.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(row).toContainText("Saved as disabled, won't run");
  await expect(row).not.toContainText(AFTER_RESTART);
  await row.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(row).toContainText(AFTER_RESTART);

  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = settings.getByRole("form", { name: "Edit connector" });
  await expect(edit.getByLabel("Connector name")).toHaveValue("Team docs");
  await edit.getByLabel("Connector name").fill("Team docs renamed");
  await edit.getByLabel("HTTP URL").fill("https://renamed.invalid/mcp");
  await edit.getByRole("button", { name: "Save connector" }).click();
  await expect(row).toContainText("Team docs renamed");
  await expect(row).toContainText("https://renamed.invalid/mcp");

  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);

  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.getByRole("button", { name: "Confirm delete" }).click();
  await expect(row).toHaveCount(0);
  await expect(settings.getByText(NOTHING_LOADED)).toBeVisible();
});

test("a failed create leaves no row and keeps what was typed", async ({
  page,
}) => {
  await start(page, "connector-management-pinned");
  const settings = await openConnectors(page);
  const add = await addHttpConnector(
    settings,
    "Refused",
    "https://refused.invalid/mcp",
  );
  await expect(settings.getByRole("alert")).toContainText("url was refused");
  await expect(settings.locator("[data-connector-id]")).toHaveCount(0);
  await expect(settings).not.toContainText("waiting to take effect");
  await expect(add.getByLabel("Connector name")).toHaveValue("Refused");
  await expect(settings.getByText(NOTHING_LOADED)).toBeVisible();
});

test("a promise of the next turn only appears when the server makes it", async ({
  page,
}) => {
  await start(page, "connector-management-pinned-deferred");
  const settings = await openConnectors(page);
  await addHttpConnector(settings, "Deferred", "https://deferred.invalid/mcp");
  await expect(connector(settings, "mcp-1")).toContainText(
    "Saved, takes effect from the next turn",
  );
});

test("once the server loads a saved connector, its own row takes over", async ({
  page,
}) => {
  await start(page, "connector-management-pinned");
  const settings = await openConnectors(page);
  await addHttpConnector(
    settings,
    "Team docs",
    "https://team-docs.invalid/mcp",
  );
  const row = connector(settings, "mcp-1");
  await expect(row).toContainText(AFTER_RESTART);
  await page.request.post(`${origin}/__test__/connectors/restart`);
  await settings.getByRole("button", { name: "Refresh" }).click();
  await expect(row).toContainText("failed");
  await expect(row).not.toContainText(AFTER_RESTART);
  await expect(row).toHaveCount(1);
  await expect(settings).not.toContainText("waiting to take effect");

  // A listed row keeps showing what runs now, so the page has to say why.
  await row.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText(
    "This server only loads connector changes when it restarts",
  );
  await expect(row).toContainText("failed");
  await row.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText(
    "This server only reconnects connectors when it restarts",
  );
});

test("a saved connector removed elsewhere leaves when the server says so", async ({
  page,
}) => {
  await start(page, "connector-management-pinned");
  const settings = await openConnectors(page);
  await addHttpConnector(
    settings,
    "Team docs",
    "https://team-docs.invalid/mcp",
  );
  const row = connector(settings, "mcp-1");
  await expect(row).toContainText(AFTER_RESTART);
  await page.request.post(`${origin}/__test__/connectors/reset`);
  await row.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(settings.getByRole("alert")).toContainText(
    "This connector is no longer in the saved setup.",
  );
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
      settings.getByText("或从服务器白名单里选择 stdio 连接器"),
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
