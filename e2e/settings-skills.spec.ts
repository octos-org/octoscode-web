import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function start(
  page: Page,
  token = "tab-scoped-e2e-token",
): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/settings-skills-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  const reference = new URL(page.url()).searchParams.get("s");
  return (JSON.parse(reference!) as string[])[2]!;
}

test("lists installed skills, invokes an action, and advances its job without axe violations", async ({
  page,
}, testInfo) => {
  const sessionId = await start(page);
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(
    settings.getByText("lifecycle-skill", { exact: true }),
  ).toBeVisible();
  await expect(settings.getByText("1.2.3", { exact: true })).toBeVisible();
  await expect(settings).toContainText("fixtures/lifecycle-skill");
  await expect(
    settings.getByText("Description not reported by the server."),
  ).toBeVisible();
  await expect(
    settings.getByText(/Remote one-click install is unavailable/),
  ).toBeVisible();
  await expect(settings.getByRole("button", { name: /install/i })).toHaveCount(
    0,
  );

  await settings.getByRole("button", { name: "Invoke", exact: true }).click();
  await expect(settings.getByText("Queued", { exact: true })).toBeVisible();
  const response = await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/skill/job/progress?session_id=${encodeURIComponent(sessionId)}`,
  );
  expect(response.status()).toBe(204);
  await expect(settings.getByText("Succeeded", { exact: true })).toBeVisible();
  await expect(
    settings.getByText("protocol action fixture").first(),
  ).toBeVisible();
  await settings.getByText("Result details").click();
  await expect(
    settings.getByText(/"summary": "protocol action fixture"/),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("settings-skills-job.png"),
    fullPage: true,
  });
});

test("keeps same-named actions' arguments independent and invokes the qualified skill", async ({
  page,
}) => {
  await start(page, "skill-duplicates-e2e-token");
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Skills", exact: true }).click();
  const first = settings.locator("article").filter({ hasText: "First probe" });
  const second = settings
    .locator("article")
    .filter({ hasText: "Second probe" });
  await first.getByLabel("input_path").fill("first.md");
  await second.getByLabel("input_path").fill("second.md");
  await expect(first.getByLabel("input_path")).toHaveValue("first.md");
  await expect(second.getByLabel("input_path")).toHaveValue("second.md");
  await second.getByRole("button", { name: "Invoke", exact: true }).click();
  await expect(
    settings.getByText("other-skill/document.probe:second.md"),
  ).toBeVisible();
});
