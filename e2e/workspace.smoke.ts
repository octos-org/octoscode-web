import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/cross-browser");
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

test("a workspace sends a prompt, reopens durable history and restores an unsent draft", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await connect(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await expect(
    page.getByRole("heading", { name: "Durable coding transcript" }),
  ).toBeVisible();
  await input.fill("Reply with a brief explanation of the workspace");
  await input.press("Enter");
  await expect(page.locator(".timeline .entry-assistant").last()).toContainText(
    "Completed with pnpm check",
  );
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeHidden();
  await input.fill("尚未发送\n保留我的草稿");
  await page.reload();
  await expect(input).toHaveValue("尚未发送\n保留我的草稿");
  // This deterministic fixture hydrates a fixed durable transcript; the real
  // Core integration/acceptance checks verify persistence of new responses.
  await expect(
    page.getByRole("heading", { name: "Durable coding transcript" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy code block" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("theme choice and keyboard Settings navigation work with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await connect(page);
  await page
    .getByRole("button", { name: "Theme: system", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.focus();
  await expect(settings).toBeFocused();
  await settings.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settings).toBeFocused();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
