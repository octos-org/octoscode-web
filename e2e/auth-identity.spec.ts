import { expect, test } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

test("rejects invalid auth before the product shell is ever mounted", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const watch = { seen: false };
    const scan = () => {
      if (document.querySelector('[aria-label="Product navigation"]')) {
        watch.seen = true;
      }
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    Object.assign(window, { __octosFixtureShellWatch: watch });
    scan();
  });

  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("fixture-invalid-auth-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.locator('[role="alert"]')).toContainText(
    "Could not connect",
  );
  await expect(page.locator("#connection-title")).toBeVisible();
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: /Choose a workspace|Add workspace/ }),
  ).toHaveCount(0);
  const shellWasSeen = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __octosFixtureShellWatch?: { seen: boolean };
        }
      ).__octosFixtureShellWatch?.seen ?? false,
  );
  expect(shellWasSeen).toBe(false);
});
