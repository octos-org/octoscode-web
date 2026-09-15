import { expect, test, type Locator, type Page } from "@playwright/test";

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
    .fill("/workspace/mobile-settings");
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("combobox", { name: "Message Octos" }),
  ).toBeVisible();
}

async function insideViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
}

async function wheelToBottom(page: Page, panel: Locator) {
  const box = (await panel.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 4000);
  await expect
    .poll(() =>
      panel.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(2);
}

for (const viewport of [
  { width: 320, height: 480 },
  { width: 390, height: 844 },
]) {
  test(`Settings remain operable at ${viewport.width}×${viewport.height}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(viewport);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await start(page);
    const navigationTrigger = page.getByRole("button", {
      name: "Open sessions",
    });
    await navigationTrigger.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await expect(settings).toBeVisible();
    const content = settings.getByRole("tabpanel");
    const close = settings.getByRole("button", { name: "Close settings" });
    await wheelToBottom(page, content);
    await insideViewport(page, settings);
    await insideViewport(page, close);
    await insideViewport(
      page,
      settings.getByRole("button", { name: "Disconnect", exact: true }),
    );
    await insideViewport(
      page,
      settings.getByRole("button", { name: "Forget server" }),
    );
    const diagnostics = settings.getByRole("button", {
      name: "Copy diagnostics",
    });
    await insideViewport(page, diagnostics);
    await diagnostics.click();
    await expect(
      settings.getByRole("button", { name: "Copied", exact: true }),
    ).toBeVisible();
    expect(await settings.evaluate((el) => el.scrollTop)).toBe(0);

    await settings.getByRole("button", { name: "Models", exact: true }).click();
    await expect(content).toHaveAttribute("data-settings-section", "models");
    await expect(
      settings.getByRole("list", { name: "Configured providers" }),
    ).toBeVisible();
    await wheelToBottom(page, content);
    await insideViewport(page, close);
    const addProvider = settings.getByRole("button", { name: "Add provider" });
    await addProvider.scrollIntoViewIfNeeded();
    await insideViewport(page, addProvider);
    await addProvider.click();
    const editor = settings.getByRole("form", { name: "Add model provider" });
    await expect(editor).toBeVisible();
    await editor.getByLabel("Provider / family ID").fill("deepseek");
    await editor.getByLabel("Base URL").fill("https://example.test/api/v1");
    const cancel = editor.getByRole("button", { name: "Cancel", exact: true });
    await cancel.scrollIntoViewIfNeeded();
    await insideViewport(page, cancel);
    await insideViewport(page, close);
    await cancel.click();
    await expect(editor).toBeHidden();
    await close.click();
    await expect(settings).toBeHidden();
    await expect(navigationTrigger).toBeFocused();

    const modelTrigger = page.getByRole("button", { name: /^Runtime model:/ });
    await modelTrigger.focus();
    await modelTrigger.press("Enter");
    await expect(settings).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(modelTrigger).toBeFocused();
  });
}
