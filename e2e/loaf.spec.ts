import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${
  process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"
}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

// Frame budget for the streaming phase: a long animation frame over this is
// a jank signal worth failing on. Generous enough to avoid runner noise.
const LONG_FRAME_BUDGET_MS = 200;

test.use({ channel: "chromium" });

async function connectAndStart(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const add = page.getByRole("region", { name: "Add workspace" });
  await expect(add).toBeVisible();
  await add
    .getByLabel("Server workspace path")
    .fill("/workspace/octoscode-web");
  await add.getByRole("button", { name: "Start session" }).click();
  await expect(add).toBeHidden();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeVisible();
}

test("streaming turn stays under the long-frame budget", async ({ page }) => {
  await connectAndStart(page);

  // Arm the LoAF observer (unbuffered) right before the streaming phase so
  // page-load frames do not pollute the measurement.
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__loaf = [];
    const observer = new PerformanceObserver((list) => {
      const frames = (
        window as unknown as Record<string, { duration: number }[]>
      ).__loaf;
      for (const entry of list.getEntries()) {
        frames.push({ duration: entry.duration });
      }
    });
    observer.observe({ type: "long-animation-frame", buffered: false });
  });

  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("Stream a reply fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.getByText("Completed with")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(1_000);

  const frames = await page.evaluate(
    () => (window as unknown as Record<string, { duration: number }[]>).__loaf,
  );
  const worst = frames.reduce((max, f) => Math.max(max, f.duration), 0);
  console.log(`[loaf] frames=${frames.length} worst=${worst.toFixed(1)}ms`);
  // The gate: nothing in the streaming phase may block the main thread for
  // longer than the budget.
  expect(
    frames.some((f) => f.duration > LONG_FRAME_BUDGET_MS),
    `long animation frames exceeded the ${LONG_FRAME_BUDGET_MS}ms budget`,
  ).toBe(false);
});
