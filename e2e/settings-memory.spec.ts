import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function start(page: Page, token = "tab-scoped-e2e-token") {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/settings-memory-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

async function openMemory(page: Page) {
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(
    settings.locator("summary").getByText("Long-term memory"),
  ).toBeVisible();
  return settings;
}

test("shows overview, entity and record details, searches, and ingests with zero axe violations", async ({
  page,
}) => {
  await start(page);
  const settings = await openMemory(page);
  await expect(settings.getByText("Protocol memory fixture.")).toBeVisible();
  await expect(settings.getByText("Today’s memory note.")).toBeVisible();
  await settings.getByRole("button", { name: /t0008/ }).first().click();
  await expect(settings.getByText("Protocol entity detail.")).toBeVisible();

  await settings.getByLabel("Search memories").fill("protocol");
  await settings.getByRole("button", { name: "Search", exact: true }).click();
  await settings.getByRole("button", { name: /T0008 protocol probe/ }).click();
  await expect(settings.getByText("probe body")).toBeVisible();

  await settings.getByLabel("Title").fill("Browser memory");
  await settings.getByLabel("Summary").fill("saved from settings");
  await settings.getByLabel("Memory content").fill("remembered body");
  await settings
    .getByRole("button", { name: "Remember this", exact: true })
    .click();
  await expect(
    settings.getByText("1 inserted · 0 updated · 0 unchanged"),
  ).toBeVisible();
  await expect(settings.getByText("remembered body")).toBeVisible();
  await expect(
    settings.getByText(/Editing and deleting memories are not available/),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Request memory" }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Promote to Knowledge" }),
  ).toHaveCount(0);

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("shows request and promote only when the server advertises them", async ({
  page,
}) => {
  await start(page, "memory-main-e2e-token");
  const settings = await openMemory(page);
  await settings.getByLabel("Memory content").fill("request this memory");
  await settings.getByRole("button", { name: "Request memory" }).click();
  await expect(
    settings.getByText("Memory request accepted: accepted"),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Promote to Knowledge" }).click();
  await expect(
    settings.getByText(/Promotion staged for 1 record/),
  ).toBeVisible();
});
