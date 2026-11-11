import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN, FIXTURE_TOKEN } from "./fixture-session";
import { composer } from "./sessions";

/**
 * WEB-WORKSPACE-BROWSER-CONTRACT-5000 — browsing the SERVER's folders from the
 * Add workspace form. The fixture advertises the feature only to the browsing
 * token, so the same file covers the feature-absent path with another token.
 */

const BROWSE_TOKEN = "workspace-browse-e2e-token";

async function connect(page: Page, token: string): Promise<Locator> {
  await page.goto("/");
  await expect(page.locator("#connection-title")).toBeVisible();
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const form = page.getByRole("region", {
    name: /Add workspace|Browse server folders/,
  });
  await expect(form).toBeVisible();
  return form;
}

function browser(page: Page): Locator {
  return page.getByRole("region", { name: "Browse server folders" });
}

function currentFolder(page: Page): Locator {
  return page.locator('[data-browse-path="true"]');
}

async function openBrowser(page: Page, form: Locator): Promise<Locator> {
  const surface = browser(page);
  if (!(await surface.isVisible().catch(() => false))) {
    await form.getByRole("button", { name: "Browse server folders" }).click();
  }
  await expect(surface).toBeVisible();
  return surface;
}

test("browses the server's folders, drills in and out, and reports what the server hid", async ({
  page,
}) => {
  const form = await connect(page, BROWSE_TOKEN);
  await openBrowser(page, form);
  await expect(
    page.getByRole("button", { name: "Enter path manually" }),
  ).toBeVisible();

  // An empty path box opens on the server's OWN working directory.
  await expect(currentFolder(page)).toHaveText("/srv/fixture");
  // `hidden_skipped` is reported honestly rather than silently swallowed.
  await expect(page.locator('[data-browse-notice="true"]')).toContainText(
    "2 hidden folders aren't shown.",
  );

  // Drill in.
  await page.getByRole("button", { name: "Open folder Projects" }).click();
  await expect(currentFolder(page)).toHaveText("/srv/fixture/Projects");
  await expect(
    page.getByRole("button", { name: "Open folder octoscode-web" }),
  ).toBeVisible();

  // …and back out through the parent affordance.
  await page.getByRole("button", { name: "Go to the parent folder" }).click();
  await expect(currentFolder(page)).toHaveText("/srv/fixture");

  // The way up is disabled at a root, never a dead control that does nothing.
  await page.getByRole("button", { name: "Open folder archive" }).click();
  await expect(currentFolder(page)).toHaveText("/srv/fixture/archive");
  await expect(page.locator('[data-browse-notice="true"]')).toContainText(
    "Only the first 1 folders are shown.",
  );
  for (const _step of [0, 1, 2]) {
    await page.getByRole("button", { name: "Go to the parent folder" }).click();
  }
  await expect(currentFolder(page)).toHaveText("/");
  await expect(
    page.getByRole("button", { name: "Go to the parent folder" }),
  ).toBeDisabled();

  const results = await new AxeBuilder({ page })
    .include('[data-workspace-browser="true"]')
    .analyze();
  expect(results.violations).toEqual([]);
});

test("shows no Browse affordance at all when the server does not advertise the feature", async ({
  page,
}) => {
  const form = await connect(page, FIXTURE_TOKEN);
  await expect(form.getByLabel("Server workspace path")).toBeVisible();
  await expect(
    form.getByRole("button", { name: "Browse server folders" }),
  ).toHaveCount(0);
  await expect(page.locator("[data-workspace-browse]")).toHaveCount(0);
  await expect(form.getByText("Browse", { exact: false })).toHaveCount(0);
  await expect(browser(page)).toHaveCount(0);

  // The typed-path form still works exactly as it did before the feature.
  await form.getByLabel("Server workspace path").fill("/workspace/no-browse");
  await form.getByRole("button", { name: "Start session" }).click();
  await expect(composer(page)).toBeEnabled();
});
