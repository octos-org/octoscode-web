import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function connect(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/execution-feedback-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

test("folds a failed write, summarizes the turn, and marks the sidebar with zero axe violations", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/execution-transparency-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  await composer.fill("Fail a write fixture unconditionally");
  await composer.press("Enter");

  const failed = page.locator("details").filter({
    hasText: "Write file report.md",
  });
  await expect(failed).toBeVisible();
  // The raw error stays folded until the reader opens the step (T-0076).
  await expect(failed).not.toHaveAttribute("open");
  await failed.locator("summary").click();
  await expect(failed).toHaveAttribute("open", "");
  await expect(failed).toContainText("permission denied: read-only workspace");
  await expect(failed).toContainText("write_file");
  const summary = page.getByLabel("Turn summary");
  // The turn completed, so its summary is not a warning; the unrecovered
  // step is still named.
  await expect(summary).toHaveAttribute("data-outcome", "complete");
  await expect(summary).toContainText("1 steps failed");
  await expect(summary).not.toContainText("⚠");
  await expect(summary).toContainText("0 files changed");
  await expect(summary).toContainText("12 tokens in · 9 tokens out");
  await expect(summary).toContainText("No output files");
  await expect(page.locator('[data-status="attention"]').first()).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("failed-write-summary.png"),
    fullPage: true,
  });
});

test("explains a long wait with its phase, elapsed time, and next action", async ({
  page,
  request,
}) => {
  test.setTimeout(45_000);
  await connect(page);
  await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/hold-next`);
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("Wait for the first model response");
  await composer.press("Enter");

  const feedback = page.locator('[data-waiting-feedback="true"]');
  await expect(feedback).toBeVisible({ timeout: 20_000 });
  await expect(feedback).toContainText("Writing response…");
  await expect(feedback).toContainText(/Elapsed [1-9][0-9]*/);
  await expect(feedback).toContainText(
    "You can stop this turn, check the connection, or retry.",
  );
  await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/reset`);
});
