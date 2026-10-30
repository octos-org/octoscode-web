import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function start(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill(workspace);
  await page.getByLabel("Server workspace path").press("Enter");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  return composer;
}

test("keeps the panel switch primary and moves secondary header actions into an accessible menu", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await start(page, `/workspace/first-look-header-${Date.now()}`);
  await page.screenshot({
    path: testInfo.outputPath("header.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Session panel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy as Markdown", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Browser preferences", exact: true }),
  ).toHaveCount(0);

  const more = page.getByRole("button", { name: "More actions", exact: true });
  await more.click();
  const menu = page.getByRole("menu", { name: "Conversation actions" });
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Copy as Markdown", exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Browser preferences", exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("header-menu.png"),
    fullPage: true,
  });

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await page
    .getByRole("menuitem", { name: "Browser preferences", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Browser preferences", exact: true }),
  ).toBeVisible();
});

test("names a session from its first prompt instead of exposing its id", async ({
  page,
}, testInfo) => {
  const composer = await start(
    page,
    `/workspace/first-look-name-${Date.now()}`,
  );
  const selectedTitle = page.locator(
    '[role="treeitem"][data-session-id][aria-current="page"] [class*="sessionTitle"]',
  );
  await page.screenshot({
    path: testInfo.outputPath("session-name.png"),
    fullPage: true,
  });
  await expect(selectedTitle).toHaveText("New session");
  const prompt = "Name this session from its first prompt";
  await composer.fill(prompt);
  await composer.press("Enter");
  await expect(selectedTitle).toHaveText(prompt);
  await expect(selectedTitle).not.toContainText(/Session [0-9a-f]{8}/);
});
