import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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
    .fill(`/workspace/settings-connectors-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

async function openSection(page: Page, name: string) {
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name, exact: true }).click();
  return settings;
}

test("shows read-only MCP status without add/edit/OAuth controls and passes axe", async ({
  page,
}) => {
  await start(page);
  const settings = await openSection(page, "Connectors");
  await expect(settings.getByText("Documentation MCP")).toBeVisible();
  await expect(
    settings.getByText("connected", { exact: true }).first(),
  ).toBeVisible();
  await expect(settings.getByText("failed", { exact: true })).toBeVisible();
  await expect(settings.getByText("connection refused")).toBeVisible();
  await expect(
    settings.getByRole("button", { name: /add|oauth|edit/i }),
  ).toHaveCount(0);
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("enables and disables an existing cron job without a create control and passes axe", async ({
  page,
}) => {
  await start(page);
  const settings = await openSection(page, "Scheduled tasks");
  await expect(settings.getByText("Queue check")).toBeVisible();
  await expect(
    settings.getByText(/New scheduled tasks are unavailable/),
  ).toBeVisible();
  const toggle = settings.getByRole("checkbox");
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("does not let a delayed list response overwrite a confirmed cron toggle", async ({
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
      if (frame.method === "cron/list") {
        listCalls += 1;
        if (listCalls > 1 && frame.id) heldListIds.add(frame.id);
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
  await start(page);
  const settings = await openSection(page, "Scheduled tasks");
  const toggle = settings.getByRole("checkbox");
  await expect(toggle).not.toBeChecked();
  await settings.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await toggle.click();
  await expect(toggle).toBeChecked();
  release?.();
  await expect(toggle).toBeChecked();
  expect(listCalls).toBe(2);
});
