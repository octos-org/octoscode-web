import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const EXECUTION_METHOD = "session/execution_environment/read";
const EXECUTION_FEATURE = "session.execution_environment.v1";

test.beforeEach(async ({ request }) => {
  await request.post(`${ORIGIN}/__test__/execution-environment/complete`);
});

async function openSettings(page: Page) {
  await page.goto("/");
  await page.locator("#connection-origin").fill(ORIGIN);
  await page.locator("#connection-token").fill("tab-scoped-e2e-token");
  await page.locator('form[class*="card"] button[type="submit"]').click();
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace|选择工作区|添加工作区/,
  });
  if (
    await chooser
      .getByRole("button", { name: /Add workspace|添加工作区/ })
      .isVisible()
  ) {
    await chooser
      .getByRole("button", { name: /Add workspace|添加工作区/ })
      .click();
  }
  const path = page.getByLabel(/Server workspace path|服务器工作区路径/);
  await path.fill("/srv/work/runtime-environment");
  await path.press("Enter");
  await page.getByRole("button", { name: /Session settings|会话设置/ }).click();
  return page.getByRole("dialog", { name: /Session settings|会话设置/ });
}

test("shows the complete Docker execution environment and tool availability", async ({
  page,
}) => {
  const dialog = await openSettings(page);
  const environment = dialog.locator('[data-execution-environment="true"]');
  await expect(environment.getByText("Docker", { exact: true })).toBeVisible();
  await expect(environment.getByText("node:22-bookworm")).toBeVisible();
  await expect(environment.getByText("Available", { exact: true })).toHaveCount(
    3,
  );
  await expect(environment.getByText("Missing", { exact: true })).toHaveCount(
    1,
  );
  await expect(environment.locator("time")).toHaveAttribute(
    "datetime",
    "2026-11-01T00:00:00Z",
  );
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await expect(environment).toHaveScreenshot("execution-environment.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
  });
});

test("shows a failed probe and its reason as neutral information", async ({
  page,
}) => {
  await page.request.post(`${ORIGIN}/__test__/execution-environment/failed`);
  const dialog = await openSettings(page);
  const environment = dialog.locator('[data-execution-environment="true"]');
  await expect(
    environment.locator('[data-probe-status="failed"]'),
  ).toBeVisible();
  await expect(environment.getByText("Probe failed: timeout")).toBeVisible();
  await expect(environment.getByRole("alert")).toHaveCount(0);
});

test("shows unsupported probing as neutral information", async ({ page }) => {
  await page.request.post(
    `${ORIGIN}/__test__/execution-environment/unsupported`,
  );
  const dialog = await openSettings(page);
  const environment = dialog.locator('[data-execution-environment="true"]');
  await expect(
    environment.getByText("This environment does not support probing"),
  ).toBeVisible();
  await expect(
    environment.locator('[data-probe-status="unsupported"]'),
  ).toHaveAttribute("data-probe-status", "unsupported");
  await expect(environment.getByRole("alert")).toHaveCount(0);
});

test("does not call or display execution probing on an older server", async ({
  page,
}) => {
  let calls = 0;
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === EXECUTION_METHOD) calls += 1;
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      const scrub = (value) => {
        if (value === EXECUTION_METHOD || value === EXECUTION_FEATURE)
          return null;
        if (Array.isArray(value))
          return value.map(scrub).filter((entry) => entry !== null);
        if (value && typeof value === "object") {
          return Object.fromEntries(
            Object.entries(value)
              .map(([key, entry]) => [key, scrub(entry)])
              .filter(([, entry]) => entry !== null),
          );
        }
        return value;
      };
      socket.send(JSON.stringify(scrub(frame)));
    });
  });
  const dialog = await openSettings(page);
  await expect(dialog.getByRole("region", { name: "Sandbox" })).toBeVisible();
  await expect(
    dialog.locator('[data-execution-environment="true"]'),
  ).toHaveCount(0);
  expect(calls).toBe(0);
});

test("localizes the execution environment in Chinese", async ({ page }) => {
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
  const dialog = await openSettings(page);
  const environment = dialog.locator('[data-execution-environment="true"]');
  await expect(
    environment.getByText("执行环境", { exact: true }),
  ).toBeVisible();
  await expect(environment.getByText("后端", { exact: true })).toBeVisible();
  await expect(
    environment.getByText("Docker 镜像", { exact: true }),
  ).toBeVisible();
  await expect(environment.getByText("可用", { exact: true })).toHaveCount(3);
  await expect(environment.getByText("没有", { exact: true })).toHaveCount(1);
});
