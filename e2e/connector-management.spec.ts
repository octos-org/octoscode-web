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

test.afterEach(async ({ request }) => {
  await request.post(`${origin}/__test__/connectors/reset`);
});
