import { expect, test, type Locator, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

function productNavigation(page: Page): Locator {
  return page.locator("aside");
}

function settingsTrigger(page: Page): Locator {
  return productNavigation(page).getByRole("button", { name: "Settings" });
}

async function connectAndStartWorkspace(
  page: Page,
  cwd: string,
): Promise<void> {
  await page.goto("/");
  await expect(
    page.locator("#connection-title"),
  ).toBeVisible();
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", { name: "Choose a workspace" });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "Add workspace" }).click();
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await addWorkspace.getByLabel("Server workspace path").fill(cwd);
  await addWorkspace.getByRole("button", { name: "Add & Start" }).click();
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeEnabled();
}

async function openSettings(page: Page): Promise<Locator> {
  await settingsTrigger(page).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function focusIsInside(dialog: Locator): Promise<boolean> {
  return dialog.evaluate((element) =>
    element.contains(document.activeElement),
  );
}

function backgroundHidden(background: Locator): Promise<boolean> {
  return background.evaluate(
    (element) =>
      element.getAttribute("aria-hidden") === "true" ||
      element.hasAttribute("inert"),
  );
}

test("Escape closes the modal and returns focus to its opener", async ({
  page,
}) => {
  await connectAndStartWorkspace(page, "/srv/work/modal-a11y-escape");
  const opener = settingsTrigger(page);
  const dialog = await openSettings(page);
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  await page.keyboard.press("Escape");

  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("initial focus lands on the surface's first focusable control", async ({
  page,
}) => {
  await connectAndStartWorkspace(page, "/srv/work/modal-a11y-initial-focus");
  const dialog = await openSettings(page);

  await expect.poll(() => focusIsInside(dialog)).toBe(true);
  await expect(
    dialog.getByRole("button", { name: "Close settings" }),
  ).toBeFocused();
});

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

test("background content is hidden from assistive tech while open", async ({
  page,
}) => {
  await connectAndStartWorkspace(page, "/srv/work/modal-a11y-background");
  const background = page.locator("main.workspace-grid");
  await expect(background).toHaveCount(1);

  const dialog = await openSettings(page);
  await expect.poll(() => backgroundHidden(background)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      background.evaluate(
        (element) =>
          element.getAttribute("aria-hidden") === null &&
          !element.hasAttribute("inert"),
      ),
    )
    .toBe(true);
});
