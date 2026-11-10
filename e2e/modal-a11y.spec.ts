import { expect, test, type Locator, type Page } from "@playwright/test";
import { connectAndStartWorkspace } from "./fixture-session.ts";

function productNavigation(page: Page): Locator {
  return page.locator("aside");
}

function settingsTrigger(page: Page): Locator {
  return productNavigation(page).getByRole("button", { name: "Settings" });
}

async function openSettings(page: Page): Promise<Locator> {
  await settingsTrigger(page).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function focusIsInside(dialog: Locator): Promise<boolean> {
  return dialog.evaluate((element) => element.contains(document.activeElement));
}

test("Tab and Shift+Tab cycle focus inside the modal only", async ({
  page,
}) => {
  await connectAndStartWorkspace(page, "/srv/work/modal-a11y-tab-cycle");
  const dialog = await openSettings(page);

  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Tab");
    await expect.poll(() => focusIsInside(dialog)).toBe(true);
  }
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => focusIsInside(dialog)).toBe(true);
  }
});
