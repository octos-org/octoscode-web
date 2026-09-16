import { expect, type Page } from "@playwright/test";

/** Follow the product's status strip into the advanced controller surface. */
export async function openSessionController(page: Page): Promise<void> {
  const pane = page.getByRole("dialog", {
    name: "Session settings",
    exact: true,
  });
  if (!(await pane.isVisible())) {
    await page
      .getByRole("button", { name: "Session settings", exact: true })
      .click();
  }
  await expect(pane).toBeVisible();
  const advanced = pane.locator("details.session-config-advanced");
  if ((await advanced.getAttribute("open")) === null) {
    await advanced.locator(":scope > summary").click();
  }
}

export async function closeSessionController(page: Page): Promise<void> {
  const pane = page.getByRole("dialog", {
    name: "Session settings",
    exact: true,
  });
  if (await pane.isVisible()) {
    await pane.getByRole("button", { name: "Close", exact: true }).click();
    await expect(pane).toHaveCount(0);
  }
}
