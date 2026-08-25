import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function launchWorkspace(page: Page, cwd: string) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Server workspace" }).fill(cwd);
  await page.getByRole("button", { name: "Connect workspace" }).click();
}

test("resumes the server-resolved Octoscode session and supervises work", async ({
  page,
}) => {
  await launchWorkspace(page, "/srv/work/project");

  await expect(
    page.getByText("_main:local:tui#coding", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Sessions" })).toBeVisible();
  await expect(
    page
      .locator(".session-row")
      .filter({ hasText: "Review protocol drift" })
      .getByText("1 running"),
  ).toBeVisible();
  await expect(page.getByText("Validate product checks")).toBeVisible();

  const composer = page.getByPlaceholder(
    "Ask Octos to change, explain, or review code…",
  );
  await composer.fill("Run the product checks");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.getByText(/Context · 13% of 1M/)).toBeVisible();
});

test("preserves unsent drafts across explicit session switches", async ({
  page,
}) => {
  await launchWorkspace(page, "/srv/work/project");
  const composer = page.getByPlaceholder(
    "Ask Octos to change, explain, or review code…",
  );
  await expect(composer).toBeEnabled();
  await composer.fill("draft for coding");

  await page
    .locator(".session-row")
    .filter({ hasText: "Review protocol drift" })
    .click();
  await expect(
    page.getByText("coding:local:review", { exact: true }),
  ).toBeVisible();
  await composer.fill("draft for review");
  await page
    .locator(".session-row")
    .filter({ hasText: "New coding session" })
    .click();
  await expect(
    page.getByText("_main:local:tui#coding", { exact: true }),
  ).toBeVisible();
  await expect(composer).toHaveValue("draft for coding");
});

test("resolves approval and structured-question takeovers", async ({
  page,
}) => {
  await launchWorkspace(page, "/srv/work/project");
  const composer = page.getByPlaceholder(
    "Ask Octos to change, explain, or review code…",
  );

  await composer.fill("Request approval fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText("pnpm check");
  await approval.getByRole("button", { name: /Yes/ }).click();
  await expect(approval).toBeHidden();

  await composer.fill("Request question fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  const question = page.getByRole("dialog", {
    name: "Choose verification depth",
  });
  await expect(question).toBeVisible();
  await question.getByLabel(/Full/).check();
  await question.getByRole("button", { name: "Continue" }).click();
  await expect(question).toBeHidden();
});

test("searches cross-session task activity and opens its session", async ({
  page,
}) => {
  await launchWorkspace(page, "/srv/work/project");
  const composer = page.getByPlaceholder(
    "Ask Octos to change, explain, or review code…",
  );
  await composer.fill("/activity");
  await composer.press("Enter");
  await expect(page.getByRole("dialog", { name: "Activity" })).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include(".activity-dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const search = page.getByRole("searchbox", { name: "Search activity" });
  await expect(search).toBeFocused();
  await search.fill("review protocol");
  await page
    .getByRole("button", { name: "Open Review protocol drift" })
    .click();
  await expect(
    page.getByText("coding:local:review", { exact: true }),
  ).toBeVisible();
});

test("matches activate and cross-profile launch choices", async ({ page }) => {
  await launchWorkspace(page, "/srv/work/new");
  const activate = page.getByRole("button", { name: /Activate _main/ });
  await expect(activate).toBeFocused();
  await activate.click();
  await expect(
    page.getByText("_main:local:tui#coding", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Disconnect" }).click();
  await page
    .getByRole("textbox", { name: "Server workspace" })
    .fill("/srv/work/cross");
  await page.getByRole("button", { name: "Connect workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose this workspace’s profile" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Continue with review/ }).click();
  await expect(
    page.getByText("review:local:tui#coding", { exact: true }),
  ).toBeVisible();
});

test("onboards an empty solo server and opens the canonical coding session", async ({
  page,
}) => {
  await launchWorkspace(page, "/srv/work/no-profile");
  const onboarding = page.getByRole("dialog", {
    name: "Create your local coding profile",
  });
  await expect(onboarding).toBeVisible();
  await expect(onboarding.getByLabel("Provider")).toHaveValue("deepseek");
  await expect(onboarding.getByLabel("Model")).toHaveValue("deepseek-chat");

  const apiKey = onboarding.getByLabel("API key");
  await apiKey.fill("sk-rejected-secret");
  await onboarding.getByRole("button", { name: "Test, save & open" }).click();
  const providerError = onboarding.getByRole("alert");
  await expect(providerError).toContainText("[redacted]");
  await expect(providerError).not.toContainText("sk-rejected-secret");
  await expect(onboarding).toContainText(
    "A retry only repeats provider test and save",
  );

  await apiKey.fill("sk-e2e-valid");
  await onboarding.getByRole("button", { name: "Test, save & open" }).click();
  await expect(
    page.getByText("coding:local:tui#coding", { exact: true }),
  ).toBeVisible();
  await expect(onboarding).toBeHidden();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("keeps the work inspector available on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 740, height: 900 });
  await launchWorkspace(page, "/srv/work/project");
  const workButton = page.getByRole("button", { name: "Work", exact: true });
  await expect(workButton).toBeVisible();
  await workButton.click();
  await expect(page.locator("#work-inspector")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#work-inspector")).toBeHidden();
});
