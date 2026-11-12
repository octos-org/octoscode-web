import { expect, test, type Page } from "@playwright/test";
import { hidden, instrument } from "./attention-probe";
import { startSession } from "./fixture-session";
import {
  newSessionIn,
  openSettings,
  productNavigation,
  selectSession,
  sendPrompt,
} from "./sessions";

const WORKSPACE = "/workspace/attention-check";
const FINISHED = "Completed with pnpm check and all tests passing.";

async function settings(page: Page) {
  const dialog = await openSettings(page);
  await expect(
    dialog.getByRole("button", { name: /desktop notifications/ }),
  ).toBeVisible();
  return dialog;
}

async function enable(page: Page) {
  const dialog = await settings(page);
  expect(await page.evaluate(() => window.__attentionProbe.requests)).toBe(0);
  const toggle = dialog.getByRole("button", {
    name: /desktop notifications/,
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__attentionProbe.requests)).toBe(1);
  await dialog.getByRole("button", { name: "Close settings" }).click();
}

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test("denied desktop permission keeps tab counts working and Disconnect clears attention", async ({
  page,
}) => {
  await instrument(page, "denied");
  await startSession(page, WORKSPACE);
  const originalTitle = await page.title();
  const dialog = await settings(page);
  expect(await page.evaluate(() => window.__attentionProbe.requests)).toBe(0);
  await dialog.getByRole("button", { name: /desktop notifications/ }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Notifications are blocked",
  );
  await expect(
    dialog.getByRole("button", { name: /desktop notifications/ }),
  ).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await hidden(page, true);
  await sendPrompt(page, "Stream a reply fixture");
  await expect(page.getByText(FINISHED, { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(`(1) ${originalTitle}`);
  expect(await page.evaluate(() => window.__attentionProbe.notices)).toEqual(
    [],
  );
  const reopened = await settings(page);
  await reopened
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await expect(page).toHaveTitle(originalTitle);
  expect(await page.evaluate(() => window.__attentionProbe.notices)).toEqual(
    [],
  );
});

test("a background Session completing while another is selected signals and acknowledges on return", async ({
  page,
}) => {
  await instrument(page);
  await startSession(page, WORKSPACE);
  const originalTitle = await page.title();
  await enable(page);
  const navigation = productNavigation(page);
  const sessions = navigation.locator('[role="treeitem"][data-session-id]');
  const originalSessionTitle = await sessions
    .first()
    .getAttribute("data-session-id");
  if (!originalSessionTitle)
    throw new Error("Expected a confirmed Session title");
  await sendPrompt(page, "Continue this turn while I open another Session");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await newSessionIn(navigation, "attention-check");
  await expect(sessions).toHaveCount(2);
  await expect(
    navigation.locator('[title="Completed in background"]'),
  ).toBeVisible();
  await expect(page).toHaveTitle(`(1) ${originalTitle}`);
  expect(
    await page.evaluate(() => window.__attentionProbe.notices),
  ).toHaveLength(1);
  await selectSession(navigation, originalSessionTitle);
  await expect(page).toHaveTitle(originalTitle);
  expect(
    await page.evaluate(() => window.__attentionProbe.notices[0]?.closed),
  ).toBe(true);
});
