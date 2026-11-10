import { expect, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN } from "./fixture-session.ts";

/** Connects with one of the fixture's memory tokens and starts a Session. */
export async function startMemorySession(
  page: Page,
  token: string,
  name: string,
) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/${name}-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

/** Opens Settings › Memory; by default waits for the overview to load. */
export async function openMemory(page: Page, expectOverview = true) {
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Memory", exact: true }).click();
  if (expectOverview) {
    await expect(
      settings.locator("summary").getByText("Long-term memory"),
    ).toBeVisible();
  }
  return settings;
}
