import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function openConversation(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/first-open-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

test("the first panel open never substitutes a loading modal", async ({
  page,
}) => {
  await page.route("**/*.js", async (route) => {
    if (route.request().url().includes("SessionPanelHost")) {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await route.continue();
  });
  await openConversation(page);
  await page.getByRole("button", { name: /^Session panel/ }).click();
  await page.waitForTimeout(150);
  await expect(
    page.getByRole("heading", { name: "Loading session panel…" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tablist", { name: "Session panel" }),
  ).toBeVisible({ timeout: 100 });
});

test("the first mobile navigation drawer appears within 100ms", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/*.js", async (route) => {
    if (route.request().url().includes("ModalSurface")) {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await route.continue();
  });
  await openConversation(page);
  await page
    .getByRole("button", { name: "Open sessions", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Sessions and workspaces" }),
  ).toBeVisible({ timeout: 100 });
});
