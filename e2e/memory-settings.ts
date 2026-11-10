import { expect, type Page } from "@playwright/test";
import { startSession } from "./fixture-session.ts";

/** Connects with one of the fixture's memory tokens and starts a Session. */
export const startMemorySession = (page: Page, token: string, name: string) =>
  startSession(page, `/workspace/${name}-${Date.now()}`, token);

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
