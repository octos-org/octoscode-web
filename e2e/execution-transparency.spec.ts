import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

test("expands a failed write, summarizes the turn, and marks the sidebar with zero axe violations", async ({
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
  await composer.fill("Fail a write fixture");
  await composer.press("Enter");

  const failed = page.locator("details").filter({
    hasText: "Write file report.md",
  });
  await expect(failed).toBeVisible();
  await expect(failed).toHaveAttribute("open", "");
  await expect(failed).toContainText("permission denied: read-only workspace");
  await expect(failed).toContainText("write_file");
  const summary = page.getByLabel("Turn summary");
  await expect(summary).toContainText("⚠ 1 steps failed");
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
